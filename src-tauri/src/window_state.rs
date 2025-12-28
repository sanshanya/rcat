use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Arc, Mutex,
};
use std::{fs, time::Duration};
use tokio::sync::Notify;
use tauri::Manager;

use crate::{WindowMode, EDGE_MARGIN, MIN_INPUT_W};

const WINDOW_STATE_VERSION: u32 = 1;
const WINDOW_STATE_FILE: &str = "window_state.json";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
struct PersistedPosition {
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub(crate) struct PersistedSize {
    pub(crate) w: f64,
    pub(crate) h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedWindowState {
    version: u32,
    anchor: Option<PersistedPosition>,
    input_width: Option<f64>,
    result_size: Option<PersistedSize>,
}

impl Default for PersistedWindowState {
    fn default() -> Self {
        Self {
            version: WINDOW_STATE_VERSION,
            anchor: None,
            input_width: None,
            result_size: None,
        }
    }
}

#[derive(Clone)]
pub(crate) struct WindowStateStore {
    inner: Arc<WindowStateStoreInner>,
}

struct WindowStateStoreInner {
    state: Mutex<PersistedWindowState>,
    current_mode: AtomicU8,
    dirty: AtomicBool,
    notify: Notify,
    io_lock: Mutex<()>,
}

impl WindowStateStore {
    pub(crate) fn new() -> Self {
        Self {
            inner: Arc::new(WindowStateStoreInner {
                state: Mutex::new(PersistedWindowState::default()),
                current_mode: AtomicU8::new(WindowMode::Mini.as_u8()),
                dirty: AtomicBool::new(false),
                notify: Notify::new(),
                io_lock: Mutex::new(()),
            }),
        }
    }

    pub(crate) fn set_current_mode(&self, mode: WindowMode) {
        self.inner.current_mode.store(mode.as_u8(), Ordering::SeqCst);
    }

    fn current_mode(&self) -> WindowMode {
        WindowMode::from_u8(self.inner.current_mode.load(Ordering::SeqCst))
    }

    pub(crate) fn get_input_width(&self) -> Option<f64> {
        self.inner.state.lock().ok()?.input_width
    }

    pub(crate) fn get_result_size(&self) -> Option<PersistedSize> {
        self.inner.state.lock().ok()?.result_size
    }

    pub(crate) fn update_anchor(&self, x: i32, y: i32) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.anchor = Some(PersistedPosition { x, y });
        }
        self.mark_dirty();
    }

    pub(crate) fn update_size_from_window(&self, window: &tauri::WebviewWindow) {
        let (w, h) = match get_current_logical_size(window) {
            Some(size) => size,
            None => return,
        };

        let mode = self.current_mode();
        let mut changed = false;
        if let Ok(mut state) = self.inner.state.lock() {
            match mode {
                WindowMode::Input => {
                    let next = w.max(MIN_INPUT_W).round();
                    if state.input_width != Some(next) {
                        state.input_width = Some(next);
                        changed = true;
                    }
                }
                WindowMode::Result => {
                    let next = PersistedSize {
                        w: w.max(MIN_INPUT_W).round(),
                        h: h.max(1.0).round(),
                    };
                    if state.result_size != Some(next) {
                        state.result_size = Some(next);
                        changed = true;
                    }
                }
                WindowMode::Mini => {}
            }
        }
        if changed {
            self.mark_dirty();
        }
    }

    pub(crate) fn restore_anchor_to_window(&self, window: &tauri::WebviewWindow) {
        let anchor = self
            .inner
            .state
            .lock()
            .ok()
            .and_then(|s| s.anchor);
        let Some(anchor) = anchor else { return };

        let (x, y) = clamp_window_position(window, anchor.x, anchor.y);
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    }

    pub(crate) fn load_from_disk(&self, app: &tauri::AppHandle) {
        let Some(path) = window_state_path(app) else { return };
        let Ok(contents) = fs::read_to_string(&path) else { return };
        let Ok(mut parsed) = serde_json::from_str::<PersistedWindowState>(&contents) else {
            return;
        };

        if parsed.version != WINDOW_STATE_VERSION {
            parsed = PersistedWindowState::default();
        }

        if let Ok(mut state) = self.inner.state.lock() {
            *state = parsed;
        }
    }

