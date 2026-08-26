use std::{
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::Duration,
};

use keyring::{Entry, Error as KeyringError};
use rand::{distr::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tokio::{
    fs,
    process::Command,
    time::{sleep, timeout},
};

use super::{
    archive, bundled, components::RuntimeComponentDescriptor, download, layout::LocalRuntimeLayout,
    logs, ports, process, LocalRuntimeError, LocalRuntimeState, LocalRuntimeStatus,
};

const DATABASE_USER: &str = "discloud";
const KEYRING_SERVICE: &str = "com.mewisme.discloud.local-runtime";
const KEYRING_POSTGRESQL_USER: &str = "postgresql.discloud";
const START_TIMEOUT_SECONDS: &str = "30";
const PG_CTL_COMMAND_TIMEOUT: Duration = Duration::from_secs(35);

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PostgresqlRuntimeSnapshot {
    pub(super) installed: bool,
    pub(super) initialized: bool,
    pub(super) running: bool,
    pub(super) version: Option<String>,
    pub(super) port: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PostgresqlRuntimeRecord {
    version: String,
    port: u16,
}

pub(super) async fn inspect(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
) -> Result<PostgresqlRuntimeSnapshot, LocalRuntimeError> {
    let runtime_dir = version_dir(layout, descriptor);
    let installed = runtime_valid(&runtime_dir).await?;
    let initialized = database_initialized(&layout.postgres_data_dir).await?;
    if !installed || !initialized {
        return Ok(PostgresqlRuntimeSnapshot {
            installed,
            initialized,
            running: false,
            version: Some(descriptor.version.clone()),
            port: None,
        });
    }

    let pg_ctl = binary_path(&runtime_dir, "pg_ctl");
    let running = is_running(&pg_ctl, &layout.postgres_data_dir).await?;
    let port = if running {
        match read_postmaster_port(&layout.postgres_data_dir).await? {
            Some(port) => Some(port),
            None => read_runtime_record(&layout.postgresql_state_path)
                .await?
                .map(|record| record.port),
        }
    } else {
        None
    };

    Ok(PostgresqlRuntimeSnapshot {
        installed,
        initialized,
        running,
        version: Some(descriptor.version.clone()),
        port,
    })
}

pub(super) async fn start<R: Runtime>(
    app: &AppHandle<R>,
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    desktop_version: &str,
    state: &LocalRuntimeState,
) -> Result<(), LocalRuntimeError> {
    let runtime_dir = ensure_runtime(app, layout, descriptor, desktop_version, state).await?;
    let initialized = ensure_database(layout, descriptor, &runtime_dir, state).await?;
    let pg_ctl = binary_path(&runtime_dir, "pg_ctl");

    if is_running(&pg_ctl, &layout.postgres_data_dir).await? {
        let port = match read_postmaster_port(&layout.postgres_data_dir).await? {
            Some(port) => port,
            None => read_runtime_record(&layout.postgresql_state_path)
                .await?
                .map(|record| record.port)
                .ok_or_else(|| {
                    LocalRuntimeError::process(
                        "PostgreSQL is running but its listen port could not be determined.",
                    )
                })?,
        };
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::Database,
            format!("PostgreSQL is already running on 127.0.0.1:{port}."),
        )
        .await;
        wait_ready(&runtime_dir, port).await?;
        ensure_application_database(&runtime_dir, port).await?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::Database,
            "DisCloud PostgreSQL database is ready.",
        )
        .await;
        write_runtime_record(
            &layout.postgresql_state_path,
            &PostgresqlRuntimeRecord {
                version: descriptor.version.clone(),
                port,
            },
        )
        .await?;
        set_snapshot(
            state,
            descriptor,
            true,
            initialized,
            true,
            Some(port),
            LocalRuntimeStatus::DatabaseReady,
        )?;
        return Ok(());
    }

    let record = read_runtime_record(&layout.postgresql_state_path).await?;
    let port = ports::choose_port(
        record
            .as_ref()
            .filter(|record| record.version == descriptor.version)
            .map(|record| record.port),
        ports::POSTGRESQL_PREFERRED_PORT,
    )?;
    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::StartingDatabase;
        snapshot.error = None;
    })?;
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Database,
        format!("Starting PostgreSQL on 127.0.0.1:{port}."),
    )
    .await;

    let log_path = layout.logs_dir.join("postgresql.log");
    fs::write(&log_path, b"")
        .await
        .map_err(|error| LocalRuntimeError::io("Could not reset the PostgreSQL log", error))?;
    let options = format!("-p {port} -h 127.0.0.1");
    let mut command = process::command(&pg_ctl);
    command
        .arg("start")
        .arg("-D")
        .arg(&layout.postgres_data_dir)
        .arg("-l")
        .arg(&log_path)
        .arg("-w")
        .arg("-t")
        .arg(START_TIMEOUT_SECONDS)
        .arg("-o")
        .arg(options);
    crate::diagnostics::info("runtime.local.postgresql", format!("starting port={port}"));
    run_pg_ctl(command, "Could not start PostgreSQL", Some(&log_path)).await?;
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Database,
        "pg_ctl start completed; waiting for PostgreSQL readiness.",
    )
    .await;
    crate::diagnostics::info(
        "runtime.local.postgresql",
        format!("pg_ctl start completed port={port}"),
    );
    if let Err(error) = wait_ready(&runtime_dir, port).await {
        let _ = stop_cluster(&pg_ctl, &layout.postgres_data_dir).await;
        return Err(error);
    }
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Database,
        format!("PostgreSQL is accepting connections on 127.0.0.1:{port}."),
    )
    .await;
    crate::diagnostics::info("runtime.local.postgresql", format!("ready port={port}"));
    if let Err(error) = ensure_application_database(&runtime_dir, port).await {
        let _ = stop_cluster(&pg_ctl, &layout.postgres_data_dir).await;
        return Err(error);
    }
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Database,
        "DisCloud PostgreSQL database is ready.",
    )
    .await;
    crate::diagnostics::info(
        "runtime.local.postgresql",
        format!("application database ready port={port}"),
    );
    write_runtime_record(
        &layout.postgresql_state_path,
        &PostgresqlRuntimeRecord {
            version: descriptor.version.clone(),
            port,
        },
    )
    .await?;
    set_snapshot(
        state,
        descriptor,
        true,
        initialized,
        true,
        Some(port),
        LocalRuntimeStatus::DatabaseReady,
    )?;
    Ok(())
}

