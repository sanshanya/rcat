use crate::window_state::WindowStateStore;
use crate::windows::hittest_mask::HitTestMaskStore;
use crate::WindowMode;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicPtr, AtomicU64, Ordering};
use tauri::{Emitter, Manager};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetAncestor, GetCursorPos, GetWindowRect, IsWindowVisible, SetWindowsHookExW,
    UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, GA_ROOTOWNER, HC_ACTION, HHOOK, MSLLHOOKSTRUCT,
    WH_MOUSE_LL, WM_LBUTTONDOWN, WM_MOUSEWHEEL, WM_NCLBUTTONDOWN,
};

use super::subclass::{load_avatar_root_hwnd, map_screen_to_avatar_client};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarWheelPayload {
    delta_y: i32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarHitTestStatsPayload {
    gate_ignore_true: u64,
    gate_ignore_false: u64,
    gate_fail_open: u64,
    gate_last_ignore: Option<bool>,
    viewport_client_mismatch: u64,
    viewport_client_last: Option<ViewportClientMismatchPayload>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewportClientMismatchPayload {
    client_w: u32,
    client_h: u32,
    viewport_w: u32,
    viewport_h: u32,
}

struct AvatarWindowsService {
    running: AtomicBool,
    shutdown: AtomicBool,
    hook: AtomicIsize,
    hittest_store_ptr: AtomicPtr<HitTestMaskStore>,
    wheel_pending_delta: AtomicI32,
    panel_root_hwnd: AtomicIsize,
    panel_click_seq: AtomicU64,
    panel_click_x: AtomicI32,
    panel_click_y: AtomicI32,
    gate_transitions_true: AtomicU64,
    gate_transitions_false: AtomicU64,
    gate_fail_open: AtomicU64,
    gate_last_ignore: AtomicI32,
}

impl AvatarWindowsService {
    const fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            hook: AtomicIsize::new(0),
            hittest_store_ptr: AtomicPtr::new(core::ptr::null_mut()),
            wheel_pending_delta: AtomicI32::new(0),
            panel_root_hwnd: AtomicIsize::new(0),
            panel_click_seq: AtomicU64::new(0),
            panel_click_x: AtomicI32::new(0),
            panel_click_y: AtomicI32::new(0),
            gate_transitions_true: AtomicU64::new(0),
            gate_transitions_false: AtomicU64::new(0),
            gate_fail_open: AtomicU64::new(0),
            gate_last_ignore: AtomicI32::new(-1),
        }
    }

    fn store_hittest_mask_store(&self, store: &HitTestMaskStore) {
        self.hittest_store_ptr.store(
            store as *const HitTestMaskStore as *mut HitTestMaskStore,
            Ordering::Release,
        );
    }

    fn load_hittest_mask_store(&self) -> Option<&'static HitTestMaskStore> {
        let raw = self.hittest_store_ptr.load(Ordering::Acquire);
        (!raw.is_null()).then(|| unsafe { &*raw })
    }

    fn set_panel_root_hwnd(&self, hwnd: HWND) {
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let root = if !root.0.is_null() { root } else { hwnd };
        self.panel_root_hwnd
            .store(root.0 as isize, Ordering::Relaxed);
    }

    fn load_panel_root_hwnd(&self) -> Option<HWND> {
        let raw = self.panel_root_hwnd.load(Ordering::Relaxed);
        if raw == 0 {
            None
        } else {
            Some(HWND(raw as *mut core::ffi::c_void))
        }
    }

    fn mask_hit_at_screen_point(&self, avatar_root: HWND, screen: POINT) -> Option<bool> {
        let mask_store = self.load_hittest_mask_store()?;
        if mask_store.force_transparent() {
            return Some(false);
        }
        let snapshot = mask_store.load()?;
        let mapped = map_screen_to_avatar_client(avatar_root, screen)?;
        Some(snapshot.hit_test_client_point(
            mapped.client.x,
            mapped.client.y,
            mapped.client_w,
            mapped.client_h,
        ))
    }

    fn ensure_hook_installed(&self) {
        if self.hook.load(Ordering::Relaxed) != 0 {
            return;
        }

        let hinst = unsafe { GetModuleHandleW(windows::core::PCWSTR::null()) }
            .ok()
            .map(|m| HINSTANCE(m.0));
        let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_ll_hook_proc), hinst, 0) };
        let hook = match hook {
            Ok(hook) => hook,
            Err(err) => {
                log::warn!("Avatar windows service: SetWindowsHookExW failed: {}", err);
                return;
            }
        };

        let raw = hook.0 as isize;
        match self
            .hook
            .compare_exchange(0, raw, Ordering::SeqCst, Ordering::SeqCst)
        {
            Ok(_) => {
                log::info!("Avatar windows hook installed");
            }
            Err(_) => {
                // Another thread won the race: remove our hook to avoid leaking it.
                let _ = unsafe { UnhookWindowsHookEx(hook) };
            }
        }
    }

    fn uninstall_hook(&self) {
        let raw = self.hook.swap(0, Ordering::SeqCst);
        if raw == 0 {
            return;
        }
        let hook = HHOOK(raw as *mut core::ffi::c_void);
        if !hook.0.is_null() {
            let _ = unsafe { UnhookWindowsHookEx(hook) };
        }
        log::info!("Avatar windows hook removed");
    }

    fn start(&'static self, app: &tauri::AppHandle) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        self.shutdown.store(false, Ordering::SeqCst);
        self.store_hittest_mask_store(&*app.state::<HitTestMaskStore>());
        self.ensure_hook_installed();

        let app = app.clone();
        let service = self;
        tauri::async_runtime::spawn(async move {
            use std::time::{Duration, SystemTime, UNIX_EPOCH};

            const FAST: Duration = Duration::from_millis(16);
            const SLOW: Duration = Duration::from_millis(300);

            log::info!("Avatar windows service started (cursor-gate + input-hook)");

            let mut last_ignore: Option<bool> = None;
            let mut last_stats_emit_ms: u64 = 0;
            let mut last_panel_click_seq = 0u64;

            loop {
                if service.shutdown.load(Ordering::Acquire) {
                    break;
                }

                let mut had_work = false;

                let click_seq = service.panel_click_seq.load(Ordering::Acquire);
                if click_seq != last_panel_click_seq {
                    last_panel_click_seq = click_seq;
                    let x = service.panel_click_x.load(Ordering::Relaxed);
                    let y = service.panel_click_y.load(Ordering::Relaxed);
                    handle_panel_outside_click(service, &app, x, y);
                    had_work = true;
                }

                let delta_y = service.wheel_pending_delta.swap(0, Ordering::Relaxed);
                if delta_y != 0 {
                    if let Some(avatar) = app.get_webview_window("avatar") {
                        let _ =
                            avatar.emit(crate::EVT_AVATAR_INPUT_WHEEL, AvatarWheelPayload { delta_y });
                    }
                    had_work = true;
                }

                let gate_sleep = update_cursor_gate(
                    service,
                    &app,
                    &mut last_ignore,
                    &mut last_stats_emit_ms,
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                );

                let sleep_dur = if had_work { FAST } else { gate_sleep.unwrap_or(SLOW) };
                tokio::time::sleep(sleep_dur).await;
            }

            log::info!("Avatar windows service stopped");
        });
    }

    fn stop(&'static self) {
        if !self.running.swap(false, Ordering::SeqCst) {
            return;
        }
        self.shutdown.store(true, Ordering::SeqCst);
        self.uninstall_hook();
    }

    fn record_panel_click(&self, hook: &MSLLHOOKSTRUCT) {
        self.panel_click_x.store(hook.pt.x, Ordering::Relaxed);
        self.panel_click_y.store(hook.pt.y, Ordering::Relaxed);
        let _ = self.panel_click_seq.fetch_add(1, Ordering::Release);
    }

    fn handle_mouse_wheel(&self, hook: &MSLLHOOKSTRUCT) -> Option<LRESULT> {
        let avatar_root = load_avatar_root_hwnd()?;

        if let Some(panel_root) = self.load_panel_root_hwnd() {
            if !panel_root.0.is_null() && unsafe { IsWindowVisible(panel_root) }.as_bool() {
                let mut rect = RECT::default();
                if unsafe { GetWindowRect(panel_root, &mut rect) }.is_ok() {
                    let pt = hook.pt;
                    let in_panel = pt.x >= rect.left
                        && pt.y >= rect.top
                        && pt.x < rect.right
                        && pt.y < rect.bottom;
                    if in_panel {
                        return None;
                    }
                }
            }
        }

        let should_swallow = match self.mask_hit_at_screen_point(avatar_root, hook.pt) {
            Some(hit) => hit,
            None => {
                // No mask yet: fall back to only swallowing when the hovered root is the avatar.
                let hovered = unsafe { WindowFromPoint(hook.pt) };
                if hovered.0.is_null() {
                    return None;
                }
                let hovered_root = unsafe { GetAncestor(hovered, GA_ROOT) };
                let hovered_root = if !hovered_root.0.is_null() {
                    hovered_root
                } else {
                    hovered
                };
                hovered_root == avatar_root
            }
        };

        if !should_swallow {
            return None;
        }

        // High word: signed wheel delta (WHEEL_DELTA=120). Convert to DOM-style deltaY:
        // wheel-up => negative deltaY (zoom in), wheel-down => positive deltaY (zoom out).
        let wheel_delta = ((hook.mouseData >> 16) as i16) as i32;
        let delta_y = -wheel_delta;
        if delta_y != 0 {
            let _ = self.wheel_pending_delta.fetch_add(delta_y, Ordering::Relaxed);
        }

        // Swallow the wheel so the underlying focused app won't scroll while hovering the avatar.
        Some(LRESULT(1))
    }
}

