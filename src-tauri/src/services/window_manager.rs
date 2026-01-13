use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Arc,
    Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use super::anchor_layout::{place_context_panel, Rect, Size, WorkArea};
use crate::window_state::WindowStateStore;

const AVATAR_WINDOW_LABEL: &str = "main";
const CONTEXT_WINDOW_LABEL: &str = "context";

pub const EVT_CONTEXT_PANEL_OPENED: &str = "context-panel-opened";

const DEFAULT_AVATAR_W: f64 = 420.0;
const DEFAULT_AVATAR_H: f64 = 720.0;
const MIN_AVATAR_W: f64 = 180.0;
const MIN_AVATAR_H: f64 = 240.0;
const FIT_ASPECT_MIN: f64 = 0.05;
const FIT_ASPECT_MAX: f64 = 20.0;
const FIT_ASPECT_TOLERANCE: f64 = 0.04;

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InteractionMode {
    Passive,
    HoverActivate,
    HoldToInteract,
}

impl InteractionMode {
    fn as_u8(self) -> u8 {
        match self {
            InteractionMode::Passive => 0,
            InteractionMode::HoverActivate => 1,
            InteractionMode::HoldToInteract => 2,
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            1 => InteractionMode::HoverActivate,
            2 => InteractionMode::HoldToInteract,
            _ => InteractionMode::Passive,
        }
    }
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarInteractionBounds {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl AvatarInteractionBounds {
    fn sanitize(self) -> Option<Self> {
        let mut left = self.left;
        let mut top = self.top;
        let mut right = self.right;
        let mut bottom = self.bottom;

        if !(left.is_finite()
            && top.is_finite()
            && right.is_finite()
            && bottom.is_finite()
            && left < right
            && top < bottom)
        {
            return None;
        }

        left = left.clamp(0.0, 1.0);
        top = top.clamp(0.0, 1.0);
        right = right.clamp(0.0, 1.0);
        bottom = bottom.clamp(0.0, 1.0);

        if left >= right || top >= bottom {
            return None;
        }

        Some(Self {
            left,
            top,
            right,
            bottom,
        })
    }
}

#[cfg_attr(feature = "typegen", derive(specta::Type))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkinMode {
    Off,
    Vrm,
}

impl SkinMode {
    fn as_u8(self) -> u8 {
        match self {
            SkinMode::Off => 0,
            SkinMode::Vrm => 1,
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            1 => SkinMode::Vrm,
            _ => SkinMode::Off,
        }
    }
}

#[derive(Clone)]
pub struct WindowManager {
    inner: Arc<Inner>,
}

struct Inner {
    skin: AtomicU8,
    context_open: AtomicBool,
    context_pinned: AtomicBool,
    interaction_mode: AtomicU8,
    avatar_bounds: Mutex<Option<AvatarInteractionBounds>>,
    avatar_click_through: AtomicBool,
}

impl WindowManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                skin: AtomicU8::new(SkinMode::Off.as_u8()),
                context_open: AtomicBool::new(false),
                context_pinned: AtomicBool::new(false),
                interaction_mode: AtomicU8::new(InteractionMode::HoldToInteract.as_u8()),
                avatar_bounds: Mutex::new(None),
                avatar_click_through: AtomicBool::new(false),
            }),
        }
    }

    pub fn skin(&self) -> SkinMode {
        SkinMode::from_u8(self.inner.skin.load(Ordering::SeqCst))
    }

    pub fn interaction_mode(&self) -> InteractionMode {
        InteractionMode::from_u8(self.inner.interaction_mode.load(Ordering::SeqCst))
    }

    pub fn is_context_open(&self) -> bool {
        self.inner.context_open.load(Ordering::SeqCst)
    }

    pub fn is_context_pinned(&self) -> bool {
        self.inner.context_pinned.load(Ordering::SeqCst)
    }

    fn set_context_open(&self, open: bool) {
        self.inner.context_open.store(open, Ordering::SeqCst);
    }

    pub fn set_interaction_mode(&self, mode: InteractionMode) {
        self.inner
            .interaction_mode
            .store(mode.as_u8(), Ordering::SeqCst);
    }

    pub fn set_avatar_interaction_bounds(&self, bounds: Option<AvatarInteractionBounds>) {
        let Ok(mut guard) = self.inner.avatar_bounds.lock() else {
            return;
        };
        *guard = bounds.and_then(|b| b.sanitize());
    }

    pub fn set_skin_mode(&self, app: &tauri::AppHandle, skin: SkinMode) {
        let prev = self.skin();
        if prev == skin {
            return;
        }

        self.inner.skin.store(skin.as_u8(), Ordering::SeqCst);

        match skin {
            SkinMode::Vrm => {
                self.set_context_open(false);
                self.inner.context_pinned.store(false, Ordering::SeqCst);

                // VRM avatar should not block desktop interaction by default.
                if let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) {
                    let _ = window.set_ignore_cursor_events(true);
                    let _ = window.set_focusable(false);
                    self.inner.avatar_click_through.store(true, Ordering::SeqCst);
                    let _ = window.emit(crate::EVT_CLICK_THROUGH_STATE, true);
                }
            }
            SkinMode::Off => {
                // Ensure the context window isn't left alive in classic mode.
                if let Some(context) = app.get_webview_window(CONTEXT_WINDOW_LABEL) {
                    let _ = context.close();
                }
                self.set_context_open(false);
                self.inner.context_pinned.store(false, Ordering::SeqCst);

                if let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) {
                    let _ = window.set_ignore_cursor_events(false);
                    let _ = window.set_focusable(true);
                    self.inner.avatar_click_through.store(false, Ordering::SeqCst);
                    let _ = window.emit(crate::EVT_CLICK_THROUGH_STATE, false);
                }
            }
        }
    }

    pub fn open_context_panel(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let avatar = app
            .get_webview_window(AVATAR_WINDOW_LABEL)
            .ok_or_else(|| "Missing avatar window".to_string())?;

        let context = match app.get_webview_window(CONTEXT_WINDOW_LABEL) {
            Some(w) => w,
            None => {
                let builder = tauri::WebviewWindowBuilder::new(
                    app,
                    CONTEXT_WINDOW_LABEL,
                    tauri::WebviewUrl::App("index.html?window=context".into()),
                )
                .title("rcat-context")
                .inner_size(380.0, 520.0)
                .resizable(true)
                .decorations(false)
                .transparent(true)
                .shadow(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false);
                builder
                    .build()
                    .map_err(|e| format!("Failed to create context window: {e}"))?
            }
        };

        self.reposition_context_panel(app, &avatar, &context);

        let _ = context.show();
        let _ = context.set_focus();

        self.set_context_open(true);

        // Tell the frontend to focus input / restore tab, even when the window is reused.
        let _ = context.emit(EVT_CONTEXT_PANEL_OPENED, ());

        Ok(())
    }

    pub fn hide_context_panel(&self, app: &tauri::AppHandle) -> Result<(), String> {
        if let Some(context) = app.get_webview_window(CONTEXT_WINDOW_LABEL) {
            let _ = context.hide();
        }
        self.set_context_open(false);
        Ok(())
    }

    pub fn handle_context_focus_change(&self, app: &tauri::AppHandle, focused: bool) {
        if focused {
            return;
        }
        if self.is_context_pinned() {
            return;
        }
        let _ = self.hide_context_panel(app);
    }

    pub fn handle_context_destroyed(&self) {
        self.set_context_open(false);
        self.inner.context_pinned.store(false, Ordering::SeqCst);
    }

    pub fn handle_avatar_moved_or_resized(&self, app: &tauri::AppHandle) {
        if self.skin() != SkinMode::Vrm {
            return;
        }
        if !self.is_context_open() {
            return;
        }

        let (Some(avatar), Some(context)) = (
            app.get_webview_window(AVATAR_WINDOW_LABEL),
            app.get_webview_window(CONTEXT_WINDOW_LABEL),
        ) else {
            return;
        };

        self.reposition_context_panel(app, &avatar, &context);
    }

    fn reposition_context_panel(
        &self,
        _app: &tauri::AppHandle,
        avatar: &tauri::WebviewWindow,
        context: &tauri::WebviewWindow,
    ) {
        let Ok(pos) = avatar.outer_position().or_else(|_| avatar.inner_position()) else {
            return;
        };
        let Ok(size) = avatar.outer_size().or_else(|_| avatar.inner_size()) else {
            return;
        };

        let avatar_rect = Rect {
            left: pos.x as f64,
            top: pos.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        };

        let panel_size = context
            .outer_size()
            .or_else(|_| context.inner_size())
            .ok()
            .map(|s| Size {
                width: s.width as f64,
                height: s.height as f64,
            })
            .unwrap_or(Size {
                width: 380.0,
                height: 520.0,
            });

        let work_area = work_area_for_avatar_window(avatar, avatar_rect);
        let pos = place_context_panel(
            avatar_rect,
            panel_size,
            work_area,
            crate::EDGE_MARGIN,
            crate::EDGE_MARGIN,
        );

        let _ = context.set_position(tauri::Position::Physical(pos));
    }

    pub fn scale_avatar_window(&self, app: &tauri::AppHandle, factor: f64) -> Result<(), String> {
        if self.skin() != SkinMode::Vrm {
            return Ok(());
        }
        if !factor.is_finite() || factor <= 0.0 {
            return Err("Invalid scale factor".to_string());
        }

        let window = app
            .get_webview_window(AVATAR_WINDOW_LABEL)
            .ok_or_else(|| "Missing avatar window".to_string())?;

        let current_rect =
            current_window_rect(&window).ok_or_else(|| "Failed to read window rect".to_string())?;
        let work_area = work_area_for_avatar_window(&window, current_rect);

        let next_rect = scale_rect_bottom_center(
            current_rect,
            factor,
            work_area,
            Size {
                width: MIN_AVATAR_W,
                height: MIN_AVATAR_H,
            },
            crate::EDGE_MARGIN,
        );

        apply_window_rect(&window, next_rect);
        Ok(())
    }

    pub fn fit_avatar_window_to_aspect(
        &self,
        app: &tauri::AppHandle,
        aspect: f64,
    ) -> Result<(), String> {
        if self.skin() != SkinMode::Vrm {
            return Ok(());
        }
        if !aspect.is_finite() || aspect <= 0.0 {
            return Err("Invalid aspect ratio".to_string());
        }

        let target_aspect = aspect.clamp(FIT_ASPECT_MIN, FIT_ASPECT_MAX);
        let window = app
            .get_webview_window(AVATAR_WINDOW_LABEL)
            .ok_or_else(|| "Missing avatar window".to_string())?;

        let current_rect =
            current_window_rect(&window).ok_or_else(|| "Failed to read window rect".to_string())?;
        let work_area = work_area_for_avatar_window(&window, current_rect);
        let scale = work_area.scale_factor.max(0.0);
        if scale <= 0.0 {
            return Ok(());
        }

        let width_logical = (current_rect.width / scale).max(1.0);
        let height_logical = (current_rect.height / scale).max(1.0);
        let current_aspect = width_logical / height_logical;

        let target_size = if current_aspect < target_aspect * (1.0 - FIT_ASPECT_TOLERANCE) {
            Size {
                width: width_logical,
                height: (width_logical / target_aspect).max(MIN_AVATAR_H),
            }
        } else if current_aspect > target_aspect * (1.0 + FIT_ASPECT_TOLERANCE) {
            Size {
                width: (height_logical * target_aspect).max(MIN_AVATAR_W),
                height: height_logical,
            }
        } else {
            return Ok(());
        };

        let next_rect = resize_rect_bottom_center(
            current_rect,
            target_size,
            work_area,
            Size {
                width: MIN_AVATAR_W,
                height: MIN_AVATAR_H,
            },
            crate::EDGE_MARGIN,
        );

        apply_window_rect(&window, next_rect);
        Ok(())
    }

    pub fn spawn_interaction_gate(&self, app: tauri::AppHandle) {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = app;
            return;
        }

        #[cfg(target_os = "windows")]
        {
            use std::time::Duration;

            use windows::Win32::Foundation::POINT;
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU, VK_RBUTTON};
            use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

            let manager = self.clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_millis(33));

                loop {
                    ticker.tick().await;

                    if manager.skin() != SkinMode::Vrm {
                        continue;
                    }

                    let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) else {
                        continue;
                    };

                    let (cursor_x, cursor_y) = {
                        let mut pt = POINT::default();
                        if unsafe { GetCursorPos(&mut pt) }.is_err() {
                            continue;
                        }
                        (pt.x, pt.y)
                    };

                    let (win_pos, win_size) = match (
                        window.inner_position().or_else(|_| window.outer_position()),
                        window.inner_size().or_else(|_| window.outer_size()),
                    ) {
                        (Ok(pos), Ok(size)) => (pos, size),
                        _ => continue,
                    };

                    let bounds = manager
                        .inner
                        .avatar_bounds
                        .lock()
                        .ok()
                        .and_then(|guard| *guard);

                    let cursor_over_avatar = if let Some(bounds) = bounds {
                        let left = win_pos.x as f64 + bounds.left * (win_size.width as f64);
                        let right = win_pos.x as f64 + bounds.right * (win_size.width as f64);
                        let top = win_pos.y as f64 + bounds.top * (win_size.height as f64);
                        let bottom = win_pos.y as f64 + bounds.bottom * (win_size.height as f64);

                        let cx = cursor_x as f64;
                        let cy = cursor_y as f64;
                        cx >= left && cx <= right && cy >= top && cy <= bottom
                    } else {
                        cursor_x >= win_pos.x
                            && cursor_x <= win_pos.x + win_size.width as i32
                            && cursor_y >= win_pos.y
                            && cursor_y <= win_pos.y + win_size.height as i32
                    };

                    let alt_state = unsafe { GetAsyncKeyState(VK_MENU.0 as i32) } as u16;
                    let alt_down = (alt_state & 0x8000) != 0;

                    let rb_state = unsafe { GetAsyncKeyState(VK_RBUTTON.0 as i32) } as u16;
                    let rb_down = (rb_state & 0x8000) != 0;
                    let rb_pressed = (rb_state & 0x0001) != 0;

                    // Right-click should always summon the chat panel when the cursor is over the
                    // avatar hitbox, even when we are currently click-through.
                    if cursor_over_avatar && rb_pressed {
                        let _ = manager.open_context_panel(&app);
                    }

                    let mut desired_click_through = match manager.interaction_mode() {
                        InteractionMode::Passive => true,
                        InteractionMode::HoverActivate => !cursor_over_avatar,
                        InteractionMode::HoldToInteract => !(alt_down && cursor_over_avatar),
                    };

                    // When the right mouse button is held over the avatar, temporarily disable
                    // click-through so the underlying app does not receive the full click.
                    if cursor_over_avatar && rb_down {
                        desired_click_through = false;
                    }

                    let current_click_through =
                        manager.inner.avatar_click_through.load(Ordering::SeqCst);
                    if current_click_through == desired_click_through {
                        continue;
                    }

                    manager
                        .inner
                        .avatar_click_through
                        .store(desired_click_through, Ordering::SeqCst);
                    let _ = window.set_ignore_cursor_events(desired_click_through);
                    let _ = window.set_focusable(!desired_click_through);
                    let _ = window.emit(crate::EVT_CLICK_THROUGH_STATE, desired_click_through);
                }
            });
        }
    }
}