pub(super) async fn stop(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    state: &LocalRuntimeState,
) -> Result<(), LocalRuntimeError> {
    let runtime_dir = version_dir(layout, descriptor);
    let installed = runtime_valid(&runtime_dir).await?;
    let initialized = database_initialized(&layout.postgres_data_dir).await?;
    if !installed || !initialized {
        set_snapshot(
            state,
            descriptor,
            installed,
            initialized,
            false,
            None,
            LocalRuntimeStatus::Stopped,
        )?;
        return Ok(());
    }

    let pg_ctl = binary_path(&runtime_dir, "pg_ctl");
    if !is_running(&pg_ctl, &layout.postgres_data_dir).await? {
        set_snapshot(
            state,
            descriptor,
            true,
            true,
            false,
            None,
            LocalRuntimeStatus::Stopped,
        )?;
        return Ok(());
    }

    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::Stopping;
        snapshot.error = None;
    })?;
    stop_cluster(&pg_ctl, &layout.postgres_data_dir).await?;
    set_snapshot(
        state,
        descriptor,
        true,
        true,
        false,
        None,
        LocalRuntimeStatus::Stopped,
    )?;
    Ok(())
}

pub(super) fn password() -> Result<String, LocalRuntimeError> {
    let entry = postgresql_keyring_entry()?;
    entry.get_password().map_err(|error| match error {
        KeyringError::NoEntry => LocalRuntimeError::credentials(
            "The local PostgreSQL credential is missing from the OS keyring.",
        ),
        error => LocalRuntimeError::credentials(format!(
            "Could not read the local PostgreSQL credential from the OS keyring: {error}"
        )),
    })
}

