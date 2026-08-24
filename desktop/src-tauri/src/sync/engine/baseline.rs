async fn load_baseline(app: &AppHandle, pair_id: &str) -> Result<SyncBaseline, ApiCommandError> {
    let path = baseline_path(app, pair_id)?;
    let backup = path.with_extension("json.bak");
    let bytes = match fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => match fs::read(&backup).await
        {
            Ok(bytes) => bytes,
            Err(backup_error) if backup_error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(SyncBaseline {
                    version: BASELINE_VERSION,
                    files: BTreeMap::new(),
                })
            }
            Err(backup_error) => {
                return Err(ApiCommandError::internal(format!(
                    "Could not read sync baseline backup: {backup_error}"
                )))
            }
        },
        Err(error) => {
            return Err(ApiCommandError::internal(format!(
                "Could not read sync baseline: {error}"
            )))
        }
    };
    let baseline = serde_json::from_slice::<SyncBaseline>(&bytes).map_err(|error| {
        ApiCommandError::internal(format!("Could not decode sync baseline: {error}"))
    })?;

    if baseline.version != BASELINE_VERSION {
        return Ok(SyncBaseline {
            version: BASELINE_VERSION,
            files: BTreeMap::new(),
        });
    }

    Ok(baseline)
}

async fn save_baseline(
    app: &AppHandle,
    pair_id: &str,
    baseline: &SyncBaseline,
) -> Result<(), ApiCommandError> {
    let path = baseline_path(app, pair_id)?;
    let parent = path
        .parent()
        .ok_or_else(|| ApiCommandError::internal("Sync baseline path has no parent."))?;
    fs::create_dir_all(parent).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not create sync state directory: {error}"))
    })?;
    let bytes = serde_json::to_vec_pretty(baseline).map_err(|error| {
        ApiCommandError::internal(format!("Could not encode sync baseline: {error}"))
    })?;
    let temp = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    fs::write(&temp, bytes).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not write sync baseline: {error}"))
    })?;

    let had_previous = fs::metadata(&path).await.is_ok();
    if had_previous {
        let _ = fs::remove_file(&backup).await;
        fs::rename(&path, &backup).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not stage previous sync baseline: {error}"))
        })?;
    }

    match fs::rename(&temp, &path).await {
        Ok(()) => {
            if had_previous {
                let _ = fs::remove_file(&backup).await;
            }
            Ok(())
        }
        Err(error) => {
            if had_previous {
                let _ = fs::rename(&backup, &path).await;
            }
            let _ = fs::remove_file(&temp).await;
            Err(ApiCommandError::internal(format!(
                "Could not finalize sync baseline: {error}"
            )))
        }
    }
}

fn baseline_path(app: &AppHandle, pair_id: &str) -> Result<PathBuf, ApiCommandError> {
    let directory = app.path().app_data_dir().map_err(|error| {
        ApiCommandError::internal(format!("Could not resolve app data directory: {error}"))
    })?;
    Ok(directory.join("sync").join(format!("{pair_id}.json")))
}

async fn canonical_local_root(value: &str) -> Result<PathBuf, ApiCommandError> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(ApiCommandError::invalid_request(
            "Sync local folder must be an absolute path.",
        ));
    }
    let metadata = fs::symlink_metadata(&path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not read sync local folder: {error}"))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ApiCommandError::invalid_request(
            "Sync local path must be a real directory, not a symbolic link.",
        ));
    }
    Ok(path)
}

fn default_sync_enabled() -> bool {
    true
}

fn default_sync_interval_seconds() -> u64 {
    30
}

fn validate_pair(pair: &SyncPairInput) -> Result<(), ApiCommandError> {
    validate_pair_id(&pair.id)?;
    if !valid_resource_id(&pair.remote_folder_id) {
        return Err(ApiCommandError::invalid_request(
            "Invalid remote folder ID.",
        ));
    }
    if !(15..=86_400).contains(&pair.interval_seconds) {
        return Err(ApiCommandError::invalid_request(
            "Sync interval must be between 15 seconds and 24 hours.",
        ));
    }
    if pair.ignore_patterns.len() > 256
        || pair
            .ignore_patterns
            .iter()
            .any(|pattern| pattern.len() > 512)
    {
        return Err(ApiCommandError::invalid_request(
            "Sync ignore rule limit exceeded.",
        ));
    }
    Ok(())
}

fn validate_pair_id(value: &str) -> Result<(), ApiCommandError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ApiCommandError::invalid_request("Invalid sync pair ID."));
    }
    Ok(())
}

fn validate_structural_conflicts(
    local: &LocalTree,
    remote: &RemoteTree,
) -> Result<(), ApiCommandError> {
    if let Some(path) = local
        .files
        .keys()
        .find(|path| remote.directories.contains_key(*path))
    {
        return Err(ApiCommandError::invalid_request(format!(
            "Sync path is a local file but a remote folder: {path}"
        )));
    }
    if let Some(path) = remote
        .files
        .keys()
        .find(|path| local.directories.contains(*path))
    {
        return Err(ApiCommandError::invalid_request(format!(
            "Sync path is a local folder but a remote file: {path}"
        )));
    }
    Ok(())
}

