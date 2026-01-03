use serde::{Deserialize, Serialize};
use tauri::Manager;

mod plugins;
pub mod services;
mod tray;
mod window_state;

use window_state::WindowStateStore;

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
    pub(crate) fn as_u8(self) -> u8 {
        match self {
            WindowMode::Mini => 0,
            WindowMode::Input => 1,
            WindowMode::Result => 2,
        }
    }

    pub(crate) fn from_u8(value: u8) -> Self {
        match value {
            1 => WindowMode::Input,
            2 => WindowMode::Result,
            _ => WindowMode::Mini,
        }
    }

    pub fn get_size(&self) -> (f64, f64) {
        match self {
            // Mini mode is an unobtrusive launcher; frontend will auto-fit precisely.
            WindowMode::Mini => (64.0, 64.0),
            WindowMode::Input => (MIN_INPUT_W, INPUT_H_COLLAPSED),
            WindowMode::Result => (400.0, 500.0),
        }
    }
}

// Input mode minimum width (used for Rust-side constraints and persistence)
pub(crate) const MIN_INPUT_W: f64 = 380.0;
// Default input window height (compact; avoids blocking clicks behind)
const INPUT_H_COLLAPSED: f64 = 220.0;
pub(crate) const EDGE_MARGIN: f64 = 12.0;

// ✅ 窗口模式切换命令
#[tauri::command]
fn set_window_mode(
    app: tauri::AppHandle,
    window_state: tauri::State<WindowStateStore>,
    mode: WindowMode,
) {
    window_state.set_current_mode(mode);
    if let Some(window) = app.get_webview_window("main") {
        let (mut width, mut height) = mode.get_size();
        match mode {
            WindowMode::Input => {
                if let Some(saved) = window_state.get_input_width() {
                    width = saved.max(MIN_INPUT_W);
                }
            }
            WindowMode::Result => {
                if let Some(saved) = window_state.get_result_size() {
                    width = saved.w.max(MIN_INPUT_W);
                    height = saved.h.max(1.0);
                }
            }
            WindowMode::Mini => {}
        }

        let min_size = match mode {
            WindowMode::Mini => (width, height),
            WindowMode::Input => (MIN_INPUT_W, 1.0),
            WindowMode::Result => (MIN_INPUT_W, 1.0),
        };

        // Decorations are controlled by tauri.conf.json; we don't toggle them at runtime.
        let _ = window.set_resizable(!matches!(mode, WindowMode::Mini));
        let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
            width: min_size.0,
            height: min_size.1,
        })));
        safe_resize(&window, width, height);
    }
}

/// ✅ 输入态动态高度调整（用于临时展开以展示下拉菜单等）
#[tauri::command]
fn resize_input_height(app: tauri::AppHandle, desired_height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        if !desired_height.is_finite() {
            return;
        }

        let (current_w, _) = window_state::get_current_logical_size(&window)
            .unwrap_or((MIN_INPUT_W, INPUT_H_COLLAPSED));

        let monitor = window.current_monitor().ok().flatten();

        // Clamp height to monitor bounds (with margins) when possible.
        let desired_height = desired_height.max(1.0);
        let clamped_h = if let Some(m) = monitor {
            let scale = m.scale_factor();
            let monitor_height = m.size().height as f64 / scale;
            let max_h = (monitor_height - 2.0 * EDGE_MARGIN).max(100.0);
            desired_height.min(max_h)
        } else {
            desired_height
        };

        // Keep width stable (respect current/auto-resized width).
        let final_w = current_w.max(MIN_INPUT_W);
        safe_resize(&window, final_w, clamped_h);
    }
}

