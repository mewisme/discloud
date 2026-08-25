use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::Mutex;

mod archive;
mod backend;
mod bundled;
pub(crate) mod components;
mod config;
pub(crate) mod download;
mod layout;
mod logs;
mod ports;
mod postgresql;
mod process;
mod web;

use backend::{BackendProcessState, BackendRuntimeSnapshot};
use components::LocalRuntimeManifest;
use layout::LocalRuntimeLayout;
use postgresql::PostgresqlRuntimeSnapshot;
use web::{WebProcessState, WebRuntimeSnapshot};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LocalRuntimeStatus {
    #[default]
    Disabled,
    Preparing,
    Installing,
    Stopped,
    Downloading,
    InitializingDatabase,
    StartingDatabase,
    DatabaseReady,
    StartingBackend,
    StartingWeb,
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
    backend_state_path: String,
    backend_shutdown_path: String,
    web_state_path: String,
    web_shutdown_path: String,
    logs_dir: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimeSnapshot {
    status: LocalRuntimeStatus,
    paths: Option<LocalRuntimePaths>,
    manifest: Option<LocalRuntimeManifest>,
    postgresql: Option<PostgresqlRuntimeSnapshot>,
    backend: Option<BackendRuntimeSnapshot>,
    web: Option<WebRuntimeSnapshot>,
    error: Option<String>,
}

#[derive(Clone, Default)]
pub(crate) struct LocalRuntimeState {
    snapshot: Arc<RwLock<LocalRuntimeSnapshot>>,
    operation: Arc<Mutex<()>>,
    backend_process: BackendProcessState,
    web_process: WebProcessState,
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
            backend_state_path: path_string(&layout.backend_state_path),
            backend_shutdown_path: path_string(&layout.backend_shutdown_path),
            web_state_path: path_string(&layout.web_state_path),
            web_shutdown_path: path_string(&layout.web_shutdown_path),
            logs_dir: path_string(&layout.logs_dir),
        }
    }
}

impl LocalRuntimeError {
    pub(crate) fn message(&self) -> &str {
        &self.message
    }

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