    pub(crate) fn flush(&self, app: &tauri::AppHandle) {
        let snapshot = match self.inner.state.lock() {
            Ok(s) => s.clone(),
            Err(_) => return,
        };
        self.inner.dirty.store(false, Ordering::SeqCst);
        self.write_snapshot(app, &snapshot);
    }

    pub(crate) fn spawn_persist_task(&self, app: tauri::AppHandle) {
        let store = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                store.inner.notify.notified().await;

                // Debounce: wait for a quiet period after the last update.
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(350)) => break,
                        _ = store.inner.notify.notified() => continue,
                    }
                }

                if !store.inner.dirty.swap(false, Ordering::SeqCst) {
                    continue;
                }

                let snapshot = match store.inner.state.lock() {
                    Ok(s) => s.clone(),
                    Err(_) => continue,
                };
                store.write_snapshot(&app, &snapshot);
            }
        });
    }

    fn mark_dirty(&self) {
        self.inner.dirty.store(true, Ordering::SeqCst);
        self.inner.notify.notify_one();
    }

    fn write_snapshot(&self, app: &tauri::AppHandle, snapshot: &PersistedWindowState) {
        let Some(path) = window_state_path(app) else { return };
        let Ok(serialized) = serde_json::to_string(snapshot) else { return };

        let _guard = match self.inner.io_lock.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        let Some(parent) = path.parent() else { return };
        let _ = fs::create_dir_all(parent);

        let tmp_path = path.with_extension("json.tmp");
        if fs::write(&tmp_path, serialized).is_ok() {
            if path.exists() {
                let _ = fs::remove_file(&path);
            }
            let _ = fs::rename(&tmp_path, &path);
        }
    }
}

fn window_state_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    Some(dir.join(WINDOW_STATE_FILE))
}

pub(crate) fn clamp_window_position(window: &tauri::WebviewWindow, x: i32, y: i32) -> (i32, i32) {
    let bounds = get_virtual_monitor_bounds(window);
    let size = window.outer_size().ok();

    if bounds.is_none() || size.is_none() {
        return (x, y);
    }

    let (virtual_left, virtual_top, virtual_right, virtual_bottom) =
        bounds.expect("checked above");
    let size = size.expect("checked above");

    let scale = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let margin = EDGE_MARGIN * scale;

    let w = size.width as f64;
    let h = size.height as f64;

    let min_x = virtual_left + margin;
    let max_x = (virtual_right - margin - w).max(min_x);
    let min_y = virtual_top + margin;
    let max_y = (virtual_bottom - margin - h).max(min_y);

    let clamped_x = (x as f64).clamp(min_x, max_x).round() as i32;
    let clamped_y = (y as f64).clamp(min_y, max_y).round() as i32;

    (clamped_x, clamped_y)
}

pub(crate) fn get_current_logical_size(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let size = window.inner_size().ok()?;
    let scale = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    Some((size.width as f64 / scale, size.height as f64 / scale))
}

pub(crate) fn get_virtual_monitor_bounds(
    window: &tauri::WebviewWindow,
) -> Option<(f64, f64, f64, f64)> {
    let monitors = window.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }

    let mut left = f64::INFINITY;
    let mut top = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut bottom = f64::NEG_INFINITY;

    for monitor in monitors {
        let pos = monitor.position();
        let size = monitor.size();
        let m_left = pos.x as f64;
        let m_top = pos.y as f64;
        let m_right = m_left + size.width as f64;
        let m_bottom = m_top + size.height as f64;

        left = left.min(m_left);
        top = top.min(m_top);
        right = right.max(m_right);
        bottom = bottom.max(m_bottom);
    }

    if left.is_finite() && top.is_finite() && right.is_finite() && bottom.is_finite() {
        Some((left, top, right, bottom))
    } else {
        None
    }
}

