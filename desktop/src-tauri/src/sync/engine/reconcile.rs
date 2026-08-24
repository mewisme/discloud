async fn reconcile_file(
    api: &ApiState,
    root: &Path,
    pair: &SyncPairInput,
    relative_path: &str,
    local: Option<LocalFile>,
    remote: Option<RemoteFile>,
    previous: Option<&BaselineFile>,
    remote_directories: &BTreeMap<String, String>,
    result: &mut SyncRunResult,
) -> Result<(), ApiCommandError> {
    match (local, remote) {
        (Some(local), Some(remote)) => {
            let local_changed =
                previous.and_then(|entry| entry.local.as_ref()) != Some(&local.fingerprint);
            let remote_changed =
                previous.and_then(|entry| entry.remote.as_ref()) != Some(&remote.fingerprint);

            if !local_changed && !remote_changed {
                return Ok(());
            }

            if local.fingerprint.size == remote.fingerprint.size
                && same_file_content(api, &local.path, &remote.id).await?
            {
                return Ok(());
            }

            match pair.direction {
                SyncDirection::TwoWay => {
                    if local_changed && remote_changed {
                        keep_both_conflict(api, root, relative_path, &local, &remote, result)
                            .await?;
                    } else if local_changed {
                        replace_remote_file(api, &local.path, &remote, result).await?;
                    } else {
                        download_remote_file(api, root, relative_path, &remote, result).await?;
                    }
                }
                SyncDirection::DownloadOnly => {
                    if local_changed {
                        preserve_local_conflict(root, relative_path, &local.path).await?;
                        result.conflicts += 1;
                    }
                    download_remote_file(api, root, relative_path, &remote, result).await?;
                }
                SyncDirection::UploadOnly => {
                    if remote_changed {
                        let original_name = remote.name.clone();
                        preserve_remote_conflict(api, &remote).await?;

                        if let Err(error) = upload_local_file(
                            api,
                            &local.path,
                            &remote.parent_id,
                            &original_name,
                            result,
                        )
                        .await
                        {
                            let _ = rename_remote_file(api, &remote.id, &original_name).await;
                            return Err(error);
                        }

                        result.conflicts += 1;
                    } else {
                        replace_remote_file(api, &local.path, &remote, result).await?;
                    }
                }
            }
        }
        (Some(local), None) => {
            let previous_local = previous.and_then(|entry| entry.local.as_ref());
            let previous_remote = previous.and_then(|entry| entry.remote.as_ref());
            let local_changed = previous_local != Some(&local.fingerprint);

            match pair.direction {
                SyncDirection::DownloadOnly => {
                    if previous_remote.is_some()
                        && pair.delete_policy == SyncDeletePolicy::Propagate
                        && !local_changed
                    {
                        soft_delete_local(root, relative_path, &local.path).await?;
                        result.local_deleted += 1;
                    } else {
                        result.skipped += 1;
                    }
                }
                SyncDirection::TwoWay => {
                    if previous_remote.is_some()
                        && pair.delete_policy == SyncDeletePolicy::Propagate
                        && !local_changed
                    {
                        soft_delete_local(root, relative_path, &local.path).await?;
                        result.local_deleted += 1;
                    } else {
                        if previous_remote.is_some() && local_changed {
                            result.conflicts += 1;
                        }
                        let parent = remote_parent_id(relative_path, remote_directories)?;
                        let name = relative_name(relative_path)?;
                        upload_local_file(api, &local.path, parent, name, result).await?;
                    }
                }
                SyncDirection::UploadOnly => {
                    let parent = remote_parent_id(relative_path, remote_directories)?;
                    let name = relative_name(relative_path)?;
                    upload_local_file(api, &local.path, parent, name, result).await?;
                }
            }
        }
        (None, Some(remote)) => {
            let previous_local = previous.and_then(|entry| entry.local.as_ref());
            let previous_remote = previous.and_then(|entry| entry.remote.as_ref());
            let remote_changed = previous_remote != Some(&remote.fingerprint);

            match pair.direction {
                SyncDirection::UploadOnly => {
                    if previous_local.is_some()
                        && pair.delete_policy == SyncDeletePolicy::Propagate
                        && !remote_changed
                    {
                        trash_remote_file(api, &remote.id).await?;
                        result.remote_deleted += 1;
                    } else {
                        result.skipped += 1;
                    }
                }
                SyncDirection::TwoWay => {
                    if previous_local.is_some()
                        && pair.delete_policy == SyncDeletePolicy::Propagate
                        && !remote_changed
                    {
                        trash_remote_file(api, &remote.id).await?;
                        result.remote_deleted += 1;
                    } else {
                        if previous_local.is_some() && remote_changed {
                            result.conflicts += 1;
                        }
                        download_remote_file(api, root, relative_path, &remote, result).await?;
                    }
                }
                SyncDirection::DownloadOnly => {
                    download_remote_file(api, root, relative_path, &remote, result).await?;
                }
            }
        }
        (None, None) => {}
    }

    Ok(())
}

async fn keep_both_conflict(
    api: &ApiState,
    root: &Path,
    relative_path: &str,
    local: &LocalFile,
    remote: &RemoteFile,
    result: &mut SyncRunResult,
) -> Result<(), ApiCommandError> {
    let (conflict_path, conflict_name) =
        preserve_local_conflict(root, relative_path, &local.path).await?;

    if let Err(error) = upload_local_file(
        api,
        &conflict_path,
        &remote.parent_id,
        &conflict_name,
        result,
    )
    .await
    {
        let original_path = root.join(relative_to_path(relative_path));
        let _ = fs::rename(&conflict_path, &original_path).await;
        return Err(error);
    }

    download_remote_file(api, root, relative_path, remote, result).await?;
    result.conflicts += 1;
    Ok(())
}

