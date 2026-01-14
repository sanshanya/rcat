use tauri::{AppHandle, Emitter, Manager};

use crate::{EVT_VRM_COMMAND, EVT_VRM_STATE_SNAPSHOT};

#[tauri::command]
pub fn vrm_command(app: AppHandle, payload: serde_json::Value) -> Result<(), String> {
    let Some(window) = app.get_webview_window("avatar") else {
        return Ok(());
    };
    window
        .emit(EVT_VRM_COMMAND, payload)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn vrm_state_snapshot(app: AppHandle, snapshot: serde_json::Value) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window
        .emit(EVT_VRM_STATE_SNAPSHOT, snapshot)
        .map_err(|e| e.to_string())?;
    Ok(())
}

