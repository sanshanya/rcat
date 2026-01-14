use serde::Deserialize;
use tauri::Manager;

use crate::windows::panel_window::{open_capsule as open_capsule_window, OpenCapsuleParams};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCapsuleArgs {
    pub tab: Option<String>,
    pub anchor_x: i32,
    pub anchor_y: i32,
}

#[tauri::command]
pub fn open_capsule(
    app: tauri::AppHandle,
    args: OpenCapsuleArgs,
) -> Result<(), String> {
    let tab = args.tab.unwrap_or_else(|| "chat".to_string());
    open_capsule_window(
        &app,
        OpenCapsuleParams {
            tab,
            anchor_x: args.anchor_x,
            anchor_y: args.anchor_y,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_capsule(
    app: tauri::AppHandle,
    reason: Option<String>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("panel"))
        .ok_or_else(|| "WindowNotFound".to_string())?;
    let reason = reason.unwrap_or_else(|| "unknown".to_string());

    // Fast path: if it's already hidden, do nothing.
    if let Ok(visible) = window.is_visible() {
        if !visible {
            return Ok(());
        }
    }

    // On Windows, interacting with the window chrome (drag/resize) can temporarily emit a blur
    // event even though the window is still the foreground window. Only dismiss on blur when
    // the panel is truly no longer foreground.
    #[cfg(target_os = "windows")]
    {
        if reason == "blur" {
            use windows::Win32::UI::WindowsAndMessaging::{
                GetAncestor, GetForegroundWindow, GA_ROOT, GA_ROOTOWNER,
            };
            if let Ok(hwnd) = window.hwnd() {
                let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
                let root = if !root.0.is_null() { root } else { hwnd };
                let root_owner = unsafe { GetAncestor(root, GA_ROOTOWNER) };
                let root_owner = if !root_owner.0.is_null() { root_owner } else { root };
                let fg = unsafe { GetForegroundWindow() };
                if !fg.0.is_null() {
                    let fg_root_owner = unsafe { GetAncestor(fg, GA_ROOTOWNER) };
                    let fg_root_owner = if !fg_root_owner.0.is_null() {
                        fg_root_owner
                    } else {
                        fg
                    };

                    // If the foreground window is the panel itself OR a panel-owned popup
                    // (dropdowns, dialogs), ignore the blur.
                    if fg == root || fg_root_owner == root_owner {
                        log::debug!(
                            "dismiss_capsule: ignored blur (still foreground; label={})",
                            window.label()
                        );
                        return Ok(());
                    }
                }
            }
        }
    }

    log::debug!(
        "dismiss_capsule: hiding panel window (label={}, reason={})",
        window.label(),
        reason
    );
    let _ = window.hide();
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugUpdatePanelTitleArgs {
    pub tab: String,
    pub window_mode: Option<String>,
}

#[tauri::command]
pub fn debug_update_panel_title(
    app: tauri::AppHandle,
    args: DebugUpdatePanelTitleArgs,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Ok(());
    }

    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("panel"))
        .ok_or_else(|| "WindowNotFound".to_string())?;

    let tab = args.tab.trim();
    let mode = args.window_mode.unwrap_or_default();
    let mode = mode.trim();

    let mut title = if tab.is_empty() {
        "rcat-panel".to_string()
    } else {
        format!("rcat-panel · {tab}")
    };
    if !mode.is_empty() {
        title.push_str(" · ");
        title.push_str(mode);
    }

    let _ = window.set_title(&title);
    Ok(())
}