fn current_window_rect(window: &tauri::WebviewWindow) -> Option<Rect> {
    let pos = window.outer_position().or_else(|_| window.inner_position()).ok()?;
    let size = window.outer_size().or_else(|_| window.inner_size()).ok()?;

    Some(Rect {
        left: pos.x as f64,
        top: pos.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    })
}

fn apply_window_rect(window: &tauri::WebviewWindow, rect: Rect) {
    let width = rect.width.round().clamp(1.0, u32::MAX as f64) as u32;
    let height = rect.height.round().clamp(1.0, u32::MAX as f64) as u32;
    let x = rect.left.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32;
    let y = rect.top.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32;

    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
}

fn scale_rect_bottom_center(
    current: Rect,
    factor: f64,
    work_area: WorkArea,
    min_size_logical: Size,
    edge_margin_logical_px: f64,
) -> Rect {
    let scale = work_area.scale_factor.max(0.0);
    let margin = edge_margin_logical_px * scale;
    let current_w = current.width.max(1.0);
    let current_h = current.height.max(1.0);

    let min_w = (min_size_logical.width * scale).max(1.0);
    let min_h = (min_size_logical.height * scale).max(1.0);

    let max_w = (work_area.right - work_area.left - 2.0 * margin).max(min_w);
    let max_h = (work_area.bottom - work_area.top - 2.0 * margin).max(min_h);

    let min_factor = (min_w / current_w).max(min_h / current_h);
    let max_factor = (max_w / current_w).min(max_h / current_h);
    let factor = factor.clamp(min_factor, max_factor);

    let width = (current_w * factor).round().clamp(min_w, max_w);
    let height = (current_h * factor).round().clamp(min_h, max_h);

    let center_x = current.center_x();
    let bottom = current.bottom();
    let mut left = center_x - width * 0.5;
    let mut top = bottom - height;

    let min_x = work_area.left + margin;
    let max_x = (work_area.right - margin - width).max(min_x);
    let min_y = work_area.top + margin;
    let max_y = (work_area.bottom - margin - height).max(min_y);

    left = left.clamp(min_x, max_x);
    top = top.clamp(min_y, max_y);

    Rect {
        left,
        top,
        width,
        height,
    }
}

