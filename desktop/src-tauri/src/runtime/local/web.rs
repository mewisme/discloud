use std::{
    fs::OpenOptions,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tokio::{
    fs,
    process::Child,
    sync::Mutex,
    time::{sleep, timeout},
};

use super::{
    archive, bundled, components::RuntimeComponentDescriptor, download, layout::LocalRuntimeLayout,
    logs, ports, process, LocalRuntimeError, LocalRuntimeState, LocalRuntimeStatus,
};

const READY_ATTEMPTS: usize = 240;
const READY_INTERVAL: Duration = Duration::from_millis(250);
const STOP_TIMEOUT: Duration = Duration::from_secs(20);
const SHUTDOWN_ACK_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WebRuntimeSnapshot {
    pub(super) enabled: bool,
    pub(super) installed: bool,
    pub(super) desired_installed: bool,
    pub(super) running: bool,
    pub(super) version: Option<String>,
    pub(super) desired_version: String,
    pub(super) previous_version: Option<String>,
    pub(super) port: Option<u16>,
    pub(super) url: Option<String>,
    pub(super) error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebRuntimeRecord {
    version: String,
    port: u16,
    pid: u32,
    #[serde(default)]
    previous_version: Option<String>,
}

#[derive(Clone, Default)]
pub(super) struct WebProcessState {
    child: Arc<Mutex<Option<Child>>>,
}

pub(super) async fn inspect(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    enabled: bool,
) -> Result<WebRuntimeSnapshot, LocalRuntimeError> {
    let desired_installed =
        runtime_valid(&version_dir(layout, descriptor), Some(&descriptor.version)).await?;
    let Some(record) = read_record(&layout.web_state_path).await? else {
        return Ok(WebRuntimeSnapshot {
            enabled,
            installed: desired_installed,
            desired_installed,
            running: false,
            version: desired_installed.then(|| descriptor.version.clone()),
            desired_version: descriptor.version.clone(),
            previous_version: None,
            port: None,
            url: None,
            error: None,
        });
    };
    let installed =
        runtime_valid(&layout.web_dir.join(&record.version), Some(&record.version)).await?;
    let running = installed && ready(record.port).await;
    let previous_version = match record.previous_version {
        Some(version) if runtime_valid(&layout.web_dir.join(&version), Some(&version)).await? => {
            Some(version)
        }
        _ => None,
    };
    Ok(WebRuntimeSnapshot {
        enabled,
        installed,
        desired_installed,
        running,
        version: installed.then_some(record.version),
        desired_version: descriptor.version.clone(),
        previous_version,
        port: Some(record.port),
        url: running.then(|| web_url(record.port)),
        error: None,
    })
}

pub(super) async fn stage<R: Runtime>(
    app: &AppHandle<R>,
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    desktop_version: &str,
    state: &LocalRuntimeState,
) -> Result<(), LocalRuntimeError> {
    let _ = ensure_runtime(app, layout, descriptor, desktop_version, state).await?;
    Ok(())
}

pub(super) async fn start<R: Runtime>(
    app: &AppHandle<R>,
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    desktop_version: &str,
    backend_port: u16,
    process: &WebProcessState,
    state: &LocalRuntimeState,
) -> Result<WebRuntimeSnapshot, LocalRuntimeError> {
    let runtime_dir = ensure_runtime(app, layout, descriptor, desktop_version, state).await?;
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::StartingWeb;
        snapshot.error = None;
    })?;
    let record = read_record(&layout.web_state_path).await?;
    if let Some(record) = record.as_ref() {
        if record.version == descriptor.version && ready(record.port).await {
            logs::append(
                layout,
                logs::LocalRuntimeLogStage::Web,
                format!(
                    "Managed Web UI is already ready on 127.0.0.1:{}.",
                    record.port
                ),
            )
            .await;
            return inspect(layout, descriptor, true).await;
        }
        if record.pid != 0 || !ports::port_available(record.port) {
            let acknowledged = request_shutdown_ack(&layout.web_shutdown_path).await?;
            if acknowledged {
                if !wait_port_available(record.port).await {
                    return Err(LocalRuntimeError::process(format!(
                        "The recovered managed web runtime did not release 127.0.0.1:{} after shutdown.",
                        record.port
                    )));
                }
            } else if !ports::port_available(record.port) {
                return Err(LocalRuntimeError::process(format!(
                    "A previous managed web runtime on 127.0.0.1:{} did not acknowledge shutdown.",
                    record.port
                )));
            }
        }
    }
    let preferred_port = record.as_ref().map(|record| record.port);
    let previous_version = record.as_ref().and_then(|record| {
        if record.version != descriptor.version {
            Some(record.version.clone())
        } else {
            record.previous_version.clone()
        }
    });
    let port = ports::choose_port(preferred_port, ports::WEB_PREFERRED_PORT)?;
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Web,
        format!("Starting Managed Web UI on 127.0.0.1:{port}."),
    )
    .await;
    let _ = fs::remove_file(&layout.web_shutdown_path).await;
    let log_path = layout.logs_dir.join("web.log");
    std::fs::write(&log_path, b"")
        .map_err(|error| LocalRuntimeError::io("Could not reset the managed web log", error))?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| LocalRuntimeError::io("Could not open the managed web log", error))?;
    let stderr = log.try_clone().map_err(|error| {
        LocalRuntimeError::io("Could not clone the managed web log handle", error)
    })?;
    let mut command = process::command(node_path(&runtime_dir));
    command
        .arg(runtime_dir.join("managed-web-runtime.cjs"))
        .current_dir(&runtime_dir)
        .env("NODE_ENV", "production")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env(
            "DISCLOUD_API_URL",
            format!("http://127.0.0.1:{backend_port}"),
        )
        .env("DISCLOUD_PUBLIC_API_URL", "")
        .env(
            "DISCLOUD_MANAGED_WEB_SHUTDOWN_FILE",
            layout.web_shutdown_path.to_string_lossy().into_owned(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));
    let mut child = command.spawn().map_err(|error| {
        LocalRuntimeError::process(format!("Could not start the managed web runtime: {error}"))
    })?;
    let pid = child.id().ok_or_else(|| {
        LocalRuntimeError::process("Could not determine the managed web process ID.")
    })?;
    write_record(
        &layout.web_state_path,
        &WebRuntimeRecord {
            version: descriptor.version.clone(),
            port,
            pid,
            previous_version: previous_version.clone(),
        },
    )
    .await?;
    if let Err(error) = wait_ready_with_child(&mut child, port).await {
        let _ = child.start_kill();
        let _ = child.wait().await;
        let _ = write_record(
            &layout.web_state_path,
            &WebRuntimeRecord {
                version: descriptor.version.clone(),
                port,
                pid: 0,
                previous_version,
            },
        )
        .await;
        return Err(error);
    }
    *process.child.lock().await = Some(child);
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Web,
        format!("Managed Web UI is ready at http://127.0.0.1:{port}."),
    )
    .await;
    inspect(layout, descriptor, true).await
}

