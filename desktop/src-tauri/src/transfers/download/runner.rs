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
    mutate_task(app, engine, task_id, |task| { task.status = DownloadTaskStatus::Downloading; task.started_at = Some(now_millis()); task.finished_at = None; task.error = None; Ok(()) })?;
    let mut sample_bytes = 0u64;
    let mut sample_started = Instant::now();
    let result = direct::download_file_direct(api, &file_id, collection_id.as_deref(), &destination, Some((cancel, cancel_notify)), |downloaded, total| {
        let elapsed = sample_started.elapsed();
        if elapsed >= PROGRESS_INTERVAL || downloaded >= total {
            let speed = speed_bytes_per_second(downloaded.saturating_sub(sample_bytes), elapsed);
            let eta = eta_seconds(downloaded, Some(total), speed);
            update_progress(app, engine, task_id, downloaded, Some(total), speed, eta)?;
            sample_bytes = downloaded; sample_started = Instant::now();
        }
        Ok(())
    }).await;
    let downloaded = match result {
        Ok(bytes) => bytes,
        Err(direct::DirectDownloadError::Cancelled) => return Err(DownloadRunError::Cancelled),
        Err(direct::DirectDownloadError::Failed(error)) => return Err(DownloadRunError::Failed(error)),
    };
    mutate_task(app, engine, task_id, |task| { task.status = DownloadTaskStatus::Completed; task.downloaded_bytes = downloaded; task.total_bytes = Some(downloaded); task.bytes_per_second = None; task.eta_seconds = Some(0); task.error = None; task.finished_at = Some(now_millis()); Ok(()) })?;
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
