async fn scan_local_tree(
    root: &Path,
    ignore_patterns: &[String],
) -> Result<LocalTree, ApiCommandError> {
    let mut tree = LocalTree::default();
    tree.directories.insert(String::new());
    let mut queue = VecDeque::from([(root.to_path_buf(), String::new())]);

    while let Some((directory, relative_directory)) = queue.pop_front() {
        let mut reader = fs::read_dir(&directory).await.map_err(|error| {
            ApiCommandError::invalid_request(format!(
                "Could not read sync directory {}: {error}",
                directory.display()
            ))
        })?;
        let mut entries = Vec::new();

        while let Some(entry) = reader.next_entry().await.map_err(|error| {
            ApiCommandError::invalid_request(format!(
                "Could not read sync directory entry: {error}"
            ))
        })? {
            let name = entry.file_name().into_string().map_err(|_| {
                ApiCommandError::invalid_request("Sync folder contains a non-Unicode path.")
            })?;
            entries.push((name, entry.path()));
        }

        entries.sort_by(|left, right| left.0.cmp(&right.0));

        for (name, path) in entries {
            let metadata = fs::symlink_metadata(&path).await.map_err(|error| {
                ApiCommandError::invalid_request(format!(
                    "Could not read sync path metadata {}: {error}",
                    path.display()
                ))
            })?;
            let relative = join_relative(&relative_directory, &name);
            crate::path_security::safe_relative_path(&relative, "Local sync path")?;
            let is_directory = metadata.is_dir();

            if is_internal_sync_path(&relative)
                || ignored_path(&relative, &name, is_directory, ignore_patterns)
            {
                tree.skipped += 1;
                continue;
            }

            if metadata.file_type().is_symlink() {
                tree.skipped += 1;
                continue;
            }

            if metadata.is_dir() {
                tree.directories.insert(relative.clone());
                queue.push_back((path, relative));
            } else if metadata.is_file() {
                tree.files.insert(
                    relative,
                    LocalFile {
                        path,
                        fingerprint: LocalFingerprint {
                            size: metadata.len(),
                            modified_ms: system_time_millis(metadata.modified().ok()),
                        },
                    },
                );
            } else {
                tree.skipped += 1;
            }
        }
    }

    Ok(tree)
}

async fn scan_remote_tree(
    api: &ApiState,
    root_folder_id: &str,
    ignore_patterns: &[String],
) -> Result<RemoteTree, ApiCommandError> {
    let root_value = send_json(
        api,
        Method::GET,
        &format!("/api/v1/folders/{root_folder_id}"),
        Vec::new(),
        None,
    )
    .await?;
    let root_id = json_string(&root_value, "id")?;
    let mut tree = RemoteTree::default();
    tree.directories.insert(String::new(), root_id.clone());
    let mut queue = VecDeque::from([(root_id, String::new())]);

    while let Some((folder_id, relative_directory)) = queue.pop_front() {
        let mut cursor: Option<String> = None;

        loop {
            let mut query = vec![
                ("limit".to_string(), REMOTE_PAGE_SIZE.to_string()),
                ("sort".to_string(), "name".to_string()),
                ("order".to_string(), "asc".to_string()),
            ];
            if let Some(value) = &cursor {
                query.push(("cursor".to_string(), value.clone()));
            }

            let page = send_json(
                api,
                Method::GET,
                &format!("/api/v1/folders/{folder_id}/children"),
                query,
                None,
            )
            .await?;
            let nodes = page
                .get("nodes")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiCommandError::internal("Folder listing has no nodes array."))?;

            for node in nodes {
                let id = json_string(node, "id")?;
                let kind = json_string(node, "kind")?;
                let name = json_string(node, "name")?;
                let updated_at = json_string(node, "updatedAt")?;
                let relative = join_relative(&relative_directory, &name);
                crate::path_security::safe_relative_path(&relative, "Remote sync path")?;
                let is_directory = kind == "folder";

                if is_internal_sync_path(&relative)
                    || ignored_path(&relative, &name, is_directory, ignore_patterns)
                {
                    tree.skipped += 1;
                    continue;
                }

                if is_directory {
                    tree.directories.insert(relative.clone(), id.clone());
                    queue.push_back((id, relative));
                } else if kind == "file" {
                    let size = node.get("size").and_then(Value::as_u64).unwrap_or(0);
                    tree.files.insert(
                        relative,
                        RemoteFile {
                            id: id.clone(),
                            parent_id: folder_id.clone(),
                            name,
                            fingerprint: RemoteFingerprint {
                                id,
                                size,
                                updated_at,
                            },
                        },
                    );
                }
            }

            cursor = page
                .get("nextCursor")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
    }

    Ok(tree)
}

