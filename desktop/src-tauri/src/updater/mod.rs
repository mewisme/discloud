use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Updater, UpdaterExt};

const CHANNELS_JSON: &str = include_str!("../../updater-channels.json");
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
    local_runtime: Option<crate::runtime::local::LocalRuntimeUpdateCompatibility>,
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
    local_runtime: bool,
) -> Result<Option<DesktopUpdateInfo>, String> {
    let updater = updater_for(&app, channel, CHECK_TIMEOUT)?;
    let update = updater.check().await.map_err(updater_error)?;
    let Some(update) = update else {
        return Ok(None);
    };
    let local_runtime = if local_runtime {
        Some(crate::runtime::local::check_desktop_update_compatibility(&app, &update.version).await)
    } else {
        None
    };
    Ok(Some(DesktopUpdateInfo {
        current_version: update.current_version,
        version: update.version,
        date: update.date.map(|date| date.to_string()),
        body: update.body,
        local_runtime,
    }))
}

#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    channel: UpdateChannel,
    local_runtime: bool,
) -> Result<(), String> {
    let updater = updater_for(&app, channel, INSTALL_TIMEOUT)?;
    let update = updater
        .check()
        .await
        .map_err(updater_error)?
        .ok_or_else(|| "No update is currently available on this channel.".to_string())?;
    if !confirm_install(&app, &update.version).await? {
        return Err("Update installation cancelled.".to_string());
    }

    if local_runtime {
        emit_progress(&app, "preparingRuntime", 0, None)?;
        crate::runtime::local::prepare_desktop_update(&app, &update.version)
            .await
            .map_err(|error| error.message().to_string())?;
    }

    emit_progress(&app, "started", 0, None)?;

    let progress_app = app.clone();
    let mut downloaded_bytes = 0_u64;
    let bytes = update
        .download(
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
            || {},
        )
        .await
        .map_err(updater_error)?;

    if local_runtime {
        if let Err(error) = crate::runtime::local::shutdown(&app).await {
            let _ = crate::runtime::local::resume_after_updater_failure(&app).await;
            return Err(format!(
                "Could not stop the local runtime before installing the update: {}",
                error.message()
            ));
        }
    }
    emit_progress(&app, "installing", 0, None)?;
    if let Err(error) = update.install(&bytes) {
        if local_runtime {
            let _ = crate::runtime::local::resume_after_updater_failure(&app).await;
        }
        return Err(updater_error(error));
    }
    app.restart()
}

fn emit_progress(
    app: &AppHandle,
    event: &'static str,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) -> Result<(), String> {
    app.emit(
        PROGRESS_EVENT,
        DesktopUpdaterProgress {
            event,
            downloaded_bytes,
            total_bytes,
        },
    )
    .map_err(|error| format!("Could not emit updater progress: {error}"))
}

async fn confirm_install(app: &AppHandle, version: &str) -> Result<bool, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "Install DisCloud {version} and restart the application now?"
        ))
        .title("Install DisCloud update")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and restart".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |confirmed| {
            let _ = sender.send(confirmed);
        });
    receiver
        .await
        .map_err(|_| "Could not receive update confirmation.".to_string())
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