fn resize_rect_bottom_center(
    current: Rect,
    target_size_logical: Size,
    work_area: WorkArea,
    min_size_logical: Size,
    edge_margin_logical_px: f64,
) -> Rect {
    let scale = work_area.scale_factor.max(0.0);
    let margin = edge_margin_logical_px * scale;

    let min_w = (min_size_logical.width * scale).max(1.0);
    let min_h = (min_size_logical.height * scale).max(1.0);

    let max_w = (work_area.right - work_area.left - 2.0 * margin).max(min_w);
    let max_h = (work_area.bottom - work_area.top - 2.0 * margin).max(min_h);

    let width = (target_size_logical.width * scale).round().clamp(min_w, max_w);
    let height = (target_size_logical.height * scale).round().clamp(min_h, max_h);

    let center_x = current.center_x();
    let bottom = current.bottom();
    let mut left = center_x - width * 0.5;
    let mut top = bottom - height;

    let min_x = work_area.left + margin;
    let max_x = (work_area.right - margin - width).max(min_x);
    let min_y = work_area.top + margin;
    let max_y = (work_area.bottom - margin - height).max(min_y);

    left = left.clamp(min_x, max_x);
    top = top.clamp(min_y, max_y);

    Rect {
        left,
        top,
        width,
        height,
    }
}

