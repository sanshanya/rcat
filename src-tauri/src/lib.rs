use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use tauri::{
    Emitter,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use serde::{Deserialize, Serialize};

// ✅ 窗口模式枚举 (FSM)
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
            WindowMode::Input => (MIN_INPUT_W, INPUT_H),
            WindowMode::Result => (400.0, 500.0),
        }
    }
}

// ✅ 输入态动态宽度常量
const MIN_INPUT_W: f64 = 220.0;
const MAX_INPUT_W: f64 = 8000.0; // Effectively unlimited, constrained by monitor width logic below
const INPUT_H: f64 = 140.0;
const EDGE_MARGIN: f64 = 12.0;

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
                let _ = window.set_position(tauri::Position::Logical(
                    tauri::LogicalPosition { x: new_x, y: p.y as f64 / scale }
                ));
            }
            
            // 最终宽度仍然受 max 限制
            clamped.min(monitor_width - 2.0 * EDGE_MARGIN)
        } else {
            clamped
        };
        
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { 
            width: final_width, 
            height: INPUT_H 
        }));
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
            let _ = window.set_position(tauri::Position::Logical(
                tauri::LogicalPosition { x: new_x, y: new_y }
            ));
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
        .invoke_handler(tauri::generate_handler![set_window_mode, resize_input_width, resize_window, get_drag_constraints])
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
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