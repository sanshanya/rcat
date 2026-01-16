#[cfg(not(target_os = "windows"))]
pub fn install_avatar_subclass(
    _window: &tauri::WebviewWindow,
) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn remove_avatar_subclass(_window: &tauri::Window) {
    // no-op
}

#[cfg(not(target_os = "windows"))]
pub fn spawn_avatar_cursor_gate(_app: &tauri::AppHandle) {
    // no-op
}

#[cfg(not(target_os = "windows"))]
pub fn set_avatar_tool_mode_enabled(_enabled: bool) {
    // no-op
}

#[cfg(not(target_os = "windows"))]
pub fn spawn_avatar_wheel_router(_app: &tauri::AppHandle) {
    // no-op
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use crate::windows::hittest_mask::HitTestMaskStore;
    use crate::window_state::WindowStateStore;
    use crate::WindowMode;
    use serde::Serialize;
    use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU64, Ordering};
    use tauri::{Emitter, Manager};
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_MENU};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, EnumChildWindows, GetAncestor, GetClassNameW, GetClientRect, GetWindowRect,
        GetWindowThreadProcessId, IsWindowVisible, SetWindowsHookExW, UnhookWindowsHookEx,
        WindowFromPoint, GA_ROOT, HC_ACTION, HHOOK, MA_NOACTIVATE,
        MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_CREATE, WM_LBUTTONDOWN, WM_MOUSEACTIVATE, WM_MOUSEWHEEL,
        WM_NCLBUTTONDOWN, WM_PARENTNOTIFY,
    };

    const AVATAR_SUBCLASS_ID: usize = 0x5243_4154_5641_5441; // "RCATVATA" (unique-ish)

    static AVATAR_GATE_HWND: AtomicIsize = AtomicIsize::new(0);
    static AVATAR_ROOT_HWND: AtomicIsize = AtomicIsize::new(0);
    static HITTEST_MASK_STORE_PTR: AtomicIsize = AtomicIsize::new(0);

    static AVATAR_TOOL_MODE_AVATAR: AtomicBool = AtomicBool::new(false);
    static GATE_TRANSITIONS_TRUE: AtomicU64 = AtomicU64::new(0);
    static GATE_TRANSITIONS_FALSE: AtomicU64 = AtomicU64::new(0);
    static GATE_FAIL_OPEN: AtomicU64 = AtomicU64::new(0);
    static GATE_LAST_IGNORE: AtomicI32 = AtomicI32::new(-1);

    static WHEEL_PENDING_NOALT: AtomicI32 = AtomicI32::new(0);
    static WHEEL_PENDING_ALT: AtomicI32 = AtomicI32::new(0);
    static WHEEL_HOOK: AtomicIsize = AtomicIsize::new(0);
    static PANEL_ROOT_HWND: AtomicIsize = AtomicIsize::new(0);
    static PANEL_CLICK_SEQ: AtomicU64 = AtomicU64::new(0);
    static PANEL_CLICK_X: AtomicI32 = AtomicI32::new(0);
    static PANEL_CLICK_Y: AtomicI32 = AtomicI32::new(0);

    #[derive(Debug, Clone, Copy, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AvatarWheelPayload {
        delta_y: i32,
        alt_key: bool,
    }

    #[derive(Debug, Clone, Copy, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AvatarHitTestStatsPayload {
        gate_ignore_true: u64,
        gate_ignore_false: u64,
        gate_fail_open: u64,
        gate_last_ignore: Option<bool>,
    }

    fn load_avatar_gate_hwnd() -> Option<HWND> {
        let raw = AVATAR_GATE_HWND.load(Ordering::Relaxed);
        if raw == 0 {
            None
        } else {
            Some(HWND(raw as *mut core::ffi::c_void))
        }
    }

    fn store_avatar_gate_hwnd(hwnd: HWND) {
        AVATAR_GATE_HWND.store(hwnd.0 as isize, Ordering::Relaxed);
    }

    fn store_hittest_mask_store(store: &HitTestMaskStore) {
        HITTEST_MASK_STORE_PTR.store(store as *const HitTestMaskStore as isize, Ordering::Release);
    }

    fn load_hittest_mask_store() -> Option<&'static HitTestMaskStore> {
        let raw = HITTEST_MASK_STORE_PTR.load(Ordering::Acquire);
        if raw == 0 {
            None
        } else {
            Some(unsafe { &*(raw as *const HitTestMaskStore) })
        }
    }

    fn load_panel_root_hwnd() -> Option<HWND> {
        let raw = PANEL_ROOT_HWND.load(Ordering::Relaxed);
        if raw == 0 {
            None
        } else {
            Some(HWND(raw as *mut core::ffi::c_void))
        }
    }

    pub fn set_panel_root_hwnd(hwnd: HWND) {
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let root = if !root.0.is_null() { root } else { hwnd };
        PANEL_ROOT_HWND.store(root.0 as isize, Ordering::Relaxed);
    }

    fn hwnd_class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buf) };
        if len <= 0 {
            return "<unknown>".to_string();
        }
        String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())])
    }

    fn collect_descendant_hwnds(root: HWND) -> Vec<HWND> {
        unsafe extern "system" fn enum_proc(hwnd: HWND, l_param: LPARAM) -> BOOL {
            let vec = unsafe { &mut *(l_param.0 as *mut Vec<HWND>) };
            vec.push(hwnd);
            BOOL(1)
        }

        let mut hwnds: Vec<HWND> = vec![root];
        unsafe {
            let _ = EnumChildWindows(
                Some(root),
                Some(enum_proc),
                LPARAM((&mut hwnds as *mut Vec<HWND>) as isize),
            );
        }

        hwnds.sort_by_key(|hwnd| hwnd.0 as usize);
        hwnds.dedup_by_key(|hwnd| hwnd.0 as usize);
        hwnds
    }

    fn select_avatar_gate_hwnd(root: HWND, targets: &[HWND]) -> HWND {
        let mut best: Option<(HWND, i64)> = None;
        for hwnd in targets.iter().copied() {
            if hwnd.0 == root.0 {
                continue;
            }
            let mut rect = RECT::default();
            if unsafe { GetClientRect(hwnd, &mut rect) }.is_err() {
                continue;
            }
            let w = (rect.right - rect.left) as i64;
            let h = (rect.bottom - rect.top) as i64;
            if w <= 0 || h <= 0 {
                continue;
            }
            let area = w.saturating_mul(h);
            if best.map(|(_, best_area)| area > best_area).unwrap_or(true) {
                best = Some((hwnd, area));
            }
        }
        best.map(|(hwnd, _)| hwnd).unwrap_or(root)
    }

    fn refresh_avatar_gate_hwnd(root: HWND) -> HWND {
        let prev = load_avatar_gate_hwnd().unwrap_or(HWND(core::ptr::null_mut()));
        let targets = collect_descendant_hwnds(root);
        let gate = select_avatar_gate_hwnd(root, &targets);
        store_avatar_gate_hwnd(gate);
        if prev.0 != gate.0 {
            log::info!(
                "Avatar cursor gate target refreshed (hwnd={:?} class={}, root={:?} class={})",
                gate,
                hwnd_class_name(gate),
                root,
                hwnd_class_name(root)
            );
        }
        gate
    }

    fn mask_hit_at_screen_point(avatar_root: HWND, screen: POINT) -> Option<bool> {
        let mask_store = load_hittest_mask_store()?;
        if mask_store.force_transparent() {
            return Some(false);
        }
        let snapshot = mask_store.load()?;

        let mut gate_hwnd = load_avatar_gate_hwnd().unwrap_or(avatar_root);
        if gate_hwnd.0.is_null() {
            gate_hwnd = avatar_root;
        }

        let mut pt = screen;
        if !unsafe { ScreenToClient(gate_hwnd, &mut pt) }.as_bool() {
            return None;
        }

        let mut client = RECT::default();
        if unsafe { GetClientRect(gate_hwnd, &mut client) }.is_err() {
            return None;
        }

        let cw = (client.right - client.left).max(1);
        let ch = (client.bottom - client.top).max(1);
        Some(mask_hit_at(&snapshot, pt.x, pt.y, cw, ch))
    }

    fn mask_hit_at(
        snapshot: &crate::windows::hittest_mask::MaskSnapshot,
        client_x: i32,
        client_y: i32,
        client_w: i32,
        client_h: i32,
    ) -> bool {
        if snapshot.rect.is_empty() {
            return false;
        }

        if client_x < 0 || client_y < 0 || client_x >= client_w || client_y >= client_h {
            return false;
        }

        let client_w = (client_w as i64).max(1);
        let client_h = (client_h as i64).max(1);

        let mx = ((client_x as i64) * (snapshot.mask_w as i64) / client_w) as i64;
        let my = ((client_y as i64) * (snapshot.mask_h as i64) / client_h) as i64;

        if mx < 0 || my < 0 {
            return false;
        }
        let mx = mx as u32;
        let my = my as u32;
        if mx >= snapshot.mask_w || my >= snapshot.mask_h {
            return false;
        }
        if !snapshot.rect.contains(mx, my) {
            return false;
        }

        let mx_usize = mx as usize;
        let my_usize = my as usize;
        let idx = my_usize * snapshot.stride + (mx_usize / 8);
        let Some(byte) = snapshot.bitset.get(idx) else {
            return false;
        };
        let bit = (byte >> (mx_usize % 8)) & 1;
        bit == 1
    }

    unsafe extern "system" fn wheel_hook_proc(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if code != HC_ACTION as i32 {
            return unsafe { CallNextHookEx(None, code, w_param, l_param) };
        }

        let msg = w_param.0 as u32;

        if msg == WM_LBUTTONDOWN || msg == WM_NCLBUTTONDOWN {
            let hook = unsafe { &*(l_param.0 as *const MSLLHOOKSTRUCT) };
            PANEL_CLICK_X.store(hook.pt.x, Ordering::Relaxed);
            PANEL_CLICK_Y.store(hook.pt.y, Ordering::Relaxed);
            let _ = PANEL_CLICK_SEQ.fetch_add(1, Ordering::Release);
            return unsafe { CallNextHookEx(None, code, w_param, l_param) };
        }

        if msg != WM_MOUSEWHEEL {
            return unsafe { CallNextHookEx(None, code, w_param, l_param) };
        }

        if !AVATAR_TOOL_MODE_AVATAR.load(Ordering::Relaxed) {
            return unsafe { CallNextHookEx(None, code, w_param, l_param) };
        }

        let root_raw = AVATAR_ROOT_HWND.load(Ordering::Relaxed);
        if root_raw == 0 {
            return unsafe { CallNextHookEx(None, code, w_param, l_param) };
        }
        let avatar_root = HWND(root_raw as *mut core::ffi::c_void);

        let hook = unsafe { &*(l_param.0 as *const MSLLHOOKSTRUCT) };
        if let Some(panel_root) = load_panel_root_hwnd() {
            if !panel_root.0.is_null() && unsafe { IsWindowVisible(panel_root) }.as_bool() {
                let mut rect = RECT::default();
                if unsafe { GetWindowRect(panel_root, &mut rect) }.is_ok() {
                    let pt = hook.pt;
                    let in_panel = pt.x >= rect.left
                        && pt.y >= rect.top
                        && pt.x < rect.right
                        && pt.y < rect.bottom;
                    if in_panel {
                        return unsafe { CallNextHookEx(None, code, w_param, l_param) };
                    }
                }
            }
        }

        if let Some(hit) = mask_hit_at_screen_point(avatar_root, hook.pt) {
            if hit {
                // High word: signed wheel delta (WHEEL_DELTA=120). Convert to DOM-style deltaY:
                // wheel-up => negative deltaY (zoom in), wheel-down => positive deltaY (zoom out).
                let wheel_delta = ((hook.mouseData >> 16) as i16) as i32;
                let delta_y = -wheel_delta;
                if delta_y == 0 {
                    return LRESULT(1);
                }

                let alt_down = unsafe { GetKeyState(VK_MENU.0 as i32) } < 0;
                if alt_down {
                    let _ = WHEEL_PENDING_ALT.fetch_add(delta_y, Ordering::Relaxed);
                } else {
                    let _ = WHEEL_PENDING_NOALT.fetch_add(delta_y, Ordering::Relaxed);
                }

                // Swallow the wheel so the underlying focused app won't scroll while hovering the avatar.
                return LRESULT(1);
            }

            // Mask says we're not on the model: let the underlying app scroll.
            return unsafe { CallNextHookEx(None, code, w_param, l_param) };
        }

        let hovered = unsafe { WindowFromPoint(hook.pt) };
        if hovered.0.is_null() {
            return unsafe { CallNextHookEx(None, code, w_param, l_param) };
        }

        let hovered_root = unsafe { GetAncestor(hovered, GA_ROOT) };
        let hovered_root = if !hovered_root.0.is_null() {
            hovered_root
        } else {
            hovered
        };
        if hovered_root != avatar_root {
            return unsafe { CallNextHookEx(None, code, w_param, l_param) };
        }

        // High word: signed wheel delta (WHEEL_DELTA=120). Convert to DOM-style deltaY:
        // wheel-up => negative deltaY (zoom in), wheel-down => positive deltaY (zoom out).
        let wheel_delta = ((hook.mouseData >> 16) as i16) as i32;
        let delta_y = -wheel_delta;
        if delta_y == 0 {
            return LRESULT(1);
        }

        let alt_down = unsafe { GetKeyState(VK_MENU.0 as i32) } < 0;
        if alt_down {
            let _ = WHEEL_PENDING_ALT.fetch_add(delta_y, Ordering::Relaxed);
        } else {
            let _ = WHEEL_PENDING_NOALT.fetch_add(delta_y, Ordering::Relaxed);
        }

        // Swallow the wheel so the underlying focused app won't scroll while hovering the avatar.
        LRESULT(1)
    }

    fn ensure_wheel_hook_installed() {
        if WHEEL_HOOK.load(Ordering::Relaxed) != 0 {
            return;
        }

        let hinst = unsafe { GetModuleHandleW(windows::core::PCWSTR::null()) }
            .ok()
            .map(|m| HINSTANCE(m.0));
        let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(wheel_hook_proc), hinst, 0) };
        let hook = match hook {
            Ok(hook) => hook,
            Err(err) => {
                log::warn!("Avatar wheel hook: SetWindowsHookExW failed: {}", err);
                return;
            }
        };
        let raw = hook.0 as isize;
        match WHEEL_HOOK.compare_exchange(0, raw, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => {
                log::info!("Avatar wheel hook installed");
            }
            Err(_) => {
                // Another thread won the race: remove our hook to avoid leaking it.
                let _ = unsafe { UnhookWindowsHookEx(hook) };
            }
        }
    }

    pub fn set_avatar_tool_mode_enabled(enabled: bool) {
        AVATAR_TOOL_MODE_AVATAR.store(enabled, Ordering::Relaxed);
    }

    pub fn spawn_avatar_wheel_router(app: &tauri::AppHandle) {
        use std::time::Duration;

        let mask_store = app.state::<HitTestMaskStore>();
        store_hittest_mask_store(&*mask_store);

        ensure_wheel_hook_installed();

        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(16));
            let mut last_panel_click_seq = 0u64;

            loop {
                ticker.tick().await;

                let click_seq = PANEL_CLICK_SEQ.load(Ordering::Acquire);
                if click_seq != last_panel_click_seq {
                    last_panel_click_seq = click_seq;
                    let x = PANEL_CLICK_X.load(Ordering::Relaxed);
                    let y = PANEL_CLICK_Y.load(Ordering::Relaxed);
                    handle_panel_outside_click(&app, x, y);
                }

                let delta_alt = WHEEL_PENDING_ALT.swap(0, Ordering::Relaxed);
                let delta_noalt = WHEEL_PENDING_NOALT.swap(0, Ordering::Relaxed);
                if delta_alt == 0 && delta_noalt == 0 {
                    continue;
                }

                let Some(avatar) = app.get_webview_window("avatar") else {
                    continue;
                };

                if delta_alt != 0 {
                    let _ = avatar.emit(
                        crate::EVT_AVATAR_INPUT_WHEEL,
                        AvatarWheelPayload {
                            delta_y: delta_alt,
                            alt_key: true,
                        },
                    );
                }

                if delta_noalt != 0 {
                    let _ = avatar.emit(
                        crate::EVT_AVATAR_INPUT_WHEEL,
                        AvatarWheelPayload {
                            delta_y: delta_noalt,
                            alt_key: false,
                        },
                    );
                }
            }
        });
    }

    fn handle_panel_outside_click(app: &tauri::AppHandle, x: i32, y: i32) {
        use windows::Win32::UI::WindowsAndMessaging::GA_ROOTOWNER;

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
        set_panel_root_hwnd(panel_root);

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

    unsafe extern "system" fn avatar_subclass_proc(
        hwnd: HWND,
        msg: u32,
        w_param: WPARAM,
        l_param: LPARAM,
        _u_id_subclass: usize,
        dw_ref_data: usize,
    ) -> LRESULT {
        match msg {
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            WM_PARENTNOTIFY => {
                let event = (w_param.0 & 0xFFFF) as u32;
                if event == WM_CREATE {
                    let child = HWND(l_param.0 as *mut core::ffi::c_void);
                    if !child.0.is_null() {
                        let _ = unsafe {
                            SetWindowSubclass(
                                child,
                                Some(avatar_subclass_proc),
                                AVATAR_SUBCLASS_ID,
                                dw_ref_data,
                            )
                        };
                        log::trace!(
                            "AvatarWindow subclass attached to child (hwnd={:?} class={})",
                            child,
                            hwnd_class_name(child)
                        );
                    }
                }
                unsafe { DefSubclassProc(hwnd, msg, w_param, l_param) }
            }
            _ => unsafe { DefSubclassProc(hwnd, msg, w_param, l_param) },
        }
    }

    pub fn install_avatar_subclass(
        window: &tauri::WebviewWindow,
    ) -> tauri::Result<()> {
        let hwnd = window.hwnd()?;
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let root = if !root.0.is_null() { root } else { hwnd };
        AVATAR_ROOT_HWND.store(root.0 as isize, Ordering::Relaxed);

        let ref_data = 0usize;
        let targets = collect_descendant_hwnds(root);
        let gate = select_avatar_gate_hwnd(root, &targets);
        store_avatar_gate_hwnd(gate);
        log::info!(
            "Avatar cursor gate target (hwnd={:?} class={}, root={:?} class={})",
            gate,
            hwnd_class_name(gate),
            root,
            hwnd_class_name(root)
        );

        let mut installed = 0usize;
        for target in targets.iter().copied() {
            let mut pid: u32 = 0;
            let tid = unsafe { GetWindowThreadProcessId(target, Some(&mut pid)) };
            let ok = unsafe {
                SetWindowSubclass(
                    target,
                    Some(avatar_subclass_proc),
                    AVATAR_SUBCLASS_ID,
                    ref_data,
                )
            };
            if ok.as_bool() {
                installed += 1;
            }
            log::trace!(
                "AvatarWindow subclass target (hwnd={:?} class={} pid={} tid={} ok={})",
                target,
                hwnd_class_name(target),
                pid,
                tid,
                ok.as_bool()
            );
        }

        if installed > 0 {
            log::info!(
                "AvatarWindow subclass installed (hwnd={:?} class={}, root={:?} class={}, targets={}, ok={})",
                hwnd,
                hwnd_class_name(hwnd),
                root,
                hwnd_class_name(root),
                targets.len(),
                installed
            );
        } else {
            log::warn!(
                "AvatarWindow subclass install failed (hwnd={:?} class={}, root={:?} class={}, targets={})",
                hwnd,
                hwnd_class_name(hwnd),
                root,
                hwnd_class_name(root),
                targets.len()
            );
        }
        Ok(())
    }

    pub fn spawn_avatar_cursor_gate(app: &tauri::AppHandle) {
        use std::time::Duration;

        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            use std::time::{SystemTime, UNIX_EPOCH};
            use windows::Win32::Foundation::POINT;
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_LBUTTON, VK_RBUTTON};
            use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

            let fast_interval = Duration::from_millis(33);
            let slow_interval = Duration::from_millis(300);
            let mut last_ignore: Option<bool> = None;
            let mut last_stats_emit_ms: u64 = 0;

            log::info!(
                "Avatar cursor gate started (fast={}ms slow={}ms)",
                fast_interval.as_millis(),
                slow_interval.as_millis()
            );

            loop {
                let sleep_dur = 'tick: {
                    let Some(window) = app.get_webview_window("avatar") else {
                        last_ignore = None;
                        break 'tick slow_interval;
                    };
                    let Ok(hwnd) = window.hwnd() else {
                        break 'tick slow_interval;
                    };
                    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
                    let root = if !root.0.is_null() { root } else { hwnd };

                    let mut gate_hwnd =
                        load_avatar_gate_hwnd().unwrap_or_else(|| refresh_avatar_gate_hwnd(root));
                    if gate_hwnd.0.is_null() || unsafe { GetAncestor(gate_hwnd, GA_ROOT) }.0 != root.0 {
                        gate_hwnd = refresh_avatar_gate_hwnd(root);
                    }

                    let mask_store = app.state::<HitTestMaskStore>();

                    let set_ignore =
                        |window: &tauri::WebviewWindow,
                         last_ignore: &mut Option<bool>,
                         ignore: bool|
                         -> bool {
                            if *last_ignore == Some(ignore) {
                                return false;
                            }
                            let _ = window.set_ignore_cursor_events(ignore);
                            *last_ignore = Some(ignore);
                            if ignore {
                                GATE_TRANSITIONS_TRUE.fetch_add(1, Ordering::Relaxed);
                                GATE_LAST_IGNORE.store(1, Ordering::Relaxed);
                            } else {
                                GATE_TRANSITIONS_FALSE.fetch_add(1, Ordering::Relaxed);
                                GATE_LAST_IGNORE.store(0, Ordering::Relaxed);
                            }
                            true
                        };

                    let fail_open_to_hittest =
                        |window: &tauri::WebviewWindow, last_ignore: &mut Option<bool>, reason: &str| {
                            if set_ignore(window, last_ignore, false) {
                                GATE_FAIL_OPEN.fetch_add(1, Ordering::Relaxed);
                                log::debug!("Avatar cursor gate fail-open: {}", reason);
                            }
                        };

                    // Avoid toggling mid-drag to prevent losing capture / breaking controls.
                    let left_down = unsafe { GetKeyState(VK_LBUTTON.0 as i32) } < 0;
                    let right_down = unsafe { GetKeyState(VK_RBUTTON.0 as i32) } < 0;
                    if left_down || right_down {
                        break 'tick fast_interval;
                    }

                    let mut screen = POINT::default();
                    if unsafe { GetCursorPos(&mut screen) }.is_err() {
                        fail_open_to_hittest(&window, &mut last_ignore, "GetCursorPos failed");
                        break 'tick fast_interval;
                    }

                    // Gate-only polling: do per-pixel mask query only when the cursor is within
                    // the avatar window bounds.
                    let mut window_rect = RECT::default();
                    if unsafe { GetWindowRect(root, &mut window_rect) }.is_err() {
                        fail_open_to_hittest(&window, &mut last_ignore, "GetWindowRect failed");
                        break 'tick slow_interval;
                    }
                    let in_window = screen.x >= window_rect.left
                        && screen.y >= window_rect.top
                        && screen.x < window_rect.right
                        && screen.y < window_rect.bottom;
                    if !in_window {
                        let _ = set_ignore(&window, &mut last_ignore, true);
                        const NEAR_MARGIN_PX: i32 = 48;
                        let near = screen.x >= window_rect.left.saturating_sub(NEAR_MARGIN_PX)
                            && screen.y >= window_rect.top.saturating_sub(NEAR_MARGIN_PX)
                            && screen.x < window_rect.right.saturating_add(NEAR_MARGIN_PX)
                            && screen.y < window_rect.bottom.saturating_add(NEAR_MARGIN_PX);
                        break 'tick if near { fast_interval } else { slow_interval };
                    }

                    let mut pt = screen;
                    if !unsafe { ScreenToClient(gate_hwnd, &mut pt) }.as_bool() {
                        gate_hwnd = refresh_avatar_gate_hwnd(root);
                        if !unsafe { ScreenToClient(gate_hwnd, &mut pt) }.as_bool() {
                            fail_open_to_hittest(&window, &mut last_ignore, "ScreenToClient failed");
                            break 'tick fast_interval;
                        }
                    }

                    let mut client = RECT::default();
                    if unsafe { GetClientRect(gate_hwnd, &mut client) }.is_err() {
                        gate_hwnd = refresh_avatar_gate_hwnd(root);
                        if unsafe { GetClientRect(gate_hwnd, &mut client) }.is_err() {
                            fail_open_to_hittest(&window, &mut last_ignore, "GetClientRect failed");
                            break 'tick fast_interval;
                        }
                    }

                    let cw = (client.right - client.left).max(1);
                    let ch = (client.bottom - client.top).max(1);
                    let in_client = pt.x >= 0 && pt.y >= 0 && pt.x < cw && pt.y < ch;

                    // Keep non-client (title bar) interactive for debugging convenience.
                    let mut interactive = !in_client;
                    if mask_store.force_transparent() {
                        interactive = false;
                    } else if in_client {
                        if let Some(snapshot) = mask_store.load() {
                            interactive = mask_hit_at(&snapshot, pt.x, pt.y, cw, ch);
                        } else {
                            // No mask yet: keep the client click-through.
                            interactive = false;
                        }
                    }

                    let ignore = !interactive;
                    if set_ignore(&window, &mut last_ignore, ignore) {
                        log::trace!(
                            "Avatar cursor gate updated (ignore_cursor_events={}, in_client={}, interactive={})",
                            ignore,
                            in_client,
                            interactive
                        );
                    }

                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    if now_ms.saturating_sub(last_stats_emit_ms) >= 1_000 {
                        last_stats_emit_ms = now_ms;
                        let last_ignore = match GATE_LAST_IGNORE.load(Ordering::Relaxed) {
                            0 => Some(false),
                            1 => Some(true),
                            _ => None,
                        };
                        let _ = window.emit(
                            crate::EVT_AVATAR_HITTEST_STATS,
                            AvatarHitTestStatsPayload {
                                gate_ignore_true: GATE_TRANSITIONS_TRUE.load(Ordering::Relaxed),
                                gate_ignore_false: GATE_TRANSITIONS_FALSE.load(Ordering::Relaxed),
                                gate_fail_open: GATE_FAIL_OPEN.load(Ordering::Relaxed),
                                gate_last_ignore: last_ignore,
                            },
                        );
                    }

                    fast_interval
                };

                tokio::time::sleep(sleep_dur).await;
            }
        });
    }

    pub fn remove_avatar_subclass(window: &tauri::Window) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let root = if !root.0.is_null() { root } else { hwnd };

        let targets = collect_descendant_hwnds(root);
        for target in targets.iter().copied() {
            let _ = unsafe {
                RemoveWindowSubclass(target, Some(avatar_subclass_proc), AVATAR_SUBCLASS_ID)
            };
        }
        log::info!(
            "AvatarWindow subclass removed (hwnd={:?}, root={:?}, targets={})",
            hwnd,
            root,
            targets.len()
        );
        store_avatar_gate_hwnd(HWND(core::ptr::null_mut()));

        let raw = WHEEL_HOOK.swap(0, Ordering::SeqCst);
        if raw != 0 {
            let hook = HHOOK(raw as *mut core::ffi::c_void);
            if !hook.0.is_null() {
                let _ = unsafe { UnhookWindowsHookEx(hook) };
            }
        }
    }

    pub fn ensure_avatar_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
        if let Some(window) = app.get_webview_window("avatar") {
            return Ok(window);
        }

        let debug_show_title = cfg!(debug_assertions);
        let builder = tauri::WebviewWindowBuilder::new(
            app,
            "avatar",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("rcat-avatar")
        .inner_size(520.0, 780.0)
        .resizable(false)
        .transparent(true)
        .decorations(debug_show_title)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true);

        let window = builder.build()?;
        let _ = window.set_focusable(false);
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        Ok(window)
    }
}

#[cfg(target_os = "windows")]
pub use windows_impl::{
    ensure_avatar_window, install_avatar_subclass, remove_avatar_subclass, set_avatar_tool_mode_enabled,
    set_panel_root_hwnd, spawn_avatar_cursor_gate, spawn_avatar_wheel_router,
};