fn union_file_paths(local: &LocalTree, remote: &RemoteTree) -> Vec<String> {
    let mut paths = BTreeSet::new();
    paths.extend(local.files.keys().cloned());
    paths.extend(remote.files.keys().cloned());
    paths.into_iter().collect()
}

fn remote_parent_id<'a>(
    relative_path: &str,
    directories: &'a BTreeMap<String, String>,
) -> Result<&'a str, ApiCommandError> {
    directories
        .get(relative_parent(relative_path))
        .map(String::as_str)
        .ok_or_else(|| ApiCommandError::internal("Remote sync parent folder is missing."))
}

fn relative_parent(path: &str) -> &str {
    path.rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("")
}

fn relative_name(path: &str) -> Result<&str, ApiCommandError> {
    path.rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiCommandError::invalid_request("Sync relative file name is invalid."))
}

fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn relative_to_path(value: &str) -> PathBuf {
    value.split('/').fold(PathBuf::new(), |mut path, segment| {
        path.push(segment);
        path
    })
}

fn path_depth(value: &str) -> usize {
    value
        .split('/')
        .filter(|segment| !segment.is_empty())
        .count()
}

fn conflict_name(name: &str, side: &str) -> String {
    let stamp = timestamp_millis();
    let suffix = format!(" (DisCloud conflict {side} {stamp})");

    if let Some(index) = name.rfind('.').filter(|index| *index > 0) {
        format!("{}{}{}", &name[..index], suffix, &name[index..])
    } else {
        format!("{name}{suffix}")
    }
}

async fn unique_path(path: PathBuf) -> Result<PathBuf, ApiCommandError> {
    if fs::metadata(&path).await.is_err() {
        return Ok(path);
    }

    let parent = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ApiCommandError::internal("Could not build unique sync path."))?;

    for index in 2..10_000 {
        let candidate = parent.join(format!("{file_name} {index}"));
        if fs::metadata(&candidate).await.is_err() {
            return Ok(candidate);
        }
    }

    Err(ApiCommandError::internal(
        "Could not allocate a unique sync path.",
    ))
}

fn ignored_path(relative_path: &str, name: &str, is_directory: bool, patterns: &[String]) -> bool {
    patterns.iter().any(|raw| {
        let pattern = raw.trim().trim_start_matches("./");
        if pattern.is_empty() || pattern.starts_with('#') {
            return false;
        }
        if let Some(prefix) = pattern.strip_suffix('/') {
            return is_directory
                && (name == prefix
                    || relative_path == prefix
                    || relative_path.starts_with(&format!("{prefix}/")));
        }
        wildcard_match(pattern, relative_path) || wildcard_match(pattern, name)
    })
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.as_bytes();
    let value = value.as_bytes();
    let (mut p, mut v, mut star, mut checkpoint) = (0_usize, 0_usize, None, 0_usize);

    while v < value.len() {
        if p < pattern.len() && (pattern[p] == b'?' || pattern[p] == value[v]) {
            p += 1;
            v += 1;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            p += 1;
            checkpoint = v;
        } else if let Some(index) = star {
            p = index + 1;
            checkpoint += 1;
            v = checkpoint;
        } else {
            return false;
        }
    }

    while p < pattern.len() && pattern[p] == b'*' {
        p += 1;
    }
    p == pattern.len()
}

fn is_internal_sync_path(relative_path: &str) -> bool {
    relative_path == LOCAL_TRASH_DIR
        || relative_path.starts_with(&format!("{LOCAL_TRASH_DIR}/"))
        || relative_path.split('/').any(|segment| {
            segment.contains(".discloud-part-") || segment.contains(".discloud-backup-")
        })
}

fn system_time_millis(value: Option<SystemTime>) -> u64 {
    value
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn timestamp_millis() -> u64 {
    system_time_millis(Some(SystemTime::now()))
}

fn sha256_hex(body: &[u8]) -> String {
    hex_digest(Sha256::digest(body).as_slice())
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn json_string(value: &Value, key: &str) -> Result<String, ApiCommandError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| ApiCommandError::internal(format!("Sync response is missing {key}.")))
}

fn valid_resource_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::{conflict_name, ignored_path, relative_parent, wildcard_match};

    #[test]
    fn matches_ignore_patterns() {
        assert!(wildcard_match("*.tmp", "cache.tmp"));
        assert!(wildcard_match("build/*", "build/output.js"));
        assert!(!wildcard_match("*.tmp", "notes.txt"));
        assert!(ignored_path(
            "node_modules",
            "node_modules",
            true,
            &["node_modules/".into()]
        ));
        assert!(ignored_path(
            "src/node_modules",
            "node_modules",
            true,
            &["node_modules/".into()]
        ));
    }

    #[test]
    fn resolves_relative_parent() {
        assert_eq!(relative_parent("file.txt"), "");
        assert_eq!(relative_parent("folder/file.txt"), "folder");
    }

    #[test]
    fn creates_conflict_name_without_losing_extension() {
        let name = conflict_name("photo.jpg", "local");
        assert!(name.starts_with("photo (DisCloud conflict local "));
        assert!(name.ends_with(".jpg"));
    }
}
