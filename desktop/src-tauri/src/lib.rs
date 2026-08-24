mod api;
mod commands;
mod desktop_runtime;
mod download_engine;
mod file_transfer;
mod session;
mod settings_transfer;
mod sync_engine;
mod sync_validation;
mod updater_runtime;
mod upload_engine;
mod upload_transfer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop_runtime::show_main_window(app);
        }));
    }

    builder = builder
        .manage(api::ApiState::default())
        .manage(desktop_runtime::DesktopRuntimeState::default())
        .manage(download_engine::DownloadEngineState::default())
        .manage(sync_engine::SyncEngineState::default())
        .manage(upload_engine::UploadEngineState::default())
        .manage(upload_transfer::UploadTransferState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--hidden"]),
            ))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .setup(|app| {
            desktop_runtime::setup(app)?;
            sync_engine::start_scheduler(app.handle().clone());
            Ok(())
        })
        .on_window_event(desktop_runtime::handle_window_event)
        .register_asynchronous_uri_scheme_protocol("discloud", |context, request, responder| {
            file_transfer::respond_file_protocol(context.app_handle().clone(), request, responder);
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            commands::connect_server,
            commands::disconnect_server,
            commands::download_file,
            commands::get_download_snapshot,
            commands::start_download,
            commands::retry_download_task,
            commands::cancel_download_task,
            commands::remove_download_task,
            commands::reveal_download_task,
            commands::get_upload_snapshot,
            commands::add_upload_paths,
            commands::retry_upload_task,
            commands::cancel_upload_task,
            commands::remove_upload_task,
            commands::update_avatar,
            commands::load_avatar,
            commands::save_recovery_codes,
            desktop_runtime::set_close_to_tray,
            sync_engine::run_sync_pair,
            sync_engine::clear_sync_pair_state,
            sync_engine::configure_sync_pairs,
            sync_validation::validate_sync_pairs,
            updater_runtime::check_for_update,
            updater_runtime::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DisCloud");
}
