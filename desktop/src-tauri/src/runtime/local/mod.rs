use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::Mutex;

mod archive;
pub(crate) mod components;
pub(crate) mod download;
mod layout;
mod postgresql;

use components::LocalRuntimeManifest;
use layout::LocalRuntimeLayout;
use postgresql::PostgresqlRuntimeSnapshot;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LocalRuntimeStatus {
    #[default]
    Disabled,
    Preparing,
    Stopped,
    Downloading,
    InitializingDatabase,
    StartingDatabase,
    DatabaseReady,
    StartingBackend,
    Ready,
    Degraded,
    Failed,
    Stopping,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimePaths {
    root_dir: String,
    runtime_dir: String,
    backend_dir: String,
    postgresql_dir: String,
    web_dir: String,
    staging_dir: String,
    postgres_data_dir: String,
    config_path: String,
    manifest_path: String,
    postgresql_state_path: String,
    logs_dir: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimeSnapshot {
    status: LocalRuntimeStatus,
    paths: Option<LocalRuntimePaths>,
    manifest: Option<LocalRuntimeManifest>,
    postgresql: Option<PostgresqlRuntimeSnapshot>,
    error: Option<String>,
}

#[derive(Clone, Default)]
pub(crate) struct LocalRuntimeState {
    snapshot: Arc<RwLock<LocalRuntimeSnapshot>>,
    operation: Arc<Mutex<()>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimeError {
    kind: &'static str,
    message: String,
}

impl LocalRuntimeState {
    fn snapshot(&self) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
        self.snapshot
            .read()
            .map_err(|_| LocalRuntimeError::internal("Local runtime state lock is poisoned."))
            .map(|snapshot| snapshot.clone())
    }

    fn update(
        &self,
        update: impl FnOnce(&mut LocalRuntimeSnapshot),
    ) -> Result<(), LocalRuntimeError> {
        let mut snapshot = self
            .snapshot
            .write()
            .map_err(|_| LocalRuntimeError::internal("Local runtime state lock is poisoned."))?;
        update(&mut snapshot);
        Ok(())
    }

    fn fail(&self, error: &LocalRuntimeError) {
        let _ = self.update(|snapshot| {
            snapshot.status = LocalRuntimeStatus::Failed;
            snapshot.error = Some(error.message.clone());
        });
    }
}

impl LocalRuntimePaths {
    fn from_layout(layout: &LocalRuntimeLayout) -> Self {
        Self {
            root_dir: path_string(&layout.root_dir),
            runtime_dir: path_string(&layout.runtime_dir),
            backend_dir: path_string(&layout.backend_dir),
            postgresql_dir: path_string(&layout.postgresql_dir),
            web_dir: path_string(&layout.web_dir),
            staging_dir: path_string(&layout.staging_dir),
            postgres_data_dir: path_string(&layout.postgres_data_dir),
            config_path: path_string(&layout.config_path),
            manifest_path: path_string(&layout.manifest_path),
            postgresql_state_path: path_string(&layout.postgresql_state_path),
            logs_dir: path_string(&layout.logs_dir),
        }
    }
}

impl LocalRuntimeError {
    pub(crate) fn io(context: &str, error: impl std::fmt::Display) -> Self {
        Self::new("io", format!("{context}: {error}"))
    }

    pub(crate) fn network(context: &str, error: impl std::fmt::Display) -> Self {
        Self::new("network", format!("{context}: {error}"))
    }

    pub(crate) fn process(message: impl Into<String>) -> Self {
        Self::new("process", message)
    }

    pub(crate) fn credentials(message: impl Into<String>) -> Self {
        Self::new("credentials", message)
    }

    pub(crate) fn invalid_artifact(message: impl Into<String>) -> Self {
        Self::new("invalidArtifact", message)
    }

    pub(crate) fn invalid_state(message: impl Into<String>) -> Self {
        Self::new("invalidState", message)
    }

    pub(crate) fn unsupported_platform() -> Self {
        Self::new(
            "unsupportedPlatform",
            format!(
                "Local runtime is not available for {} {}.",
                std::env::consts::OS,
                std::env::consts::ARCH
            ),
        )
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }

    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[tauri::command]
pub(crate) fn get_local_runtime_snapshot(
    state: State<'_, LocalRuntimeState>,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    state.snapshot()
}

#[tauri::command]
pub(crate) async fn prepare_local_runtime(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    let _operation = state.operation.lock().await;
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::Preparing;
        snapshot.error = None;
    })?;

    let result = prepare_local_runtime_inner(&app, state.inner()).await;
    if let Err(error) = &result {
        fail(state.inner(), error);
    }
    result
}

#[tauri::command]
pub(crate) async fn start_local_postgresql(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    let _operation = state.operation.lock().await;
    let result = start_local_postgresql_inner(&app, state.inner()).await;
    if let Err(error) = &result {
        fail(state.inner(), error);
    }
    result
}

#[tauri::command]
pub(crate) async fn stop_local_postgresql(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    let _operation = state.operation.lock().await;
    let result = stop_local_postgresql_inner(&app, state.inner()).await;
    if let Err(error) = &result {
        fail(state.inner(), error);
    }
    result
}

pub(crate) async fn shutdown<R: Runtime>(app: &AppHandle<R>) -> Result<(), LocalRuntimeError> {
    let state = app.state::<LocalRuntimeState>();
    let _operation = state.operation.lock().await;
    let layout = LocalRuntimeLayout::resolve(app)?;
    let manifest = LocalRuntimeManifest::for_current_platform(app)?;
    postgresql::stop(&layout, &manifest.components.postgresql, state.inner()).await
}

async fn prepare_local_runtime_inner(
    app: &AppHandle,
    state: &LocalRuntimeState,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    prepare_foundation(app, state).await?;
    state.update(|snapshot| {
        snapshot.status = if snapshot
            .postgresql
            .as_ref()
            .is_some_and(|postgresql| postgresql.running)
        {
            LocalRuntimeStatus::DatabaseReady
        } else {
            LocalRuntimeStatus::Stopped
        };
        snapshot.error = None;
    })?;
    state.snapshot()
}

async fn start_local_postgresql_inner(
    app: &AppHandle,
    state: &LocalRuntimeState,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::Preparing;
        snapshot.error = None;
    })?;
    let (layout, manifest) = prepare_foundation(app, state).await?;
    postgresql::start(
        &layout,
        &manifest.components.postgresql,
        &manifest.desktop_version,
        state,
    )
    .await?;
    state.snapshot()
}