fn work_area_for_avatar_window(window: &tauri::WebviewWindow, avatar_rect: Rect) -> WorkArea {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let scale_factor = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let _ = avatar_rect;

    #[cfg(target_os = "windows")]
    {
        if let Some(area) = windows_work_area_for_point(
            avatar_rect.center_x().round() as i32,
            avatar_rect.center_y().round() as i32,
        ) {
            return WorkArea {
                left: area.0 as f64,
                top: area.1 as f64,
                right: area.2 as f64,
                bottom: area.3 as f64,
                scale_factor,
            };
        }
    }

    if let Some(m) = monitor {
        let pos = m.position();
        let size = m.size();
        return WorkArea {
            left: pos.x as f64,
            top: pos.y as f64,
            right: pos.x as f64 + size.width as f64,
            bottom: pos.y as f64 + size.height as f64,
            scale_factor,
        };
    }

    // Fallback: virtual desktop bounds (may span multiple monitors).
    let bounds = crate::window_state::get_virtual_monitor_bounds(window);
    if let Some((left, top, right, bottom)) = bounds {
        return WorkArea {
            left,
            top,
            right,
            bottom,
            scale_factor,
        };
    }

    WorkArea {
        left: 0.0,
        top: 0.0,
        right: 1920.0,
        bottom: 1080.0,
        scale_factor,
    }
}