    pub(crate) fn configuration(message: impl Into<String>) -> Self {
        Self::new("configuration", message)
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
pub(crate) async fn get_local_runtime_log(
    app: AppHandle,
    stage: logs::LocalRuntimeLogStage,
) -> Result<logs::LocalRuntimeLog, LocalRuntimeError> {
    let layout = LocalRuntimeLayout::resolve(&app)?;
    logs::read(&layout, stage).await
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
pub(crate) async fn get_local_server_settings(
    app: AppHandle,
) -> Result<config::LocalServerSettings, LocalRuntimeError> {
    config::load_settings(&app).await
}

#[tauri::command]
pub(crate) async fn save_local_server_settings(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
    settings: config::LocalServerSettingsInput,
) -> Result<config::LocalServerSettings, LocalRuntimeError> {
    let _operation = state.operation.lock().await;
    let result = config::save_settings(&app, settings).await;
    if let Err(error) = &result {
        fail(state.inner(), error);
        return result;
    }
    prepare_foundation(&app, state.inner()).await?;
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimeStartResult {
    snapshot: LocalRuntimeSnapshot,
    server_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimeUpdateCompatibility {
    backend_version: String,
    postgresql_version: String,
    compatible: bool,
    detail: Option<String>,
    web_enabled: bool,
    web_version: Option<String>,
    web_compatible: Option<bool>,
    web_detail: Option<String>,
}

#[tauri::command]
pub(crate) async fn start_local_runtime(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
    api: State<'_, crate::api::ApiState>,
) -> Result<LocalRuntimeStartResult, LocalRuntimeError> {
    let _operation = state.operation.lock().await;
    let result = start_local_runtime_inner(&app, state.inner(), api.inner()).await;
    if let Err(error) = &result {
        fail(state.inner(), error);
    }
    result
}

#[tauri::command]
pub(crate) async fn stop_local_runtime(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
    api: State<'_, crate::api::ApiState>,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    let _operation = state.operation.lock().await;
    let result = stop_local_runtime_inner(&app, state.inner(), api.inner()).await;
    if let Err(error) = &result {
        fail(state.inner(), error);
    }
    result
}

#[tauri::command]
pub(crate) async fn restart_local_runtime(
    app: AppHandle,
    state: State<'_, LocalRuntimeState>,
    api: State<'_, crate::api::ApiState>,
) -> Result<LocalRuntimeStartResult, LocalRuntimeError> {
    let _operation = state.operation.lock().await;
    let result = async {
        stop_local_runtime_inner(&app, state.inner(), api.inner()).await?;
        start_local_runtime_inner(&app, state.inner(), api.inner()).await
    }
    .await;
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
    let web_enabled = config::web_enabled(&layout).await.unwrap_or(false);
    if let Some(descriptor) = manifest.components.web.as_ref() {
        if let Err(error) = web::stop(&layout, descriptor, web_enabled, &state.web_process).await {
            crate::diagnostics::warn("runtime.local.web", error.message().to_string());
        }
    }
    backend::stop(
        &layout,
        &manifest.components.backend,
        &state.backend_process,
        state.inner(),
    )
    .await?;
    postgresql::stop(&layout, &manifest.components.postgresql, state.inner()).await
}

pub(crate) async fn check_desktop_update_compatibility(
    app: &AppHandle,
    version: &str,
) -> LocalRuntimeUpdateCompatibility {
    let version = normalize_update_version(version);
    let descriptor = match components::backend_descriptor(version) {
        Ok(descriptor) => descriptor,
        Err(error) => {
            return LocalRuntimeUpdateCompatibility {
                backend_version: version.to_string(),
                postgresql_version: components::POSTGRESQL_VERSION.to_string(),
                compatible: false,
                detail: Some(error.message().to_string()),
                web_enabled: false,
                web_version: Some(version.to_string()),
                web_compatible: None,
                web_detail: None,
            };
        }
    };
    let client = download::client(&app.package_info().version.to_string());
    let result = match client.as_ref() {
        Ok(client) => download::verify_descriptor_available(client, &descriptor)
            .await
            .map_err(|error| error.message().to_string()),
        Err(error) => Err(error.message().to_string()),
    };
    let web_enabled = match LocalRuntimeLayout::resolve(app) {
        Ok(layout) => config::web_enabled(&layout).await.unwrap_or(false),
        Err(_) => false,
    };
    let (web_version, web_compatible, web_detail) = if web_enabled {
        match components::web_descriptor(version) {
            Ok(web_descriptor) => {
                let web_result = match client.as_ref() {
                    Ok(client) => download::verify_descriptor_available(client, &web_descriptor)
                        .await
                        .map_err(|error| error.message().to_string()),
                    Err(error) => Err(error.message().to_string()),
                };
                (
                    Some(version.to_string()),
                    Some(web_result.is_ok()),
                    web_result.err(),
                )
            }
            Err(error) => (
                Some(version.to_string()),
                Some(false),
                Some(error.message().to_string()),
            ),
        }
    } else {
        (Some(version.to_string()), None, None)
    };
    LocalRuntimeUpdateCompatibility {
        backend_version: version.to_string(),
        postgresql_version: components::POSTGRESQL_VERSION.to_string(),
        compatible: result.is_ok(),
        detail: result.err(),
        web_enabled,
        web_version,
        web_compatible,
        web_detail,
    }
}

pub(crate) async fn prepare_desktop_update(
    app: &AppHandle,
    version: &str,
) -> Result<(), LocalRuntimeError> {
    let state = app.state::<LocalRuntimeState>();
    let _operation = state.operation.lock().await;
    let previous_status = state.snapshot()?.status;
    let layout = LocalRuntimeLayout::resolve(app)?;
    layout.prepare().await?;
    let descriptor = components::backend_descriptor(normalize_update_version(version))?;
    let result = backend::stage(
        &layout,
        &descriptor,
        &app.package_info().version.to_string(),
        state.inner(),
    )
    .await;
    if result.is_ok() && config::web_enabled(&layout).await.unwrap_or(false) {
        match components::web_descriptor(normalize_update_version(version)) {
            Ok(web_descriptor) => {
                if let Err(error) = web::stage(
                    app,
                    &layout,
                    &web_descriptor,
                    &app.package_info().version.to_string(),
                    state.inner(),
                )
                .await
                {
                    crate::diagnostics::warn("runtime.local.web", error.message().to_string());
                }
            }
            Err(error) => {
                crate::diagnostics::warn("runtime.local.web", error.message().to_string());
            }
        }
    }
    let _ = prepare_foundation(app, state.inner()).await;
    let _ = state.update(|snapshot| {
        snapshot.status = previous_status;
        if result.is_ok() {
            snapshot.error = None;
        }
    });
    result
}

pub(crate) async fn resume_after_updater_failure(app: &AppHandle) -> Result<(), LocalRuntimeError> {
    let state = app.state::<LocalRuntimeState>();
    let api = app.state::<crate::api::ApiState>();
    let _operation = state.operation.lock().await;
    start_local_runtime_inner(app, state.inner(), api.inner())
        .await
        .map(|_| ())
}

fn normalize_update_version(version: &str) -> &str {
    version.strip_prefix('v').unwrap_or(version)
}

async fn prepare_local_runtime_inner(
    app: &AppHandle,
    state: &LocalRuntimeState,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    prepare_foundation(app, state).await?;
    state.update(|snapshot| {
        snapshot.status = if snapshot
            .backend
            .as_ref()
            .is_some_and(|backend| backend.running)
        {
            LocalRuntimeStatus::Ready
        } else if snapshot
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
        app,
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
    if state
        .snapshot()?
        .backend
        .as_ref()
        .is_some_and(|backend| backend.running)
    {
        return Err(LocalRuntimeError::invalid_state(
            "Stop the local runtime before stopping PostgreSQL.",
        ));
    }
    postgresql::stop(&layout, &manifest.components.postgresql, state).await?;
    state.snapshot()
}

async fn start_local_runtime_inner(
    app: &AppHandle,
    state: &LocalRuntimeState,
    api: &crate::api::ApiState,
) -> Result<LocalRuntimeStartResult, LocalRuntimeError> {
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::Preparing;
        snapshot.error = None;
    })?;
    let initial_layout = LocalRuntimeLayout::resolve(app)?;
    logs::reset(&initial_layout).await;
    logs::append(
        &initial_layout,
        logs::LocalRuntimeLogStage::Prepare,
        format!(
            "Preparing local runtime at {}.",
            initial_layout.root_dir.display()
        ),
    )
    .await;
    let (layout, manifest) = prepare_foundation(app, state).await?;
    logs::append(
        &layout,
        logs::LocalRuntimeLogStage::Prepare,
        format!(
            "Local runtime directory ready at {}.",
            layout.root_dir.display()
        ),
    )
    .await;
    postgresql::start(
        app,
        &layout,
        &manifest.components.postgresql,
        &manifest.desktop_version,
        state,
    )
    .await?;
    let postgresql_port = state
        .snapshot()?
        .postgresql
        .and_then(|postgresql| postgresql.port)
        .ok_or_else(|| {
            LocalRuntimeError::internal("PostgreSQL is ready but its port is unavailable.")
        })?;
    let server_url = backend::start(
        &layout,
        &manifest.components.backend,
        &manifest.desktop_version,
        postgresql_port,
        &state.backend_process,
        state,
    )
    .await?;
    logs::append(
        &layout,
        logs::LocalRuntimeLogStage::Connect,
        format!("Connecting Desktop to {server_url}."),
    )
    .await;
    api.connect(server_url.clone()).await.map_err(|error| {
        LocalRuntimeError::network(
            "Could not connect Desktop to the local backend",
            format!("{error:?}"),
        )
    })?;
    logs::append(
        &layout,
        logs::LocalRuntimeLogStage::Connect,
        "Desktop connected to the local backend.",
    )
    .await;
    let backend_port = state
        .snapshot()?
        .backend
        .and_then(|backend| backend.port)
        .ok_or_else(|| {
            LocalRuntimeError::internal("Backend is ready but its port is unavailable.")
        })?;
    let web_enabled = config::web_enabled(&layout).await?;
    if let Some(descriptor) = manifest.components.web.as_ref() {
        if web_enabled {
            state.update(|snapshot| {
                snapshot.status = LocalRuntimeStatus::StartingWeb;
                snapshot.error = None;
            })?;
            match web::start(
                app,
                &layout,
                descriptor,
                &manifest.desktop_version,
                backend_port,
                &state.web_process,
                state,
            )
            .await
            {
                Ok(web_snapshot) => state.update(|snapshot| snapshot.web = Some(web_snapshot))?,
                Err(error) => {
                    crate::diagnostics::warn("runtime.local.web", error.message().to_string());
                    let web_snapshot =
                        web::inspect_with_error(&layout, descriptor, true, &error).await;
                    state.update(|snapshot| snapshot.web = Some(web_snapshot))?;
                }
            }
        } else {
            logs::append(
                &layout,
                logs::LocalRuntimeLogStage::Web,
                "Managed Web UI is disabled; skipping this stage.",
            )
            .await;
            match web::stop(&layout, descriptor, false, &state.web_process).await {
                Ok(web_snapshot) => state.update(|snapshot| snapshot.web = Some(web_snapshot))?,
                Err(error) => {
                    crate::diagnostics::warn("runtime.local.web", error.message().to_string());
                    let web_snapshot =
                        web::inspect_with_error(&layout, descriptor, false, &error).await;
                    state.update(|snapshot| snapshot.web = Some(web_snapshot))?;
                }
            }
        }
    }
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::Ready;
        snapshot.error = None;
    })?;
    logs::append(
        &layout,
        logs::LocalRuntimeLogStage::Connect,
        "Local runtime provisioning is complete.",
    )
    .await;
    Ok(LocalRuntimeStartResult {
        snapshot: state.snapshot()?,
        server_url,
    })
}

async fn stop_local_runtime_inner(
    app: &AppHandle,
    state: &LocalRuntimeState,
    api: &crate::api::ApiState,
) -> Result<LocalRuntimeSnapshot, LocalRuntimeError> {
    let (layout, manifest) = prepare_foundation(app, state).await?;
    let web_enabled = config::web_enabled(&layout).await.unwrap_or(false);
    if let Some(descriptor) = manifest.components.web.as_ref() {
        match web::stop(&layout, descriptor, web_enabled, &state.web_process).await {
            Ok(web_snapshot) => state.update(|snapshot| snapshot.web = Some(web_snapshot))?,
            Err(error) => {
                crate::diagnostics::warn("runtime.local.web", error.message().to_string());
                let web_snapshot =
                    web::inspect_with_error(&layout, descriptor, web_enabled, &error).await;
                state.update(|snapshot| snapshot.web = Some(web_snapshot))?;
            }
        }
    }
    api.disconnect().map_err(|error| {
        LocalRuntimeError::internal(format!(
            "Could not disconnect the local API client: {error:?}"
        ))
    })?;
    backend::stop(
        &layout,
        &manifest.components.backend,
        &state.backend_process,
        state,
    )
    .await?;
    postgresql::stop(&layout, &manifest.components.postgresql, state).await?;
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::Stopped;
        snapshot.error = None;
    })?;
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
    config::ensure_config_file(&layout).await?;
    let paths = LocalRuntimePaths::from_layout(&layout);
    let postgresql = postgresql::inspect(&layout, &manifest.components.postgresql).await?;
    let backend = backend::inspect(&layout, &manifest.components.backend).await?;
    let web_enabled = config::web_enabled(&layout).await?;
    let web = if let Some(descriptor) = manifest.components.web.as_ref() {
        match web::inspect(&layout, descriptor, web_enabled).await {
            Ok(snapshot) => Some(snapshot),
            Err(error) => {
                crate::diagnostics::warn("runtime.local.web", error.message().to_string());
                Some(web::inspect_with_error(&layout, descriptor, web_enabled, &error).await)
            }
        }
    } else {
        None
    };
    state.update(|snapshot| {
        snapshot.paths = Some(paths);
        snapshot.manifest = Some(manifest.clone());
        snapshot.postgresql = Some(postgresql);
        snapshot.backend = Some(backend);
        snapshot.web = web;
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
    use super::{normalize_update_version, LocalRuntimeStatus};

    #[test]
    fn local_runtime_starts_disabled() {
        assert_eq!(LocalRuntimeStatus::default(), LocalRuntimeStatus::Disabled);
    }

    #[test]
    fn normalizes_release_tag_version() {
        assert_eq!(normalize_update_version("v1.2.3"), "1.2.3");
        assert_eq!(normalize_update_version("1.2.3-beta.1"), "1.2.3-beta.1");
    }
}
