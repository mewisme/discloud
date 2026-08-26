#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncConflict {
    id: String,
    pair_id: String,
    relative_path: String,
    local_path: String,
    remote_file_id: String,
    remote_name: String,
    local_size: u64,
    remote_size: u64,
    local_modified_at: u64,
    remote_updated_at: String,
    detected_at: u64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SyncConflictResolution {
    KeepLocal,
    KeepRemote,
    KeepBoth,
}

fn queue_sync_conflict(
    pair: &SyncPairInput,
    relative_path: &str,
    local: &LocalFile,
    remote: &RemoteFile,
    pending: &mut BTreeMap<String, SyncConflict>,
    result: &mut SyncRunResult,
) {
    pending.insert(relative_path.to_string(), build_sync_conflict(pair, relative_path, local, remote));
    result.conflicts += 1;
}

fn build_sync_conflict(pair: &SyncPairInput, relative_path: &str, local: &LocalFile, remote: &RemoteFile) -> SyncConflict {
    let mut hasher = Sha256::new();
    hasher.update(pair.id.as_bytes());
    hasher.update(relative_path.as_bytes());
    hasher.update(local.fingerprint.size.to_le_bytes());
    hasher.update(local.fingerprint.modified_ms.to_le_bytes());
    hasher.update(remote.fingerprint.id.as_bytes());
    hasher.update(remote.fingerprint.size.to_le_bytes());
    hasher.update(remote.fingerprint.updated_at.as_bytes());
    let id = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    SyncConflict {
        id,
        pair_id: pair.id.clone(),
        relative_path: relative_path.to_string(),
        local_path: crate::path_display::user_path_string(&local.path),
        remote_file_id: remote.id.clone(),
        remote_name: remote.name.clone(),
        local_size: local.fingerprint.size,
        remote_size: remote.fingerprint.size,
        local_modified_at: local.fingerprint.modified_ms,
        remote_updated_at: remote.fingerprint.updated_at.clone(),
        detected_at: timestamp_millis(),
    }
}

#[tauri::command]
pub(crate) async fn list_sync_conflicts(app: AppHandle, pair_id: String) -> Result<Vec<SyncConflict>, ApiCommandError> {
    validate_pair_id(&pair_id)?;
    load_sync_conflicts(&app, &pair_id).await
}

#[tauri::command]
pub(crate) async fn resolve_sync_conflict(
    window: WebviewWindow,
    app: AppHandle,
    api_state: State<'_, ApiState>,
    sync_state: State<'_, SyncEngineState>,
    mut pair: SyncPairInput,
    conflict_id: String,
    resolution: SyncConflictResolution,
) -> Result<SyncRunResult, ApiCommandError> {
    validate_pair(&pair)?;
    authorize_pair_local_root(&window, api_state.inner(), &mut pair).await?;
    if conflict_id.is_empty() || conflict_id.len() > 128 || !conflict_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ApiCommandError::invalid_request("Invalid sync conflict ID."));
    }
    if !sync_state.begin(&pair.id)? {
        return Err(ApiCommandError::invalid_request("This sync pair is already running."));
    }
    sync_state.mark_run(&pair.id, timestamp_millis());
    let result = async {
        let mut resolved = resolve_sync_conflict_item(&app, api_state.inner(), &pair, &conflict_id, resolution).await?;
        let rerun = run_pair(&app, api_state.inner(), &pair).await?;
        merge_sync_results(&mut resolved, rerun);
        Ok(resolved)
    }.await;
    sync_state.finish(&pair.id);
    result
}

async fn resolve_sync_conflict_item(
    app: &AppHandle,
    api: &ApiState,
    pair: &SyncPairInput,
    conflict_id: &str,
    resolution: SyncConflictResolution,
) -> Result<SyncRunResult, ApiCommandError> {
    let mut conflicts = load_sync_conflicts(app, &pair.id).await?;
    let index = conflicts.iter().position(|conflict| conflict.id == conflict_id).ok_or_else(|| ApiCommandError::invalid_request("Sync conflict not found."))?;
    let conflict = conflicts[index].clone();
    let root = super::grants::verify_pair_authorization(api, &pair.id, &pair.remote_folder_id).await?;
    let mut local_tree = scan_local_tree(&root, &pair.ignore_patterns).await?;
    let mut remote_tree = scan_remote_tree(api, &pair.remote_folder_id, &pair.ignore_patterns).await?;
    let local = local_tree.files.remove(&conflict.relative_path);
    let remote = remote_tree.files.remove(&conflict.relative_path);
    let (_local, remote) = match (local, remote) {
        (Some(local), Some(remote)) => (local, remote),
        _ => {
            conflicts.remove(index);
            save_sync_conflicts(app, &pair.id, &conflicts).await?;
            return Err(ApiCommandError::invalid_request("This conflict changed outside DisCloud. It was cleared; run sync again to re-evaluate it."));
        }
    };
    let mut result = SyncRunResult::default();
    match resolution {
        SyncConflictResolution::KeepLocal => replace_remote_file(api, &root, &conflict.relative_path, &remote, &mut result).await?,
        SyncConflictResolution::KeepRemote => download_remote_file(api, &root, &conflict.relative_path, &remote, &mut result).await?,
        SyncConflictResolution::KeepBoth => {
            keep_both_conflict(api, &root, &conflict.relative_path, &remote, &mut result).await?;
            result.conflicts = 0;
        }
    }
    conflicts.remove(index);
    save_sync_conflicts(app, &pair.id, &conflicts).await?;
    Ok(result)
}