static WINDOWS_SERVICE: AvatarWindowsService = AvatarWindowsService::new();

pub fn start_avatar_windows_service(app: &tauri::AppHandle) {
    WINDOWS_SERVICE.start(app);
}

pub fn stop_avatar_windows_service() {
    WINDOWS_SERVICE.stop();
}

pub fn set_panel_root_hwnd(hwnd: HWND) {
    WINDOWS_SERVICE.set_panel_root_hwnd(hwnd);
}

unsafe extern "system" fn mouse_ll_hook_proc(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if code != HC_ACTION as i32 {
        return unsafe { CallNextHookEx(None, code, w_param, l_param) };
    }

    let msg = w_param.0 as u32;

    if msg == WM_LBUTTONDOWN || msg == WM_NCLBUTTONDOWN {
        let hook = unsafe { &*(l_param.0 as *const MSLLHOOKSTRUCT) };
        WINDOWS_SERVICE.record_panel_click(hook);
        return unsafe { CallNextHookEx(None, code, w_param, l_param) };
    }

    if msg != WM_MOUSEWHEEL {
        return unsafe { CallNextHookEx(None, code, w_param, l_param) };
    }

    let hook = unsafe { &*(l_param.0 as *const MSLLHOOKSTRUCT) };
    if let Some(result) = WINDOWS_SERVICE.handle_mouse_wheel(hook) {
        return result;
    }

    unsafe { CallNextHookEx(None, code, w_param, l_param) }
}

