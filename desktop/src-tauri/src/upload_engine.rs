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
    upload_transfer::{
        self, LocalUploadFile, UploadRunInput, UploadRunResult, UploadTransferEvent,
        UploadTransferState,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadTask {
    id: String,
    file: LocalUploadFile,
    folder_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    relative_path: Option<String>,
    skip_existing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    status: UploadTaskStatus,
    uploaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadSnapshot {
    tasks: Vec<UploadTask>,
    completion_version: u64,
    revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadTaskEvent {
    task: UploadTask,
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

    let snapshot = {
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

        for planned in plan.files {
            let key = (planned.folder_id.clone(), planned.file.name.clone());
            if !known.insert(key) {
                continue;
            }

            let id = engine.next_task_id();
            let task = UploadTask {
                id: id.clone(),
                relative_path: (planned.relative_path != planned.file.name)
                    .then_some(planned.relative_path),
                file: planned.file,
                folder_id: planned.folder_id,
                skip_existing: planned.skip_existing,
                session_id: None,
                status: UploadTaskStatus::Queued,
                uploaded_bytes: 0,
                error: None,
            };

            inner.order.push(id.clone());
            inner.queue.push_back(id.clone());
            inner.tasks.insert(id, task);
            added = true;
        }

        if added {
            inner.revision = inner.revision.wrapping_add(1);
            Some(snapshot_from_inner(&inner))
        } else {
            None
        }
    };

    if let Some(snapshot) = snapshot {
        let _ = app.emit(SNAPSHOT_EVENT, snapshot);
    }

    if plan.created_folders > 0 {
        emit_folder_changed(&app, &folder_id);
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
        let task = task.clone();
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
            let task = task.clone();
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
            && !(matches!(task.status, UploadTaskStatus::Uploading | UploadTaskStatus::Error)
                && task.session_id.is_some())
        {
            return Ok(());
        }

        task.status = UploadTaskStatus::Cancelling;
        task.error = None;
        let task = task.clone();
        let upload_id = task.session_id.clone();
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
        let task = task.clone();
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

        let removable = matches!(
            task.status,
            UploadTaskStatus::Completed | UploadTaskStatus::Skipped | UploadTaskStatus::Cancelled
        ) || task.status == UploadTaskStatus::Error && task.session_id.is_none();

        if !removable {
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

    for upload_id in upload_ids {
        let _ = upload_transfer::cancel_upload(api, &upload_id).await;
    }

    for task_id in task_ids {
        let _ = transfers.finish(&task_id);
    }

    let _ = app.emit(SNAPSHOT_EVENT, snapshot);
    Ok(())
}

fn pump(
    app: AppHandle,
    api: ApiState,
    transfers: UploadTransferState,
    engine: UploadEngineState,
) -> Result<(), ApiCommandError> {
    loop {
        let next = {
            let mut inner = engine.lock()?;
            if inner.active_files >= FILE_CONCURRENCY {
                None
            } else {
                let mut task_id = None;

                while let Some(candidate) = inner.queue.pop_front() {
                    if inner
                        .tasks
                        .get(&candidate)
                        .is_some_and(|task| task.status == UploadTaskStatus::Queued)
                    {
                        task_id = Some(candidate);
                        break;
                    }
                }

                task_id.map(|task_id| {
                    inner.active_files += 1;
                    (task_id, inner.generation)
                })
            }
        };

        let Some((task_id, generation)) = next else {
            return Ok(());
        };

        let task_app = app.clone();
        let task_api = api.clone();
        let task_transfers = transfers.clone();
        let task_engine = engine.clone();

        tauri::async_runtime::spawn(async move {
            run_engine_task(
                task_app.clone(),
                task_api.clone(),
                task_transfers.clone(),
                task_engine.clone(),
                task_id,
                generation,
            )
            .await;

            let should_pump = match task_engine.lock() {
                Ok(mut inner) if inner.generation == generation => {
                    inner.active_files = inner.active_files.saturating_sub(1);
                    true
                }
                _ => false,
            };

            if should_pump {
                let _ = pump(task_app, task_api, task_transfers, task_engine);
            }
        });
    }
}

async fn run_engine_task(
    app: AppHandle,
    api: ApiState,
    transfers: UploadTransferState,
    engine: UploadEngineState,
    task_id: String,
    generation: u64,
) {
    let initial = match queued_task(&engine, &task_id, generation) {
        Ok(Some(task)) => task,
        _ => return,
    };

    if let Err(error) = transfers.begin(task_id.clone()) {
        if let Ok(Some(event)) = set_task_error(&engine, &task_id, Some(generation), error.message().to_string()) {
            emit_task_event(&app, event);
        }
        return;
    }

    let preparing = match set_task_preparing(&engine, &task_id, generation) {
        Ok(Some(event)) => event,
        _ => {
            let _ = transfers.finish(&task_id);
            return;
        }
    };
    emit_task_event(&app, preparing);

    let progress_engine = engine.clone();
    let progress_app = app.clone();
    let progress_task_id = task_id.clone();
    let result = upload_transfer::run_upload_task(
        &api,
        &transfers,
        UploadRunInput {
            task_id: task_id.clone(),
            upload_id: initial.session_id.clone(),
            folder_id: initial.folder_id.clone(),
            path: initial.file.path.clone(),
            name: initial.file.name.clone(),
            size: initial.file.size,
        },
        move |event| {
            if let Ok(Some(event)) = apply_transfer_event(
                &progress_engine,
                &progress_task_id,
                generation,
                event,
            ) {
                emit_task_event(&progress_app, event);
            }
        },
    )
    .await;

    let _ = transfers.finish(&task_id);

    match result {
        Ok(result) => {
            if let Ok(Some(event)) = complete_task(&engine, &task_id, generation, result) {
                let folder_id = event.task.folder_id.clone();
                emit_task_event(&app, event);
                emit_folder_changed(&app, &folder_id);
            }
        }
        Err(error) => {
            emit_unauthorized(&app, &error);

            if let Ok(Some(event)) = fail_task(&engine, &task_id, generation, &error) {
                emit_task_event(&app, event);
            }
        }
    }
}

fn queued_task(
    engine: &UploadEngineState,
    task_id: &str,
    generation: u64,
) -> Result<Option<UploadTask>, ApiCommandError> {
    let inner = engine.lock()?;
    if inner.generation != generation {
        return Ok(None);
    }

    Ok(inner
        .tasks
        .get(task_id)
        .filter(|task| task.status == UploadTaskStatus::Queued)
        .cloned())
}

fn set_task_preparing(
    engine: &UploadEngineState,
    task_id: &str,
    generation: u64,
) -> Result<Option<UploadTaskEvent>, ApiCommandError> {
    let mut inner = engine.lock()?;
    if inner.generation != generation {
        return Ok(None);
    }

    let completion_version = inner.completion_version;
    let Some(task) = inner.tasks.get_mut(task_id) else {
        return Ok(None);
    };

    if task.status != UploadTaskStatus::Queued {
        return Ok(None);
    }

    task.status = UploadTaskStatus::Preparing;
    task.error = None;
    let task = task.clone();
    inner.revision = inner.revision.wrapping_add(1);

    Ok(Some(UploadTaskEvent {
        task,
        completion_version,
        revision: inner.revision,
    }))
}

fn apply_transfer_event(
    engine: &UploadEngineState,
    task_id: &str,
    generation: u64,
    transfer: UploadTransferEvent,
) -> Result<Option<UploadTaskEvent>, ApiCommandError> {
    let mut inner = engine.lock()?;
    if inner.generation != generation {
        return Ok(None);
    }

    let completion_version = inner.completion_version;
    let Some(task) = inner.tasks.get_mut(task_id) else {
        return Ok(None);
    };

    if matches!(task.status, UploadTaskStatus::Cancelling | UploadTaskStatus::Cancelled) {
        return Ok(None);
    }

    task.session_id = Some(transfer.session_id);
    task.uploaded_bytes = task.uploaded_bytes.max(transfer.uploaded_bytes.min(task.file.size));
    task.status = if transfer.status == "finalizing" {
        UploadTaskStatus::Finalizing
    } else {
        UploadTaskStatus::Uploading
    };
    let task = task.clone();
    inner.revision = inner.revision.wrapping_add(1);

    Ok(Some(UploadTaskEvent {
        task,
        completion_version,
        revision: inner.revision,
    }))
}

fn complete_task(
    engine: &UploadEngineState,
    task_id: &str,
    generation: u64,
    result: UploadRunResult,
) -> Result<Option<UploadTaskEvent>, ApiCommandError> {
    let mut inner = engine.lock()?;
    if inner.generation != generation {
        return Ok(None);
    }

    {
        let Some(task) = inner.tasks.get_mut(task_id) else {
            return Ok(None);
        };

        if matches!(task.status, UploadTaskStatus::Cancelling | UploadTaskStatus::Cancelled) {
            return Ok(None);
        }

        task.session_id = Some(result.session_id);
        task.status = UploadTaskStatus::Completed;
        task.uploaded_bytes = result.uploaded_bytes.min(task.file.size);
        task.error = None;
    }

    if !inner.tasks.values().any(|task| is_active_status(task.status))
        && !inner
            .tasks
            .values()
            .any(|task| task.status == UploadTaskStatus::Error)
    {
        inner.completion_version = inner.completion_version.wrapping_add(1);
    }

    inner.revision = inner.revision.wrapping_add(1);
    let completion_version = inner.completion_version;
    let revision = inner.revision;
    Ok(inner.tasks.get(task_id).cloned().map(|task| UploadTaskEvent {
        task,
        completion_version,
        revision,
    }))
}

fn fail_task(
    engine: &UploadEngineState,
    task_id: &str,
    generation: u64,
    error: &ApiCommandError,
) -> Result<Option<UploadTaskEvent>, ApiCommandError> {
    let mut inner = engine.lock()?;
    if inner.generation != generation {
        return Ok(None);
    }

    let completion_version = inner.completion_version;
    let Some(task) = inner.tasks.get_mut(task_id) else {
        return Ok(None);
    };

    if matches!(task.status, UploadTaskStatus::Cancelling | UploadTaskStatus::Cancelled) {
        return Ok(None);
    }

    if task.skip_existing && error.is_file_already_exists() {
        task.status = UploadTaskStatus::Skipped;
        task.uploaded_bytes = 0;
        task.error = None;
    } else if error.is_cancelled() {
        task.status = UploadTaskStatus::Cancelled;
        task.uploaded_bytes = 0;
        task.error = None;
    } else {
        task.status = UploadTaskStatus::Error;
        task.error = Some(upload_error_message(error));
    }

    let task = task.clone();
    inner.revision = inner.revision.wrapping_add(1);
    Ok(Some(UploadTaskEvent {
        task,
        completion_version,
        revision: inner.revision,
    }))
}

fn set_task_error(
    engine: &UploadEngineState,
    task_id: &str,
    generation: Option<u64>,
    message: String,
) -> Result<Option<UploadTaskEvent>, ApiCommandError> {
    let mut inner = engine.lock()?;
    if generation.is_some_and(|generation| inner.generation != generation) {
        return Ok(None);
    }

    let completion_version = inner.completion_version;
    let Some(task) = inner.tasks.get_mut(task_id) else {
        return Ok(None);
    };

    task.status = UploadTaskStatus::Error;
    task.error = Some(message);
    let task = task.clone();
    inner.revision = inner.revision.wrapping_add(1);

    Ok(Some(UploadTaskEvent {
        task,
        completion_version,
        revision: inner.revision,
    }))
}

fn upload_error_message(error: &ApiCommandError) -> String {
    match error.request_id() {
        Some(request_id) => format!("{} · {request_id}", error.message()),
        None => error.message().to_string(),
    }
}

fn snapshot_from_inner(inner: &UploadEngineInner) -> UploadSnapshot {
    let tasks = inner
        .order
        .iter()
        .filter_map(|id| inner.tasks.get(id).cloned())
        .collect();

    UploadSnapshot {
        tasks,
        completion_version: inner.completion_version,
        revision: inner.revision,
    }
}

fn emit_task_event(app: &AppHandle, event: UploadTaskEvent) {
    let _ = app.emit(TASK_EVENT, event);
}

fn emit_folder_changed(app: &AppHandle, folder_id: &str) {
    let _ = app.emit(
        FOLDER_CHANGED_EVENT,
        UploadFolderChangedEvent {
            folder_id: folder_id.to_string(),
        },
    );
}

fn emit_unauthorized(app: &AppHandle, error: &ApiCommandError) {
    if error.is_unauthorized() {
        let _ = app.emit(UNAUTHORIZED_EVENT, ());
    }
}

async fn plan_upload_files(
    api: &ApiState,
    parent_folder_id: &str,
    files: Vec<LocalUploadFile>,
) -> Result<UploadPlan, ApiCommandError> {
    let (entries, folder_paths) = build_upload_tree(files)?;

    if folder_paths.is_empty() {
        return Ok(UploadPlan {
            files: entries
                .into_iter()
                .map(|entry| PlannedUploadFile {
                    file: entry.file,
                    folder_id: parent_folder_id.to_string(),
                    relative_path: entry.relative_path,
                    skip_existing: false,
                })
                .collect(),
            created_folders: 0,
        });
    }

    let (resolved, created_folders) = resolve_folder_paths(api, parent_folder_id, &folder_paths).await?;
    let files = entries
        .into_iter()
        .map(|entry| {
            let folder_id = if entry.directory_path.is_empty() {
                parent_folder_id.to_string()
            } else {
                resolved.get(&entry.directory_path).cloned().ok_or_else(|| {
                    ApiCommandError::invalid_response(format!(
                        "Could not resolve upload folder: {}",
                        entry.directory_path
                    ))
                })?
            };

            Ok(PlannedUploadFile {
                file: entry.file,
                folder_id,
                relative_path: entry.relative_path,
                skip_existing: !entry.directory_path.is_empty(),
            })
        })
        .collect::<Result<Vec<_>, ApiCommandError>>()?;

    Ok(UploadPlan {
        files,
        created_folders,
    })
}

fn build_upload_tree(
    files: Vec<LocalUploadFile>,
) -> Result<(Vec<UploadEntry>, Vec<String>), ApiCommandError> {
    let entries = files
        .into_iter()
        .map(build_upload_entry)
        .collect::<Result<Vec<_>, _>>()?;
    let mut folders = HashSet::new();

    for entry in &entries {
        if entry.directory_path.is_empty() {
            continue;
        }

        let segments = entry.directory_path.split('/').collect::<Vec<_>>();
        for index in 1..=segments.len() {
            folders.insert(segments[..index].join("/"));
        }
    }

    let mut folder_paths = folders.into_iter().collect::<Vec<_>>();
    folder_paths.sort_by(|left, right| {
        folder_depth(left)
            .cmp(&folder_depth(right))
            .then_with(|| left.cmp(right))
    });

    Ok((entries, folder_paths))
}

fn build_upload_entry(file: LocalUploadFile) -> Result<UploadEntry, ApiCommandError> {
    let source = file.relative_path.trim_start_matches('/');
    let raw_segments = source.split('/').collect::<Vec<_>>();

    if raw_segments.iter().any(|segment| {
        segment.is_empty() || *segment == "." || *segment == ".." || segment.contains('\0')
    }) {
        return Err(ApiCommandError::invalid_request(format!(
            "Unsafe upload path: {}",
            file.relative_path
        )));
    }

    let mut normalized = raw_segments
        .iter()
        .map(|segment| normalize_segment(segment))
        .collect::<Result<Vec<_>, _>>()?;
    let relative_file_name = normalized
        .pop()
        .ok_or_else(|| ApiCommandError::invalid_request("Upload path is empty."))?;
    let file_name = normalize_segment(&file.name)?;

    if relative_file_name != file_name {
        return Err(ApiCommandError::invalid_request(format!(
            "Upload path does not match file name: {}",
            file.relative_path
        )));
    }

    let directory_path = normalized.join("/");
    let relative_path = if directory_path.is_empty() {
        file_name
    } else {
        format!("{directory_path}/{file_name}")
    };

    Ok(UploadEntry {
        file,
        relative_path,
        directory_path,
    })
}

fn normalize_segment(value: &str) -> Result<String, ApiCommandError> {
    let segment = value.trim();

    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.contains('\0')
        || segment.contains('/')
        || segment.contains('\\')
    {
        return Err(ApiCommandError::invalid_request(format!(
            "Unsafe upload path segment: {value}"
        )));
    }

    Ok(segment.to_string())
}

async fn resolve_folder_paths(
    api: &ApiState,
    parent_folder_id: &str,
    paths: &[String],
) -> Result<(HashMap<String, String>, usize), ApiCommandError> {
    let mut children = HashMap::<String, Vec<String>>::new();

    for path in paths {
        children
            .entry(parent_path(path).to_string())
            .or_default()
            .push(path.clone());
    }

    for values in children.values_mut() {
        values.sort();
    }

    let roots = children.get("").cloned().unwrap_or_default();
    let mut work = VecDeque::from([(parent_folder_id.to_string(), roots)]);
    let mut resolved = HashMap::new();
    let mut created = 0usize;

    while let Some((remote_parent_id, roots)) = work.pop_front() {
        if roots.is_empty() {
            continue;
        }

        let (selected, deferred) = take_folder_batch(roots, &children);

        let client_ids = selected
            .iter()
            .enumerate()
            .map(|(index, path)| (path.clone(), format!("folder-{index}")))
            .collect::<HashMap<_, _>>();
        let folders = selected
            .iter()
            .map(|path| {
                let client_id = client_ids.get(path).cloned().ok_or_else(|| {
                    ApiCommandError::internal("Upload folder client ID is missing.")
                })?;
                let parent = parent_path(path);
                let value = match client_ids.get(parent) {
                    Some(parent_client_id) => json!({
                        "clientId": client_id,
                        "parentClientId": parent_client_id,
                        "name": folder_name(path),
                    }),
                    None => json!({
                        "clientId": client_id,
                        "name": folder_name(path),
                    }),
                };

                Ok(value)
            })
            .collect::<Result<Vec<Value>, ApiCommandError>>()?;
        let result: BatchFoldersResult = api
            .request_json(
                Method::POST,
                "/api/v1/folders/batch".to_string(),
                Some(json!({
                    "parentFolderId": remote_parent_id.clone(),
                    "folders": folders,
                })),
            )
            .await?;
        let path_by_client_id = client_ids
            .iter()
            .map(|(path, client_id)| (client_id.clone(), path.clone()))
            .collect::<HashMap<_, _>>();

        for folder in result.folders {
            let path = path_by_client_id.get(&folder.client_id).ok_or_else(|| {
                ApiCommandError::invalid_response(format!(
                    "Unexpected folder batch result: {}",
                    folder.client_id
                ))
            })?;

            resolved.insert(path.clone(), folder.folder_id);
            if folder.created {
                created += 1;
            }
        }

        for path in &selected {
            if !resolved.contains_key(path) {
                return Err(ApiCommandError::invalid_response(format!(
                    "Folder batch response omitted: {path}"
                )));
            }
        }

        for (parent, roots) in deferred {
            let next_parent_id = if parent.is_empty() {
                remote_parent_id.clone()
            } else {
                resolved.get(&parent).cloned().ok_or_else(|| {
                    ApiCommandError::invalid_response(format!(
                        "Could not resolve upload parent: {parent}"
                    ))
                })?
            };

            work.push_back((next_parent_id, roots));
        }
    }

    Ok((resolved, created))
}

fn take_folder_batch(
    roots: Vec<String>,
    children: &HashMap<String, Vec<String>>,
) -> (Vec<String>, BTreeMap<String, Vec<String>>) {
    let mut stack = roots.into_iter().rev().collect::<Vec<_>>();
    let mut selected = Vec::new();
    let mut deferred = BTreeMap::<String, Vec<String>>::new();

    while let Some(path) = stack.pop() {
        if selected.len() >= MAX_BATCH_FOLDERS {
            deferred
                .entry(parent_path(&path).to_string())
                .or_default()
                .push(path);
            continue;
        }

        if let Some(descendants) = children.get(&path) {
            stack.extend(descendants.iter().rev().cloned());
        }

        selected.push(path);
    }

    (selected, deferred)
}

fn parent_path(path: &str) -> &str {
    path.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("")
}

fn folder_name(path: &str) -> &str {
    path.rsplit_once('/').map(|(_, name)| name).unwrap_or(path)
}

fn folder_depth(path: &str) -> usize {
    path.bytes().filter(|byte| *byte == b'/').count() + 1
}

fn is_active_status(status: UploadTaskStatus) -> bool {
    matches!(
        status,
        UploadTaskStatus::Queued
            | UploadTaskStatus::Preparing
            | UploadTaskStatus::Uploading
            | UploadTaskStatus::Finalizing
            | UploadTaskStatus::Cancelling
    )
}

fn valid_resource_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::upload_transfer::LocalUploadFile;

    use super::{build_upload_tree, folder_depth, normalize_segment, take_folder_batch};

    #[test]
    fn builds_upload_folder_tree() {
        let files = vec![LocalUploadFile {
            path: "C:/upload/root/sub/file.txt".to_string(),
            name: "file.txt".to_string(),
            size: 12,
            relative_path: "root/sub/file.txt".to_string(),
        }];
        let (entries, folders) = build_upload_tree(files).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].directory_path, "root/sub");
        assert_eq!(folders, vec!["root".to_string(), "root/sub".to_string()]);
    }

    #[test]
    fn validates_upload_segments() {
        assert_eq!(normalize_segment(" file.txt ").unwrap(), "file.txt");
        assert!(normalize_segment("..").is_err());
        assert!(normalize_segment("folder/name").is_err());
        assert!(normalize_segment("folder\\name").is_err());
    }

    #[test]
    fn limits_folder_batches() {
        let roots = (0..1500)
            .map(|index| format!("root-{index:04}"))
            .collect::<Vec<_>>();
        let (selected, deferred) = take_folder_batch(roots, &HashMap::new());

        assert_eq!(selected.len(), 1000);
        assert_eq!(deferred.get("").map(Vec::len), Some(500));
    }

    #[test]
    fn sorts_folder_depth() {
        assert_eq!(folder_depth("one"), 1);
        assert_eq!(folder_depth("one/two/three"), 3);
    }
}