pub(super) fn password_configured() -> Result<bool, LocalRuntimeError> {
    match postgresql_keyring_entry()?.get_password() {
        Ok(password) => Ok(!password.trim().is_empty()),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(error) => Err(LocalRuntimeError::credentials(format!(
            "Could not read the local PostgreSQL credential from the OS keyring: {error}"
        ))),
    }
}

pub(super) fn ensure_password() -> Result<String, LocalRuntimeError> {
    ensure_postgresql_password()
}

async fn ensure_runtime<R: Runtime>(
    app: &AppHandle<R>,
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    desktop_version: &str,
    state: &LocalRuntimeState,
) -> Result<PathBuf, LocalRuntimeError> {
    let destination = version_dir(layout, descriptor);
    if runtime_valid(&destination).await? {
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::PostgresqlRuntime,
            format!(
                "PostgreSQL {} runtime is already installed.",
                descriptor.version
            ),
        )
        .await;
        set_snapshot(
            state,
            descriptor,
            true,
            database_initialized(&layout.postgres_data_dir).await?,
            false,
            None,
            LocalRuntimeStatus::Preparing,
        )?;
        return Ok(destination);
    }

    if fs::try_exists(&destination).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the PostgreSQL runtime directory", error)
    })? {
        fs::remove_dir_all(&destination).await.map_err(|error| {
            LocalRuntimeError::io("Could not remove an incomplete PostgreSQL runtime", error)
        })?;
    }

    if let Some(resource_dir) = bundled::resource_directory(app, descriptor).await? {
        state.update(|snapshot| {
            snapshot.status = LocalRuntimeStatus::Installing;
            snapshot.error = None;
        })?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::PostgresqlRuntime,
            format!(
                "Installing bundled PostgreSQL {} runtime.",
                descriptor.version
            ),
        )
        .await;
        crate::diagnostics::info(
            "runtime.local.postgresql",
            format!("using bundled directory={}", resource_dir.display()),
        );
        let resource_root = find_runtime_root(&resource_dir).await?;
        bundled::copy_resource_directory(&resource_root, &destination).await?;
    } else {
        state.update(|snapshot| {
            snapshot.status = LocalRuntimeStatus::Downloading;
            snapshot.error = None;
        })?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::PostgresqlRuntime,
            format!("Downloading PostgreSQL {} runtime.", descriptor.version),
        )
        .await;
        let client = download::client(desktop_version)?;
        let downloads_dir = layout.staging_dir.join("downloads");
        let verified = download::download_verified(&client, descriptor, &downloads_dir).await?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::PostgresqlRuntime,
            format!(
                "Downloaded and verified PostgreSQL {} runtime ({} bytes).",
                descriptor.version, verified.bytes
            ),
        )
        .await;
        crate::diagnostics::info(
            "runtime.local.postgresql",
            format!(
                "downloaded={} bytes={} sha256={}",
                verified.path.display(),
                verified.bytes,
                verified.sha256
            ),
        );
        let extraction_dir = layout
            .staging_dir
            .join(format!("postgresql-{}.extract", descriptor.version));
        archive::extract_tar_gz(&verified.path, &extraction_dir).await?;
        let extracted_root = find_runtime_root(&extraction_dir).await?;
        fs::create_dir_all(&layout.postgresql_dir)
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not create the PostgreSQL runtime directory", error)
            })?;
        if extracted_root == extraction_dir {
            fs::rename(&extraction_dir, &destination)
                .await
                .map_err(|error| {
                    LocalRuntimeError::io("Could not install the PostgreSQL runtime", error)
                })?;
        } else {
            fs::rename(&extracted_root, &destination)
                .await
                .map_err(|error| {
                    LocalRuntimeError::io("Could not install the PostgreSQL runtime", error)
                })?;
            let _ = fs::remove_dir_all(&extraction_dir).await;
        }
        let _ = fs::remove_file(&verified.path).await;
    }

    ensure_runtime_executables(&destination).await?;
    if !runtime_valid(&destination).await? {
        return Err(LocalRuntimeError::invalid_artifact(
            "The PostgreSQL runtime does not contain the required executables.",
        ));
    }
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::PostgresqlRuntime,
        format!("PostgreSQL {} runtime is ready.", descriptor.version),
    )
    .await;
    Ok(destination)
}

