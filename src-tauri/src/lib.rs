use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

pub mod services;

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[cfg_attr(feature = "typegen", specta(rename_all = "lowercase"))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowMode {
    Mini,   // 胶囊态
    Input,  // 输入态
    Result, // 结果态 (固定大小，内部滚动)
}

impl WindowMode {
    pub fn get_size(&self) -> (f64, f64) {
        match self {
            WindowMode::Mini => (220.0, 80.0),
            WindowMode::Input => (MIN_INPUT_W, INPUT_H_COLLAPSED),
            WindowMode::Result => (400.0, 500.0),
        }
    }
}

// ✅ 输入态动态宽度常量
const MIN_INPUT_W: f64 = 380.0;
const MAX_INPUT_W: f64 = 8000.0; // Effectively unlimited, constrained by monitor width logic below
// Default input window height (compact; avoids blocking clicks behind)
const INPUT_H_COLLAPSED: f64 = 220.0;
// Expanded input window height (used temporarily for menus like model Select)
const INPUT_H_EXPANDED: f64 = 380.0;
const EDGE_MARGIN: f64 = 12.0;

fn get_current_logical_size(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let size = window.inner_size().ok()?;
    let scale = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    Some((size.width as f64 / scale, size.height as f64 / scale))
}

// ✅ 窗口模式切换命令
#[tauri::command]
fn set_window_mode(app: tauri::AppHandle, mode: WindowMode) {
    if let Some(window) = app.get_webview_window("main") {
        let (width, height) = mode.get_size();
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
    }
}

// ✅ 输入态动态宽度调整 (带屏幕边界约束)
#[tauri::command]
fn resize_input_width(app: tauri::AppHandle, desired_width: f64) {
    if let Some(window) = app.get_webview_window("main") {
        // 1. 先 clamp 到 min/max
        let clamped = desired_width.clamp(MIN_INPUT_W, MAX_INPUT_W);

        // Preserve current height to avoid resetting dynamic input height.
        let current_h = get_current_logical_size(&window)
            .map(|(_, h)| h)
            .unwrap_or(INPUT_H_COLLAPSED)
            .max(INPUT_H_COLLAPSED);

        // 2. 获取窗口位置和显示器信息
        let pos = window.outer_position().ok();
        let monitor = window.current_monitor().ok().flatten();

        let final_width = if let (Some(p), Some(m)) = (pos, monitor) {
            let scale = m.scale_factor();
            let monitor_width = m.size().width as f64 / scale;
            let window_x = p.x as f64 / scale;

            // 3. 计算右侧剩余空间
            let space_right = monitor_width - window_x - EDGE_MARGIN;

            // 4. 如果会溢出，考虑左移窗口
            if clamped > space_right {
                let new_x = (monitor_width - clamped - EDGE_MARGIN).max(EDGE_MARGIN);
                let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                    x: new_x,
                    y: p.y as f64 / scale,
                }));
            }

            // 最终宽度仍然受 max 限制
            let max_w = (monitor_width - 2.0 * EDGE_MARGIN).max(100.0);
            clamped.min(max_w)
        } else {
            clamped
        };

        safe_resize(&window, final_width, current_h);
    }
}

/// ✅ 输入态动态高度调整（用于临时展开以展示下拉菜单等）
#[tauri::command]
fn resize_input_height(app: tauri::AppHandle, desired_height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let (current_w, _) =
            get_current_logical_size(&window).unwrap_or((MIN_INPUT_W, INPUT_H_COLLAPSED));

        let monitor = window.current_monitor().ok().flatten();

        // Clamp height to monitor bounds (with margins) when possible.
        let clamped_h = if let Some(m) = monitor {
            let scale = m.scale_factor();
            let monitor_height = m.size().height as f64 / scale;
            let max_h = (monitor_height - 2.0 * EDGE_MARGIN).max(100.0);
            desired_height
                .clamp(INPUT_H_COLLAPSED, INPUT_H_EXPANDED)
                .min(max_h)
        } else {
            desired_height.clamp(INPUT_H_COLLAPSED, INPUT_H_EXPANDED)
        };

        // Keep width stable (respect current/auto-resized width).
        let final_w = current_w.max(MIN_INPUT_W);
        safe_resize(&window, final_w, clamped_h);
    }
}