async fn preserve_local_conflict(
    root: &Path,
    relative_path: &str,
    source: &Path,
) -> Result<(PathBuf, String), ApiCommandError> {
    let name = relative_name(relative_path)?;
    let conflict_name = conflict_name(name, "local");
    let parent = source.parent().unwrap_or(root);
    let destination = unique_path(parent.join(&conflict_name)).await?;

    fs::rename(source, &destination).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not preserve local conflict copy: {error}"))
    })?;

    let final_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ApiCommandError::internal("Conflict file name is not valid Unicode."))?
        .to_string();

    Ok((destination, final_name))
}

async fn preserve_remote_conflict(
    api: &ApiState,
    remote: &RemoteFile,
) -> Result<(), ApiCommandError> {
    let name = conflict_name(&remote.name, "remote");
    rename_remote_file(api, &remote.id, &name).await
}

async fn rename_remote_file(
    api: &ApiState,
    file_id: &str,
    name: &str,
) -> Result<(), ApiCommandError> {
    let endpoint = format!("/api/v1/nodes/{file_id}");
    send_json(
        api,
        Method::PATCH,
        &endpoint,
        Vec::new(),
        Some(json!({ "name": name })),
    )
    .await?;
    Ok(())
}

async fn replace_remote_file(
    api: &ApiState,
    local_path: &Path,
    remote: &RemoteFile,
    result: &mut SyncRunResult,
) -> Result<(), ApiCommandError> {
    let original_name = remote.name.clone();
    let staged_name = conflict_name(&remote.name, "replaced");
    rename_remote_file(api, &remote.id, &staged_name).await?;

    if let Err(error) =
        upload_local_file(api, local_path, &remote.parent_id, &original_name, result).await
    {
        let _ = rename_remote_file(api, &remote.id, &original_name).await;
        return Err(error);
    }

    trash_remote_file(api, &remote.id).await?;
    result.remote_deleted += 1;
    Ok(())
}

async fn upload_local_file(
    api: &ApiState,
    local_path: &Path,
    parent_id: &str,
    name: &str,
    result: &mut SyncRunResult,
) -> Result<(), ApiCommandError> {
    upload_file(api, local_path, parent_id, name).await?;
    result.uploaded += 1;
    Ok(())
}

async fn download_remote_file(
    api: &ApiState,
    root: &Path,
    relative_path: &str,
    remote: &RemoteFile,
    result: &mut SyncRunResult,
) -> Result<(), ApiCommandError> {
    let destination = root.join(relative_to_path(relative_path));
    download_file(api, &remote.id, &destination).await?;
    result.downloaded += 1;
    Ok(())
}

async fn trash_remote_file(api: &ApiState, file_id: &str) -> Result<(), ApiCommandError> {
    let endpoint = format!("/api/v1/files/{file_id}");
    send_json(api, Method::DELETE, &endpoint, Vec::new(), None).await?;
    Ok(())
}

async fn soft_delete_local(
    root: &Path,
    relative_path: &str,
    source: &Path,
) -> Result<(), ApiCommandError> {
    let trash_root = root
        .join(LOCAL_TRASH_DIR)
        .join(timestamp_millis().to_string());
    let destination = trash_root.join(relative_to_path(relative_path));

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not create local sync trash: {error}"))
        })?;
    }

    fs::rename(source, destination).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not move local file to sync trash: {error}"))
    })
}

async fn ensure_local_directories(
    root: &Path,
    remote: &RemoteTree,
    local: &mut LocalTree,
    result: &mut SyncRunResult,
) -> Result<(), ApiCommandError> {
    let mut directories = remote
        .directories
        .keys()
        .filter(|path| !path.is_empty() && !local.directories.contains(*path))
        .cloned()
        .collect::<Vec<_>>();
    directories.sort_by_key(|path| path_depth(path));

    for relative in directories {
        let path = root.join(relative_to_path(&relative));
        fs::create_dir_all(&path).await.map_err(|error| {
            ApiCommandError::internal(format!(
                "Could not create local sync directory {}: {error}",
                path.display()
            ))
        })?;
        local.directories.insert(relative);
        result.created_local_folders += 1;
    }

    Ok(())
}

async fn ensure_remote_directories(
    api: &ApiState,
    local: &LocalTree,
    remote: &mut RemoteTree,
    result: &mut SyncRunResult,
) -> Result<(), ApiCommandError> {
    let mut directories = local
        .directories
        .iter()
        .filter(|path| !path.is_empty() && !remote.directories.contains_key(*path))
        .cloned()
        .collect::<Vec<_>>();
    directories.sort_by_key(|path| path_depth(path));

    for relative in directories {
        let parent_relative = relative_parent(&relative);
        let parent_id = remote
            .directories
            .get(parent_relative)
            .ok_or_else(|| ApiCommandError::internal("Remote parent folder is missing."))?
            .clone();
        let name = relative_name(&relative)?;
        let value = send_json(
            api,
            Method::POST,
            "/api/v1/folders",
            Vec::new(),
            Some(json!({ "parentId": parent_id, "name": name })),
        )
        .await?;
        let id = json_string(&value, "id")?;
        remote.directories.insert(relative, id);
        result.created_remote_folders += 1;
    }

    Ok(())
}

