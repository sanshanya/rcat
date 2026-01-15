use serde::Deserialize;
use tauri::Manager;

use crate::windows::panel_window::{
    open_capsule as open_capsule_window, toggle_capsule as toggle_capsule_window, OpenCapsuleParams,
};

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
pub fn toggle_capsule(
    app: tauri::AppHandle,
    args: OpenCapsuleArgs,
) -> Result<(), String> {
    let tab = args.tab.unwrap_or_else(|| "chat".to_string());
    toggle_capsule_window(
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

    #[cfg(target_os = "windows")]
    {
        if reason == "blur" {
            // Blur/focus events can "bounce" on Windows due to focus-stealing rules and window
            // chrome interactions. Mini-mode dismissal is handled by the global mouse hook
            // (outside-click), so treat blur as a no-op to avoid flaky auto-hide.
            return Ok(());
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
