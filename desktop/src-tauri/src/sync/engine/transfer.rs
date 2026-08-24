async fn upload_file(
    api: &ApiState,
    path: &Path,
    parent_folder_id: &str,
    name: &str,
) -> Result<String, ApiCommandError> {
    let metadata = fs::symlink_metadata(path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not read sync upload file: {error}"))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ApiCommandError::invalid_request(
            "Sync upload source must be a regular file, not a symbolic link.",
        ));
    }

    let file_sha = file_sha256(path).await?;
    let create = send_json(
        api,
        Method::POST,
        "/api/v1/uploads",
        Vec::new(),
        Some(json!({
            "parentFolderId": parent_folder_id,
            "name": name,
            "size": metadata.len(),
            "fileSha256": file_sha,
        })),
    )
    .await?;
    let session = parse_upload_session(&create)?;

    if session.status == "completed" {
        return session.committed_file_id.ok_or_else(|| {
            ApiCommandError::internal("Completed upload session has no committed file ID.")
        });
    }
    if session.status != "open" {
        return Err(ApiCommandError::internal(format!(
            "Sync upload session is {}.",
            session.status
        )));
    }

    let result = upload_file_parts(api, path, &session).await;
    if let Err(error) = result {
        let _ = send_json(
            api,
            Method::DELETE,
            &format!("/api/v1/uploads/{}", session.id),
            Vec::new(),
            None,
        )
        .await;
        return Err(error);
    }

    let completed = send_json(
        api,
        Method::POST,
        &format!("/api/v1/uploads/{}/complete", session.id),
        Vec::new(),
        None,
    )
    .await?;
    json_string(&completed, "id")
}

async fn upload_file_parts(
    api: &ApiState,
    path: &Path,
    session: &UploadSession,
) -> Result<(), ApiCommandError> {
    let metadata = fs::symlink_metadata(path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not inspect sync upload file: {error}"))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ApiCommandError::invalid_request(
            "Sync upload source changed into a symbolic link or non-file path.",
        ));
    }
    let mut file = File::open(path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not open sync upload file: {error}"))
    })?;
    let chunk_size = session.chunk_size.max(1);
    let mut index = 0_u32;

    loop {
        let mut body = vec![0_u8; chunk_size];
        let mut filled = 0_usize;

        while filled < body.len() {
            let read = file.read(&mut body[filled..]).await.map_err(|error| {
                ApiCommandError::internal(format!("Could not read sync upload file: {error}"))
            })?;
            if read == 0 {
                break;
            }
            filled += read;
        }

        if filled == 0 {
            break;
        }
        body.truncate(filled);
        upload_part_with_retry(api, session, index, body).await?;
        index = index.saturating_add(1);
    }

    Ok(())
}

async fn upload_part_with_retry(
    api: &ApiState,
    session: &UploadSession,
    part_index: u32,
    body: Vec<u8>,
) -> Result<(), ApiCommandError> {
    let digest = sha256_hex(&body);
    let endpoint = format!("/api/v1/uploads/{}/parts/{part_index}", session.id);
    let headers = vec![
        (
            "Content-Type".to_string(),
            "application/octet-stream".to_string(),
        ),
        ("X-Chunk-SHA256".to_string(), digest),
    ];

    for attempt in 0..MAX_UPLOAD_ATTEMPTS {
        let response = api
            .raw_request_body(
                Method::PUT,
                &endpoint,
                Vec::new(),
                headers.clone(),
                body.clone(),
            )
            .await;

        match response {
            Ok(response) if response.status().is_success() => {
                let _ = response.bytes().await;
                return Ok(());
            }
            Ok(response) => {
                let error = response_error(response).await;
                if attempt + 1 >= MAX_UPLOAD_ATTEMPTS || !error.is_retryable_transfer() {
                    return Err(error);
                }
            }
            Err(error) => {
                if attempt + 1 >= MAX_UPLOAD_ATTEMPTS || !error.is_retryable_transfer() {
                    return Err(error);
                }
            }
        }

        sleep(Duration::from_millis(500 * 2_u64.pow(attempt as u32))).await;
    }

    Err(ApiCommandError::internal(
        "Sync upload retry loop exited unexpectedly.",
    ))
}

async fn download_file(
    api: &ApiState,
    file_id: &str,
    root: &Path,
    relative_path: &str,
) -> Result<(), ApiCommandError> {
    let destination = crate::path_security::checked_child_output_file(
        root,
        relative_path,
        "Sync download destination",
    )
    .await?;
    let endpoint = format!("/api/v1/files/{file_id}/download");
    let mut response = api
        .raw_request(Method::GET, &endpoint, Vec::new(), Vec::new())
        .await?;

    if !response.status().is_success() {
        return Err(response_error(response).await);
    }

    let expected_sha = response
        .headers()
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .map(|value| value.trim_start_matches("W/").trim_matches('"').to_string())
        .filter(|value| value.len() == 64);

    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let parent_relative = relative_parent(relative_path);
    let temp_name = format!(".{file_name}.discloud-part-{}", timestamp_millis());
    let temp_relative = if parent_relative.is_empty() {
        temp_name
    } else {
        format!("{parent_relative}/{temp_name}")
    };
    let temp = crate::path_security::checked_child_output_file(
        root,
        &temp_relative,
        "Sync temporary download path",
    )
    .await?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .await
        .map_err(|error| {
        ApiCommandError::internal(format!("Could not create sync download file: {error}"))
    })?;
    let mut hasher = Sha256::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| ApiCommandError::network("Could not read sync download", error))?
    {
        hasher.update(&chunk);
        output.write_all(&chunk).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not write sync download: {error}"))
        })?;
    }
    output.flush().await.map_err(|error| {
        ApiCommandError::internal(format!("Could not flush sync download: {error}"))
    })?;
    drop(output);

    if let Some(expected) = expected_sha {
        let actual = hex_digest(hasher.finalize().as_slice());
        if actual != expected {
            let _ = fs::remove_file(&temp).await;
            return Err(ApiCommandError::internal(
                "Downloaded sync file failed SHA-256 verification.",
            ));
        }
    }

    replace_local_file(root, relative_path, &temp).await
}

