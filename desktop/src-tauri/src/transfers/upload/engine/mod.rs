use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::{
    api::{ApiCommandError, ApiState},
    transfers::upload::transfer::{
        self as upload_transfer, LocalUploadFile, UploadRunInput, UploadRunResult,
        UploadTransferEvent, UploadTransferState,
    },
};

const FILE_CONCURRENCY: usize = 3;
const MAX_BATCH_FOLDERS: usize = 1000;
const SNAPSHOT_EVENT: &str = "discloud-upload-snapshot";
const TASK_EVENT: &str = "discloud-upload-task";
const REMOVED_EVENT: &str = "discloud-upload-removed";
const FOLDER_CHANGED_EVENT: &str = "discloud-upload-folder-changed";
const UNAUTHORIZED_EVENT: &str = "discloud-upload-unauthorized";

#[derive(Clone)]
pub(crate) struct UploadEngineState {
    inner: Arc<Mutex<UploadEngineInner>>,
    sequence: Arc<AtomicU64>,
}

impl Default for UploadEngineState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(UploadEngineInner::default())),
            sequence: Arc::new(AtomicU64::new(0)),
        }
    }
}

#[derive(Default)]
struct UploadEngineInner {
    tasks: HashMap<String, UploadTask>,
    order: Vec<String>,
    queue: VecDeque<String>,
    active_files: usize,
    completion_version: u64,
    revision: u64,
    generation: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum UploadTaskStatus {
    Queued,
    Preparing,
    Uploading,
    Finalizing,
    Completed,
    Skipped,
    Error,
    Cancelling,
    Cancelled,
}

#[derive(Clone)]
struct UploadTask {
    id: String,
    file: LocalUploadFile,
    folder_id: String,
    relative_path: Option<String>,
    skip_existing: bool,
    session_id: Option<String>,
    thumbnail_key: Option<String>,
    committed_file_id: Option<String>,
    status: UploadTaskStatus,
    uploaded_bytes: u64,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadFileView {
    name: String,
    size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadTaskView {
    id: String,
    file: UploadFileView,
    folder_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    committed_file_id: Option<String>,
    status: UploadTaskStatus,
    uploaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    can_cancel: bool,
    can_remove: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadSnapshot {
    tasks: Vec<UploadTaskView>,
    completion_version: u64,
    revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadTaskEvent {
    task: UploadTaskView,
    completion_version: u64,
    revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadRemovedEvent {
    task_id: String,
    completion_version: u64,
    revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadFolderChangedEvent {
    folder_id: String,
}

struct UploadPlan {
    files: Vec<PlannedUploadFile>,
    created_folders: usize,
}

struct PlannedUploadFile {
    file: LocalUploadFile,
    folder_id: String,
    relative_path: String,
    skip_existing: bool,
}

struct UploadEntry {
    file: LocalUploadFile,
    relative_path: String,
    directory_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchFoldersResult {
    folders: Vec<BatchFolderResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchFolderResult {
    client_id: String,
    folder_id: String,
    created: bool,
}

impl UploadEngineState {
    fn lock(&self) -> Result<MutexGuard<'_, UploadEngineInner>, ApiCommandError> {
        self.inner
            .lock()
            .map_err(|_| ApiCommandError::internal("Upload engine state lock is poisoned."))
    }

    pub(crate) fn snapshot(&self) -> Result<UploadSnapshot, ApiCommandError> {
        let inner = self.lock()?;
        Ok(snapshot_from_inner(&inner))
    }

    fn next_task_id(&self) -> String {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();

        format!("upload-{}-{timestamp}-{sequence}", std::process::id())
    }
}

pub(crate) async fn add_paths(
    app: AppHandle,
    api: ApiState,
    transfers: UploadTransferState,
    engine: UploadEngineState,
    folder_id: String,
    paths: Vec<String>,
) -> Result<(), ApiCommandError> {
    if !valid_resource_id(&folder_id) {
        return Err(ApiCommandError::invalid_request("Invalid folder ID."));
    }

    if paths.is_empty() {
        return Ok(());
    }

    let generation = engine.lock()?.generation;
    let files = upload_transfer::inspect_files(paths).await?;
    let plan = match plan_upload_files(&api, &folder_id, files).await {
        Ok(plan) => plan,
        Err(error) => {
            if engine.lock()?.generation == generation {
                emit_unauthorized(&app, &error);
            }
            return Err(error);
        }
    };

    let (snapshot, thumbnail_jobs) = {
        let mut inner = engine.lock()?;
        if inner.generation != generation {
            return Ok(());
        }
        let mut known = inner
            .tasks
            .values()
            .filter(|task| {
                !matches!(
                    task.status,
                    UploadTaskStatus::Completed
                        | UploadTaskStatus::Skipped
                        | UploadTaskStatus::Cancelled
                )
            })
            .map(|task| (task.folder_id.clone(), task.file.name.clone()))
            .collect::<HashSet<_>>();
        let mut added = false;
        let mut thumbnail_jobs = Vec::new();

        for planned in plan.files {
            let key = (planned.folder_id.clone(), planned.file.name.clone());
            if !known.insert(key) {
                continue;
            }

            let id = engine.next_task_id();
            thumbnail_jobs.push((id.clone(), planned.file.path.clone()));
            let task = UploadTask {
                id: id.clone(),
                relative_path: (planned.relative_path != planned.file.name)
                    .then_some(planned.relative_path),
                file: planned.file,
                folder_id: planned.folder_id,
                skip_existing: planned.skip_existing,
                session_id: None,
                thumbnail_key: None,
                committed_file_id: None,
                status: UploadTaskStatus::Queued,
                uploaded_bytes: 0,
                error: None,
            };

            inner.order.push(id.clone());
            inner.queue.push_back(id.clone());
            inner.tasks.insert(id, task);
            added = true;
        }

        let snapshot = if added {
            inner.revision = inner.revision.wrapping_add(1);
            Some(snapshot_from_inner(&inner))
        } else {
            None
        };
        (snapshot, thumbnail_jobs)
    };

    if let Some(snapshot) = snapshot {
        let _ = app.emit(SNAPSHOT_EVENT, snapshot);
    }

    if plan.created_folders > 0 {
        emit_folder_changed(&app, &folder_id);
    }

    for (task_id, path) in thumbnail_jobs {
        spawn_task_thumbnail(
            app.clone(),
            api.clone(),
            engine.clone(),
            task_id,
            generation,
            path,
        );
    }

    pump(app, api, transfers, engine)
}

pub(crate) fn retry(
    app: AppHandle,
    api: ApiState,
    transfers: UploadTransferState,
    engine: UploadEngineState,
    task_id: String,
) -> Result<(), ApiCommandError> {
    let event = {
        let mut inner = engine.lock()?;
        let completion_version = inner.completion_version;
        let Some(task) = inner.tasks.get_mut(&task_id) else {
            return Ok(());
        };

        if task.status != UploadTaskStatus::Error {
            return Ok(());
        }

        task.status = UploadTaskStatus::Queued;
        if task.session_id.is_none() {
            task.uploaded_bytes = 0;
        }
        task.error = None;
        let task = upload_task_view(task);
        inner.queue.push_back(task_id);
        inner.revision = inner.revision.wrapping_add(1);

        UploadTaskEvent {
            task,
            completion_version,
            revision: inner.revision,
        }
    };

    emit_task_event(&app, event);
    pump(app, api, transfers, engine)
}

pub(crate) async fn cancel(
    app: AppHandle,
    api: ApiState,
    transfers: UploadTransferState,
    engine: UploadEngineState,
    task_id: String,
) -> Result<(), ApiCommandError> {
    let (event, upload_id) = {
        let mut inner = engine.lock()?;
        let completion_version = inner.completion_version;
        let Some(task) = inner.tasks.get_mut(&task_id) else {
            return Ok(());
        };

        if task.status == UploadTaskStatus::Queued {
            task.status = UploadTaskStatus::Cancelled;
            task.uploaded_bytes = 0;
            task.error = None;
            let task = upload_task_view(task);
            inner.revision = inner.revision.wrapping_add(1);
            let event = UploadTaskEvent {
                task,
                completion_version,
                revision: inner.revision,
            };
            drop(inner);
            emit_task_event(&app, event);
            return Ok(());
        }

        if matches!(
            task.status,
            UploadTaskStatus::Completed
                | UploadTaskStatus::Skipped
                | UploadTaskStatus::Cancelled
                | UploadTaskStatus::Finalizing
                | UploadTaskStatus::Cancelling
        ) {
            return Ok(());
        }

        if task.status != UploadTaskStatus::Preparing
            && !(matches!(
                task.status,
                UploadTaskStatus::Uploading | UploadTaskStatus::Error
            ) && task.session_id.is_some())
        {
            return Ok(());
        }

        task.status = UploadTaskStatus::Cancelling;
        task.error = None;
        let upload_id = task.session_id.clone();
        let task = upload_task_view(task);
        inner.revision = inner.revision.wrapping_add(1);
        (
            UploadTaskEvent {
                task,
                completion_version,
                revision: inner.revision,
            },
            upload_id,
        )
    };

    emit_task_event(&app, event);

    let _ = transfers.cancel(&task_id)?;

    if let Some(upload_id) = upload_id {
        if let Err(error) = upload_transfer::cancel_upload(&api, &upload_id).await {
            emit_unauthorized(&app, &error);
            let event = set_task_error(&engine, &task_id, None, upload_error_message(&error))?;
            if let Some(event) = event {
                emit_task_event(&app, event);
            }
            return Err(error);
        }
    }

    let event = {
        let mut inner = engine.lock()?;
        let completion_version = inner.completion_version;
        let Some(task) = inner.tasks.get_mut(&task_id) else {
            return Ok(());
        };

        task.status = UploadTaskStatus::Cancelled;
        task.uploaded_bytes = 0;
        task.error = None;
        let task = upload_task_view(task);
        inner.revision = inner.revision.wrapping_add(1);
        UploadTaskEvent {
            task,
            completion_version,
            revision: inner.revision,
        }
    };

    emit_task_event(&app, event);
    Ok(())
}

pub(crate) fn remove(
    app: AppHandle,
    engine: UploadEngineState,
    task_id: String,
) -> Result<(), ApiCommandError> {
    let event = {
        let mut inner = engine.lock()?;
        let Some(task) = inner.tasks.get(&task_id) else {
            return Ok(());
        };

        if !can_remove_task(task) {
            return Ok(());
        }

        inner.tasks.remove(&task_id);
        inner.order.retain(|id| id != &task_id);
        inner.queue.retain(|id| id != &task_id);
        inner.revision = inner.revision.wrapping_add(1);

        UploadRemovedEvent {
            task_id,
            completion_version: inner.completion_version,
            revision: inner.revision,
        }
    };

    let _ = app.emit(REMOVED_EVENT, event);
    Ok(())
}

pub(crate) async fn reset(
    app: &AppHandle,
    api: &ApiState,
    transfers: &UploadTransferState,
    engine: &UploadEngineState,
) -> Result<(), ApiCommandError> {
    let (task_ids, upload_ids, snapshot) = {
        let mut inner = engine.lock()?;
        let task_ids = inner
            .tasks
            .values()
            .filter(|task| is_active_status(task.status))
            .map(|task| task.id.clone())
            .collect::<Vec<_>>();
        let upload_ids = inner
            .tasks
            .values()
            .filter(|task| {
                !matches!(
                    task.status,
                    UploadTaskStatus::Completed
                        | UploadTaskStatus::Skipped
                        | UploadTaskStatus::Cancelled
                )
            })
            .filter_map(|task| task.session_id.clone())
            .collect::<HashSet<_>>();

        inner.generation = inner.generation.wrapping_add(1);
        inner.revision = inner.revision.wrapping_add(1);
        inner.tasks.clear();
        inner.order.clear();
        inner.queue.clear();
        inner.active_files = 0;
        inner.completion_version = 0;

        (task_ids, upload_ids, snapshot_from_inner(&inner))
    };

    for task_id in &task_ids {
        let _ = transfers.cancel(task_id);
    }

    for task_id in task_ids {
        let _ = transfers.finish(&task_id);
    }

    let _ = app.emit(SNAPSHOT_EVENT, snapshot);

    let cancellations = upload_ids
        .into_iter()
        .map(|upload_id| {
            let api = api.clone();

            tauri::async_runtime::spawn(async move {
                let _ = upload_transfer::cancel_upload(&api, &upload_id).await;
            })
        })
        .collect::<Vec<_>>();

    for cancellation in cancellations {
        let _ = cancellation.await;
    }

    crate::thumbnails::clear_cache(app);
    Ok(())
}

include!("runner.rs");
include!("planner.rs");
