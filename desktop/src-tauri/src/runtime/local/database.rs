use std::{
    path::{Path, PathBuf},
    process::Output,
    time::{SystemTime, UNIX_EPOCH},
};

use tokio::{fs, io::AsyncReadExt, process::Command};

use super::{
    atomic_file, components::RuntimeComponentDescriptor, layout::LocalRuntimeLayout, postgresql,
    process, LocalRuntimeError,
};

const DATABASE_NAME: &str = "discloud";
const DATABASE_USER: &str = "discloud";
const CUSTOM_DUMP_MAGIC: &[u8; 5] = b"PGDMP";
const MIN_SUPPORTED_MIGRATION_VERSION: i64 = 3;
const MAX_SUPPORTED_MIGRATION_VERSION: i64 = 25;
const REQUIRED_TABLES: [&str; 3] = ["schema_migrations", "users", "nodes"];

pub(super) struct DatabaseExport {
    pub(super) path: PathBuf,
    pub(super) bytes: u64,
}

pub(super) async fn validate_source(path: &Path) -> Result<PathBuf, LocalRuntimeError> {
    if !path.is_absolute() {
        return Err(LocalRuntimeError::invalid_artifact(
            "The database backup path must be absolute.",
        ));
    }
    let metadata = fs::symlink_metadata(path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not inspect the database backup", error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(LocalRuntimeError::invalid_artifact(
            "The database backup must be a regular file, not a symbolic link.",
        ));
    }
    let canonical = fs::canonicalize(path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not resolve the database backup", error))?;
    validate_magic(&canonical).await?;
    Ok(canonical)
}

pub(super) async fn export(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    port: u16,
    destination: &Path,
) -> Result<DatabaseExport, LocalRuntimeError> {
    validate_destination(destination).await?;
    let runtime_dir = runtime_dir(layout, descriptor);
    ensure_tools(&runtime_dir).await?;
    let password = postgresql::password()?;
    let temporary = temporary_path(destination, "part");
    let _ = fs::remove_file(&temporary).await;

    let mut command = process::command(binary_path(&runtime_dir, "pg_dump"));
    command
        .arg("-h")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(port.to_string())
        .arg("-U")
        .arg(DATABASE_USER)
        .arg("-d")
        .arg(DATABASE_NAME)
        .arg("--format=custom")
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--file")
        .arg(&temporary)
        .env("PGPASSWORD", &password);
    if let Err(error) = run_checked(command, "Could not export the Local server database").await {
        let _ = fs::remove_file(&temporary).await;
        return Err(error);
    }
    if let Err(error) = validate_archive(&runtime_dir, &temporary).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(error);
    }
    let bytes = fs::metadata(&temporary)
        .await
        .map_err(|error| {
            LocalRuntimeError::io("Could not inspect the exported database backup", error)
        })?
        .len();
    atomic_file::replace(
        &temporary,
        destination,
        "Could not finalize the exported database backup",
    )
    .await?;
    Ok(DatabaseExport {
        path: destination.to_path_buf(),
        bytes,
    })
}

pub(super) async fn import(
    layout: &LocalRuntimeLayout,
    descriptor: &RuntimeComponentDescriptor,
    port: u16,
    source: &Path,
) -> Result<(), LocalRuntimeError> {
    let runtime_dir = runtime_dir(layout, descriptor);
    ensure_tools(&runtime_dir).await?;
    validate_archive(&runtime_dir, source).await?;
    let password = postgresql::password()?;
    let suffix = operation_suffix()?;
    let restore_database = format!("discloud_import_{suffix}");
    let previous_database = format!("discloud_previous_{suffix}");

    create_database(&runtime_dir, port, &password, &restore_database).await?;
    let restore_result = async {
        restore_archive(&runtime_dir, port, &password, source, &restore_database).await?;
        validate_restored_database(&runtime_dir, port, &password, &restore_database).await
    }
    .await;
    if let Err(error) = restore_result {
        let _ = drop_database(&runtime_dir, port, &password, &restore_database).await;
        return Err(error);
    }

    if let Err(error) =
        terminate_database_connections(&runtime_dir, port, &password, DATABASE_NAME).await
    {
        let _ = drop_database(&runtime_dir, port, &password, &restore_database).await;
        return Err(error);
    }
    if let Err(error) = rename_database(
        &runtime_dir,
        port,
        &password,
        DATABASE_NAME,
        &previous_database,
    )
    .await
    {
        let _ = drop_database(&runtime_dir, port, &password, &restore_database).await;
        return Err(error);
    }
    if let Err(error) = rename_database(
        &runtime_dir,
        port,
        &password,
        &restore_database,
        DATABASE_NAME,
    )
    .await
    {
        let rollback = rename_database(
            &runtime_dir,
            port,
            &password,
            &previous_database,
            DATABASE_NAME,
        )
        .await;
        let _ = drop_database(&runtime_dir, port, &password, &restore_database).await;
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(LocalRuntimeError::process(format!(
                "Could not activate the imported database and rollback also failed. Activation: {} Rollback: {}",
                error.message(),
                rollback_error.message()
            ))),
        };
    }
    if let Err(error) =
        validate_restored_database(&runtime_dir, port, &password, DATABASE_NAME).await
    {
        let _ = terminate_database_connections(&runtime_dir, port, &password, DATABASE_NAME).await;
        let _ = drop_database(&runtime_dir, port, &password, DATABASE_NAME).await;
        let rollback = rename_database(
            &runtime_dir,
            port,
            &password,
            &previous_database,
            DATABASE_NAME,
        )
        .await;
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(LocalRuntimeError::process(format!(
                "Imported database validation failed and rollback also failed. Validation: {} Rollback: {}",
                error.message(),
                rollback_error.message()
            ))),
        };
    }
    if let Err(error) = drop_database(&runtime_dir, port, &password, &previous_database).await {
        crate::diagnostics::warn(
            "runtime.local.database",
            format!(
                "could not remove previous database after successful import: {}",
                error.message()
            ),
        );
    }
    Ok(())
}

