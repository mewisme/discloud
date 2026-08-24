use std::{
    collections::HashMap,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use reqwest::Method;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::{
    fs::{self, File},
    io::AsyncWriteExt,
    sync::Notify,
};

use crate::api::{response_error, ApiCommandError, ApiState};

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

#[derive(Clone)]
struct DownloadTask {
    id: String,
    file_id: String,
    collection_id: Option<String>,
    file_name: String,
    destination: PathBuf,
    status: DownloadTaskStatus,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
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
    downloaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
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
        downloaded_bytes: 0,
        total_bytes: None,
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
        task.downloaded_bytes = 0;
        task.total_bytes = None;
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

fn spawn_download(app: AppHandle, api: ApiState, engine: DownloadEngineState, task_id: String) {
    tauri::async_runtime::spawn(async move {
        match run_download(&app, &api, &engine, &task_id).await {
            Ok(()) => {}
            Err(DownloadRunError::Cancelled) => {
                let _ = mutate_task(&app, &engine, &task_id, |task| {
                    task.status = DownloadTaskStatus::Cancelled;
                    task.bytes_per_second = None;
                    task.eta_seconds = None;
                    task.finished_at = Some(now_millis());
                    Ok(())
                });
            }
            Err(DownloadRunError::Failed(error)) => {
                let message = error.message().to_string();
                let _ = mutate_task(&app, &engine, &task_id, |task| {
                    task.status = DownloadTaskStatus::Error;
                    task.bytes_per_second = None;
                    task.eta_seconds = None;
                    task.error = Some(message);
                    task.finished_at = Some(now_millis());
                    Ok(())
                });
            }
        }
    });
}

async fn run_download(
    app: &AppHandle,
    api: &ApiState,
    engine: &DownloadEngineState,
    task_id: &str,
) -> Result<(), DownloadRunError> {
    let (file_id, collection_id, destination, cancel, cancel_notify) = {
        let inner = engine.lock()?;
        let task = inner
            .tasks
            .get(task_id)
            .ok_or_else(|| ApiCommandError::invalid_request("Download task not found."))?;

        (
            task.file_id.clone(),
            task.collection_id.clone(),
            task.destination.clone(),
            Arc::clone(&task.cancel),
            Arc::clone(&task.cancel_notify),
        )
    };

    if cancel.load(Ordering::Relaxed) {
        return Err(DownloadRunError::Cancelled);
    }

    let path = format!("/api/v1/files/{file_id}/download");
    let query = collection_id
        .as_deref()
        .map(|id| vec![("collectionId".to_string(), id.to_string())])
        .unwrap_or_default();
    let mut response = tokio::select! {
        _ = cancel_notify.notified() => return Err(DownloadRunError::Cancelled),
        result = api.raw_request(Method::GET, &path, query, Vec::new()) => result?,
    };

    if cancel.load(Ordering::Relaxed) {
        return Err(DownloadRunError::Cancelled);
    }

    if !response.status().is_success() {
        return Err(response_error(response).await.into());
    }

    if cancel.load(Ordering::Relaxed) {
        return Err(DownloadRunError::Cancelled);
    }

    let total_bytes = response.content_length();
    mutate_task(app, engine, task_id, |task| {
        task.status = DownloadTaskStatus::Downloading;
        task.total_bytes = total_bytes;
        task.started_at = Some(now_millis());
        task.finished_at = None;
        task.error = None;
        Ok(())
    })?;

    let temporary = temporary_download_path(&destination, task_id)?;
    let _ = fs::remove_file(&temporary).await;
    let mut output = File::create_new(&temporary).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not create download file: {error}"))
    })?;
    let mut downloaded_bytes = 0u64;
    let mut sample_bytes = 0u64;
    let mut sample_started = Instant::now();

    let result: Result<(), DownloadRunError> = async {
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(DownloadRunError::Cancelled);
            }

            let chunk = tokio::select! {
                _ = cancel_notify.notified() => return Err(DownloadRunError::Cancelled),
                result = response.chunk() => result.map_err(|error| ApiCommandError::network("Download failed", error))?,
            };
            let Some(chunk) = chunk else { break };

            output.write_all(&chunk).await.map_err(|error| {
                ApiCommandError::internal(format!("Could not write download file: {error}"))
            })?;
            downloaded_bytes += chunk.len() as u64;

            let elapsed = sample_started.elapsed();
            let complete = total_bytes.is_some_and(|total| downloaded_bytes >= total);
            if elapsed >= PROGRESS_INTERVAL || complete {
                let delta = downloaded_bytes.saturating_sub(sample_bytes);
                let speed = speed_bytes_per_second(delta, elapsed);
                let eta = eta_seconds(downloaded_bytes, total_bytes, speed);
                update_progress(app, engine, task_id, downloaded_bytes, total_bytes, speed, eta)?;
                sample_bytes = downloaded_bytes;
                sample_started = Instant::now();
            }
        }

        if cancel.load(Ordering::Relaxed) {
            return Err(DownloadRunError::Cancelled);
        }

        output.flush().await.map_err(|error| {
            ApiCommandError::internal(format!("Could not flush download file: {error}"))
        })?;

        if total_bytes.is_some_and(|expected| expected != downloaded_bytes) {
            return Err(ApiCommandError::internal("Downloaded file size does not match the server response.").into());
        }

        Ok(())
    }
    .await;

    drop(output);

    if let Err(error) = result {
        let _ = fs::remove_file(&temporary).await;
        return Err(error);
    }

    if let Err(error) = fs::rename(&temporary, &destination).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(ApiCommandError::internal(format!(
            "Could not finalize download file: {error}"
        ))
        .into());
    }

    mutate_task(app, engine, task_id, |task| {
        task.status = DownloadTaskStatus::Completed;
        task.downloaded_bytes = downloaded_bytes;
        task.total_bytes = total_bytes.or(Some(downloaded_bytes));
        task.bytes_per_second = None;
        task.eta_seconds = Some(0);
        task.error = None;
        task.finished_at = Some(now_millis());
        Ok(())
    })?;

    Ok(())
}

