use std::path::PathBuf;

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
    pub(super) postgresql_state_path: PathBuf,
    pub(super) logs_dir: PathBuf,
}

impl LocalRuntimeLayout {
    pub(super) fn resolve<R: Runtime>(app: &AppHandle<R>) -> Result<Self, LocalRuntimeError> {
        let root_dir = app.path().app_local_data_dir().map_err(|error| {
            LocalRuntimeError::io("Could not resolve the local runtime directory", error)
        })?;
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
            postgresql_state_path: state_dir.join("postgresql.json"),
            logs_dir: root_dir.join("logs"),
            root_dir,
            runtime_dir,
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
