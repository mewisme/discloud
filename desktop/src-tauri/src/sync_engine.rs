use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{header::ETAG, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    fs::{self, File},
    io::{AsyncReadExt, AsyncWriteExt},
    time::sleep,
};

use crate::api::{response_error, ApiCommandError, ApiState};

const BASELINE_VERSION: u32 = 1;
const REMOTE_PAGE_SIZE: usize = 100;
const MAX_UPLOAD_ATTEMPTS: usize = 3;
const DEFAULT_CHUNK_SIZE: usize = 8 * 1024 * 1024;
const LOCAL_TRASH_DIR: &str = ".discloud-trash";

#[derive(Default)]
pub(crate) struct SyncEngineState {
    active: Mutex<HashSet<String>>,
    schedules: Mutex<BTreeMap<String, SyncPairInput>>,
    last_runs: Mutex<HashMap<String, u64>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncPairInput {
    id: String,
    local_path: String,
    remote_folder_id: String,
    direction: SyncDirection,
    delete_policy: SyncDeletePolicy,
    #[serde(default = "default_sync_enabled")]
    enabled: bool,
    #[serde(default = "default_sync_interval_seconds")]
    interval_seconds: u64,
    #[serde(default)]
    ignore_patterns: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum SyncDirection {
    TwoWay,
    DownloadOnly,
    UploadOnly,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SyncDeletePolicy {
    Preserve,
    Propagate,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncRunResult {
    uploaded: u64,
    downloaded: u64,
    remote_deleted: u64,
    local_deleted: u64,
    conflicts: u64,
    created_remote_folders: u64,
    created_local_folders: u64,
    skipped: u64,
}

#[derive(Clone, Debug)]
struct LocalFile {
    path: PathBuf,
    fingerprint: LocalFingerprint,
}

#[derive(Clone, Debug, Default)]
struct LocalTree {
    files: BTreeMap<String, LocalFile>,
    directories: BTreeSet<String>,
    skipped: u64,
}

#[derive(Clone, Debug)]
struct RemoteFile {
    id: String,
    parent_id: String,
    name: String,
    fingerprint: RemoteFingerprint,
}

#[derive(Clone, Debug, Default)]
struct RemoteTree {
    files: BTreeMap<String, RemoteFile>,
    directories: BTreeMap<String, String>,
    skipped: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LocalFingerprint {
    size: u64,
    modified_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RemoteFingerprint {
    id: String,
    size: u64,
    updated_at: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncBaseline {
    version: u32,
    files: BTreeMap<String, BaselineFile>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BaselineFile {
    local: Option<LocalFingerprint>,
    remote: Option<RemoteFingerprint>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncRunEvent {
    stage: &'static str,
    pair_id: String,
    started_at: u64,
    finished_at: Option<u64>,
    result: Option<SyncRunResult>,
    error: Option<String>,
}

#[derive(Clone, Debug)]
struct UploadSession {
    id: String,
    chunk_size: usize,
    status: String,
    committed_file_id: Option<String>,
}

impl SyncEngineState {
    fn begin(&self, pair_id: &str) -> Result<bool, ApiCommandError> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| ApiCommandError::internal("Sync state lock is poisoned."))?;
        Ok(active.insert(pair_id.to_string()))
    }

    fn finish(&self, pair_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(pair_id);
        }
    }

    fn configure(&self, pairs: Vec<SyncPairInput>) -> Result<(), ApiCommandError> {
        let configured = pairs
            .into_iter()
            .map(|pair| (pair.id.clone(), pair))
            .collect::<BTreeMap<_, _>>();
        let ids = configured.keys().cloned().collect::<HashSet<_>>();
        *self
            .schedules
            .lock()
            .map_err(|_| ApiCommandError::internal("Sync schedule lock is poisoned."))? =
            configured;
        self.last_runs
            .lock()
            .map_err(|_| ApiCommandError::internal("Sync schedule state lock is poisoned."))?
            .retain(|pair_id, _| ids.contains(pair_id));
        Ok(())
    }

    fn mark_run(&self, pair_id: &str, started_at: u64) {
        if let Ok(mut last_runs) = self.last_runs.lock() {
            last_runs.insert(pair_id.to_string(), started_at);
        }
    }

    fn due_pairs(&self, now: u64) -> Vec<SyncPairInput> {
        let Ok(active) = self.active.lock() else {
            return Vec::new();
        };
        let Ok(schedules) = self.schedules.lock() else {
            return Vec::new();
        };
        let Ok(last_runs) = self.last_runs.lock() else {
            return Vec::new();
        };

        schedules
            .values()
            .filter(|pair| {
                if !pair.enabled || active.contains(&pair.id) {
                    return false;
                }
                let interval_ms = pair.interval_seconds.saturating_mul(1000);
                last_runs
                    .get(&pair.id)
                    .is_none_or(|last| now.saturating_sub(*last) >= interval_ms)
            })
            .cloned()
            .collect()
    }
}

impl SyncDirection {
    fn uploads(self) -> bool {
        self != Self::DownloadOnly
    }

    fn downloads(self) -> bool {
        self != Self::UploadOnly
    }
}

pub(crate) fn start_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(5)).await;
            let due = app.state::<SyncEngineState>().due_pairs(timestamp_millis());

            for pair in due {
                let pair_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    run_scheduled_pair(&pair_app, pair).await;
                });
            }
        }
    });
}

#[tauri::command]
pub(crate) fn configure_sync_pairs(
    state: State<'_, SyncEngineState>,
    pairs: Vec<SyncPairInput>,
) -> Result<(), ApiCommandError> {
    for pair in &pairs {
        validate_pair(pair)?;
    }
    state.configure(pairs)
}