fn update_progress(
    app: &AppHandle,
    engine: &DownloadEngineState,
    task_id: &str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    bytes_per_second: Option<u64>,
    eta_seconds: Option<u64>,
) -> Result<(), ApiCommandError> {
    mutate_task(app, engine, task_id, |task| {
        task.downloaded_bytes = downloaded_bytes;
        task.total_bytes = total_bytes;
        task.bytes_per_second = bytes_per_second;
        task.eta_seconds = eta_seconds;
        Ok(())
    })
}

fn mutate_task<F>(
    app: &AppHandle,
    engine: &DownloadEngineState,
    task_id: &str,
    mutate: F,
) -> Result<(), ApiCommandError>
where
    F: FnOnce(&mut DownloadTask) -> Result<(), ApiCommandError>,
{
    let (view, revision) = {
        let mut inner = engine.lock()?;
        let view = {
            let task = inner
                .tasks
                .get_mut(task_id)
                .ok_or_else(|| ApiCommandError::invalid_request("Download task not found."))?;
            mutate(task)?;
            task_view(task)
        };
        inner.revision = inner.revision.wrapping_add(1);
        (view, inner.revision)
    };

    emit_task(app, view, revision)
}

fn emit_task(
    app: &AppHandle,
    task: DownloadTaskView,
    revision: u64,
) -> Result<(), ApiCommandError> {
    app.emit(TASK_EVENT, DownloadTaskEvent { task, revision })
        .map_err(|error| {
            ApiCommandError::internal(format!("Could not emit download task: {error}"))
        })
}

fn snapshot_from_inner(inner: &DownloadEngineInner) -> DownloadSnapshot {
    DownloadSnapshot {
        tasks: inner
            .order
            .iter()
            .filter_map(|id| inner.tasks.get(id))
            .map(task_view)
            .collect(),
        revision: inner.revision,
    }
}

fn task_view(task: &DownloadTask) -> DownloadTaskView {
    let active = matches!(
        task.status,
        DownloadTaskStatus::Queued
            | DownloadTaskStatus::Downloading
            | DownloadTaskStatus::Cancelling
    );
    let retry = matches!(
        task.status,
        DownloadTaskStatus::Error | DownloadTaskStatus::Cancelled
    );
    let removable = matches!(
        task.status,
        DownloadTaskStatus::Completed | DownloadTaskStatus::Error | DownloadTaskStatus::Cancelled
    );

    DownloadTaskView {
        id: task.id.clone(),
        file_name: task.file_name.clone(),
        status: task.status,
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        bytes_per_second: task.bytes_per_second,
        eta_seconds: task.eta_seconds,
        error: task.error.clone(),
        started_at: task.started_at,
        finished_at: task.finished_at,
        can_cancel: active && task.status != DownloadTaskStatus::Cancelling,
        can_retry: retry,
        can_remove: removable,
        can_reveal: task.status == DownloadTaskStatus::Completed,
    }
}

fn validate_resource_id(value: &str, kind: &str) -> Result<(), ApiCommandError> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
    {
        return Err(ApiCommandError::invalid_request(format!(
            "Invalid {kind} ID."
        )));
    }

    Ok(())
}

fn validate_destination(destination: String) -> Result<PathBuf, ApiCommandError> {
    if destination.trim().is_empty() {
        return Err(ApiCommandError::invalid_request(
            "Download destination is required.",
        ));
    }

    let destination = PathBuf::from(destination);
    if destination.file_name().is_none() {
        return Err(ApiCommandError::invalid_request(
            "Download destination must be a file path.",
        ));
    }

    Ok(destination)
}

fn temporary_download_path(destination: &Path, task_id: &str) -> Result<PathBuf, ApiCommandError> {
    let original = destination.file_name().ok_or_else(|| {
        ApiCommandError::invalid_request("Download destination must be a file path.")
    })?;
    let mut file_name = OsString::from(".");
    file_name.push(original);
    file_name.push(format!(".{task_id}.part"));
    Ok(destination.with_file_name(file_name))
}

fn speed_bytes_per_second(bytes: u64, elapsed: Duration) -> Option<u64> {
    if bytes == 0 || elapsed.is_zero() {
        return None;
    }

    Some((bytes as f64 / elapsed.as_secs_f64()).round().max(1.0) as u64)
}

fn eta_seconds(downloaded: u64, total: Option<u64>, speed: Option<u64>) -> Option<u64> {
    let total = total?;
    let speed = speed?;
    if speed == 0 || downloaded >= total {
        return Some(0);
    }

    Some(total.saturating_sub(downloaded).div_ceil(speed))
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(target_os = "windows")]
fn reveal_path(path: &Path) -> Result<(), ApiCommandError> {
    Command::new("explorer.exe")
        .arg(format!("/select,{}", path.to_string_lossy()))
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiCommandError::internal(format!("Could not reveal download: {error}")))
}

#[cfg(target_os = "macos")]
fn reveal_path(path: &Path) -> Result<(), ApiCommandError> {
    Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiCommandError::internal(format!("Could not reveal download: {error}")))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_path(path: &Path) -> Result<(), ApiCommandError> {
    let parent = path.parent().unwrap_or(path);
    Command::new("xdg-open")
        .arg(parent)
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiCommandError::internal(format!("Could not reveal download: {error}")))
}