async fn validate_destination(path: &Path) -> Result<(), LocalRuntimeError> {
    if !path.is_absolute() {
        return Err(LocalRuntimeError::configuration(
            "The database export path must be absolute.",
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        LocalRuntimeError::configuration("The database export path must have a parent directory.")
    })?;
    let metadata = fs::metadata(parent).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the database export directory", error)
    })?;
    if !metadata.is_dir() {
        return Err(LocalRuntimeError::configuration(
            "The database export parent must be a directory.",
        ));
    }
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(LocalRuntimeError::configuration(
                "The database export destination must be a regular file.",
            ))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(LocalRuntimeError::io(
            "Could not inspect the database export destination",
            error,
        )),
    }
}

async fn validate_magic(path: &Path) -> Result<(), LocalRuntimeError> {
    let mut file = fs::File::open(path)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not open the database backup", error))?;
    let mut magic = [0u8; CUSTOM_DUMP_MAGIC.len()];
    file.read_exact(&mut magic).await.map_err(|_| {
        LocalRuntimeError::invalid_artifact("The database backup is truncated or empty.")
    })?;
    if &magic != CUSTOM_DUMP_MAGIC {
        return Err(LocalRuntimeError::invalid_artifact(
            "The selected file is not a PostgreSQL custom-format backup.",
        ));
    }
    Ok(())
}

async fn validate_archive(runtime_dir: &Path, path: &Path) -> Result<(), LocalRuntimeError> {
    validate_magic(path).await?;
    let mut command = process::command(binary_path(runtime_dir, "pg_restore"));
    command.arg("--list").arg(path);
    let output = run_checked(command, "Could not inspect the PostgreSQL backup archive").await?;
    let listing = String::from_utf8_lossy(&output.stdout);
    let missing = REQUIRED_TABLES
        .iter()
        .filter(|table| !archive_has_table(&listing, table))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(LocalRuntimeError::invalid_artifact(format!(
            "The backup is not a valid DisCloud database archive; missing required tables: {}.",
            missing.join(", ")
        )));
    }
    Ok(())
}

fn archive_has_table(listing: &str, table: &str) -> bool {
    listing.lines().any(|line| {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        fields
            .windows(3)
            .any(|fields| fields == ["TABLE", "public", table])
    })
}

async fn restore_archive(
    runtime_dir: &Path,
    port: u16,
    password: &str,
    source: &Path,
    database: &str,
) -> Result<(), LocalRuntimeError> {
    let mut command = process::command(binary_path(runtime_dir, "pg_restore"));
    command
        .arg("-h")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(port.to_string())
        .arg("-U")
        .arg(DATABASE_USER)
        .arg("-d")
        .arg(database)
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--exit-on-error")
        .arg(source)
        .env("PGPASSWORD", password);
    run_checked(command, "Could not restore the database backup").await?;
    Ok(())
}

