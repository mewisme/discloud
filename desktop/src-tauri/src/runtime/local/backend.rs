use std::{
    fs::OpenOptions,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::{fs, process::Child, process::Command, sync::Mutex, time::sleep, time::timeout};

use super::{
    archive, components::RuntimeComponentDescriptor, config, download, layout::LocalRuntimeLayout,
    ports, LocalRuntimeError, LocalRuntimeState, LocalRuntimeStatus,
};

const READY_ATTEMPTS: usize = 240;
const READY_INTERVAL: Duration = Duration::from_millis(250);
const STOP_TIMEOUT: Duration = Duration::from_secs(20);
const RECOVERED_SHUTDOWN_ACK_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BackendRuntimeSnapshot {
    pub(super) installed: bool,
    pub(super) running: bool,
    pub(super) version: Option<String>,
    pub(super) port: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendRuntimeRecord {
    version: String,
    port: u16,
    pid: u32,
}

#[derive(Clone, Default)]
pub(super) struct BackendProcessState {
    child: Arc<Mutex<Option<Child>>>,
}

pub(super) async fn inspect(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
) -> Result<BackendRuntimeSnapshot, LocalRuntimeError> {
    let runtime_dir = version_dir(layout, descriptor);
    let installed = runtime_valid(&runtime_dir).await?;
    if !installed {
        return Ok(BackendRuntimeSnapshot {
            installed: false,
            running: false,
            version: Some(descriptor.version.clone()),
            port: None,
        });
    }

    let Some(record) = read_runtime_record(&layout.backend_state_path).await? else {
        return Ok(BackendRuntimeSnapshot {
            installed: true,
            running: false,
            version: Some(descriptor.version.clone()),
            port: None,
        });
    };
    if record.version != descriptor.version {
        let _ = fs::remove_file(&layout.backend_state_path).await;
        return Ok(BackendRuntimeSnapshot {
            installed: true,
            running: false,
            version: Some(descriptor.version.clone()),
            port: None,
        });
    }
    let running = ready(record.port).await;
    Ok(BackendRuntimeSnapshot {
        installed: true,
        running,
        version: Some(descriptor.version.clone()),
        port: Some(record.port),
    })
}

pub(super) async fn start(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    desktop_version: &str,
    postgresql_port: u16,
    process: &BackendProcessState,
    state: &LocalRuntimeState,
) -> Result<String, LocalRuntimeError> {
    let runtime_dir = ensure_runtime(layout, descriptor, desktop_version, state).await?;
    let record = read_runtime_record(&layout.backend_state_path).await?;
    if let Some(record) = record.as_ref() {
        if record.version == descriptor.version && ready(record.port).await {
            set_snapshot(state, descriptor, true, true, Some(record.port))?;
            return Ok(server_url(record.port));
        }
        if record.version != descriptor.version {
            let _ = fs::remove_file(&layout.backend_state_path).await;
        } else if record.pid != 0 {
            let acknowledged = request_shutdown_ack(&layout.backend_shutdown_path).await?;
            if acknowledged {
                if !wait_port_available(record.port).await {
                    return Err(LocalRuntimeError::process(format!(
                        "The recovered local backend did not release 127.0.0.1:{} after shutdown.",
                        record.port
                    )));
                }
                sleep(Duration::from_millis(500)).await;
            } else if !ports::port_available(record.port) {
                return Err(LocalRuntimeError::process(format!(
                    "A previous local backend on 127.0.0.1:{} is not ready and did not acknowledge shutdown.",
                    record.port
                )));
            }
        }
    }
    let preferred_port = record
        .filter(|record| record.version == descriptor.version)
        .map(|record| record.port);
    let port = ports::choose_port(preferred_port, ports::BACKEND_PREFERRED_PORT)?;
    let environment = config::backend_environment(layout, postgresql_port, port).await?;
    let _ = fs::remove_file(&layout.backend_shutdown_path).await;
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::StartingBackend;
        snapshot.error = None;
    })?;

    let executable = binary_path(&runtime_dir);
    let log_path = layout.logs_dir.join("backend.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| LocalRuntimeError::io("Could not open the local backend log", error))?;
    let stderr = log.try_clone().map_err(|error| {
        LocalRuntimeError::io("Could not clone the local backend log handle", error)
    })?;
    let mut command = Command::new(executable);
    command
        .current_dir(&runtime_dir)
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));
    let mut child = command.spawn().map_err(|error| {
        LocalRuntimeError::process(format!("Could not start the local backend: {error}"))
    })?;
    let pid = child.id().ok_or_else(|| {
        LocalRuntimeError::process("Could not determine the local backend process ID.")
    })?;
    write_runtime_record(
        &layout.backend_state_path,
        &BackendRuntimeRecord {
            version: descriptor.version.clone(),
            port,
            pid,
        },
    )
    .await?;

    if let Err(error) = wait_ready_with_child(&mut child, port).await {
        let _ = child.start_kill();
        let _ = child.wait().await;
        let _ = write_runtime_record(
            &layout.backend_state_path,
            &BackendRuntimeRecord {
                version: descriptor.version.clone(),
                port,
                pid: 0,
            },
        )
        .await;
        return Err(error);
    }
    *process.child.lock().await = Some(child);
    set_snapshot(state, descriptor, true, true, Some(port))?;
    Ok(server_url(port))
}

