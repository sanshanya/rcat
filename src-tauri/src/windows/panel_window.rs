use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

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

    // Best effort: focus for input.
    let _ = window.set_focus();

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