pub(super) async fn stop(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    enabled: bool,
    process: &WebProcessState,
) -> Result<WebRuntimeSnapshot, LocalRuntimeError> {
    let snapshot = inspect(layout, descriptor, enabled).await?;
    let Some(port) = snapshot.port else {
        return Ok(snapshot);
    };
    let record = read_record(&layout.web_state_path).await?;
    let mut child_guard = process.child.lock().await;
    if let Some(mut child) = child_guard.take() {
        fs::write(&layout.web_shutdown_path, b"shutdown\n")
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not request managed web shutdown", error)
            })?;
        stop_owned_child(&mut child).await?;
    } else if snapshot.running || record.as_ref().is_some_and(|record| record.pid != 0) {
        if !request_shutdown_ack(&layout.web_shutdown_path).await? {
            if !ports::port_available(port) {
                return Err(LocalRuntimeError::process(
                    "The recovered managed web runtime did not acknowledge shutdown.",
                ));
            }
        } else if !wait_port_available(port).await {
            return Err(LocalRuntimeError::process(format!(
                "The recovered managed web runtime did not release 127.0.0.1:{port} after shutdown."
            )));
        }
    }
    drop(child_guard);
    let _ = fs::remove_file(&layout.web_shutdown_path).await;
    let version = record
        .as_ref()
        .map(|record| record.version.clone())
        .or(snapshot.version.clone())
        .unwrap_or_else(|| descriptor.version.clone());
    let previous_version = record
        .as_ref()
        .and_then(|record| record.previous_version.clone())
        .or(snapshot.previous_version.clone());
    write_record(
        &layout.web_state_path,
        &WebRuntimeRecord {
            version,
            port,
            pid: 0,
            previous_version,
        },
    )
    .await?;
    inspect(layout, descriptor, enabled).await
}