async fn ensure_database(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    runtime_dir: &Path,
    state: &LocalRuntimeState,
) -> Result<bool, LocalRuntimeError> {
    if database_initialized(&layout.postgres_data_dir).await? {
        validate_database_major(&layout.postgres_data_dir, &descriptor.version).await?;
        logs::append(
            layout,
            logs::LocalRuntimeLogStage::Database,
            "Existing PostgreSQL cluster is valid.",
        )
        .await;
        set_snapshot(
            state,
            descriptor,
            true,
            true,
            false,
            None,
            LocalRuntimeStatus::Preparing,
        )?;
        return Ok(true);
    }
    if !directory_empty_or_missing(&layout.postgres_data_dir).await? {
        return Err(LocalRuntimeError::invalid_state("The local PostgreSQL data directory is not empty but does not contain a valid PostgreSQL cluster."));
    }

    state.update(|snapshot| {
        snapshot.status = LocalRuntimeStatus::InitializingDatabase;
        snapshot.error = None;
    })?;
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Database,
        "Initializing the PostgreSQL cluster.",
    )
    .await;
    let password = ensure_postgresql_password()?;
    let password_file = layout.staging_dir.join("postgresql-password.txt");
    write_password_file(&password_file, &password).await?;
    let initdb = binary_path(runtime_dir, "initdb");
    let mut command = process::command(initdb);
    command
        .arg("-D")
        .arg(&layout.postgres_data_dir)
        .arg("--username")
        .arg(DATABASE_USER)
        .arg("--auth-local=scram-sha-256")
        .arg("--auth-host=scram-sha-256")
        .arg("--encoding=UTF8")
        .arg("--pwfile")
        .arg(&password_file);
    let result = run_checked(command, "Could not initialize PostgreSQL").await;
    let _ = fs::remove_file(&password_file).await;
    if let Err(error) = result {
        if !database_initialized(&layout.postgres_data_dir)
            .await
            .unwrap_or(false)
        {
            let _ = fs::remove_dir_all(&layout.postgres_data_dir).await;
        }
        return Err(error);
    }
    validate_database_major(&layout.postgres_data_dir, &descriptor.version).await?;
    logs::append(
        layout,
        logs::LocalRuntimeLogStage::Database,
        "PostgreSQL cluster initialization completed.",
    )
    .await;
    Ok(true)
}

fn set_snapshot(
    state: &LocalRuntimeState,
    descriptor: &RuntimeComponentDescriptor,
    installed: bool,
    initialized: bool,
    running: bool,
    port: Option<u16>,
    status: LocalRuntimeStatus,
) -> Result<(), LocalRuntimeError> {
    state.update(|snapshot| {
        snapshot.status = status;
        snapshot.postgresql = Some(PostgresqlRuntimeSnapshot {
            installed,
            initialized,
            running,
            version: Some(descriptor.version.clone()),
            port,
        });
        snapshot.error = None;
    })
}

fn version_dir(layout: &LocalRuntimeLayout, descriptor: &RuntimeComponentDescriptor) -> PathBuf {
    layout.postgresql_dir.join(&descriptor.version)
}

async fn runtime_valid(runtime_dir: &Path) -> Result<bool, LocalRuntimeError> {
    for name in ["initdb", "pg_ctl", "pg_isready", "postgres", "psql"] {
        if !fs::try_exists(binary_path(runtime_dir, name))
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not inspect the PostgreSQL runtime", error)
            })?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(unix)]
