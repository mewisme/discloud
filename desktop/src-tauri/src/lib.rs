use tauri_plugin_fs::FsExt;

mod api;
mod commands;
mod diagnostics;
mod path_security;
mod runtime;
mod settings;
mod sync;
mod thumbnails;
mod transfers;
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            runtime::desktop::show_main_window(app);
        }));
    }

    builder = builder
        .manage(api::ApiState::default())
        .manage(thumbnails::ThumbnailState::default())
        .manage(runtime::desktop::DesktopRuntimeState::default())
        .manage(transfers::download::DownloadEngineState::default())
        .manage(sync::engine::SyncEngineState::default())
        .manage(sync::grants::SyncRootSelectionState::default())
        .manage(transfers::upload::engine::UploadEngineState::default())
        .manage(transfers::upload::transfer::UploadTransferState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--hidden"]),
            ))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            diagnostics::setup(app.handle());
            thumbnails::setup(app.handle());
            runtime::desktop::setup(app)?;
            sync::engine::start_scheduler(app.handle().clone());
            Ok(())
        })
        .on_window_event(runtime::desktop::handle_window_event)
        .on_webview_event(|webview, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let scope = webview.fs_scope();
                for path in paths {
                    if path.is_file() {
                        let _ = scope.allow_file(path);
                    } else if path.is_dir() {
                        let _ = scope.allow_directory(path, true);
                    }
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("discloud", |context, request, responder| {
            transfers::file::respond_file_protocol(
                context.app_handle().clone(),
                request,
                responder,
            );
        })
        .register_asynchronous_uri_scheme_protocol(
            "discloud-thumbnail",
            |context, request, responder| {
                thumbnails::respond_protocol(context.app_handle().clone(), request, responder);
            },
        )
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            diagnostics::get_desktop_diagnostics,
            diagnostics::export_desktop_logs,
            diagnostics::clear_desktop_logs,
            diagnostics::open_desktop_log_folder,
            commands::connect_server,
            commands::disconnect_server,
            commands::download_file,
            commands::download_folder,
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
            runtime::desktop::set_close_to_tray,
            sync::engine::run_sync_pair,
            sync::engine::list_sync_conflicts,
            sync::engine::resolve_sync_conflict,
            sync::engine::open_sync_local_path,
            sync::engine::clear_sync_pair_state,
            sync::engine::configure_sync_pairs,
            sync::grants::pick_sync_folder,
            sync::grants::revoke_sync_pair_authorization,
            sync::validation::validate_sync_pairs,
            updater::check_for_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DisCloud");
}