fn update_cursor_gate(
    service: &AvatarWindowsService,
    app: &tauri::AppHandle,
    last_ignore: &mut Option<bool>,
    last_stats_emit_ms: &mut u64,
    now_ms: u64,
) -> Option<std::time::Duration> {
    use std::time::Duration;

    let Some(window) = app.get_webview_window("avatar") else {
        *last_ignore = None;
        service.gate_last_ignore.store(-1, Ordering::Relaxed);
        return Some(Duration::from_millis(300));
    };
    let Ok(hwnd) = window.hwnd() else {
        *last_ignore = None;
        service.gate_last_ignore.store(-1, Ordering::Relaxed);
        return Some(Duration::from_millis(300));
    };
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let root = if !root.0.is_null() { root } else { hwnd };

    let mask_store = app.state::<HitTestMaskStore>();

    let set_ignore = |window: &tauri::WebviewWindow,
                      last_ignore: &mut Option<bool>,
                      ignore: bool|
     -> bool {
        if *last_ignore == Some(ignore) {
            return false;
        }
        let _ = window.set_ignore_cursor_events(ignore);
        *last_ignore = Some(ignore);
        if ignore {
            service.gate_transitions_true.fetch_add(1, Ordering::Relaxed);
            service.gate_last_ignore.store(1, Ordering::Relaxed);
        } else {
            service.gate_transitions_false.fetch_add(1, Ordering::Relaxed);
            service.gate_last_ignore.store(0, Ordering::Relaxed);
        }
        true
    };

    let fail_open_to_click_through =
        |window: &tauri::WebviewWindow, last_ignore: &mut Option<bool>, reason: &str| {
            // Fail-open to click-through: when we can't reliably compute hit-test state,
            // prefer not blocking the desktop.
            if set_ignore(window, last_ignore, true) {
                service.gate_fail_open.fetch_add(1, Ordering::Relaxed);
                log::debug!("Avatar cursor gate fail-open (click-through): {}", reason);
            }
        };

    // Avoid toggling mid-drag to prevent losing capture / breaking controls.
    let left_down = unsafe { GetKeyState(VK_LBUTTON.0 as i32) } < 0;
    let right_down = unsafe { GetKeyState(VK_RBUTTON.0 as i32) } < 0;
    if left_down || right_down {
        return Some(Duration::from_millis(16));
    }

    let mut screen = POINT::default();
    if unsafe { GetCursorPos(&mut screen) }.is_err() {
        fail_open_to_click_through(&window, last_ignore, "GetCursorPos failed");
        return Some(Duration::from_millis(16));
    }

    // Gate-only polling: do per-pixel mask query only when the cursor is within
    // the avatar window bounds.
    let mut window_rect = RECT::default();
    if unsafe { GetWindowRect(root, &mut window_rect) }.is_err() {
        fail_open_to_click_through(&window, last_ignore, "GetWindowRect failed");
        return Some(Duration::from_millis(300));
    }
    let in_window = screen.x >= window_rect.left
        && screen.y >= window_rect.top
        && screen.x < window_rect.right
        && screen.y < window_rect.bottom;
    if !in_window {
        let _ = set_ignore(&window, last_ignore, true);
        const NEAR_MARGIN_PX: i32 = 48;
        let near = screen.x >= window_rect.left.saturating_sub(NEAR_MARGIN_PX)
            && screen.y >= window_rect.top.saturating_sub(NEAR_MARGIN_PX)
            && screen.x < window_rect.right.saturating_add(NEAR_MARGIN_PX)
            && screen.y < window_rect.bottom.saturating_add(NEAR_MARGIN_PX);
        return Some(if near {
            Duration::from_millis(16)
        } else {
            Duration::from_millis(300)
        });
    }

    let Some(mapped) = map_screen_to_avatar_client(root, screen) else {
        fail_open_to_click_through(&window, last_ignore, "ScreenToClient failed");
        return Some(Duration::from_millis(16));
    };
    let pt = mapped.client;
    let cw = mapped.client_w;
    let ch = mapped.client_h;
    let in_client = mapped.in_client;

    // Keep non-client (title bar) interactive for debugging convenience.
    let mut interactive = !in_client;
    if mask_store.force_transparent() {
        interactive = false;
    } else if in_client {
        if let Some(snapshot) = mask_store.load() {
            interactive = snapshot.hit_test_client_point(pt.x, pt.y, cw, ch);
        } else {
            // No mask yet: keep the client click-through.
            interactive = false;
        }
    }

    let ignore = !interactive;
    if set_ignore(&window, last_ignore, ignore) {
        log::trace!(
            "Avatar cursor gate updated (ignore_cursor_events={}, in_client={}, interactive={})",
            ignore,
            in_client,
            interactive
        );
    }

    if now_ms.saturating_sub(*last_stats_emit_ms) >= 1_000 {
        *last_stats_emit_ms = now_ms;
        let last_ignore_val = match service.gate_last_ignore.load(Ordering::Relaxed) {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        };
        let mismatch_count = mask_store.viewport_client_mismatch_count();
        let mismatch_last = mask_store
            .viewport_client_last_mismatch()
            .map(|(client_w, client_h, viewport_w, viewport_h)| ViewportClientMismatchPayload {
                client_w,
                client_h,
                viewport_w,
                viewport_h,
            });
        let _ = window.emit(
            crate::EVT_AVATAR_HITTEST_STATS,
            AvatarHitTestStatsPayload {
                gate_ignore_true: service.gate_transitions_true.load(Ordering::Relaxed),
                gate_ignore_false: service.gate_transitions_false.load(Ordering::Relaxed),
                gate_fail_open: service.gate_fail_open.load(Ordering::Relaxed),
                gate_last_ignore: last_ignore_val,
                viewport_client_mismatch: mismatch_count,
                viewport_client_last: mismatch_last,
            },
        );
    }

    Some(Duration::from_millis(16))
}