async fn ensure_runtime_executables(runtime_dir: &Path) -> Result<(), LocalRuntimeError> {
    use std::os::unix::fs::PermissionsExt;

    let mut entries = fs::read_dir(runtime_dir.join("bin"))
        .await
        .map_err(|error| {
            LocalRuntimeError::io("Could not inspect PostgreSQL runtime permissions", error)
        })?;
    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect PostgreSQL runtime permissions", error)
    })? {
        let file_type = entry.file_type().await.map_err(|error| {
            LocalRuntimeError::io("Could not inspect a PostgreSQL runtime executable", error)
        })?;
        if !file_type.is_file() {
            continue;
        }
        let path = entry.path();
        let mut permissions = entry
            .metadata()
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not inspect PostgreSQL runtime permissions", error)
            })?
            .permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        fs::set_permissions(path, permissions)
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not make a PostgreSQL runtime file executable", error)
            })?;
    }
    Ok(())
}

#[cfg(not(unix))]
async fn ensure_runtime_executables(_runtime_dir: &Path) -> Result<(), LocalRuntimeError> {
    Ok(())
}

async fn ensure_application_database(
    runtime_dir: &Path,
    port: u16,
) -> Result<(), LocalRuntimeError> {
    let password = password()?;
    let mut check = process::command(binary_path(runtime_dir, "psql"));
    check
        .arg("-h")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(port.to_string())
        .arg("-U")
        .arg(DATABASE_USER)
        .arg("-d")
        .arg("postgres")
        .arg("-Atqc")
        .arg("SELECT 1 FROM pg_database WHERE datname = 'discloud'")
        .env("PGPASSWORD", &password);
    let output = run_checked(check, "Could not inspect the DisCloud PostgreSQL database").await?;
    if String::from_utf8_lossy(&output.stdout).trim() == "1" {
        return Ok(());
    }

    let mut create = process::command(binary_path(runtime_dir, "psql"));
    create
        .arg("-h")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(port.to_string())
        .arg("-U")
        .arg(DATABASE_USER)
        .arg("-d")
        .arg("postgres")
        .arg("-v")
        .arg("ON_ERROR_STOP=1")
        .arg("-c")
        .arg("CREATE DATABASE discloud")
        .env("PGPASSWORD", password);
    run_checked(create, "Could not create the DisCloud PostgreSQL database").await?;
    Ok(())
}

async fn find_runtime_root(extraction_dir: &Path) -> Result<PathBuf, LocalRuntimeError> {
    if runtime_valid(extraction_dir).await? {
        return Ok(extraction_dir.to_path_buf());
    }
    let mut entries = fs::read_dir(extraction_dir).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the extracted PostgreSQL runtime", error)
    })?;
    let mut candidates = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the extracted PostgreSQL runtime", error)
    })? {
        let path = entry.path();
        if entry
            .file_type()
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not inspect an extracted PostgreSQL entry", error)
            })?
            .is_dir()
            && runtime_valid(&path).await?
        {
            candidates.push(path);
        }
    }
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        _ => Err(LocalRuntimeError::invalid_artifact(
            "The PostgreSQL runtime has an unsupported directory layout.",
        )),
    }
}

async fn database_initialized(data_dir: &Path) -> Result<bool, LocalRuntimeError> {
    fs::try_exists(data_dir.join("PG_VERSION"))
        .await
        .map_err(|error| {
            LocalRuntimeError::io("Could not inspect the PostgreSQL data directory", error)
        })
}

async fn validate_database_major(data_dir: &Path, version: &str) -> Result<(), LocalRuntimeError> {
    let actual = fs::read_to_string(data_dir.join("PG_VERSION"))
        .await
        .map_err(|error| {
            LocalRuntimeError::io("Could not read the PostgreSQL data version", error)
        })?;
    let expected = version.split('.').next().unwrap_or(version);
    if actual.trim() != expected {
        return Err(LocalRuntimeError::invalid_state(format!("Local PostgreSQL data uses major version {}, but runtime version {version} requires major version {expected}.", actual.trim())));
    }
    Ok(())
}