async fn validate_restored_database(
    runtime_dir: &Path,
    port: u16,
    password: &str,
    database: &str,
) -> Result<(), LocalRuntimeError> {
    let checks = REQUIRED_TABLES
        .iter()
        .map(|table| format!("to_regclass('public.{table}') IS NOT NULL"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let output = psql(
        runtime_dir,
        port,
        password,
        database,
        &format!("SELECT CASE WHEN {checks} THEN 'valid' ELSE 'invalid' END"),
    )
    .await?;
    if String::from_utf8_lossy(&output.stdout).trim() != "valid" {
        return Err(LocalRuntimeError::invalid_artifact(
            "The restored database failed DisCloud schema validation.",
        ));
    }
    let output = psql(
        runtime_dir,
        port,
        password,
        database,
        "SELECT COALESCE(MAX(version_id) FILTER (WHERE is_applied), 0) FROM schema_migrations",
    )
    .await?;
    let version = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<i64>()
        .map_err(|_| {
            LocalRuntimeError::invalid_artifact(
                "The restored database has invalid migration metadata.",
            )
        })?;
    validate_migration_version(version)
}

fn validate_migration_version(version: i64) -> Result<(), LocalRuntimeError> {
    if (MIN_SUPPORTED_MIGRATION_VERSION..=MAX_SUPPORTED_MIGRATION_VERSION).contains(&version) {
        return Ok(());
    }
    Err(LocalRuntimeError::incompatible_data(format!(
        "The backup uses DisCloud database migration version {version}; this Desktop version supports backups from {MIN_SUPPORTED_MIGRATION_VERSION} through {MAX_SUPPORTED_MIGRATION_VERSION}."
    )))
}

async fn create_database(
    runtime_dir: &Path,
    port: u16,
    password: &str,
    database: &str,
) -> Result<(), LocalRuntimeError> {
    psql(
        runtime_dir,
        port,
        password,
        "postgres",
        &format!("CREATE DATABASE {database} TEMPLATE template0 ENCODING 'UTF8'"),
    )
    .await?;
    Ok(())
}

async fn rename_database(
    runtime_dir: &Path,
    port: u16,
    password: &str,
    from: &str,
    to: &str,
) -> Result<(), LocalRuntimeError> {
    psql(
        runtime_dir,
        port,
        password,
        "postgres",
        &format!("ALTER DATABASE {from} RENAME TO {to}"),
    )
    .await?;
    Ok(())
}

async fn terminate_database_connections(
    runtime_dir: &Path,
    port: u16,
    password: &str,
    database: &str,
) -> Result<(), LocalRuntimeError> {
    psql(
        runtime_dir,
        port,
        password,
        "postgres",
        &format!("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{database}' AND pid <> pg_backend_pid()"),
    )
    .await?;
    Ok(())
}

async fn drop_database(
    runtime_dir: &Path,
    port: u16,
    password: &str,
    database: &str,
) -> Result<(), LocalRuntimeError> {
    terminate_database_connections(runtime_dir, port, password, database).await?;
    psql(
        runtime_dir,
        port,
        password,
        "postgres",
        &format!("DROP DATABASE IF EXISTS {database}"),
    )
    .await?;
    Ok(())
}

async fn psql(
    runtime_dir: &Path,
    port: u16,
    password: &str,
    database: &str,
    sql: &str,
) -> Result<Output, LocalRuntimeError> {
    let mut command = process::command(binary_path(runtime_dir, "psql"));
    command
        .arg("-h")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(port.to_string())
        .arg("-U")
        .arg(DATABASE_USER)
        .arg("-d")
        .arg(database)
        .arg("-v")
        .arg("ON_ERROR_STOP=1")
        .arg("-Atqc")
        .arg(sql)
        .env("PGPASSWORD", password);
    run_checked(command, "PostgreSQL database operation failed").await
}

async fn ensure_tools(runtime_dir: &Path) -> Result<(), LocalRuntimeError> {
    for tool in ["pg_dump", "pg_restore", "psql"] {
        if !fs::try_exists(binary_path(runtime_dir, tool))
            .await
            .map_err(|error| {
                LocalRuntimeError::io("Could not inspect PostgreSQL backup tools", error)
            })?
        {
            return Err(LocalRuntimeError::invalid_state(format!(
                "The managed PostgreSQL runtime is missing {tool}."
            )));
        }
    }
    Ok(())
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

fn runtime_dir(layout: &LocalRuntimeLayout, descriptor: &RuntimeComponentDescriptor) -> PathBuf {
    layout.postgresql_dir.join(&descriptor.version)
}

fn binary_path(runtime_dir: &Path, name: &str) -> PathBuf {
    #[cfg(target_os = "windows")]
    let name = format!("{name}.exe");
    #[cfg(not(target_os = "windows"))]
    let name = name.to_string();
    runtime_dir.join("bin").join(name)
}

fn temporary_path(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{}.{}", std::process::id(), suffix));
    PathBuf::from(name)
}

fn operation_suffix() -> Result<String, LocalRuntimeError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| LocalRuntimeError::internal(format!("System clock is invalid: {error}")))?
        .as_millis();
    Ok(format!("{}_{}", std::process::id(), millis))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{archive_has_table, validate_migration_version, MAX_SUPPORTED_MIGRATION_VERSION};

    #[test]
    fn detects_required_table_entries() {
        let listing =
            "123; 1259 1 TABLE public users discloud\n124; 0 0 TABLE DATA public users discloud\n";
        assert!(archive_has_table(listing, "users"));
        assert!(!archive_has_table(listing, "nodes"));
    }

    #[test]
    fn supported_migration_version_matches_repository() {
        let migrations = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../migrations");
        let latest = std::fs::read_dir(migrations)
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|entry| {
                entry
                    .file_name()
                    .to_str()?
                    .split('_')
                    .next()?
                    .parse::<i64>()
                    .ok()
            })
            .max()
            .unwrap();
        assert_eq!(latest, MAX_SUPPORTED_MIGRATION_VERSION);
    }

    #[test]
    fn validates_supported_backup_migration_range() {
        assert!(validate_migration_version(3).is_ok());
        assert!(validate_migration_version(MAX_SUPPORTED_MIGRATION_VERSION).is_ok());
        assert!(validate_migration_version(2).is_err());
        assert!(validate_migration_version(MAX_SUPPORTED_MIGRATION_VERSION + 1).is_err());
    }
}
