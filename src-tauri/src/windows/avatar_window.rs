#[cfg(not(target_os = "windows"))]
pub fn install_avatar_subclass(
    _window: &tauri::WebviewWindow,
    _mask_store: &crate::windows::hittest_mask::HitTestMaskStore,
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

#[cfg(target_os = "windows")]
mod windows_impl {
    use crate::windows::hittest_mask::HitTestMaskStore;
    use crate::window_state::WindowStateStore;
    use crate::WindowMode;
    use std::sync::atomic::{AtomicIsize, Ordering};
    use tauri::Manager;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetAncestor, GetClassNameW, GetClientRect, GetWindowRect,
        GetWindowThreadProcessId, GA_ROOT, HTCLIENT, HTTRANSPARENT, MA_NOACTIVATE, WM_CREATE,
        WM_MOUSEACTIVATE, WM_NCHITTEST, WM_PARENTNOTIFY,
    };

    const AVATAR_SUBCLASS_ID: usize = 0x5243_4154_5641_5441; // "RCATVATA" (unique-ish)

    static AVATAR_GATE_HWND: AtomicIsize = AtomicIsize::new(0);

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
        let targets = collect_descendant_hwnds(root);
        let gate = select_avatar_gate_hwnd(root, &targets);
        store_avatar_gate_hwnd(gate);
        gate
    }

    fn lparam_to_screen_point(l_param: LPARAM) -> POINT {
        let raw = l_param.0 as i32 as u32;
        let x = (raw & 0xFFFF) as u16 as i16 as i32;
        let y = ((raw >> 16) & 0xFFFF) as u16 as i16 as i32;
        POINT { x, y }
    }

    fn handle_nchittest(hwnd: HWND, l_param: LPARAM, mask_store: &HitTestMaskStore) -> LRESULT {
        if mask_store.force_transparent() {
            return LRESULT(HTTRANSPARENT as isize);
        }

        let Some(snapshot) = mask_store.load() else {
            return LRESULT(HTTRANSPARENT as isize);
        };
        if snapshot.rect.is_empty() {
            return LRESULT(HTTRANSPARENT as isize);
        }

        let mut pt = lparam_to_screen_point(l_param);
        if !unsafe { ScreenToClient(hwnd, &mut pt) }.as_bool() {
            return LRESULT(HTTRANSPARENT as isize);
        }

        let mut client = RECT::default();
        if unsafe { GetClientRect(hwnd, &mut client) }.is_err() {
            return LRESULT(HTTRANSPARENT as isize);
        }

        let client_w = (client.right - client.left).max(1);
        let client_h = (client.bottom - client.top).max(1);
        if pt.x < 0 || pt.y < 0 || pt.x >= client_w || pt.y >= client_h {
            return LRESULT(HTTRANSPARENT as isize);
        }

        let vx = ((pt.x as i64) * (snapshot.viewport_w as i64) / (client_w as i64)) as i64;
        let vy = ((pt.y as i64) * (snapshot.viewport_h as i64) / (client_h as i64)) as i64;

        let mx = (vx * snapshot.mask_w as i64 / snapshot.viewport_w as i64) as i64;
        let my = (vy * snapshot.mask_h as i64 / snapshot.viewport_h as i64) as i64;

        if mx < 0 || my < 0 {
            return LRESULT(HTTRANSPARENT as isize);
        }
        let mx = mx as u32;
        let my = my as u32;
        if mx >= snapshot.mask_w || my >= snapshot.mask_h {
            return LRESULT(HTTRANSPARENT as isize);
        }
        if !snapshot.rect.contains(mx, my) {
            return LRESULT(HTTRANSPARENT as isize);
        }

        let mx_usize = mx as usize;
        let my_usize = my as usize;
        let idx = my_usize * snapshot.stride + (mx_usize / 8);
        let Some(byte) = snapshot.bitset.get(idx) else {
            return LRESULT(HTTRANSPARENT as isize);
        };
        let bit = (byte >> (mx_usize % 8)) & 1;
        if bit == 1 {
            LRESULT(HTCLIENT as isize)
        } else {
            LRESULT(HTTRANSPARENT as isize)
        }
    }

    unsafe extern "system" fn avatar_subclass_proc(
        hwnd: HWND,
        msg: u32,
        w_param: WPARAM,
        l_param: LPARAM,
        _u_id_subclass: usize,
        dw_ref_data: usize,
    ) -> LRESULT {
        let mask_store = unsafe { &*(dw_ref_data as *const HitTestMaskStore) };

        match msg {
            WM_NCHITTEST => handle_nchittest(hwnd, l_param, mask_store),
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
                        log::debug!(
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
        mask_store: &HitTestMaskStore,
    ) -> tauri::Result<()> {
        let hwnd = window.hwnd()?;
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let root = if !root.0.is_null() { root } else { hwnd };

        let ref_data = (mask_store as *const HitTestMaskStore) as usize;
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
            log::debug!(
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
            use windows::Win32::Foundation::POINT;
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_LBUTTON, VK_RBUTTON};
            use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

            let fast_interval = Duration::from_millis(33);
            let slow_interval = Duration::from_millis(300);
            let mut last_ignore: Option<bool> = None;

            log::info!("Avatar cursor gate started (rate≈30Hz)");

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

                    let mut fail_open_to_hittest = |reason: &str| {
                        if last_ignore != Some(false) {
                            let _ = window.set_ignore_cursor_events(false);
                            last_ignore = Some(false);
                            log::debug!("Avatar cursor gate fail-open: {}", reason);
                        }
                    };

                    // While the panel is open, make the avatar fully click-through so it never
                    // steals wheel/click input from the panel (e.g. when the panel overlaps the model).
                    let panel_visible = app
                        .get_webview_window("main")
                        .and_then(|w| w.is_visible().ok())
                        .unwrap_or(false);
                    if panel_visible {
                        let mode = app.state::<WindowStateStore>().get_current_mode();
                        if !matches!(mode, WindowMode::Mini) {
                            let ignore = true;
                            if last_ignore != Some(ignore) {
                                let _ = window.set_ignore_cursor_events(ignore);
                                last_ignore = Some(ignore);
                                log::debug!(
                                    "Avatar cursor gate forced click-through (panel visible; mode={:?})",
                                    mode
                                );
                            }
                            break 'tick fast_interval;
                        }
                    }

                    // Avoid toggling mid-drag to prevent losing capture / breaking controls.
                    let left_down = unsafe { GetKeyState(VK_LBUTTON.0 as i32) } < 0;
                    let right_down = unsafe { GetKeyState(VK_RBUTTON.0 as i32) } < 0;
                    if left_down || right_down {
                        break 'tick fast_interval;
                    }

                    let mut screen = POINT::default();
                    if unsafe { GetCursorPos(&mut screen) }.is_err() {
                        fail_open_to_hittest("GetCursorPos failed");
                        break 'tick fast_interval;
                    }

                    // Hybrid polling: only do the expensive mask query while the cursor is
                    // within the avatar window bounds. When outside, force ignore=false so
                    // `WM_NCHITTEST` remains available immediately on re-entry.
                    let mut window_rect = RECT::default();
                    if unsafe { GetWindowRect(root, &mut window_rect) }.is_err() {
                        fail_open_to_hittest("GetWindowRect failed");
                        break 'tick slow_interval;
                    }
                    let in_window = screen.x >= window_rect.left
                        && screen.y >= window_rect.top
                        && screen.x < window_rect.right
                        && screen.y < window_rect.bottom;
                    if !in_window {
                        if last_ignore != Some(false) {
                            let _ = window.set_ignore_cursor_events(false);
                            last_ignore = Some(false);
                        }
                        break 'tick slow_interval;
                    }

                    let mut pt = screen;
                    if !unsafe { ScreenToClient(gate_hwnd, &mut pt) }.as_bool() {
                        gate_hwnd = refresh_avatar_gate_hwnd(root);
                        if !unsafe { ScreenToClient(gate_hwnd, &mut pt) }.as_bool() {
                            fail_open_to_hittest("ScreenToClient failed");
                            break 'tick fast_interval;
                        }
                    }

                    let mut client = RECT::default();
                    if unsafe { GetClientRect(gate_hwnd, &mut client) }.is_err() {
                        gate_hwnd = refresh_avatar_gate_hwnd(root);
                        if unsafe { GetClientRect(gate_hwnd, &mut client) }.is_err() {
                            fail_open_to_hittest("GetClientRect failed");
                            break 'tick fast_interval;
                        }
                    }

                    let cw = (client.right - client.left).max(1);
                    let ch = (client.bottom - client.top).max(1);
                    let in_client = pt.x >= 0 && pt.y >= 0 && pt.x < cw && pt.y < ch;

                    let mask_store = app.state::<HitTestMaskStore>();

                    // Keep non-client (title bar) interactive for debugging convenience.
                    let mut interactive = !in_client;
                    if mask_store.force_transparent() {
                        interactive = false;
                    } else if in_client {
                        if let Some(snapshot) = mask_store.load() {
                            let mx = ((pt.x as i64) * (snapshot.mask_w as i64) / (cw as i64)) as i64;
                            let my = ((pt.y as i64) * (snapshot.mask_h as i64) / (ch as i64)) as i64;

                            if mx >= 0 && my >= 0 {
                                let mx = mx as u32;
                                let my = my as u32;
                                if mx < snapshot.mask_w
                                    && my < snapshot.mask_h
                                    && snapshot.rect.contains(mx, my)
                                {
                                    let mx_usize = mx as usize;
                                    let my_usize = my as usize;
                                    let idx = my_usize * snapshot.stride + (mx_usize / 8);
                                    if let Some(byte) = snapshot.bitset.get(idx) {
                                        let bit = (byte >> (mx_usize % 8)) & 1;
                                        interactive = bit == 1;
                                    }
                                }
                            }
                        } else {
                            // No mask yet: keep the client click-through.
                            interactive = false;
                        }
                    }

                    let ignore = !interactive;
                    if last_ignore != Some(ignore) {
                        let _ = window.set_ignore_cursor_events(ignore);
                        last_ignore = Some(ignore);
                        log::debug!(
                            "Avatar cursor gate updated (ignore_cursor_events={}, in_client={}, interactive={})",
                            ignore,
                            in_client,
                            interactive
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
    ensure_avatar_window, install_avatar_subclass, remove_avatar_subclass, spawn_avatar_cursor_gate,
};
