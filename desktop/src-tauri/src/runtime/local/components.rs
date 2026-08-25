use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tokio::fs;

use super::LocalRuntimeError;

const MANIFEST_SCHEMA_VERSION: u32 = 1;
const POSTGRESQL_VERSION: &str = "18.6.0";
const DISCLOUD_RELEASE_BASE: &str = "https://github.com/mewisme/discloud/releases/download";
const POSTGRESQL_RELEASE_BASE: &str =
    "https://github.com/mewisme/postgresql-binaries/releases/download";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RuntimeComponentKind {
    Backend,
    #[serde(rename = "postgresql")]
    PostgreSQL,
    Web,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeComponentDescriptor {
    pub(crate) kind: RuntimeComponentKind,
    pub(crate) version: String,
    pub(crate) target: String,
    pub(crate) archive_name: String,
    pub(crate) download_url: String,
    pub(crate) checksum_url: String,
    pub(crate) optional: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimeComponents {
    pub(crate) backend: RuntimeComponentDescriptor,
    pub(crate) postgresql: RuntimeComponentDescriptor,
    pub(crate) web: Option<RuntimeComponentDescriptor>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimeManifest {
    pub(crate) schema_version: u32,
    pub(crate) desktop_version: String,
    pub(crate) components: LocalRuntimeComponents,
}

impl LocalRuntimeManifest {
    pub(crate) fn for_current_platform<R: Runtime>(
        app: &AppHandle<R>,
    ) -> Result<Self, LocalRuntimeError> {
        let desktop_version = app.package_info().version.to_string();
        let backend = backend_descriptor(&desktop_version)?;
        let postgresql = postgresql_descriptor()?;

        Ok(Self {
            schema_version: MANIFEST_SCHEMA_VERSION,
            desktop_version,
            components: LocalRuntimeComponents {
                backend,
                postgresql,
                web: None,
            },
        })
    }
}

pub(crate) async fn write_manifest(
    path: &Path,
    manifest: &LocalRuntimeManifest,
) -> Result<(), LocalRuntimeError> {
    let mut content = serde_json::to_vec_pretty(manifest).map_err(|error| {
        LocalRuntimeError::internal(format!(
            "Could not serialize the local runtime manifest: {error}"
        ))
    })?;
    content.push(b'\n');

    if fs::read(path).await.ok().as_deref() == Some(content.as_slice()) {
        return Ok(());
    }

    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, content).await.map_err(|error| {
        LocalRuntimeError::io("Could not write the local runtime manifest", error)
    })?;
    if fs::try_exists(path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the local runtime manifest", error)
    })? {
        fs::remove_file(path).await.map_err(|error| {
            LocalRuntimeError::io("Could not replace the local runtime manifest", error)
        })?;
    }
    fs::rename(&temporary, path).await.map_err(|error| {
        LocalRuntimeError::io("Could not install the local runtime manifest", error)
    })?;
    Ok(())
}

fn backend_descriptor(version: &str) -> Result<RuntimeComponentDescriptor, LocalRuntimeError> {
    let (os, arch, extension) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => ("windows", "amd64", "zip"),
        ("macos", "x86_64") => ("darwin", "amd64", "tar.gz"),
        ("macos", "aarch64") => ("darwin", "arm64", "tar.gz"),
        ("linux", "x86_64") => ("linux", "amd64", "tar.gz"),
        ("linux", "aarch64") => ("linux", "arm64", "tar.gz"),
        _ => return Err(LocalRuntimeError::unsupported_platform()),
    };
    let archive_name = format!("discloud-backend_{version}_{os}_{arch}.{extension}");
    let release = format!("{DISCLOUD_RELEASE_BASE}/v{version}");

    Ok(RuntimeComponentDescriptor {
        kind: RuntimeComponentKind::Backend,
        version: version.to_string(),
        target: format!("{os}_{arch}"),
        download_url: format!("{release}/{archive_name}"),
        checksum_url: format!("{release}/discloud-backend-checksums.txt"),
        archive_name,
        optional: false,
    })
}

fn postgresql_descriptor() -> Result<RuntimeComponentDescriptor, LocalRuntimeError> {
    let target = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        _ => return Err(LocalRuntimeError::unsupported_platform()),
    };
    let archive_name = format!("postgresql-{POSTGRESQL_VERSION}-{target}.tar.gz");
    let release = format!("{POSTGRESQL_RELEASE_BASE}/{POSTGRESQL_VERSION}");

    Ok(RuntimeComponentDescriptor {
        kind: RuntimeComponentKind::PostgreSQL,
        version: POSTGRESQL_VERSION.to_string(),
        target: target.to_string(),
        download_url: format!("{release}/{archive_name}"),
        checksum_url: format!("{release}/{archive_name}.sha256"),
        archive_name,
        optional: false,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        backend_descriptor, postgresql_descriptor, RuntimeComponentKind, POSTGRESQL_VERSION,
    };

    #[test]
    fn backend_descriptor_uses_versioned_release_asset() {
        let descriptor = backend_descriptor("0.1.0-rc.2").unwrap();
        assert_eq!(descriptor.kind, RuntimeComponentKind::Backend);
        assert!(descriptor.download_url.contains("/v0.1.0-rc.2/"));
        assert!(descriptor
            .archive_name
            .starts_with("discloud-backend_0.1.0-rc.2_"));
    }

    #[test]
    fn postgresql_descriptor_is_pinned() {
        let descriptor = postgresql_descriptor().unwrap();
        assert_eq!(descriptor.kind, RuntimeComponentKind::PostgreSQL);
        assert_eq!(descriptor.version, POSTGRESQL_VERSION);
        assert!(descriptor.checksum_url.ends_with(".sha256"));
    }
}