async fn replace_local_file(root: &Path, relative_path: &str, temp: &Path) -> Result<(), ApiCommandError> {
    let destination = crate::path_security::checked_child_output_file(
        root,
        relative_path,
        "Sync download destination",
    )
    .await?;
    let temp = temp
        .to_str()
        .ok_or_else(|| ApiCommandError::invalid_request("Sync temporary path must be valid UTF-8."))?;
    let temp = crate::path_security::canonical_path_within(root, temp, "Sync temporary download path").await?;
    if fs::symlink_metadata(&destination).await.is_err() {
        return fs::rename(&temp, &destination).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not finalize sync download: {error}"))
        });
    }

    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let parent_relative = relative_parent(relative_path);
    let backup_name = format!(".{file_name}.discloud-backup-{}", timestamp_millis());
    let backup_relative = if parent_relative.is_empty() {
        backup_name
    } else {
        format!("{parent_relative}/{backup_name}")
    };
    let backup_candidate = crate::path_security::checked_child_output_file(
        root,
        &backup_relative,
        "Sync backup path",
    )
    .await?;
    let backup = unique_path(backup_candidate).await?;

    fs::rename(&destination, &backup).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not stage existing local file: {error}"))
    })?;

    match fs::rename(&temp, &destination).await {
        Ok(()) => {
            let _ = fs::remove_file(backup).await;
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, &destination).await;
            let _ = fs::remove_file(&temp).await;
            Err(ApiCommandError::internal(format!(
                "Could not replace local sync file: {error}"
            )))
        }
    }
}

async fn same_file_content(
    api: &ApiState,
    local_path: &Path,
    remote_id: &str,
) -> Result<bool, ApiCommandError> {
    let metadata = send_json(
        api,
        Method::GET,
        &format!("/api/v1/files/{remote_id}"),
        Vec::new(),
        None,
    )
    .await?;
    let Some(remote_sha) = metadata.get("sha256").and_then(Value::as_str) else {
        return Ok(false);
    };
    Ok(file_sha256(local_path).await? == remote_sha)
}

async fn file_sha256(path: &Path) -> Result<String, ApiCommandError> {
    let metadata = fs::symlink_metadata(path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not inspect local sync file: {error}"))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ApiCommandError::invalid_request(
            "Local sync file must be a regular file, not a symbolic link.",
        ));
    }
    let mut file = File::open(path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not open local sync file: {error}"))
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];

    loop {
        let read = file.read(&mut buffer).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not hash local sync file: {error}"))
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hex_digest(hasher.finalize().as_slice()))
}

async fn send_json(
    api: &ApiState,
    method: Method,
    path: &str,
    query: Vec<(String, String)>,
    body: Option<Value>,
) -> Result<Value, ApiCommandError> {
    let response = if let Some(body) = body {
        let bytes = serde_json::to_vec(&body).map_err(|error| {
            ApiCommandError::internal(format!("Could not encode sync request: {error}"))
        })?;
        api.raw_request_body(
            method,
            path,
            query,
            vec![("Content-Type".to_string(), "application/json".to_string())],
            bytes,
        )
        .await?
    } else {
        api.raw_request(method, path, query, Vec::new()).await?
    };

    if !response.status().is_success() {
        return Err(response_error(response).await);
    }
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(Value::Null);
    }

    response.json::<Value>().await.map_err(|error| {
        ApiCommandError::internal(format!("Could not decode sync response: {error}"))
    })
}

fn parse_upload_session(value: &Value) -> Result<UploadSession, ApiCommandError> {
    let chunk_size = value
        .get("chunkSize")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(DEFAULT_CHUNK_SIZE);

    Ok(UploadSession {
        id: json_string(value, "id")?,
        chunk_size,
        status: json_string(value, "status")?,
        committed_file_id: value
            .get("committedFileId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

fn build_baseline(local: &LocalTree, remote: &RemoteTree) -> SyncBaseline {
    let mut directories = BTreeMap::new();
    let mut directory_paths = BTreeSet::new();
    directory_paths.extend(local.directories.iter().filter(|path| !path.is_empty()).cloned());
    directory_paths.extend(remote.directories.keys().filter(|path| !path.is_empty()).cloned());
    for path in directory_paths {
        directories.insert(
            path.clone(),
            BaselineDirectory {
                local: local.directories.contains(&path),
                remote: remote.directories.contains_key(&path),
            },
        );
    }

    let mut files = BTreeMap::new();
    let paths = union_file_paths(local, remote);

    for path in paths {
        files.insert(
            path.clone(),
            BaselineFile {
                local: local.files.get(&path).map(|file| file.fingerprint.clone()),
                remote: remote.files.get(&path).map(|file| file.fingerprint.clone()),
            },
        );
    }

    SyncBaseline {
        version: BASELINE_VERSION,
        directories,
        files,
    }
}

