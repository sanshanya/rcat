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

pub fn open_capsule(app: &AppHandle, params: OpenCapsuleParams) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("panel"))
        .ok_or(tauri::Error::WindowNotFound)?;

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
        use windows::Win32::Foundation::POINT;
        use windows::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromPoint, MONITOR_DEFAULTTONEAREST, MONITORINFO,
        };

        let size = window
            .outer_size()
            .or_else(|_| window.inner_size())
            .unwrap_or(tauri::PhysicalSize {
                width: 420,
                height: 340,
            });

        let anchor = POINT {
            x: params.anchor_x,
            y: params.anchor_y,
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
        let mut x = params.anchor_x + padding;
        let mut y = params.anchor_y + padding;

        let min_x = work_rect.left;
        let max_x = (work_rect.right - size.width as i32).max(min_x);
        let min_y = work_rect.top;
        let max_y = (work_rect.bottom - size.height as i32).max(min_y);

        // If it doesn't fit on the right, flip to the left.
        if x > max_x {
            x = params.anchor_x - size.width as i32 - padding;
        }
        x = x.clamp(min_x, max_x);
        y = y.clamp(min_y, max_y);

        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
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

    // Ensure backend mode constraints/sizing are applied before showing.
    crate::set_window_mode(
        app.clone(),
        app.state::<WindowStateStore>(),
        WindowMode::Mini,
    );

    let _ = window.show();
    let _ = window.set_always_on_top(true);

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromPoint, MONITOR_DEFAULTTONEAREST, MONITORINFO,
        };

        let size = window
            .outer_size()
            .or_else(|_| window.inner_size())
            .unwrap_or(tauri::PhysicalSize { width: 64, height: 64 });

        let anchor = POINT {
            x: params.anchor_x,
            y: params.anchor_y,
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
        let mut x = params.anchor_x + padding;
        let mut y = params.anchor_y + padding;

        let min_x = work_rect.left;
        let max_x = (work_rect.right - size.width as i32).max(min_x);
        let min_y = work_rect.top;
        let max_y = (work_rect.bottom - size.height as i32).max(min_y);

        // If it doesn't fit on the right, flip to the left.
        if x > max_x {
            x = params.anchor_x - size.width as i32 - padding;
        }
        x = x.clamp(min_x, max_x);
        y = y.clamp(min_y, max_y);

        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
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
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn spawn_panel_auto_dismiss(_app: &tauri::AppHandle) {
    // no-op
}

/// Windows-only: hide the panel when the user clicks outside it.
///
/// We cannot rely solely on focus/blur events because the AvatarWindow is non-activating
/// (MA_NOACTIVATE), so the panel may fail to become foreground due to focus-stealing rules.
/// Instead, we watch global left-clicks and dismiss when the click lands outside the panel.
#[cfg(target_os = "windows")]
pub fn spawn_panel_auto_dismiss(app: &tauri::AppHandle) {
    use std::time::Duration;

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetCursorPos, WindowFromPoint, GA_ROOT, GA_ROOTOWNER,
        };

        let mut ticker = tokio::time::interval(Duration::from_millis(33));
        let mut last_down = false;

        log::info!("Panel auto-dismiss started (outside left-click)");

        loop {
            ticker.tick().await;

            let Some(panel) = app
                .get_webview_window("main")
                .or_else(|| app.get_webview_window("panel"))
            else {
                continue;
            };

            let mode = app.state::<WindowStateStore>().get_current_mode();
            // Only auto-hide in capsule (mini) mode; expanded panel is "pinned" until manually closed.
            if !matches!(mode, WindowMode::Mini) {
                last_down = false;
                continue;
            }

            let Ok(visible) = panel.is_visible() else {
                continue;
            };
            if !visible {
                last_down = false;
                continue;
            }

            let down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;
            if down && !last_down {
                let mut pt = POINT::default();
                if unsafe { GetCursorPos(&mut pt) }.is_ok() {
                    let clicked = unsafe { WindowFromPoint(pt) };
                    if let Ok(panel_hwnd) = panel.hwnd() {
                        let panel_root = unsafe { GetAncestor(panel_hwnd, GA_ROOT) };
                        let panel_root = if !panel_root.0.is_null() {
                            panel_root
                        } else {
                            panel_hwnd
                        };

                        // Many WebView2/UI popups (e.g. <select> dropdowns, file dialogs) are
                        // separate top-level windows owned by the panel. GA_ROOT would treat them
                        // as "outside", so use GA_ROOTOWNER to keep them associated with the panel.
                        let panel_root_owner = unsafe { GetAncestor(panel_root, GA_ROOTOWNER) };
                        let panel_root_owner = if !panel_root_owner.0.is_null() {
                            panel_root_owner
                        } else {
                            panel_root
                        };

                        let click_root = if !clicked.0.is_null() {
                            unsafe { GetAncestor(clicked, GA_ROOT) }
                        } else {
                            clicked
                        };
                        let click_root = if !click_root.0.is_null() {
                            click_root
                        } else {
                            clicked
                        };

                        let click_root_owner = if !clicked.0.is_null() {
                            unsafe { GetAncestor(clicked, GA_ROOTOWNER) }
                        } else {
                            clicked
                        };
                        let click_root_owner = if !click_root_owner.0.is_null() {
                            click_root_owner
                        } else {
                            clicked
                        };

                        let is_inside_panel = !clicked.0.is_null()
                            && (click_root == panel_root
                                || click_root_owner == panel_root
                                || click_root_owner == panel_root_owner);

                        if !is_inside_panel {
                            let _ = panel.hide();
                            log::debug!(
                                "Panel auto-dismiss: hide on outside click (mode={:?}, clicked={:?}, click_root={:?}, click_root_owner={:?}, panel_root={:?}, panel_root_owner={:?})",
                                mode,
                                clicked,
                                click_root,
                                click_root_owner,
                                panel_root,
                                panel_root_owner
                            );
                        }
                    }
                }
            }
            last_down = down;
        }
    });
}
