use tauri::{AppHandle, Emitter, Manager};

use crate::{EVT_VRM_COMMAND, EVT_VRM_STATE_SNAPSHOT};
use crate::commands::vrm_types::{VrmCommandPayload, VrmStateSnapshot};

#[tauri::command]
pub fn vrm_command(app: AppHandle, payload: VrmCommandPayload) -> Result<(), String> {
    let Some(window) = app.get_webview_window("avatar") else {
        return Ok(());
    };
    window
        .emit(EVT_VRM_COMMAND, payload)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn vrm_state_snapshot(app: AppHandle, snapshot: VrmStateSnapshot) -> Result<(), String> {
    let Some(window) = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("panel"))
    else {
        return Ok(());
    };
    window
        .emit(EVT_VRM_STATE_SNAPSHOT, snapshot)
        .map_err(|e| e.to_string())?;
    Ok(())
}
