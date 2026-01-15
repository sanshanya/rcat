use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::window_state::WindowStateStore;
use crate::WindowMode;

pub const EVT_CAPSULE_OPENED: &str = "capsule-opened";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleOpenedPayload {
    pub tab: String,
}

#[derive(Debug, Clone)]
pub struct OpenCapsuleParams {
    pub tab: String,
    pub anchor_x: i32,
    pub anchor_y: i32,
}

#[cfg(target_os = "windows")]
fn position_capsule_near_anchor(window: &tauri::WebviewWindow, anchor_x: i32, anchor_y: i32) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITOR_DEFAULTTONEAREST, MONITORINFO,
    };

    let size = window
        .outer_size()
        .or_else(|_| window.inner_size())
        .unwrap_or(tauri::PhysicalSize { width: 64, height: 64 });

    let anchor = POINT {
        x: anchor_x,
        y: anchor_y,
    };
    let monitor = unsafe { MonitorFromPoint(anchor, MONITOR_DEFAULTTONEAREST) };

    let mut info = MONITORINFO::default();
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    let work_rect = if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        info.rcWork
    } else {
        info.rcMonitor
    };

    let padding = 12;
    let mut x = anchor_x + padding;
    let mut y = anchor_y + padding;

    let min_x = work_rect.left;
    let max_x = (work_rect.right - size.width as i32).max(min_x);
    let min_y = work_rect.top;
    let max_y = (work_rect.bottom - size.height as i32).max(min_y);

    // If it doesn't fit on the right, flip to the left.
    if x > max_x {
        x = anchor_x - size.width as i32 - padding;
    }
    x = x.clamp(min_x, max_x);
    y = y.clamp(min_y, max_y);

    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
}

fn show_capsule(app: &AppHandle, window: &tauri::WebviewWindow, params: &OpenCapsuleParams) {
    // Always open as the capsule (mini) first. The user can click to expand and take focus.
    crate::set_window_mode(
        app.clone(),
        app.state::<WindowStateStore>(),
        WindowMode::Mini,
    );

    // Ensure it's visible before sizing/positioning.
    let _ = window.show();
    let _ = window.set_always_on_top(true);

    #[cfg(target_os = "windows")]
    {
        position_capsule_near_anchor(window, params.anchor_x, params.anchor_y);
    }

    let _ = window.emit(
        EVT_CAPSULE_OPENED,
        CapsuleOpenedPayload {
            tab: params.tab.clone(),
        },
    );

    if let Some(avatar) = app.get_webview_window("avatar") {
        let _ = avatar.emit(crate::EVT_VRM_STATE_REQUEST, ());
    }
}

pub fn open_capsule(app: &AppHandle, params: OpenCapsuleParams) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("panel"))
        .ok_or(tauri::Error::WindowNotFound)?;

    show_capsule(app, &window, &params);
    Ok(())
}

/// Toggle the capsule window:
/// - if visible: hide
/// - if hidden: show as `WindowMode::Mini` (胶囊态) near the anchor
pub fn toggle_capsule(app: &AppHandle, params: OpenCapsuleParams) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("panel"))
        .ok_or(tauri::Error::WindowNotFound)?;

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return Ok(());
    }

    show_capsule(app, &window, &params);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn spawn_panel_auto_dismiss(_app: &tauri::AppHandle) {
    // no-op
}

/// Windows-only: hide the panel when the user clicks outside it.
///
/// NOTE: This used to be implemented as a 33ms polling loop (checking VK_LBUTTON + WindowFromPoint).
/// It is now handled by the global `WH_MOUSE_LL` hook in `windows::avatar_window`, so we don't need
/// a separate ticker here.
#[cfg(target_os = "windows")]
pub fn spawn_panel_auto_dismiss(app: &tauri::AppHandle) {
    log::info!("Panel auto-dismiss: handled by global mouse hook");
}
