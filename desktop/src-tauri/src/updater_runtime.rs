use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Updater, UpdaterExt};

const CHANNELS_JSON: &str = include_str!("../updater-channels.json");
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PROGRESS_EVENT: &str = "desktop-updater-progress";

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum UpdateChannel {
    Stable,
    Rc,
    Beta,
    Alpha,
}

#[derive(Debug, Deserialize)]
struct UpdaterChannels {
    stable: Vec<String>,
    rc: Vec<String>,
    beta: Vec<String>,
    alpha: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopUpdateInfo {
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdaterProgress {
    event: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

#[tauri::command]
pub(crate) async fn check_for_update(
    app: AppHandle,
    channel: UpdateChannel,
) -> Result<Option<DesktopUpdateInfo>, String> {
    let updater = updater_for(&app, channel, CHECK_TIMEOUT)?;
    let update = updater.check().await.map_err(updater_error)?;

    Ok(update.map(|update| DesktopUpdateInfo {
        current_version: update.current_version,
        version: update.version,
        date: update.date.map(|date| date.to_string()),
        body: update.body,
    }))
}

#[tauri::command]
pub(crate) async fn install_update(app: AppHandle, channel: UpdateChannel) -> Result<(), String> {
    let updater = updater_for(&app, channel, INSTALL_TIMEOUT)?;
    let update = updater
        .check()
        .await
        .map_err(updater_error)?
        .ok_or_else(|| "No update is currently available on this channel.".to_string())?;

    app.emit(
        PROGRESS_EVENT,
        DesktopUpdaterProgress {
            event: "started",
            downloaded_bytes: 0,
            total_bytes: None,
        },
    )
    .map_err(|error| format!("Could not emit updater progress: {error}"))?;

    let progress_app = app.clone();
    let finish_app = app.clone();
    let mut downloaded_bytes = 0_u64;

    update
        .download_and_install(
            move |chunk_length, total_bytes| {
                downloaded_bytes = downloaded_bytes.saturating_add(chunk_length as u64);
                let _ = progress_app.emit(
                    PROGRESS_EVENT,
                    DesktopUpdaterProgress {
                        event: "progress",
                        downloaded_bytes,
                        total_bytes,
                    },
                );
            },
            move || {
                let _ = finish_app.emit(
                    PROGRESS_EVENT,
                    DesktopUpdaterProgress {
                        event: "installing",
                        downloaded_bytes: 0,
                        total_bytes: None,
                    },
                );
            },
        )
        .await
        .map_err(updater_error)
}

fn updater_for(
    app: &AppHandle,
    channel: UpdateChannel,
    timeout: Duration,
) -> Result<Updater, String> {
    let channels: UpdaterChannels = serde_json::from_str(CHANNELS_JSON)
        .map_err(|error| format!("Could not read updater channel configuration: {error}"))?;

    let configured = match channel {
        UpdateChannel::Stable => channels.stable,
        UpdateChannel::Rc => channels.rc,
        UpdateChannel::Beta => channels.beta,
        UpdateChannel::Alpha => channels.alpha,
    };

    if configured.is_empty() {
        return Err("Selected updater channel has no configured endpoint.".to_string());
    }

    let endpoints = configured
        .into_iter()
        .map(|endpoint| {
            endpoint
                .parse()
                .map_err(|error| format!("Invalid updater endpoint: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    app.updater_builder()
        .endpoints(endpoints)
        .map_err(updater_error)?
        .timeout(timeout)
        .build()
        .map_err(updater_error)
}

fn updater_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