fn handle_panel_outside_click(service: &AvatarWindowsService, app: &tauri::AppHandle, x: i32, y: i32) {
    let Some(panel) = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("panel"))
    else {
        return;
    };

    let mode = app.state::<WindowStateStore>().get_current_mode();
    if !matches!(mode, WindowMode::Mini) {
        return;
    }

    let Ok(visible) = panel.is_visible() else {
        return;
    };
    if !visible {
        return;
    }

    let clicked = unsafe { WindowFromPoint(POINT { x, y }) };

    let Ok(panel_hwnd) = panel.hwnd() else {
        return;
    };
    let panel_root = unsafe { GetAncestor(panel_hwnd, GA_ROOT) };
    let panel_root = if !panel_root.0.is_null() {
        panel_root
    } else {
        panel_hwnd
    };

    // Keep an updated panel root HWND so the global wheel hook can avoid stealing scroll input
    // when the cursor is over the panel (even if the avatar happens to be on top).
    service.set_panel_root_hwnd(panel_root);

    // If the click point is within the panel rect, treat it as inside regardless of what
    // WindowFromPoint reports (avatar overlays / layered windows can skew that result).
    let mut panel_rect = RECT::default();
    if unsafe { GetWindowRect(panel_root, &mut panel_rect) }.is_ok() {
        let in_panel_rect = x >= panel_rect.left
            && y >= panel_rect.top
            && x < panel_rect.right
            && y < panel_rect.bottom;
        if in_panel_rect {
            return;
        }
    }

    // Many WebView2/UI popups (e.g. <select> dropdowns) are separate top-level windows
    // owned by the panel. GA_ROOT would treat them as "outside", so use GA_ROOTOWNER.
    let panel_root_owner = unsafe { GetAncestor(panel_root, GA_ROOTOWNER) };
    let panel_root_owner = if !panel_root_owner.0.is_null() {
        panel_root_owner
    } else {
        panel_root
    };

    let click_root = if !clicked.0.is_null() {
        unsafe { GetAncestor(clicked, GA_ROOT) }
    } else {
        clicked
    };
    let click_root = if !click_root.0.is_null() { click_root } else { clicked };

    let click_root_owner = if !clicked.0.is_null() {
        unsafe { GetAncestor(clicked, GA_ROOTOWNER) }
    } else {
        clicked
    };
    let click_root_owner = if !click_root_owner.0.is_null() {
        click_root_owner
    } else {
        clicked
    };

    let is_inside_panel = !clicked.0.is_null()
        && (click_root == panel_root
            || click_root_owner == panel_root
            || click_root_owner == panel_root_owner);
    if is_inside_panel {
        return;
    }

    let _ = panel.hide();
    log::debug!(
        "Panel auto-dismiss: hide on outside click (mode={:?}, clicked={:?}, click_root={:?}, click_root_owner={:?}, panel_root={:?}, panel_root_owner={:?})",
        mode,
        clicked,
        click_root,
        click_root_owner,
        panel_root,
        panel_root_owner
    );
}