async fn directory_empty_or_missing(path: &Path) -> Result<bool, LocalRuntimeError> {
    if !fs::try_exists(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the PostgreSQL data directory", error)
    })? {
        return Ok(true);
    }
    let mut entries = fs::read_dir(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the PostgreSQL data directory", error)
    })?;
    Ok(entries
        .next_entry()
        .await
        .map_err(|error| {
            LocalRuntimeError::io("Could not inspect the PostgreSQL data directory", error)
        })?
        .is_none())
}

async fn is_running(pg_ctl: &Path, data_dir: &Path) -> Result<bool, LocalRuntimeError> {
    let output = process::command(pg_ctl)
        .arg("status")
        .arg("-D")
        .arg(data_dir)
        .output()
        .await
        .map_err(|error| {
            LocalRuntimeError::process(format!("Could not query PostgreSQL status: {error}"))
        })?;
    Ok(output.status.success())
}

async fn wait_ready(runtime_dir: &Path, port: u16) -> Result<(), LocalRuntimeError> {
    let pg_isready = binary_path(runtime_dir, "pg_isready");
    for _ in 0..30 {
        let output = process::command(&pg_isready)
            .arg("-h")
            .arg("127.0.0.1")
            .arg("-p")
            .arg(port.to_string())
            .arg("-U")
            .arg(DATABASE_USER)
            .arg("-t")
            .arg("1")
            .output()
            .await
            .map_err(|error| {
                LocalRuntimeError::process(format!("Could not check PostgreSQL readiness: {error}"))
            })?;
        if output.status.success() {
            return Ok(());
        }
        sleep(Duration::from_millis(250)).await;
    }
    Err(LocalRuntimeError::process(format!(
        "PostgreSQL did not become ready on 127.0.0.1:{port}."
    )))
}

async fn stop_cluster(pg_ctl: &Path, data_dir: &Path) -> Result<(), LocalRuntimeError> {
    let mut command = process::command(pg_ctl);
    command
        .arg("stop")
        .arg("-D")
        .arg(data_dir)
        .arg("-m")
        .arg("fast")
        .arg("-w")
        .arg("-t")
        .arg(START_TIMEOUT_SECONDS);
    run_pg_ctl(command, "Could not stop PostgreSQL", None).await?;
    Ok(())
}

async fn run_pg_ctl(
    mut command: Command,
    context: &str,
    log_path: Option<&Path>,
) -> Result<(), LocalRuntimeError> {
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let status = timeout(PG_CTL_COMMAND_TIMEOUT, command.status())
        .await
        .map_err(|_| {
            LocalRuntimeError::process(format!(
                "{context}: command timed out after {} seconds",
                PG_CTL_COMMAND_TIMEOUT.as_secs()
            ))
        })?
        .map_err(|error| LocalRuntimeError::process(format!("{context}: {error}")))?;
    if status.success() {
        return Ok(());
    }
    let detail = match log_path {
        Some(path) => read_log_tail(path, 12)
            .await
            .unwrap_or_else(|| format!("process exited with {status}")),
        None => format!("process exited with {status}"),
    };
    Err(LocalRuntimeError::process(format!("{context}: {detail}")))
}

async fn read_log_tail(path: &Path, max_lines: usize) -> Option<String> {
    let content = fs::read_to_string(path).await.ok()?;
    let mut lines = content.lines().rev().take(max_lines).collect::<Vec<_>>();
    lines.reverse();
    let detail = lines.join("\n");
    (!detail.trim().is_empty()).then_some(detail)
}

async fn run_checked(mut command: Command, context: &str) -> Result<Output, LocalRuntimeError> {
    let output = command
        .output()
        .await
        .map_err(|error| LocalRuntimeError::process(format!("{context}: {error}")))?;
    if output.status.success() {
        return Ok(output);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("process exited with {}", output.status)
    };
    Err(LocalRuntimeError::process(format!("{context}: {detail}")))
}