pub(super) async fn stop(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    process: &BackendProcessState,
    state: &LocalRuntimeState,
) -> Result<(), LocalRuntimeError> {
    let snapshot = inspect(layout, descriptor).await?;
    if !snapshot.running {
        let port = snapshot.port;
        let record = read_runtime_record(&layout.backend_state_path).await?;
        let mut child_guard = process.child.lock().await;
        if let Some(mut child) = child_guard.take() {
            let _ = fs::write(&layout.backend_shutdown_path, b"shutdown\n").await;
            stop_owned_child(&mut child).await?;
        } else if record.as_ref().is_some_and(|record| record.pid != 0) {
            let acknowledged = request_shutdown_ack(&layout.backend_shutdown_path).await?;
            if let Some(port) = port {
                if acknowledged {
                    if !wait_port_available(port).await {
                        return Err(LocalRuntimeError::process(format!(
                            "The recovered local backend did not release 127.0.0.1:{port} after shutdown."
                        )));
                    }
                } else if !ports::port_available(port) {
                    return Err(LocalRuntimeError::process(format!(
                        "A previous local backend on 127.0.0.1:{port} did not acknowledge shutdown."
                    )));
                }
            }
        }
        drop(child_guard);
        let _ = fs::remove_file(&layout.backend_shutdown_path).await;
        if let Some(port) = port {
            write_runtime_record(
                &layout.backend_state_path,
                &BackendRuntimeRecord {
                    version: descriptor.version.clone(),
                    port,
                    pid: 0,
                },
            )
            .await?;
        }
        set_snapshot(state, descriptor, snapshot.installed, false, port)?;
        return Ok(());
    }
    let port = snapshot.port.expect("running backend has a port");
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::Stopping;
        snapshot.error = None;
    })?;
    let mut child_guard = process.child.lock().await;
    if let Some(mut child) = child_guard.take() {
        fs::write(&layout.backend_shutdown_path, b"shutdown\n")
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not request local backend shutdown", error)
            })?;
        stop_owned_child(&mut child).await?;
    } else {
        if !request_shutdown_ack(&layout.backend_shutdown_path).await? {
            return Err(LocalRuntimeError::process(
                "The recovered local backend did not acknowledge the managed shutdown request.",
            ));
        }
        if !wait_port_available(port).await {
            return Err(LocalRuntimeError::process(format!(
                "The recovered local backend did not release 127.0.0.1:{port} after shutdown."
            )));
        }
    }
    drop(child_guard);
    let _ = fs::remove_file(&layout.backend_shutdown_path).await;
    write_runtime_record(
        &layout.backend_state_path,
        &BackendRuntimeRecord {
            version: descriptor.version.clone(),
            port,
            pid: 0,
        },
    )
    .await?;
    set_snapshot(state, descriptor, true, false, Some(port))?;
    Ok(())
}