/// Helper function: Resize window with screen edge constraints.
/// Clamps the size to fit within the virtual desktop without moving the window.
fn safe_resize(window: &tauri::WebviewWindow, width: f64, height: f64) {
    let pos = window.outer_position().ok();

    let scale = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    // Keep the window inside the virtual desktop bounds (all monitors combined),
    // but preserve its position to avoid "jumping" when auto-fitting content.
    let bounds = window_state::get_virtual_monitor_bounds(window);

    if let (Some(p), Some((_virtual_left, _virtual_top, virtual_right, virtual_bottom))) =
        (pos, bounds)
    {
        let margin = EDGE_MARGIN * scale;

        // Compute the maximum size we can fit to the right/bottom, without moving the window.
        let max_w = (virtual_right - margin - p.x as f64).max(1.0);
        let max_h = (virtual_bottom - margin - p.y as f64).max(1.0);

        let target_w = (width * scale).clamp(1.0, max_w).round();
        let target_h = (height * scale).clamp(1.0, max_h).round();

        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: target_w.clamp(1.0, u32::MAX as f64) as u32,
            height: target_h.clamp(1.0, u32::MAX as f64) as u32,
        }));
        return;
    }

    // Fallback: if we can't get monitor/position, resize in logical pixels.
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
fn set_window_min_size(app: tauri::AppHandle, min_width: f64, min_height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let width = if min_width.is_finite() && min_width > 0.0 {
            Some(min_width.max(1.0))
        } else {
            None
        };
        let height = if min_height.is_finite() && min_height > 0.0 {
            Some(min_height.max(1.0))
        } else {
            None
        };

        if width.is_none() && height.is_none() {
            return;
        }

        // When width is omitted by the frontend, keep input's minimum width in Rust as the
        // single source of truth to avoid constant drift between Rust and TS.
        let width = width.unwrap_or(MIN_INPUT_W);
        let height = height.unwrap_or(1.0);

        let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
            width,
            height,
        })));
    }
}

pub(crate) const EVT_CLICK_THROUGH_STATE: &str = "click-through-state";

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                // Keep dependencies quiet by default; enable debug logs only for our crate in dev.
                .level(log::LevelFilter::Info)
                .level_for(
                    "app_lib",
                    if cfg!(debug_assertions) {
                        log::LevelFilter::Debug
                    } else {
                        log::LevelFilter::Info
                    },
                )
                // Tao/Winit sometimes emits internal ordering warnings on Windows; they are not actionable.
                .level_for("tao", log::LevelFilter::Error)
                .build(),
        )
        .manage(services::ai::AiStreamManager::default())
        .manage(services::voice::VoiceState::new())
        .manage(WindowStateStore::new())
        .invoke_handler(tauri::generate_handler![
            set_window_mode,
            resize_input_height,
            resize_window,
            set_window_min_size,
            services::ai::commands::chat_stream,
            services::ai::commands::chat_abort,
            services::ai::commands::chat_abort_conversation,
            services::config::get_ai_config,
            services::config::set_ai_provider,
            services::config::set_ai_profile,
            services::config::test_ai_profile,
            services::ai::commands::chat_stream_with_tools,
            services::voice::voice_play_text,
            services::voice::voice_stop,
            services::voice::voice_prepare,
            // History commands
            services::history::history_bootstrap,
            services::history::history_list_conversations,
            services::history::history_get_conversation,
            services::history::history_get_conversation_page,
            services::history::history_new_conversation,
            services::history::history_set_active_conversation,
            services::history::history_mark_seen,
            services::history::history_clear_conversation,
            services::history::history_delete_conversation,
            services::history::history_fork_conversation,
            services::history::history_rename_conversation,
            // Vision commands
            services::vision::capture_screen_text,
            services::vision::analyze_screen_vlm,
            services::vision::list_capturable_windows,
            services::vision::get_smart_window,
            services::vision::capture_smart
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            let app = window.app_handle();
            let window_state = app.state::<WindowStateStore>();

            match event {
                tauri::WindowEvent::Moved(pos) => {
                    window_state.update_anchor(pos.x, pos.y);
                }
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    if let Some(w) = app.get_webview_window("main") {
                        window_state.update_size_from_window(&w);
                    }
                }
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                    window_state.flush(&app);
                }
                _ => {}
            }
        })
        .setup(|app| {
            tray::setup_tray(app)?;

            let app_handle = app.handle().clone();

            // Initialize data directory early so all subsystems share the same root.
            // Single source of truth: `<exe_dir>/savedata`.
            let dir = services::paths::init_data_dir(&app_handle)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            log::info!("Data dir: {}", dir.display());

            // History store must be available before the frontend boots.
            let history_store = plugins::history::HistoryStore::init(&app_handle)?;
            app.manage(history_store);

            let window_state = app.state::<WindowStateStore>();
            window_state.load_from_disk(&app_handle);
            window_state.spawn_persist_task(app_handle.clone());

            if let Some(window) = app.get_webview_window("main") {
                window_state.restore_anchor_to_window(&window);
            }

            // The window is created as resizable (to allow native resize in input/result),
            // but mini mode should remain fixed-size.
            set_window_mode(
                app_handle.clone(),
                app.state::<WindowStateStore>(),
                WindowMode::Mini,
            );

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