async fn read_postmaster_port(data_dir: &Path) -> Result<Option<u16>, LocalRuntimeError> {
    let path = data_dir.join("postmaster.pid");
    if !fs::try_exists(&path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not inspect postmaster.pid", error))?
    {
        return Ok(None);
    }
    let content = fs::read_to_string(path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not read postmaster.pid", error))?;
    Ok(parse_postmaster_port(&content))
}

fn parse_postmaster_port(content: &str) -> Option<u16> {
    content.lines().nth(3)?.trim().parse().ok()
}

async fn read_runtime_record(
    path: &Path,
) -> Result<Option<PostgresqlRuntimeRecord>, LocalRuntimeError> {
    if !fs::try_exists(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the PostgreSQL runtime state", error)
    })? {
        return Ok(None);
    }
    let content = fs::read(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not read the PostgreSQL runtime state", error)
    })?;
    match serde_json::from_slice(&content) {
        Ok(record) => Ok(Some(record)),
        Err(error) => {
            crate::diagnostics::warn(
                "runtime.local.postgresql",
                format!("ignoring invalid runtime state: {error}"),
            );
            let _ = fs::remove_file(path).await;
            Ok(None)
        }
    }
}

async fn write_runtime_record(
    path: &Path,
    record: &PostgresqlRuntimeRecord,
) -> Result<(), LocalRuntimeError> {
    let mut content = serde_json::to_vec_pretty(record).map_err(|error| {
        LocalRuntimeError::internal(format!(
            "Could not serialize the PostgreSQL runtime state: {error}"
        ))
    })?;
    content.push(b'\n');
    super::atomic_file::write(
        path,
        content,
        "Could not install the PostgreSQL runtime state",
    )
    .await
}

fn ensure_postgresql_password() -> Result<String, LocalRuntimeError> {
    let entry = postgresql_keyring_entry()?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(KeyringError::NoEntry) => {
            let password = random_password();
            entry.set_password(&password).map_err(|error| {
                LocalRuntimeError::credentials(format!(
                    "Could not save the local PostgreSQL credential to the OS keyring: {error}"
                ))
            })?;
            Ok(password)
        }
        Err(error) => Err(LocalRuntimeError::credentials(format!(
            "Could not read the local PostgreSQL credential from the OS keyring: {error}"
        ))),
    }
}

fn postgresql_keyring_entry() -> Result<Entry, LocalRuntimeError> {
    Entry::new(KEYRING_SERVICE, KEYRING_POSTGRESQL_USER).map_err(|error| {
        LocalRuntimeError::credentials(format!(
            "Could not open the OS keyring for local PostgreSQL: {error}"
        ))
    })
}

fn random_password() -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

async fn write_password_file(path: &Path, password: &str) -> Result<(), LocalRuntimeError> {
    fs::write(path, password).await.map_err(|error| {
        LocalRuntimeError::io(
            "Could not write the temporary PostgreSQL password file",
            error,
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .await
            .map_err(|error| {
                LocalRuntimeError::io(
                    "Could not secure the temporary PostgreSQL password file",
                    error,
                )
            })?;
    }
    Ok(())
}

fn binary_path(runtime_dir: &Path, name: &str) -> PathBuf {
    #[cfg(target_os = "windows")]
    let name = format!("{name}.exe");
    #[cfg(not(target_os = "windows"))]
    let name = name.to_string();
    runtime_dir.join("bin").join(name)
}

#[cfg(test)]
mod tests {
    use super::{parse_postmaster_port, random_password};

    #[test]
    fn parses_postmaster_port() {
        let content = "1234\n/data\n1700000000\n54321\n/tmp\n127.0.0.1\n";
        assert_eq!(parse_postmaster_port(content), Some(54321));
    }

    #[test]
    fn generates_strong_random_password_length() {
        let password = random_password();
        assert_eq!(password.len(), 48);
        assert!(password.bytes().all(|byte| byte.is_ascii_alphanumeric()));
    }
}
