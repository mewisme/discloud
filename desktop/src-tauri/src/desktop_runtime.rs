use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Manager, Runtime, State, Window, WindowEvent,
};

pub(crate) struct DesktopRuntimeState {
    close_to_tray: AtomicBool,
}

impl Default for DesktopRuntimeState {
    fn default() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
        }
    }
}

impl DesktopRuntimeState {
    fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }

    fn set_close_to_tray(&self, enabled: bool) {
        self.close_to_tray.store(enabled, Ordering::Relaxed);
    }
}

#[tauri::command]
pub(crate) fn set_close_to_tray(state: State<'_, DesktopRuntimeState>, enabled: bool) {
    state.set_close_to_tray(enabled);
}

pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show DisCloud", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide DisCloud", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("DisCloud")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;

    if std::env::args().any(|argument| argument == "--hidden") {
        hide_main_window(app.handle());
    }

    Ok(())
}

pub(crate) fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        let state = window.app_handle().state::<DesktopRuntimeState>();

        if state.close_to_tray() {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}