async fn stop_local_postgresql_inner(
    app: &AppHandle,
    state: &LocalRuntimeState,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    let (layout, manifest) = prepare_foundation(app, state).await?;
    postgresql::stop(&layout, &manifest.components.postgresql, state).await?;
    state.snapshot()
}

async fn prepare_foundation(
    app: &AppHandle,
    state: &LocalRuntimeState,
) -> Result<(LocalRuntimeLayout, LocalRuntimeManifest), LocalRuntimeError> {
    let layout = LocalRuntimeLayout::resolve(app)?;
    layout.prepare().await?;
    let manifest = LocalRuntimeManifest::for_current_platform(app)?;
    components::write_manifest(&layout.manifest_path, &manifest).await?;
    let paths = LocalRuntimePaths::from_layout(&layout);
    let postgresql = postgresql::inspect(&layout, &manifest.components.postgresql).await?;
    state.update(|snapshot| {
        snapshot.paths = Some(paths);
        snapshot.manifest = Some(manifest.clone());
        snapshot.postgresql = Some(postgresql);
        snapshot.error = None;
    })?;
    Ok((layout, manifest))
}

fn fail(state: &LocalRuntimeState, error: &LocalRuntimeError) {
    state.fail(error);
    crate::diagnostics::error("runtime.local", error.message.clone());
}

fn path_string(path: &PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::LocalRuntimeStatus;

    #[test]
    fn local_runtime_starts_disabled() {
        assert_eq!(LocalRuntimeStatus::default(), LocalRuntimeStatus::Disabled);
    }
}