fn merge_sync_results(target: &mut SyncRunResult, source: SyncRunResult) {
    target.uploaded += source.uploaded;
    target.downloaded += source.downloaded;
    target.remote_deleted += source.remote_deleted;
    target.local_deleted += source.local_deleted;
    target.conflicts += source.conflicts;
    target.created_remote_folders += source.created_remote_folders;
    target.created_local_folders += source.created_local_folders;
    target.skipped += source.skipped;
}

async fn load_sync_conflicts(app: &AppHandle, pair_id: &str) -> Result<Vec<SyncConflict>, ApiCommandError> {
    let path = conflicts_path(app, pair_id)?;
    match fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| ApiCommandError::internal(format!("Could not decode sync conflicts: {error}"))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(ApiCommandError::internal(format!("Could not read sync conflicts: {error}"))),
    }
}

async fn save_sync_conflicts(app: &AppHandle, pair_id: &str, conflicts: &[SyncConflict]) -> Result<(), ApiCommandError> {
    if conflicts.is_empty() {
        return clear_sync_conflicts(app, pair_id).await;
    }
    let path = conflicts_path(app, pair_id)?;
    let parent = path.parent().ok_or_else(|| ApiCommandError::internal("Sync conflict path has no parent."))?;
    fs::create_dir_all(parent).await.map_err(|error| ApiCommandError::internal(format!("Could not create sync conflict directory: {error}")))?;
    let bytes = serde_json::to_vec_pretty(conflicts).map_err(|error| ApiCommandError::internal(format!("Could not encode sync conflicts: {error}")))?;
    let temp = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    fs::write(&temp, bytes).await.map_err(|error| ApiCommandError::internal(format!("Could not write sync conflicts: {error}")))?;
    let had_previous = fs::metadata(&path).await.is_ok();
    if had_previous {
        let _ = fs::remove_file(&backup).await;
        fs::rename(&path, &backup).await.map_err(|error| ApiCommandError::internal(format!("Could not stage previous sync conflicts: {error}")))?;
    }
    match fs::rename(&temp, &path).await {
        Ok(()) => {
            if had_previous { let _ = fs::remove_file(&backup).await; }
            Ok(())
        }
        Err(error) => {
            if had_previous { let _ = fs::rename(&backup, &path).await; }
            let _ = fs::remove_file(&temp).await;
            Err(ApiCommandError::internal(format!("Could not finalize sync conflicts: {error}")))
        }
    }
}

async fn clear_sync_conflicts(app: &AppHandle, pair_id: &str) -> Result<(), ApiCommandError> {
    let path = conflicts_path(app, pair_id)?;
    for candidate in [path.clone(), path.with_extension("json.bak"), path.with_extension("json.tmp")] {
        match fs::remove_file(candidate).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ApiCommandError::internal(format!("Could not remove sync conflict state: {error}"))),
        }
    }
    Ok(())
}

fn conflicts_path(app: &AppHandle, pair_id: &str) -> Result<PathBuf, ApiCommandError> {
    let directory = app.path().app_data_dir().map_err(|error| ApiCommandError::internal(format!("Could not resolve app data directory: {error}")))?;
    Ok(directory.join("sync").join(format!("{pair_id}.conflicts.json")))
}

#[tauri::command]
pub(crate) async fn open_sync_local_path(
    pair_id: String,
    local_path: String,
) -> Result<(), ApiCommandError> {
    validate_pair_id(&pair_id)?;
    let root = super::grants::authorized_root(&pair_id).await?;
    let path = crate::path_security::canonical_path_within(&root, &local_path, "Sync local path").await?;
    let metadata = fs::symlink_metadata(&path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not inspect sync local path: {error}"))
    })?;
    open_local_path(&path, metadata.is_dir())
}

#[cfg(target_os = "windows")]
fn open_local_path(path: &Path, directory: bool) -> Result<(), ApiCommandError> {
    let mut command = std::process::Command::new("explorer.exe");
    if directory { command.arg(path); } else { command.arg(format!("/select,{}", path.to_string_lossy())); }
    command.spawn().map(|_| ()).map_err(|error| ApiCommandError::internal(format!("Could not open local sync path: {error}")))
}

#[cfg(target_os = "macos")]
fn open_local_path(path: &Path, directory: bool) -> Result<(), ApiCommandError> {
    let mut command = std::process::Command::new("open");
    if !directory { command.arg("-R"); }
    command.arg(path).spawn().map(|_| ()).map_err(|error| ApiCommandError::internal(format!("Could not open local sync path: {error}")))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_local_path(path: &Path, directory: bool) -> Result<(), ApiCommandError> {
    let target = if directory { path } else { path.parent().unwrap_or(path) };
    std::process::Command::new("xdg-open").arg(target).spawn().map(|_| ()).map_err(|error| ApiCommandError::internal(format!("Could not open local sync path: {error}")))
}