async fn ensure_runtime(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    desktop_version: &str,
    state: &LocalRuntimeState,
) -> Result<PathBuf, LocalRuntimeError> {
    let destination = version_dir(layout, descriptor);
    if runtime_valid(&destination).await? {
        return Ok(destination);
    }
    if fs::try_exists(&destination).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the backend runtime directory", error)
    })? {
        fs::remove_dir_all(&destination).await.map_err(|error| {
            LocalRuntimeError::io("Could not remove an incomplete backend runtime", error)
        })?;
    }
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::Downloading;
        snapshot.error = None;
    })?;
    let client = download::client(desktop_version)?;
    let downloads_dir = layout.staging_dir.join("downloads");
    let verified = download::download_verified(&client, descriptor, &downloads_dir).await?;
    crate::diagnostics::info(
        "runtime.local.backend",
        format!(
            "downloaded={} bytes={} sha256={}",
            verified.path.display(),
            verified.bytes,
            verified.sha256
        ),
    );

    let extraction_dir = layout
        .staging_dir
        .join(format!("backend-{}.extract", descriptor.version));
    if descriptor.archive_name.ends_with(".zip") {
        archive::extract_zip(&verified.path, &extraction_dir).await?;
    } else {
        archive::extract_tar_gz(&verified.path, &extraction_dir).await?;
    }
    let extracted_root = find_runtime_root(&extraction_dir).await?;
    if extracted_root == extraction_dir {
        fs::rename(&extraction_dir, &destination)
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not install the backend runtime", error)
            })?;
    } else {
        fs::rename(&extracted_root, &destination)
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not install the backend runtime", error)
            })?;
        let _ = fs::remove_dir_all(&extraction_dir).await;
    }
    let _ = fs::remove_file(&verified.path).await;
    if !runtime_valid(&destination).await? {
        return Err(LocalRuntimeError::invalid_artifact(
            "The backend runtime archive does not contain the DisCloud executable.",
        ));
    }
    Ok(destination)
}

fn set_snapshot(
    state: &LocalRuntimeState,
    descriptor: &RuntimeComponentDescriptor,
    installed: bool,
    running: bool,
    port: Option<u16>,
) -> Result<(), LocalRuntimeError> {
    state.update(|snapshot| {
        snapshot.backend = Some(BackendRuntimeSnapshot {
            installed,
            running,
            version: Some(descriptor.version.clone()),
            port,
        });
        snapshot.error = None;
    })
}

async fn stop_owned_child(child: &mut Child) -> Result<(), LocalRuntimeError> {
    match timeout(STOP_TIMEOUT, child.wait()).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(error)) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(LocalRuntimeError::process(format!(
                "Could not wait for the local backend to stop: {error}"
            )))
        }
        Err(_) => {
            child.start_kill().map_err(|error| {
                LocalRuntimeError::process(format!(
                    "Could not terminate the local backend after the shutdown timeout: {error}"
                ))
            })?;
            child.wait().await.map_err(|error| {
                LocalRuntimeError::process(format!(
                    "Could not wait for the terminated local backend: {error}"
                ))
            })?;
            Ok(())
        }
    }
}

fn version_dir(layout: &LocalRuntimeLayout, descriptor: &RuntimeComponentDescriptor) -> PathBuf {
    layout.backend_dir.join(&descriptor.version)
}

async fn runtime_valid(runtime_dir: &Path) -> Result<bool, LocalRuntimeError> {
    fs::try_exists(binary_path(runtime_dir))
        .await
        .map_err(|error| LocalRuntimeError::io("Could not inspect the backend runtime", error))
}

