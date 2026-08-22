mod api;
mod commands;
mod desktop_runtime;
mod file_transfer;
mod session;
mod settings_transfer;
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
        .manage(upload_transfer::UploadTransferState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ));
    }

    builder
        .setup(|app| {
            desktop_runtime::setup(app)?;
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
            commands::inspect_upload_files,
            commands::begin_upload_task,
            commands::cancel_upload_task,
            commands::finish_upload_task,
            commands::upload_file_part,
            commands::update_avatar,
            commands::load_avatar,
            commands::save_recovery_codes,
            desktop_runtime::set_close_to_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DisCloud");
}
