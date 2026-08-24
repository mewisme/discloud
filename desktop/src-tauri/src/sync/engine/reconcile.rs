#[derive(Clone, Debug)]
struct LocalRenameCandidate {
    old_path: String,
    new_path: String,
    remote: RemoteFile,
}

fn detect_local_rename_candidates(
    local: &LocalTree,
    remote: &RemoteTree,
    baseline: &SyncBaseline,
    pending_conflicts: &BTreeMap<String, SyncConflict>,
) -> Vec<LocalRenameCandidate> {
    let mut proposals = Vec::new();

    for (old_path, previous) in &baseline.files {
        let (Some(previous_local), Some(previous_remote)) = (&previous.local, &previous.remote) else {
            continue;
        };
        if local.files.contains_key(old_path) || pending_conflicts.contains_key(old_path) {
            continue;
        }

        let Some(current_remote) = remote.files.get(old_path) else {
            continue;
        };
        if &current_remote.fingerprint != previous_remote {
            continue;
        }

        let matches = local
            .files
            .iter()
            .filter(|(new_path, current_local)| {
                !remote.files.contains_key(*new_path)
                    && !baseline.files.contains_key(*new_path)
                    && !pending_conflicts.contains_key(*new_path)
                    && relative_parent(old_path) == relative_parent(new_path)
                    && &current_local.fingerprint == previous_local
            })
            .map(|(new_path, _)| new_path.clone())
            .collect::<Vec<_>>();

        if matches.len() == 1 {
            proposals.push(LocalRenameCandidate {
                old_path: old_path.clone(),
                new_path: matches[0].clone(),
                remote: current_remote.clone(),
            });
        }
    }

    let mut new_path_counts = BTreeMap::<String, usize>::new();
    for candidate in &proposals {
        *new_path_counts.entry(candidate.new_path.clone()).or_default() += 1;
    }
    proposals.retain(|candidate| new_path_counts.get(&candidate.new_path) == Some(&1));
    proposals
}

async fn reconcile_local_renames(
    api: &ApiState,
    local: &LocalTree,
    remote: &mut RemoteTree,
    baseline: &SyncBaseline,
    pending_conflicts: &BTreeMap<String, SyncConflict>,
) -> Result<BTreeSet<String>, ApiCommandError> {
    let candidates = detect_local_rename_candidates(local, remote, baseline, pending_conflicts);
    let mut handled = BTreeSet::new();

    for candidate in candidates {
        let Some(current_local) = local.files.get(&candidate.new_path) else {
            continue;
        };
        if !same_file_content(api, &current_local.path, &candidate.remote.id).await? {
            continue;
        }

        let name = relative_name(&candidate.new_path)?;
        rename_remote_file(api, &candidate.remote.id, name).await?;

        remote.files.remove(&candidate.old_path);
        let mut renamed = candidate.remote;
        renamed.name = name.to_string();
        remote.files.insert(candidate.new_path.clone(), renamed);
        handled.insert(candidate.old_path);
        handled.insert(candidate.new_path);
    }

    Ok(handled)
}