fn with_error(mut snapshot: WebRuntimeSnapshot, error: &LocalRuntimeError) -> WebRuntimeSnapshot {
    snapshot.error = Some(error.message().to_string());
    snapshot.running = false;
    snapshot.url = None;
    snapshot
}

pub(super) async fn inspect_with_error(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    enabled: bool,
    error: &LocalRuntimeError,
) -> WebRuntimeSnapshot {
    match inspect(layout, descriptor, enabled).await {
        Ok(snapshot) => with_error(snapshot, error),
        Err(_) => WebRuntimeSnapshot {
            enabled,
            installed: false,
            desired_installed: false,
            running: false,
            version: None,
            desired_version: descriptor.version.clone(),
            previous_version: None,
            port: None,
            url: None,
            error: Some(error.message().to_string()),
        },
    }
}

async fn ensure_runtime<R: Runtime>(
    app: &AppHandle<R>,
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    desktop_version: &str,
    state: &LocalRuntimeState,
) -> Result<PathBuf, LocalRuntimeError> {
    let destination = version_dir(layout, descriptor);
    if runtime_valid(&destination, Some(&descriptor.version)).await? {
        verify_node(&destination).await?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::Web,
            format!(
                "Managed Web UI {} runtime is already installed.",
                descriptor.version
            ),
        )
        .await;
        return Ok(destination);
    }
    if fs::try_exists(&destination).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the managed web runtime directory", error)
    })? {
        fs::remove_dir_all(&destination).await.map_err(|error| {
            LocalRuntimeError::io("Could not remove an incomplete managed web runtime", error)
        })?;
    }
    if let Some(resource_dir) = bundled::resource_directory(app, descriptor).await? {
        state.update(|snapshot| {
            snapshot.status = LocalRuntimeStatus::Installing;
            snapshot.error = None;
        })?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::Web,
            format!(
                "Installing bundled Managed Web UI {} runtime.",
                descriptor.version
            ),
        )
        .await;
        crate::diagnostics::info(
            "runtime.local.web",
            format!("using bundled directory={}", resource_dir.display()),
        );
        bundled::copy_resource_directory(&resource_dir, &destination).await?;
    } else {
        state.update(|snapshot| {
            snapshot.status = LocalRuntimeStatus::Downloading;
            snapshot.error = None;
        })?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::Web,
            format!("Downloading Managed Web UI {} runtime.", descriptor.version),
        )
        .await;
        let client = download::client(desktop_version)?;
        let downloads_dir = layout.staging_dir.join("downloads");
        let verified = download::download_verified(&client, descriptor, &downloads_dir).await?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::Web,
            format!(
                "Downloaded and verified Managed Web UI {} runtime ({} bytes).",
                descriptor.version, verified.bytes
            ),
        )
        .await;
        crate::diagnostics::info(
            "runtime.local.web",
            format!(
                "downloaded={} bytes={} sha256={}",
                verified.path.display(),
                verified.bytes,
                verified.sha256
            ),
        );
        let extraction_dir = layout
            .staging_dir
            .join(format!("web-{}.extract", descriptor.version));
        archive::extract_tar_gz(&verified.path, &extraction_dir).await?;
        fs::rename(&extraction_dir, &destination)
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not install the managed web runtime", error)
            })?;
        let _ = fs::remove_file(&verified.path).await;
    }
    if !runtime_valid(&destination, Some(&descriptor.version)).await? {
        let _ = fs::remove_dir_all(&destination).await;
        return Err(LocalRuntimeError::invalid_artifact(
            "The managed web runtime is missing Node.js, its launcher, server.js, Next.js runtime assets, or matching version metadata.",
        ));
    }
    ensure_node_executable(&destination).await?;
    if let Err(error) = verify_node(&destination).await {
        let _ = fs::remove_dir_all(&destination).await;
        return Err(error);
    }
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Web,
        format!("Managed Web UI {} runtime is ready.", descriptor.version),
    )
    .await;
    Ok(destination)
}

