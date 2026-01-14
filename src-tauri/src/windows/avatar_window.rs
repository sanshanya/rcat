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

#[cfg(target_os = "windows")]
mod windows_impl {
    use crate::windows::hittest_mask::HitTestMaskStore;
    use tauri::Manager;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_MENU};
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, HTCAPTION, HTCLIENT, HTTRANSPARENT, MA_NOACTIVATE, WM_MOUSEACTIVATE,
        WM_NCHITTEST,
    };

    const AVATAR_SUBCLASS_ID: usize = 0x5243_4154_5641_5441; // "RCATVATA" (unique-ish)

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
            let alt_down = unsafe { GetKeyState(VK_MENU.0 as i32) } < 0;
            if alt_down {
                LRESULT(HTCAPTION as isize)
            } else {
                LRESULT(HTCLIENT as isize)
            }
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
            _ => unsafe { DefSubclassProc(hwnd, msg, w_param, l_param) },
        }
    }

    pub fn install_avatar_subclass(
        window: &tauri::WebviewWindow,
        mask_store: &HitTestMaskStore,
    ) -> tauri::Result<()> {
        let hwnd = window.hwnd()?;
        let ref_data = (mask_store as *const HitTestMaskStore) as usize;
        let ok = unsafe { SetWindowSubclass(hwnd, Some(avatar_subclass_proc), AVATAR_SUBCLASS_ID, ref_data) };
        if ok.as_bool() {
            log::info!("AvatarWindow subclass installed (hwnd={:?})", hwnd);
        } else {
            log::warn!("AvatarWindow subclass install failed (hwnd={:?})", hwnd);
        }
        Ok(())
    }

    pub fn remove_avatar_subclass(window: &tauri::Window) {
        let Ok(hwnd) = window.hwnd() else { return };
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(avatar_subclass_proc), AVATAR_SUBCLASS_ID) };
        log::info!("AvatarWindow subclass removed (hwnd={:?})", hwnd);
    }

    pub fn ensure_avatar_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
        if let Some(window) = app.get_webview_window("avatar") {
            return Ok(window);
        }

        let builder = tauri::WebviewWindowBuilder::new(
            app,
            "avatar",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("rcat-avatar")
        .inner_size(520.0, 780.0)
        .resizable(false)
        .transparent(true)
        .decorations(false)
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
pub use windows_impl::{ensure_avatar_window, install_avatar_subclass, remove_avatar_subclass};
