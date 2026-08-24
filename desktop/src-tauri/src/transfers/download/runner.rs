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
                crate::diagnostics::error("download.task", format!("task_id={task_id} error={message}"));
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
        let task = inner.tasks.get(task_id).ok_or_else(|| ApiCommandError::invalid_request("Download task not found."))?;
        (task.file_id.clone(), task.collection_id.clone(), task.destination.clone(), Arc::clone(&task.cancel), Arc::clone(&task.cancel_notify))
    };
    mutate_task(app, engine, task_id, |task| { task.status = DownloadTaskStatus::Downloading; task.phase = Some(DownloadTaskPhase::Preparing); task.started_at = Some(now_millis()); task.finished_at = None; task.error = None; Ok(()) })?;
    let mut sample_bytes = 0u64;
    let mut sample_started = Instant::now();
    let mut last_phase = None;
    let result = direct::download_file_direct(api, &file_id, collection_id.as_deref(), &destination, Some((cancel, cancel_notify)), |update| {
        let phase_changed = last_phase != Some(update.phase);
        if phase_changed {
            last_phase = Some(update.phase);
            sample_bytes = update.downloaded_bytes;
            sample_started = Instant::now();
            return update_progress(app, engine, task_id, update.phase, update.downloaded_bytes, update.total_bytes, update.completed_chunks, update.total_chunks, None, None);
        }
        if update.phase != DownloadTaskPhase::Transferring { return Ok(()); }
        let elapsed = sample_started.elapsed();
        if elapsed >= PROGRESS_INTERVAL || update.total_bytes.is_some_and(|total| update.downloaded_bytes >= total) {
            let speed = speed_bytes_per_second(update.downloaded_bytes.saturating_sub(sample_bytes), elapsed);
            let eta = eta_seconds(update.downloaded_bytes, update.total_bytes, speed);
            update_progress(app, engine, task_id, update.phase, update.downloaded_bytes, update.total_bytes, update.completed_chunks, update.total_chunks, speed, eta)?;
            sample_bytes = update.downloaded_bytes; sample_started = Instant::now();
        }
        Ok(())
    }).await;
    let downloaded = match result {
        Ok(bytes) => bytes,
        Err(direct::DirectDownloadError::Cancelled) => return Err(DownloadRunError::Cancelled),
        Err(direct::DirectDownloadError::Failed(error)) => return Err(DownloadRunError::Failed(error)),
    };
    mutate_task(app, engine, task_id, |task| { task.status = DownloadTaskStatus::Completed; task.phase = None; task.downloaded_bytes = downloaded; task.total_bytes = Some(downloaded); task.completed_chunks = task.total_chunks; task.bytes_per_second = None; task.eta_seconds = Some(0); task.error = None; task.finished_at = Some(now_millis()); Ok(()) })?;
    Ok(())
}

fn update_progress(
    app: &AppHandle,
    engine: &DownloadEngineState,
    task_id: &str,
    phase: DownloadTaskPhase,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    completed_chunks: usize,
    total_chunks: Option<usize>,
    bytes_per_second: Option<u64>,
    eta_seconds: Option<u64>,
) -> Result<(), ApiCommandError> {
    mutate_task(app, engine, task_id, |task| {
        task.phase = Some(phase);
        task.downloaded_bytes = downloaded_bytes;
        task.total_bytes = total_bytes;
        task.completed_chunks = Some(completed_chunks);
        task.total_chunks = total_chunks;
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
        phase: task.phase,
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        completed_chunks: task.completed_chunks,
        total_chunks: task.total_chunks,
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
pub(crate) fn reveal_path(path: &Path) -> Result<(), ApiCommandError> {
    Command::new("explorer.exe")
        .arg(format!("/select,{}", path.to_string_lossy()))
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiCommandError::internal(format!("Could not reveal download: {error}")))
}

#[cfg(target_os = "macos")]
pub(crate) fn reveal_path(path: &Path) -> Result<(), ApiCommandError> {
    Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiCommandError::internal(format!("Could not reveal download: {error}")))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn reveal_path(path: &Path) -> Result<(), ApiCommandError> {
    let parent = path.parent().unwrap_or(path);
    Command::new("xdg-open")
        .arg(parent)
        .spawn()
        .map(|_| ())
        .map_err(|error| ApiCommandError::internal(format!("Could not reveal download: {error}")))
}
