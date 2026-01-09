use serde::Serialize;
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use std::time::Duration;
#[cfg(target_os = "windows")]
use tauri::{Emitter, Manager};

pub const EVT_GLOBAL_CURSOR_GAZE: &str = "global-cursor-gaze";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorGazePayload {
    /// Normalized gaze direction X (left=-1 .. right=+1).
    pub x: f32,
    /// Normalized gaze direction Y (down=-1 .. up=+1).
    pub y: f32,
}

pub fn spawn_global_cursor_gaze_emitter(app: AppHandle) {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return;
    }

    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn(async move {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        log::info!(
            "Cursor gaze emitter started (event={}, rate≈30Hz)",
            EVT_GLOBAL_CURSOR_GAZE
        );

        let mut ticker = tokio::time::interval(Duration::from_millis(33));
        let mut last_pos: Option<(i32, i32)> = None;

        loop {
            ticker.tick().await;

            let (cursor_x, cursor_y) = {
                let mut pt = POINT::default();
                if unsafe { GetCursorPos(&mut pt) }.is_err() {
                    continue;
                }
                (pt.x, pt.y)
            };

            if last_pos == Some((cursor_x, cursor_y)) {
                continue;
            }
            last_pos = Some((cursor_x, cursor_y));

            let Some(window) = app.get_webview_window("main") else {
                continue;
            };

            let Ok(pos) = window.outer_position() else {
                continue;
            };
            let Ok(size) = window.outer_size() else {
                continue;
            };

            let center_x = pos.x + (size.width as i32 / 2);
            let center_y = pos.y + (size.height as i32 / 2);

            let dx = cursor_x - center_x;
            let dy = cursor_y - center_y;

            let scale_x = (size.width as f32).max(1.0) * 0.6;
            let scale_y = (size.height as f32).max(1.0) * 0.7;

            let x = (dx as f32 / scale_x).clamp(-1.0, 1.0);
            let y = (-(dy as f32) / scale_y).clamp(-1.0, 1.0);

            let _ = app.emit(EVT_GLOBAL_CURSOR_GAZE, CursorGazePayload { x, y });
        }
    });
}