/// Helper function: Safely resize window with screen edge constraints.
/// Shifts window position if it would extend beyond monitor bounds.
fn safe_resize(window: &tauri::WebviewWindow, width: f64, height: f64) {
    let pos = window.outer_position().ok();
    let monitor = window.current_monitor().ok().flatten();

    if let (Some(p), Some(m)) = (pos, monitor) {
        let scale = m.scale_factor();
        let monitor_width = m.size().width as f64 / scale;
        let monitor_height = m.size().height as f64 / scale;
        let window_x = p.x as f64 / scale;
        let window_y = p.y as f64 / scale;

        let mut new_x = window_x;
        let mut new_y = window_y;

        // Check right edge
        let space_right = monitor_width - window_x - EDGE_MARGIN;
        if width > space_right {
            new_x = (monitor_width - width - EDGE_MARGIN).max(EDGE_MARGIN);
        }

        // Check bottom edge
        let space_bottom = monitor_height - window_y - EDGE_MARGIN;
        if height > space_bottom {
            new_y = (monitor_height - height - EDGE_MARGIN).max(EDGE_MARGIN);
        }

        // Shift position if needed
        if new_x != window_x || new_y != window_y {
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x: new_x,
                y: new_y,
            }));
        }
    }

    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
}

// ✅ 通用手动重设大小
#[tauri::command]
fn resize_window(app: tauri::AppHandle, width: f64, height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        safe_resize(&window, width, height);
    }
}

#[tauri::command]
fn get_drag_constraints(app: tauri::AppHandle) -> (f64, f64) {
    if let Some(window) = app.get_webview_window("main") {
        if let (Ok(pos), Ok(Some(monitor))) = (window.outer_position(), window.current_monitor()) {
            let scale = monitor.scale_factor();
            let m_size = monitor.size();

            // Calculate remaining space in logical pixels
            let max_w = (m_size.width as f64 - pos.x as f64) / scale;
            let max_h = (m_size.height as f64 - pos.y as f64) / scale;

            return (max_w.max(100.0), max_h.max(100.0));
        }
    }
    (8000.0, 8000.0)
}

const EVT_CLICK_THROUGH_STATE: &str = "click-through-state";

pub fn run() {
    tauri::Builder::default()
        .manage(services::ai::AiStreamManager::default())
        .invoke_handler(tauri::generate_handler![
            set_window_mode,
            resize_input_width,
            resize_input_height,
            resize_window,
            get_drag_constraints,
            services::ai::chat_stream,
            services::ai::chat_abort,
            services::ai::chat_simple,
            services::ai::get_ai_public_config,
            services::ai::chat_stream_with_tools,
            // Vision commands
            services::vision::capture_screen_text,
            services::vision::analyze_screen_vlm,
            services::vision::list_capturable_windows,
            services::vision::get_smart_window,
            services::vision::capture_smart
        ])
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// TODO: Refactor tray state management into a dedicated TrayState struct
// when tray logic grows more complex (e.g., more menu items, dynamic state).
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let click_through = CheckMenuItem::with_id(
        app,
        "click_through",
        "点击穿透 (只看不用)",
        true,
        false,
        None::<&str>,
    )?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&click_through, &sep, &quit_i])?;
    let icon = app.default_window_icon().cloned();

    let click_through_for_menu = click_through.clone();
    let click_through_for_tray = click_through.clone();
    let is_through = Arc::new(AtomicBool::new(false));

    let is_through_menu = is_through.clone();
    let is_through_tray = is_through.clone();

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();

            if id == "quit" {
                app.exit(0);
                return;
            }

            if id == "click_through" {
                let current = is_through_menu.load(Ordering::SeqCst);
                let new_state = !current;
                is_through_menu.store(new_state, Ordering::SeqCst);

                let _ = click_through_for_menu.set_checked(new_state);

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_ignore_cursor_events(new_state);
                    let _ = window.set_focusable(!new_state);

                    // ✅ 2. 使用常量发送事件
                    let _ = window.emit(EVT_CLICK_THROUGH_STATE, new_state);
                }
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.is_visible().and_then(|is_visible| {
                        if is_visible {
                            window.hide()?;
                        } else {
                            window.show()?;
                            window.set_focus()?;

                            let saved_state = is_through_tray.load(Ordering::SeqCst);

                            let _ = click_through_for_tray.set_checked(saved_state);
                            let _ = window.set_ignore_cursor_events(saved_state);
                            let _ = window.set_focusable(!saved_state);

                            // ✅ 3. 使用常量发送事件
                            let _ = window.emit(EVT_CLICK_THROUGH_STATE, saved_state);
                        }
                        Ok(())
                    });
                }
            }
        });

    if let Some(i) = icon {
        builder = builder.icon(i);
    }

    builder.build(app)?;
    Ok(())
}
