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

const BASELINE_VERSION: u32 = 2;
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
    #[serde(default)]
    directories: BTreeMap<String, BaselineDirectory>,
    files: BTreeMap<String, BaselineFile>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BaselineDirectory {
    local: bool,
    remote: bool,
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

impl SyncPairInput {
    fn propagates_deletions(&self) -> bool {
        self.direction == SyncDirection::TwoWay || self.delete_policy == SyncDeletePolicy::Propagate
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
    clear_sync_conflicts(&app, &pair_id).await?;
    Ok(())
}

async fn run_pair(
    app: &AppHandle,
    api: &ApiState,
    pair: &SyncPairInput,
) -> Result<SyncRunResult, ApiCommandError> {
    let root = canonical_local_root(&pair.local_path).await?;
    let baseline = load_baseline(app, &pair.id).await?;
    let mut pending_conflicts = load_sync_conflicts(app, &pair.id)
        .await?
        .into_iter()
        .map(|conflict| (conflict.relative_path.clone(), conflict))
        .collect::<BTreeMap<_, _>>();
    let mut local = scan_local_tree(&root, &pair.ignore_patterns).await?;
    let mut remote = scan_remote_tree(api, &pair.remote_folder_id, &pair.ignore_patterns).await?;
    let mut result = SyncRunResult {
        skipped: local.skipped + remote.skipped,
        ..SyncRunResult::default()
    };

    validate_structural_conflicts(&local, &remote)?;

    reconcile_directory_deletions(
        api,
        &root,
        pair,
        &mut local,
        &mut remote,
        &baseline,
        &mut result,
    )
    .await?;

    if pair.direction.downloads() {
        ensure_local_directories(&root, &remote, &mut local, &mut result).await?;
    }

    if pair.direction.uploads() {
        ensure_remote_directories(api, &local, &mut remote, &mut result).await?;
    }

    let renamed_paths = if pair.direction.uploads() {
        reconcile_local_renames(api, &local, &mut remote, &baseline, &pending_conflicts).await?
    } else {
        BTreeSet::new()
    };
    let paths = union_file_paths(&local, &remote);

    for relative_path in paths {
        if renamed_paths.contains(&relative_path) {
            continue;
        }
        if pending_conflicts.contains_key(&relative_path) {
            result.conflicts += 1;
            continue;
        }
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
            &mut pending_conflicts,
            &mut result,
        )
        .await?;
    }

    let final_local = scan_local_tree(&root, &pair.ignore_patterns).await?;
    let final_remote = scan_remote_tree(api, &pair.remote_folder_id, &pair.ignore_patterns).await?;
    let mut next_baseline = build_baseline(&final_local, &final_remote);
    for relative_path in pending_conflicts.keys() {
        if let Some(previous) = baseline.files.get(relative_path) {
            next_baseline
                .files
                .insert(relative_path.clone(), previous.clone());
        } else {
            next_baseline.files.remove(relative_path);
        }
    }
    save_baseline(app, &pair.id, &next_baseline).await?;
    save_sync_conflicts(
        app,
        &pair.id,
        &pending_conflicts.into_values().collect::<Vec<_>>(),
    )
    .await?;

    Ok(result)
}

include!("conflicts.rs");
include!("reconcile.rs");
include!("scan.rs");
include!("transfer.rs");
include!("baseline.rs");