async fn run_scheduled_pair(app: &AppHandle, pair: SyncPairInput) {
    let started_at = timestamp_millis();
    {
        let state = app.state::<SyncEngineState>();
        if !state.begin(&pair.id).unwrap_or(false) {
            return;
        }
        state.mark_run(&pair.id, started_at);
    }
    let _ = app.emit(
        "desktop-sync-run",
        SyncRunEvent {
            stage: "started",
            pair_id: pair.id.clone(),
            started_at,
            finished_at: None,
            result: None,
            error: None,
        },
    );

    let result = {
        let api = app.state::<ApiState>();
        run_pair(app, api.inner(), &pair).await
    };
    app.state::<SyncEngineState>().finish(&pair.id);
    let finished_at = timestamp_millis();
    let (sync_result, error) = match result {
        Ok(result) => (Some(result), None),
        Err(error) => (None, Some(error.message().to_string())),
    };

    let _ = app.emit(
        "desktop-sync-run",
        SyncRunEvent {
            stage: "finished",
            pair_id: pair.id,
            started_at,
            finished_at: Some(finished_at),
            result: sync_result,
            error,
        },
    );
}

#[tauri::command]
pub(crate) async fn run_sync_pair(
    app: AppHandle,
    api_state: State<'_, ApiState>,
    sync_state: State<'_, SyncEngineState>,
    pair: SyncPairInput,
) -> Result<SyncRunResult, ApiCommandError> {
    validate_pair(&pair)?;

    if !sync_state.begin(&pair.id)? {
        return Err(ApiCommandError::invalid_request(
            "This sync pair is already running.",
        ));
    }

    sync_state.mark_run(&pair.id, timestamp_millis());
    let result = run_pair(&app, api_state.inner(), &pair).await;
    sync_state.finish(&pair.id);
    result
}

#[tauri::command]
pub(crate) async fn clear_sync_pair_state(
    app: AppHandle,
    pair_id: String,
) -> Result<(), ApiCommandError> {
    validate_pair_id(&pair_id)?;
    let path = baseline_path(&app, &pair_id)?;
    for candidate in [
        path.clone(),
        path.with_extension("json.bak"),
        path.with_extension("json.tmp"),
    ] {
        match fs::remove_file(candidate).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ApiCommandError::internal(format!(
                    "Could not remove sync baseline: {error}"
                )))
            }
        }
    }
    Ok(())
}

async fn run_pair(
    app: &AppHandle,
    api: &ApiState,
    pair: &SyncPairInput,
) -> Result<SyncRunResult, ApiCommandError> {
    let root = canonical_local_root(&pair.local_path).await?;
    let baseline = load_baseline(app, &pair.id).await?;
    let mut local = scan_local_tree(&root, &pair.ignore_patterns).await?;
    let mut remote = scan_remote_tree(api, &pair.remote_folder_id, &pair.ignore_patterns).await?;
    let mut result = SyncRunResult {
        skipped: local.skipped + remote.skipped,
        ..SyncRunResult::default()
    };

    validate_structural_conflicts(&local, &remote)?;

    if pair.direction.downloads() {
        ensure_local_directories(&root, &remote, &mut local, &mut result).await?;
    }

    if pair.direction.uploads() {
        ensure_remote_directories(api, &local, &mut remote, &mut result).await?;
    }

    let paths = union_file_paths(&local, &remote);

    for relative_path in paths {
        let current_local = local.files.get(&relative_path).cloned();
        let current_remote = remote.files.get(&relative_path).cloned();
        let previous = baseline.files.get(&relative_path);

        reconcile_file(
            api,
            &root,
            pair,
            &relative_path,
            current_local,
            current_remote,
            previous,
            &remote.directories,
            &mut result,
        )
        .await?;
    }

    let final_local = scan_local_tree(&root, &pair.ignore_patterns).await?;
    let final_remote = scan_remote_tree(api, &pair.remote_folder_id, &pair.ignore_patterns).await?;
    let next_baseline = build_baseline(&final_local, &final_remote);
    save_baseline(app, &pair.id, &next_baseline).await?;

    Ok(result)
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

async fn upload_file(
    api: &ApiState,
    path: &Path,
    parent_folder_id: &str,
    name: &str,
) -> Result<String, ApiCommandError> {
    let metadata = fs::metadata(path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not read sync upload file: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(ApiCommandError::invalid_request(
            "Sync upload source is not a file.",
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
    destination: &Path,
) -> Result<(), ApiCommandError> {
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

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not create sync download directory: {error}"))
        })?;
    }

    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let temp =
        unique_path(parent.join(format!(".{file_name}.discloud-part-{}", timestamp_millis())))
            .await?;
    let mut output = File::create(&temp).await.map_err(|error| {
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

    replace_local_file(destination, &temp).await
}

async fn replace_local_file(destination: &Path, temp: &Path) -> Result<(), ApiCommandError> {
    if fs::metadata(destination).await.is_err() {
        return fs::rename(temp, destination).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not finalize sync download: {error}"))
        });
    }

    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let backup = unique_path(parent.join(format!(
        ".{file_name}.discloud-backup-{}",
        timestamp_millis()
    )))
    .await?;

    fs::rename(destination, &backup).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not stage existing local file: {error}"))
    })?;

    match fs::rename(temp, destination).await {
        Ok(()) => {
            let _ = fs::remove_file(backup).await;
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, destination).await;
            let _ = fs::remove_file(temp).await;
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
        files,
    }
}

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
