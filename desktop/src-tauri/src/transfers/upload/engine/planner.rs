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

    let (resolved, created_folders) =
        resolve_folder_paths(api, parent_folder_id, &folder_paths).await?;
    let files = entries
        .into_iter()
        .map(|entry| {
            let folder_id = if entry.directory_path.is_empty() {
                parent_folder_id.to_string()
            } else {
                resolved
                    .get(&entry.directory_path)
                    .cloned()
                    .ok_or_else(|| {
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
    path.rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("")
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

    use crate::transfers::upload::transfer::LocalUploadFile;

    use super::{
        build_upload_tree, folder_depth, normalize_segment, take_folder_batch, upload_task_view,
        UploadTask, UploadTaskStatus,
    };

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
    fn upload_view_hides_native_transfer_state() {
        let task = UploadTask {
            id: "task-id".to_string(),
            file: LocalUploadFile {
                path: "C:/secret/file.txt".to_string(),
                name: "file.txt".to_string(),
                size: 12,
                relative_path: "folder/file.txt".to_string(),
            },
            folder_id: "folder-id".to_string(),
            relative_path: Some("folder/file.txt".to_string()),
            skip_existing: true,
            session_id: Some("session-id".to_string()),
            status: UploadTaskStatus::Uploading,
            uploaded_bytes: 6,
            error: None,
        };
        let value = serde_json::to_value(upload_task_view(&task)).unwrap();

        assert_eq!(value["file"]["name"], "file.txt");
        assert_eq!(value["file"]["size"], 12);
        assert!(value["file"].get("relativePath").is_none());
        assert_eq!(value["canCancel"], true);
        assert_eq!(value["canRemove"], false);
        assert!(value.get("sessionId").is_none());
        assert!(value.get("skipExisting").is_none());
        assert!(value["file"].get("path").is_none());
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
