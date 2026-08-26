use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tokio::fs;

use super::LocalRuntimeError;

pub(super) struct LocalRuntimeLayout {
    pub(super) root_dir: PathBuf,
    pub(super) runtime_dir: PathBuf,
    pub(super) backend_dir: PathBuf,
    pub(super) postgresql_dir: PathBuf,
    pub(super) web_dir: PathBuf,
    pub(super) staging_dir: PathBuf,
    pub(super) postgres_data_dir: PathBuf,
    pub(super) config_path: PathBuf,
    pub(super) manifest_path: PathBuf,
    pub(super) data_metadata_path: PathBuf,
    pub(super) postgresql_state_path: PathBuf,
    pub(super) backend_state_path: PathBuf,
    pub(super) backend_shutdown_path: PathBuf,
    pub(super) web_state_path: PathBuf,
    pub(super) web_shutdown_path: PathBuf,
    pub(super) logs_dir: PathBuf,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalRuntimeRootPreference {
    root_dir: String,
}

impl LocalRuntimeLayout {
    pub(super) fn resolve<R: Runtime>(app: &AppHandle<R>) -> Result<Self, LocalRuntimeError> {
        let default_root_dir = default_root_dir(app)?;
        let root_dir = read_root_preference(app)?.unwrap_or(default_root_dir);
        Self::from_root(root_dir)
    }

    pub(super) fn default_root<R: Runtime>(
        app: &AppHandle<R>,
    ) -> Result<PathBuf, LocalRuntimeError> {
        default_root_dir(app)
    }

    fn from_root(root_dir: PathBuf) -> Result<Self, LocalRuntimeError> {
        if !root_dir.is_absolute() {
            return Err(LocalRuntimeError::configuration(
                "The local runtime data directory must be an absolute path.",
            ));
        }
        let runtime_dir = root_dir.join("runtime");
        let config_dir = root_dir.join("config");
        let state_dir = root_dir.join("state");

        Ok(Self {
            backend_dir: runtime_dir.join("backend"),
            postgresql_dir: runtime_dir.join("postgresql"),
            web_dir: runtime_dir.join("web"),
            staging_dir: runtime_dir.join(".staging"),
            postgres_data_dir: root_dir.join("postgres").join("data"),
            config_path: config_dir.join("local-server.env"),
            manifest_path: state_dir.join("runtime-manifest.json"),
            data_metadata_path: state_dir.join("local-data.json"),
            postgresql_state_path: state_dir.join("postgresql.json"),
            backend_state_path: state_dir.join("backend.json"),
            backend_shutdown_path: state_dir.join("backend.shutdown"),
            web_state_path: state_dir.join("web.json"),
            web_shutdown_path: state_dir.join("web.shutdown"),
            logs_dir: root_dir.join("logs"),
            root_dir,
            runtime_dir,
        })
    }

    pub(super) async fn set_root<R: Runtime>(
        app: &AppHandle<R>,
        root_dir: &PathBuf,
    ) -> Result<(), LocalRuntimeError> {
        if !root_dir.is_absolute() {
            return Err(LocalRuntimeError::configuration(
                "The local runtime data directory must be an absolute path.",
            ));
        }
        let default_root = default_root_dir(app)?;
        let path = root_preference_path(app)?;
        fs::create_dir_all(path.parent().expect("runtime root preference has a parent"))
            .await
            .map_err(|error| {
                LocalRuntimeError::io(
                    "Could not create the local runtime settings directory",
                    error,
                )
            })?;
        if root_dir == &default_root {
            if fs::try_exists(&path).await.map_err(|error| {
                LocalRuntimeError::io("Could not inspect the local runtime root preference", error)
            })? {
                fs::remove_file(&path).await.map_err(|error| {
                    LocalRuntimeError::io(
                        "Could not clear the local runtime root preference",
                        error,
                    )
                })?;
            }
            return Ok(());
        }
        let preference = LocalRuntimeRootPreference {
            root_dir: crate::path_display::user_path_string(root_dir),
        };
        let mut content = serde_json::to_vec_pretty(&preference).map_err(|error| {
            LocalRuntimeError::internal(format!(
                "Could not serialize the local runtime root preference: {error}"
            ))
        })?;
        content.push(b'\n');
        super::atomic_file::write(
            &path,
            content,
            "Could not install the local runtime root preference",
        )
        .await
    }

    pub(super) fn for_root(root_dir: PathBuf) -> Result<Self, LocalRuntimeError> {
        Self::from_root(root_dir)
    }

    pub(super) async fn database_initialized(&self) -> Result<bool, LocalRuntimeError> {
        fs::try_exists(self.postgres_data_dir.join("PG_VERSION"))
            .await
            .map_err(|error| {
                LocalRuntimeError::io(
                    "Could not inspect the local PostgreSQL data directory",
                    error,
                )
            })
    }

    pub(super) async fn prepare(&self) -> Result<(), LocalRuntimeError> {
        for path in [
            &self.root_dir,
            &self.runtime_dir,
            &self.backend_dir,
            &self.postgresql_dir,
            &self.web_dir,
            &self.staging_dir,
            self.postgres_data_dir
                .parent()
                .expect("PostgreSQL data path has a parent"),
            self.config_path.parent().expect("config path has a parent"),
            self.manifest_path
                .parent()
                .expect("manifest path has a parent"),
            &self.logs_dir,
        ] {
            fs::create_dir_all(path).await.map_err(|error| {
                LocalRuntimeError::io("Could not create a local runtime directory", error)
            })?;
        }
        Ok(())
    }
}

fn default_root_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, LocalRuntimeError> {
    app.path().app_local_data_dir().map_err(|error| {
        LocalRuntimeError::io("Could not resolve the local runtime directory", error)
    })
}

fn root_preference_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, LocalRuntimeError> {
    Ok(default_root_dir(app)?
        .join("state")
        .join("local-runtime-root.json"))
}

fn read_root_preference<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<PathBuf>, LocalRuntimeError> {
    let path = root_preference_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read(&path).map_err(|error| {
        LocalRuntimeError::io("Could not read the local runtime root preference", error)
    })?;
    let preference: LocalRuntimeRootPreference =
        serde_json::from_slice(&content).map_err(|error| {
            LocalRuntimeError::configuration(format!(
                "The local runtime root preference is invalid: {error}"
            ))
        })?;
    let root_dir = crate::path_display::user_path(&PathBuf::from(preference.root_dir));
    if !root_dir.is_absolute() {
        return Err(LocalRuntimeError::configuration(
            "The saved local runtime data directory is not absolute.",
        ));
    }
    Ok(Some(root_dir))
}
