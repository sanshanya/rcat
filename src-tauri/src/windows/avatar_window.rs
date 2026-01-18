#[cfg(not(target_os = "windows"))]
pub fn install_avatar_subclass(
    _window: &tauri::WebviewWindow,
) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn remove_avatar_subclass(_window: &tauri::Window) {
    // no-op
}

#[cfg(not(target_os = "windows"))]
pub fn start_avatar_windows_service(_app: &tauri::AppHandle) {
    // no-op
}

#[cfg(not(target_os = "windows"))]
pub fn stop_avatar_windows_service() {
    // no-op
}

#[cfg(target_os = "windows")]
mod service;
#[cfg(target_os = "windows")]
mod subclass;

#[cfg(target_os = "windows")]
pub use service::{set_panel_root_hwnd, start_avatar_windows_service, stop_avatar_windows_service};
#[cfg(target_os = "windows")]
pub use subclass::{install_avatar_subclass, remove_avatar_subclass};

#[cfg(target_os = "windows")]
pub fn ensure_avatar_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("avatar") {
        return Ok(window);
    }

    let debug_show_title = cfg!(debug_assertions);
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "avatar",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("rcat-avatar")
    .inner_size(520.0, 780.0)
    .resizable(false)
    .transparent(true)
    .decorations(debug_show_title)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true);

    let window = builder.build()?;
    let _ = window.set_focusable(false);
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    Ok(window)
}
