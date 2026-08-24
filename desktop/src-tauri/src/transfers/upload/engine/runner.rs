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
        if let Ok(Some(event)) = set_task_error(
            &engine,
            &task_id,
            Some(generation),
            error.message().to_string(),
        ) {
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
            if let Ok(Some(event)) =
                apply_transfer_event(&progress_engine, &progress_task_id, generation, event)
            {
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
    let task = upload_task_view(task);
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

    if matches!(
        task.status,
        UploadTaskStatus::Cancelling | UploadTaskStatus::Cancelled
    ) {
        return Ok(None);
    }

    task.session_id = Some(transfer.session_id);
    task.uploaded_bytes = task
        .uploaded_bytes
        .max(transfer.uploaded_bytes.min(task.file.size));
    task.status = if transfer.status == "finalizing" {
        UploadTaskStatus::Finalizing
    } else {
        UploadTaskStatus::Uploading
    };
    let task = upload_task_view(task);
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

        if matches!(
            task.status,
            UploadTaskStatus::Cancelling | UploadTaskStatus::Cancelled
        ) {
            return Ok(None);
        }

        task.session_id = Some(result.session_id);
        task.status = UploadTaskStatus::Completed;
        task.uploaded_bytes = result.uploaded_bytes.min(task.file.size);
        task.error = None;
    }

    if !inner
        .tasks
        .values()
        .any(|task| is_active_status(task.status))
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
    Ok(inner.tasks.get(task_id).map(|task| UploadTaskEvent {
        task: upload_task_view(task),
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

    if matches!(
        task.status,
        UploadTaskStatus::Cancelling | UploadTaskStatus::Cancelled
    ) {
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

    let task = upload_task_view(task);
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
    let task = upload_task_view(task);
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

fn upload_task_view(task: &UploadTask) -> UploadTaskView {
    UploadTaskView {
        id: task.id.clone(),
        file: UploadFileView {
            name: task.file.name.clone(),
            size: task.file.size,
        },
        folder_id: task.folder_id.clone(),
        relative_path: task.relative_path.clone(),
        status: task.status,
        uploaded_bytes: task.uploaded_bytes,
        error: task.error.clone(),
        can_cancel: can_cancel_task(task),
        can_remove: can_remove_task(task),
    }
}

fn can_cancel_task(task: &UploadTask) -> bool {
    matches!(
        task.status,
        UploadTaskStatus::Queued | UploadTaskStatus::Preparing
    ) || task.session_id.is_some()
        && matches!(
            task.status,
            UploadTaskStatus::Uploading | UploadTaskStatus::Error
        )
}

fn can_remove_task(task: &UploadTask) -> bool {
    matches!(
        task.status,
        UploadTaskStatus::Completed | UploadTaskStatus::Skipped | UploadTaskStatus::Cancelled
    ) || task.status == UploadTaskStatus::Error && task.session_id.is_none()
}

fn snapshot_from_inner(inner: &UploadEngineInner) -> UploadSnapshot {
    let tasks = inner
        .order
        .iter()
        .filter_map(|id| inner.tasks.get(id).map(upload_task_view))
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