async fn runtime_valid(
    runtime_dir: &Path,
    expected_version: Option<&str>,
) -> Result<bool, LocalRuntimeError> {
    for path in [
        node_path(runtime_dir),
        runtime_dir.join("managed-web-runtime.cjs"),
        runtime_dir.join("web").join("server.js"),
        runtime_dir.join("web").join(".next").join("server"),
        runtime_dir.join("web").join(".next").join("static"),
        runtime_dir.join("discloud-web-version.txt"),
    ] {
        if !fs::try_exists(path).await.map_err(|error| {
            LocalRuntimeError::io("Could not inspect the managed web runtime", error)
        })? {
            return Ok(false);
        }
    }
    if let Some(expected) = expected_version {
        let version = fs::read_to_string(runtime_dir.join("discloud-web-version.txt"))
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not read managed web version metadata", error)
            })?;
        if version.trim() != expected {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn verify_node(runtime_dir: &Path) -> Result<(), LocalRuntimeError> {
    let output = timeout(
        Duration::from_secs(5),
        process::command(node_path(runtime_dir))
            .arg("--version")
            .output(),
    )
    .await
    .map_err(|_| {
        LocalRuntimeError::invalid_artifact("The embedded Node.js version check timed out.")
    })?
    .map_err(|error| {
        LocalRuntimeError::invalid_artifact(format!("Could not execute embedded Node.js: {error}"))
    })?;
    let version = String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_start_matches('v')
        .to_string();
    let major = version
        .split('.')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    if !output.status.success() || major < 24 {
        return Err(LocalRuntimeError::invalid_artifact(format!(
            "Managed web runtime requires embedded Node.js 24 or newer, got {version:?}."
        )));
    }
    Ok(())
}

#[cfg(unix)]
async fn ensure_node_executable(runtime_dir: &Path) -> Result<(), LocalRuntimeError> {
    use std::os::unix::fs::PermissionsExt;
    let path = node_path(runtime_dir);
    let mut permissions = fs::metadata(&path)
        .await
        .map_err(|error| {
            LocalRuntimeError::io("Could not inspect embedded Node.js permissions", error)
        })?
        .permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    fs::set_permissions(path, permissions)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not make embedded Node.js executable", error))
}

#[cfg(not(unix))]
async fn ensure_node_executable(_runtime_dir: &Path) -> Result<(), LocalRuntimeError> {
    Ok(())
}

async fn ready(port: u16) -> bool {
    let client = match readiness_client() {
        Ok(client) => client,
        Err(_) => return false,
    };
    matches!(
        client.get(format!("http://127.0.0.1:{port}/healthz")).send().await,
        Ok(response) if response.status() == StatusCode::NO_CONTENT
    )
}

async fn wait_ready_with_child(child: &mut Child, port: u16) -> Result<(), LocalRuntimeError> {
    for _ in 0..READY_ATTEMPTS {
        if let Some(status) = child.try_wait().map_err(|error| {
            LocalRuntimeError::process(format!(
                "Could not inspect the managed web process: {error}"
            ))
        })? {
            return Err(LocalRuntimeError::process(format!(
                "The managed web runtime exited before becoming ready: {status}."
            )));
        }
        if ready(port).await {
            return Ok(());
        }
        sleep(READY_INTERVAL).await;
    }
    Err(LocalRuntimeError::process(format!(
        "The managed web runtime did not become ready on 127.0.0.1:{port}."
    )))
}

async fn stop_owned_child(child: &mut Child) -> Result<(), LocalRuntimeError> {
    match timeout(STOP_TIMEOUT, child.wait()).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(error)) => Err(LocalRuntimeError::process(format!(
            "Could not wait for the managed web runtime to stop: {error}"
        ))),
        Err(_) => {
            child.start_kill().map_err(|error| {
                LocalRuntimeError::process(format!(
                    "Could not terminate the managed web runtime after the shutdown timeout: {error}"
                ))
            })?;
            child.wait().await.map_err(|error| {
                LocalRuntimeError::process(format!(
                    "Could not wait for the terminated managed web runtime: {error}"
                ))
            })?;
            Ok(())
        }
    }
}

