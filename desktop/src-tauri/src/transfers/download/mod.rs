use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::api::{ApiCommandError, ApiState};

const SNAPSHOT_EVENT: &str = "discloud-download-snapshot";
const TASK_EVENT: &str = "discloud-download-task";
const REMOVED_EVENT: &str = "discloud-download-removed";
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

#[derive(Clone)]
pub(crate) struct DownloadEngineState {
    inner: Arc<Mutex<DownloadEngineInner>>,
    sequence: Arc<AtomicU64>,
}

impl Default for DownloadEngineState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(DownloadEngineInner::default())),
            sequence: Arc::new(AtomicU64::new(0)),
        }
    }
}

#[derive(Default)]
struct DownloadEngineInner {
    tasks: HashMap<String, DownloadTask>,
    order: Vec<String>,
    revision: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DownloadTaskStatus {
    Queued,
    Downloading,
    Completed,
    Error,
    Cancelling,
    Cancelled,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DownloadTaskPhase {
    Preparing,
    Resuming,
    Resolving,
    Transferring,
    Verifying,
    Finalizing,
}

#[derive(Clone)]
struct DownloadTask {
    id: String,
    file_id: String,
    collection_id: Option<String>,
    file_name: String,
    destination: PathBuf,
    status: DownloadTaskStatus,
    phase: Option<DownloadTaskPhase>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    completed_chunks: Option<usize>,
    total_chunks: Option<usize>,
    bytes_per_second: Option<u64>,
    eta_seconds: Option<u64>,
    error: Option<String>,
    started_at: Option<u64>,
    finished_at: Option<u64>,
    cancel: Arc<AtomicBool>,
    cancel_notify: Arc<Notify>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadTaskView {
    id: String,
    file_name: String,
    status: DownloadTaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<DownloadTaskPhase>,
    downloaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_chunks: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_chunks: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_per_second: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    eta_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    finished_at: Option<u64>,
    can_cancel: bool,
    can_retry: bool,
    can_remove: bool,
    can_reveal: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadSnapshot {
    tasks: Vec<DownloadTaskView>,
    revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadTaskEvent {
    task: DownloadTaskView,
    revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadRemovedEvent {
    task_id: String,
    revision: u64,
}

enum DownloadRunError {
    Cancelled,
    Failed(ApiCommandError),
}

impl From<ApiCommandError> for DownloadRunError {
    fn from(error: ApiCommandError) -> Self {
        Self::Failed(error)
    }
}

impl DownloadEngineState {
    fn lock(&self) -> Result<MutexGuard<'_, DownloadEngineInner>, ApiCommandError> {
        self.inner
            .lock()
            .map_err(|_| ApiCommandError::internal("Download engine state lock is poisoned."))
    }

    pub(crate) fn snapshot(&self) -> Result<DownloadSnapshot, ApiCommandError> {
        let inner = self.lock()?;
        Ok(snapshot_from_inner(&inner))
    }

    fn next_task_id(&self) -> String {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();

        format!("download-{}-{timestamp}-{sequence}", std::process::id())
    }
}

pub(crate) fn start_download(
    app: AppHandle,
    api: ApiState,
    engine: DownloadEngineState,
    file_id: String,
    collection_id: Option<String>,
    file_name: String,
    destination: String,
) -> Result<DownloadTaskView, ApiCommandError> {
    validate_resource_id(&file_id, "file")?;
    if let Some(collection_id) = collection_id.as_deref() {
        validate_resource_id(collection_id, "collection")?;
    }

    if file_name.trim().is_empty() {
        return Err(ApiCommandError::invalid_request(
            "Download file name is required.",
        ));
    }

    let destination = validate_destination(destination)?;
    let id = engine.next_task_id();
    let task = DownloadTask {
        id: id.clone(),
        file_id,
        collection_id,
        file_name,
        destination,
        status: DownloadTaskStatus::Queued,
        phase: None,
        downloaded_bytes: 0,
        total_bytes: None,
        completed_chunks: None,
        total_chunks: None,
        bytes_per_second: None,
        eta_seconds: None,
        error: None,
        started_at: None,
        finished_at: None,
        cancel: Arc::new(AtomicBool::new(false)),
        cancel_notify: Arc::new(Notify::new()),
    };

    let (view, revision) = {
        let mut inner = engine.lock()?;
        inner.order.push(id.clone());
        inner.tasks.insert(id.clone(), task);
        inner.revision = inner.revision.wrapping_add(1);
        let view = task_view(inner.tasks.get(&id).expect("download task inserted"));
        (view, inner.revision)
    };

    emit_task(&app, view.clone(), revision)?;
    spawn_download(app, api, engine, id);
    Ok(view)
}

pub(crate) fn retry_download(
    app: AppHandle,
    api: ApiState,
    engine: DownloadEngineState,
    task_id: String,
) -> Result<(), ApiCommandError> {
    mutate_task(&app, &engine, &task_id, |task| {
        if !matches!(
            task.status,
            DownloadTaskStatus::Error | DownloadTaskStatus::Cancelled
        ) {
            return Err(ApiCommandError::invalid_request(
                "Only failed or cancelled downloads can be retried.",
            ));
        }

        task.status = DownloadTaskStatus::Queued;
        task.phase = None;
        task.downloaded_bytes = 0;
        task.total_bytes = None;
        task.completed_chunks = None;
        task.total_chunks = None;
        task.bytes_per_second = None;
        task.eta_seconds = None;
        task.error = None;
        task.started_at = None;
        task.finished_at = None;
        task.cancel = Arc::new(AtomicBool::new(false));
        task.cancel_notify = Arc::new(Notify::new());
        Ok(())
    })?;

    spawn_download(app, api, engine, task_id);
    Ok(())
}

pub(crate) fn cancel_download(
    app: AppHandle,
    engine: &DownloadEngineState,
    task_id: String,
) -> Result<(), ApiCommandError> {
    mutate_task(&app, engine, &task_id, |task| {
        if !matches!(
            task.status,
            DownloadTaskStatus::Queued | DownloadTaskStatus::Downloading
        ) {
            return Err(ApiCommandError::invalid_request(
                "This download cannot be cancelled.",
            ));
        }

        task.cancel.store(true, Ordering::Relaxed);
        task.cancel_notify.notify_one();
        task.status = DownloadTaskStatus::Cancelling;
        task.bytes_per_second = None;
        task.eta_seconds = None;
        Ok(())
    })
}

pub(crate) fn remove_download(
    app: AppHandle,
    engine: &DownloadEngineState,
    task_id: String,
) -> Result<(), ApiCommandError> {
    let revision = {
        let mut inner = engine.lock()?;
        let task = inner
            .tasks
            .get(&task_id)
            .ok_or_else(|| ApiCommandError::invalid_request("Download task not found."))?;

        if matches!(
            task.status,
            DownloadTaskStatus::Queued
                | DownloadTaskStatus::Downloading
                | DownloadTaskStatus::Cancelling
        ) {
            return Err(ApiCommandError::invalid_request(
                "Active downloads cannot be removed.",
            ));
        }

        inner.tasks.remove(&task_id);
        inner.order.retain(|id| id != &task_id);
        inner.revision = inner.revision.wrapping_add(1);
        inner.revision
    };

    app.emit(REMOVED_EVENT, DownloadRemovedEvent { task_id, revision })
        .map_err(|error| {
            ApiCommandError::internal(format!("Could not emit download removal: {error}"))
        })
}

pub(crate) fn reveal_download(
    engine: &DownloadEngineState,
    task_id: String,
) -> Result<(), ApiCommandError> {
    let destination = {
        let inner = engine.lock()?;
        let task = inner
            .tasks
            .get(&task_id)
            .ok_or_else(|| ApiCommandError::invalid_request("Download task not found."))?;

        if task.status != DownloadTaskStatus::Completed {
            return Err(ApiCommandError::invalid_request(
                "Only completed downloads can be revealed.",
            ));
        }

        task.destination.clone()
    };

    reveal_path(&destination)
}

pub(crate) fn reset(app: &AppHandle, engine: &DownloadEngineState) -> Result<(), ApiCommandError> {
    let snapshot = {
        let mut inner = engine.lock()?;
        for task in inner.tasks.values() {
            task.cancel.store(true, Ordering::Relaxed);
            task.cancel_notify.notify_one();
        }
        inner.tasks.clear();
        inner.order.clear();
        inner.revision = inner.revision.wrapping_add(1);
        snapshot_from_inner(&inner)
    };

    app.emit(SNAPSHOT_EVENT, snapshot).map_err(|error| {
        ApiCommandError::internal(format!("Could not emit download reset: {error}"))
    })
}

mod direct;

pub(crate) use direct::download_folder_direct;

include!("runner.rs");