async fn reconcile_file(
    api: &ApiState,
    root: &Path,
    pair: &SyncPairInput,
    relative_path: &str,
    local: Option<LocalFile>,
    remote: Option<RemoteFile>,
    previous: Option<&BaselineFile>,
    remote_directories: &BTreeMap<String, String>,
    pending_conflicts: &mut BTreeMap<String, SyncConflict>,
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
                        queue_sync_conflict(pair, relative_path, &local, &remote, pending_conflicts, result);
                    } else if local_changed {
                        replace_remote_file(api, &local.path, &remote, result).await?;
                    } else {
                        download_remote_file(api, root, relative_path, &remote, result).await?;
                    }
                }
                SyncDirection::DownloadOnly => {
                    if local_changed {
                        queue_sync_conflict(pair, relative_path, &local, &remote, pending_conflicts, result);
                    } else {
                        download_remote_file(api, root, relative_path, &remote, result).await?;
                    }
                }
                SyncDirection::UploadOnly => {
                    if remote_changed {
                        queue_sync_conflict(pair, relative_path, &local, &remote, pending_conflicts, result);
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
                    if should_propagate_remote_file_deletion(pair, previous_remote.is_some(), local_changed) {
                        soft_delete_local(root, relative_path, &local.path).await?;
                        result.local_deleted += 1;
                    } else {
                        result.skipped += 1;
                    }
                }
                SyncDirection::TwoWay => {
                    if should_propagate_remote_file_deletion(pair, previous_remote.is_some(), local_changed) {
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
                    if should_propagate_local_file_deletion(pair, previous_local.is_some(), remote_changed) {
                        trash_remote_file(api, &remote.id).await?;
                        result.remote_deleted += 1;
                    } else {
                        result.skipped += 1;
                    }
                }
                SyncDirection::TwoWay => {
                    if should_propagate_local_file_deletion(pair, previous_local.is_some(), remote_changed) {
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

fn should_propagate_remote_file_deletion(pair: &SyncPairInput, existed_remote: bool, local_changed: bool) -> bool {
    existed_remote && pair.propagates_deletions() && !local_changed
}

fn should_propagate_local_file_deletion(pair: &SyncPairInput, existed_local: bool, remote_changed: bool) -> bool {
    existed_local && pair.propagates_deletions() && !remote_changed
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DirectoryDeletion {
    Local,
    Remote,
}

async fn reconcile_directory_deletions(
    api: &ApiState,
    root: &Path,
    pair: &SyncPairInput,
    local: &mut LocalTree,
    remote: &mut RemoteTree,
    baseline: &SyncBaseline,
    result: &mut SyncRunResult,
) -> Result<(), ApiCommandError> {
    if !pair.propagates_deletions() {
        return Ok(());
    }

    let mut paths = BTreeSet::new();
    paths.extend(local.directories.iter().filter(|path| !path.is_empty()).cloned());
    paths.extend(remote.directories.keys().filter(|path| !path.is_empty()).cloned());
    let mut paths = paths.into_iter().collect::<Vec<_>>();
    paths.sort_by_key(|path| path_depth(path));
    let mut handled = Vec::<String>::new();

    for relative in paths {
        if handled.iter().any(|parent| path_in_subtree(&relative, parent)) {
            continue;
        }
        let Some(deletion) = directory_deletion(pair, &relative, local, remote, baseline) else {
            continue;
        };

        match deletion {
            DirectoryDeletion::Local => {
                let source = root.join(relative_to_path(&relative));
                soft_delete_local(root, &relative, &source).await?;
                remove_local_subtree(local, &relative);
                result.local_deleted += 1;
            }
            DirectoryDeletion::Remote => {
                let folder_id = remote
                    .directories
                    .get(&relative)
                    .ok_or_else(|| ApiCommandError::internal("Remote sync folder disappeared during reconciliation."))?
                    .clone();
                trash_remote_folder(api, &folder_id).await?;
                remove_remote_subtree(remote, &relative);
                result.remote_deleted += 1;
            }
        }
        handled.push(relative);
    }

    Ok(())
}

fn directory_deletion(
    pair: &SyncPairInput,
    relative: &str,
    local: &LocalTree,
    remote: &RemoteTree,
    baseline: &SyncBaseline,
) -> Option<DirectoryDeletion> {
    if !pair.propagates_deletions() {
        return None;
    }
    let previous = baseline.directories.get(relative)?;
    if !previous.local || !previous.remote {
        return None;
    }

    match (
        local.directories.contains(relative),
        remote.directories.contains_key(relative),
    ) {
        (false, true)
            if pair.direction.uploads() && !remote_subtree_has_live_changes(relative, remote, baseline) =>
        {
            Some(DirectoryDeletion::Remote)
        }
        (true, false)
            if pair.direction.downloads() && !local_subtree_has_live_changes(relative, local, baseline) =>
        {
            Some(DirectoryDeletion::Local)
        }
        _ => None,
    }
}

fn local_subtree_has_live_changes(relative: &str, local: &LocalTree, baseline: &SyncBaseline) -> bool {
    local.files.iter().any(|(path, file)| {
        path_in_subtree(path, relative)
            && baseline.files.get(path).and_then(|entry| entry.local.as_ref()) != Some(&file.fingerprint)
    }) || local.directories.iter().any(|path| {
        path != relative
            && path_in_subtree(path, relative)
            && !baseline.directories.get(path).is_some_and(|entry| entry.local)
    })
}

fn remote_subtree_has_live_changes(relative: &str, remote: &RemoteTree, baseline: &SyncBaseline) -> bool {
    remote.files.iter().any(|(path, file)| {
        path_in_subtree(path, relative)
            && baseline.files.get(path).and_then(|entry| entry.remote.as_ref()) != Some(&file.fingerprint)
    }) || remote.directories.keys().any(|path| {
        path != relative
            && path_in_subtree(path, relative)
            && !baseline.directories.get(path).is_some_and(|entry| entry.remote)
    })
}

fn remove_local_subtree(local: &mut LocalTree, relative: &str) {
    local.files.retain(|path, _| !path_in_subtree(path, relative));
    local.directories.retain(|path| !path_in_subtree(path, relative));
}

fn remove_remote_subtree(remote: &mut RemoteTree, relative: &str) {
    remote.files.retain(|path, _| !path_in_subtree(path, relative));
    remote.directories.retain(|path, _| !path_in_subtree(path, relative));
}

fn path_in_subtree(path: &str, parent: &str) -> bool {
    path == parent || path.strip_prefix(parent).is_some_and(|suffix| suffix.starts_with('/'))
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

#[allow(dead_code)]
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

async fn trash_remote_folder(api: &ApiState, folder_id: &str) -> Result<(), ApiCommandError> {
    let endpoint = format!("/api/v1/folders/{folder_id}");
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
        ApiCommandError::internal(format!("Could not move local sync path to trash: {error}"))
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


#[cfg(test)]
mod rename_tests {
    use super::*;

    fn local(path: &str, size: u64, modified_ms: u64) -> LocalFile {
        LocalFile {
            path: PathBuf::from(path),
            fingerprint: LocalFingerprint { size, modified_ms },
        }
    }

    fn remote(id: &str, name: &str, size: u64, updated_at: &str) -> RemoteFile {
        RemoteFile {
            id: id.to_string(),
            parent_id: "parent".to_string(),
            name: name.to_string(),
            fingerprint: RemoteFingerprint {
                id: id.to_string(),
                size,
                updated_at: updated_at.to_string(),
            },
        }
    }

    #[test]
    fn detects_same_folder_local_rename_without_replacing_remote_identity() {
        let current_local = local("b.txt", 12, 42);
        let current_remote = remote("file-id", "a.txt", 12, "2026-08-24T00:00:00Z");
        let local_tree = LocalTree {
            files: BTreeMap::from([("b.txt".to_string(), current_local.clone())]),
            directories: BTreeSet::from([String::new()]),
            skipped: 0,
        };
        let remote_tree = RemoteTree {
            files: BTreeMap::from([("a.txt".to_string(), current_remote.clone())]),
            directories: BTreeMap::from([(String::new(), "parent".to_string())]),
            skipped: 0,
        };
        let baseline = SyncBaseline {
            version: BASELINE_VERSION,
            directories: BTreeMap::new(),
            files: BTreeMap::from([(
                "a.txt".to_string(),
                BaselineFile {
                    local: Some(current_local.fingerprint.clone()),
                    remote: Some(current_remote.fingerprint.clone()),
                },
            )]),
        };

        let candidates = detect_local_rename_candidates(
            &local_tree,
            &remote_tree,
            &baseline,
            &BTreeMap::new(),
        );

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].old_path, "a.txt");
        assert_eq!(candidates[0].new_path, "b.txt");
        assert_eq!(candidates[0].remote.id, "file-id");
    }

    #[test]
    fn rejects_ambiguous_or_cross_folder_local_rename_candidates() {
        let previous_local = LocalFingerprint {
            size: 12,
            modified_ms: 42,
        };
        let current_remote = remote("file-id", "a.txt", 12, "2026-08-24T00:00:00Z");
        let local_tree = LocalTree {
            files: BTreeMap::from([
                ("b.txt".to_string(), local("b.txt", 12, 42)),
                ("c.txt".to_string(), local("c.txt", 12, 42)),
                ("folder/d.txt".to_string(), local("folder/d.txt", 12, 42)),
            ]),
            directories: BTreeSet::from([String::new(), "folder".to_string()]),
            skipped: 0,
        };
        let remote_tree = RemoteTree {
            files: BTreeMap::from([("a.txt".to_string(), current_remote.clone())]),
            directories: BTreeMap::from([
                (String::new(), "parent".to_string()),
                ("folder".to_string(), "folder-id".to_string()),
            ]),
            skipped: 0,
        };
        let baseline = SyncBaseline {
            version: BASELINE_VERSION,
            directories: BTreeMap::new(),
            files: BTreeMap::from([(
                "a.txt".to_string(),
                BaselineFile {
                    local: Some(previous_local),
                    remote: Some(current_remote.fingerprint),
                },
            )]),
        };

        let candidates = detect_local_rename_candidates(
            &local_tree,
            &remote_tree,
            &baseline,
            &BTreeMap::new(),
        );

        assert!(candidates.is_empty());
    }
}

#[cfg(test)]
mod directory_deletion_tests {
    use super::*;

    fn pair(direction: SyncDirection, delete_policy: SyncDeletePolicy) -> SyncPairInput {
        SyncPairInput {
            id: "pair".to_string(),
            local_path: "C:/sync".to_string(),
            remote_folder_id: "remote".to_string(),
            direction,
            delete_policy,
            enabled: true,
            interval_seconds: 30,
            ignore_patterns: Vec::new(),
        }
    }

    fn baseline() -> SyncBaseline {
        SyncBaseline {
            version: BASELINE_VERSION,
            directories: BTreeMap::from([(
                "folder".to_string(),
                BaselineDirectory { local: true, remote: true },
            )]),
            files: BTreeMap::new(),
        }
    }

    #[test]
    fn two_way_propagates_local_folder_deletion_to_remote() {
        let local = LocalTree { directories: BTreeSet::from([String::new()]), ..LocalTree::default() };
        let remote = RemoteTree { directories: BTreeMap::from([(String::new(), "root".to_string()), ("folder".to_string(), "folder-id".to_string())]), ..RemoteTree::default() };
        assert_eq!(directory_deletion(&pair(SyncDirection::TwoWay, SyncDeletePolicy::Propagate), "folder", &local, &remote, &baseline()), Some(DirectoryDeletion::Remote));
    }

    #[test]
    fn two_way_propagates_remote_folder_deletion_to_local() {
        let local = LocalTree { directories: BTreeSet::from([String::new(), "folder".to_string()]), ..LocalTree::default() };
        let remote = RemoteTree { directories: BTreeMap::from([(String::new(), "root".to_string())]), ..RemoteTree::default() };
        assert_eq!(directory_deletion(&pair(SyncDirection::TwoWay, SyncDeletePolicy::Propagate), "folder", &local, &remote, &baseline()), Some(DirectoryDeletion::Local));
    }

    #[test]
    fn preserve_policy_does_not_propagate_folder_deletion() {
        let local = LocalTree { directories: BTreeSet::from([String::new()]), ..LocalTree::default() };
        let remote = RemoteTree { directories: BTreeMap::from([(String::new(), "root".to_string()), ("folder".to_string(), "folder-id".to_string())]), ..RemoteTree::default() };
        assert_eq!(directory_deletion(&pair(SyncDirection::UploadOnly, SyncDeletePolicy::Preserve), "folder", &local, &remote, &baseline()), None);
    }

    #[test]
    fn two_way_legacy_preserve_still_propagates_folder_deletion() {
        let local = LocalTree { directories: BTreeSet::from([String::new()]), ..LocalTree::default() };
        let remote = RemoteTree { directories: BTreeMap::from([(String::new(), "root".to_string()), ("folder".to_string(), "folder-id".to_string())]), ..RemoteTree::default() };
        assert_eq!(directory_deletion(&pair(SyncDirection::TwoWay, SyncDeletePolicy::Preserve), "folder", &local, &remote, &baseline()), Some(DirectoryDeletion::Remote));
    }

    #[test]
    fn surviving_side_changes_block_folder_deletion() {
        let local = LocalTree { directories: BTreeSet::from([String::new()]), ..LocalTree::default() };
        let remote = RemoteTree {
            files: BTreeMap::from([(
                "folder/new.txt".to_string(),
                RemoteFile {
                    id: "new".to_string(),
                    parent_id: "folder-id".to_string(),
                    name: "new.txt".to_string(),
                    fingerprint: RemoteFingerprint { id: "new".to_string(), size: 1, updated_at: "now".to_string() },
                },
            )]),
            directories: BTreeMap::from([(String::new(), "root".to_string()), ("folder".to_string(), "folder-id".to_string())]),
            skipped: 0,
        };
        assert_eq!(directory_deletion(&pair(SyncDirection::TwoWay, SyncDeletePolicy::Propagate), "folder", &local, &remote, &baseline()), None);
    }
}

#[cfg(test)]
mod file_deletion_tests {
    use super::*;

    fn pair(direction: SyncDirection, delete_policy: SyncDeletePolicy) -> SyncPairInput {
        SyncPairInput {
            id: "pair".to_string(),
            local_path: "C:/sync".to_string(),
            remote_folder_id: "remote".to_string(),
            direction,
            delete_policy,
            enabled: true,
            interval_seconds: 30,
            ignore_patterns: Vec::new(),
        }
    }

    #[test]
    fn legacy_two_way_preserve_propagates_remote_file_deletion() {
        assert!(should_propagate_remote_file_deletion(&pair(SyncDirection::TwoWay, SyncDeletePolicy::Preserve), true, false));
    }

    #[test]
    fn changed_local_file_is_not_deleted_after_remote_deletion() {
        assert!(!should_propagate_remote_file_deletion(&pair(SyncDirection::TwoWay, SyncDeletePolicy::Preserve), true, true));
    }
}