async fn find_runtime_root(extraction_dir: &Path) -> Result<PathBuf, LocalRuntimeError> {
    if runtime_valid(extraction_dir).await? {
        return Ok(extraction_dir.to_path_buf());
    }
    let mut entries = fs::read_dir(extraction_dir).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the extracted backend runtime", error)
    })?;
    let mut candidates = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the extracted backend runtime", error)
    })? {
        if entry
            .file_type()
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not inspect an extracted backend entry", error)
            })?
            .is_dir()
            && runtime_valid(&entry.path()).await?
        {
            candidates.push(entry.path());
        }
    }
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        _ => Err(LocalRuntimeError::invalid_artifact(
            "The backend archive has an unsupported directory layout.",
        )),
    }
}

async fn ready(port: u16) -> bool {
    let client = match readiness_client() {
        Ok(client) => client,
        Err(_) => return false,
    };
    matches!(
        client
            .get(format!("http://127.0.0.1:{port}/readyz"))
            .send()
            .await,
        Ok(response) if response.status() == StatusCode::NO_CONTENT
    )
}

async fn wait_ready_with_child(child: &mut Child, port: u16) -> Result<(), LocalRuntimeError> {
    for _ in 0..READY_ATTEMPTS {
        if let Some(status) = child.try_wait().map_err(|error| {
            LocalRuntimeError::process(format!(
                "Could not inspect the local backend process: {error}"
            ))
        })? {
            return Err(LocalRuntimeError::process(format!(
                "The local backend exited before becoming ready: {status}."
            )));
        }
        if ready(port).await {
            return Ok(());
        }
        sleep(READY_INTERVAL).await;
    }
    Err(LocalRuntimeError::process(format!(
        "The local backend did not become ready on 127.0.0.1:{port}."
    )))
}

async fn request_shutdown_ack(path: &Path) -> Result<bool, LocalRuntimeError> {
    fs::write(path, b"shutdown\n").await.map_err(|error| {
        LocalRuntimeError::io("Could not request recovered backend shutdown", error)
    })?;
    let attempts =
        (RECOVERED_SHUTDOWN_ACK_TIMEOUT.as_millis() / READY_INTERVAL.as_millis()) as usize;
    for _ in 0..attempts {
        if !fs::try_exists(path).await.map_err(|error| {
            LocalRuntimeError::io("Could not inspect the backend shutdown request", error)
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
            LocalRuntimeError::network("Could not create the backend readiness client", error)
        })
}

async fn read_runtime_record(
    path: &Path,
) -> Result<Option<BackendRuntimeRecord>, LocalRuntimeError> {
    if !fs::try_exists(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the backend runtime state", error)
    })? {
        return Ok(None);
    }
    let content = fs::read(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not read the backend runtime state", error)
    })?;
    match serde_json::from_slice(&content) {
        Ok(record) => Ok(Some(record)),
        Err(error) => {
            crate::diagnostics::warn(
                "runtime.local.backend",
                format!("ignoring invalid runtime state: {error}"),
            );
            let _ = fs::remove_file(path).await;
            Ok(None)
        }
    }
}

async fn write_runtime_record(
    path: &Path,
    record: &BackendRuntimeRecord,
) -> Result<(), LocalRuntimeError> {
    let mut content = serde_json::to_vec_pretty(record).map_err(|error| {
        LocalRuntimeError::internal(format!(
            "Could not serialize the backend runtime state: {error}"
        ))
    })?;
    content.push(b'\n');
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, content).await.map_err(|error| {
        LocalRuntimeError::io("Could not write the backend runtime state", error)
    })?;
    if fs::try_exists(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the backend runtime state", error)
    })? {
        fs::remove_file(path).await.map_err(|error| {
            LocalRuntimeError::io("Could not replace the backend runtime state", error)
        })?;
    }
    fs::rename(&temporary, path).await.map_err(|error| {
        LocalRuntimeError::io("Could not install the backend runtime state", error)
    })
}

fn binary_path(runtime_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    let name = "discloud.exe";
    #[cfg(not(target_os = "windows"))]
    let name = "discloud";
    runtime_dir.join(name)
}

fn server_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

#[cfg(test)]
mod tests {
    use super::server_url;

    #[test]
    fn formats_loopback_server_url() {
        assert_eq!(server_url(12345), "http://127.0.0.1:12345");
    }
}