async fn request_shutdown_ack(path: &Path) -> Result<bool, LocalRuntimeError> {
    fs::write(path, b"shutdown\n")
        .await
        .map_err(|error| LocalRuntimeError::io("Could not request managed web shutdown", error))?;
    let attempts = (SHUTDOWN_ACK_TIMEOUT.as_millis() / READY_INTERVAL.as_millis()) as usize;
    for _ in 0..attempts {
        if !fs::try_exists(path).await.map_err(|error| {
            LocalRuntimeError::io("Could not inspect the managed web shutdown request", error)
        })? {
            return Ok(true);
        }
        sleep(READY_INTERVAL).await;
    }
    let _ = fs::remove_file(path).await;
    Ok(false)
}

async fn wait_port_available(port: u16) -> bool {
    let attempts = (STOP_TIMEOUT.as_millis() / READY_INTERVAL.as_millis()) as usize;
    for _ in 0..attempts {
        if ports::port_available(port) {
            return true;
        }
        sleep(READY_INTERVAL).await;
    }
    ports::port_available(port)
}

fn readiness_client() -> Result<Client, LocalRuntimeError> {
    Client::builder()
        .connect_timeout(Duration::from_millis(500))
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(|error| {
            LocalRuntimeError::network("Could not create the managed web readiness client", error)
        })
}

async fn read_record(path: &Path) -> Result<Option<WebRuntimeRecord>, LocalRuntimeError> {
    if !fs::try_exists(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the managed web runtime state", error)
    })? {
        return Ok(None);
    }
    let content = fs::read(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not read the managed web runtime state", error)
    })?;
    match serde_json::from_slice(&content) {
        Ok(record) => Ok(Some(record)),
        Err(error) => {
            crate::diagnostics::warn(
                "runtime.local.web",
                format!("ignoring invalid runtime state: {error}"),
            );
            let _ = fs::remove_file(path).await;
            Ok(None)
        }
    }
}

async fn write_record(path: &Path, record: &WebRuntimeRecord) -> Result<(), LocalRuntimeError> {
    let mut content = serde_json::to_vec_pretty(record).map_err(|error| {
        LocalRuntimeError::internal(format!(
            "Could not serialize the managed web runtime state: {error}"
        ))
    })?;
    content.push(b'\n');
    super::atomic_file::write(
        path,
        content,
        "Could not install the managed web runtime state",
    )
    .await
}

fn node_path(runtime_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    let name = "node.exe";
    #[cfg(not(target_os = "windows"))]
    let name = "node";
    runtime_dir.join(name)
}

fn version_dir(layout: &LocalRuntimeLayout, descriptor: &RuntimeComponentDescriptor) -> PathBuf {
    layout.web_dir.join(&descriptor.version)
}

fn web_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

#[cfg(test)]
mod tests {
    use super::{web_url, WebRuntimeRecord};

    #[test]
    fn formats_loopback_web_url() {
        assert_eq!(web_url(27833), "http://127.0.0.1:27833");
    }

    #[test]
    fn reads_legacy_runtime_record_without_previous_version() {
        let record: WebRuntimeRecord =
            serde_json::from_str("{\"version\":\"1.0.0\",\"port\":27833,\"pid\":0}").unwrap();
        assert_eq!(record.previous_version, None);
    }
}