#[cfg(target_os = "windows")]
fn windows_work_area_for_point(x: i32, y: i32) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let hmonitor = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST) };
    if hmonitor.0.is_null() {
        return None;
    }

    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };

    let ok = unsafe { GetMonitorInfoW(hmonitor, &mut info) }.as_bool();
    if !ok {
        return None;
    }
    let rc = info.rcWork;
    Some((rc.left, rc.top, rc.right, rc.bottom))
}

#[tauri::command]
pub(crate) fn set_skin_mode(
    app: tauri::AppHandle,
    manager: tauri::State<'_, WindowManager>,
    window_state: tauri::State<'_, WindowStateStore>,
    skin: SkinMode,
) {
    let prev = manager.skin();
    manager.set_skin_mode(&app, skin);

    if prev == skin {
        return;
    }

    let Some(window) = app.get_webview_window(AVATAR_WINDOW_LABEL) else {
        return;
    };

    match skin {
        SkinMode::Vrm => {
            // Debug UX: keep native window frame during `tauri dev` so we can drag/resize and use
            // the system menu easily. Release builds run frameless by default.
            if cfg!(debug_assertions) {
                let _ = window.set_decorations(true);
                let _ = window.set_resizable(true);
            } else {
                let _ = window.set_decorations(false);
                let _ = window.set_resizable(false);
            }
            let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                width: MIN_AVATAR_W,
                height: MIN_AVATAR_H,
            })));

            let desired = window_state
                .get_vrm_size()
                .unwrap_or(crate::window_state::PersistedSize {
                    w: DEFAULT_AVATAR_W,
                    h: DEFAULT_AVATAR_H,
                });

            if desired.w.is_finite() && desired.h.is_finite() {
                if let Some(current_rect) = current_window_rect(&window) {
                    let work_area = work_area_for_avatar_window(&window, current_rect);
                    let target_rect = resize_rect_bottom_center(
                        current_rect,
                        Size {
                            width: desired.w,
                            height: desired.h,
                        },
                        work_area,
                        Size {
                            width: MIN_AVATAR_W,
                            height: MIN_AVATAR_H,
                        },
                        crate::EDGE_MARGIN,
                    );
                    apply_window_rect(&window, target_rect);
                } else {
                    crate::safe_resize(&window, desired.w, desired.h);
                }
            }
        }
        SkinMode::Off => {
            let _ = window.set_decorations(true);
            let _ = window.set_resizable(true);
        }
    }
}

#[tauri::command]
pub(crate) fn open_context_panel(
    app: tauri::AppHandle,
    manager: tauri::State<'_, WindowManager>,
) -> Result<(), String> {
    manager.open_context_panel(&app)
}

#[tauri::command]
pub(crate) fn hide_context_panel(
    app: tauri::AppHandle,
    manager: tauri::State<'_, WindowManager>,
) -> Result<(), String> {
    manager.hide_context_panel(&app)
}

#[tauri::command]
pub(crate) fn scale_avatar_window(
    app: tauri::AppHandle,
    manager: tauri::State<'_, WindowManager>,
    factor: f64,
) -> Result<(), String> {
    manager.scale_avatar_window(&app, factor)
}

#[tauri::command]
pub(crate) fn fit_avatar_window_to_aspect(
    app: tauri::AppHandle,
    manager: tauri::State<'_, WindowManager>,
    aspect: f64,
) -> Result<(), String> {
    manager.fit_avatar_window_to_aspect(&app, aspect)
}

#[tauri::command]
pub(crate) fn set_interaction_mode(
    manager: tauri::State<'_, WindowManager>,
    mode: InteractionMode,
) {
    manager.set_interaction_mode(mode);
}

#[tauri::command]
pub(crate) fn set_avatar_interaction_bounds(
    manager: tauri::State<'_, WindowManager>,
    bounds: Option<AvatarInteractionBounds>,
) {
    manager.set_avatar_interaction_bounds(bounds);
}
