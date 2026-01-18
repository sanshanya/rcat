use std::sync::atomic::{AtomicIsize, Ordering};

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetAncestor, GetClassNameW, GetClientRect, GetWindowThreadProcessId, GA_ROOT,
    MA_NOACTIVATE, WM_CREATE, WM_MOUSEACTIVATE, WM_PARENTNOTIFY,
};

const AVATAR_SUBCLASS_ID: usize = 0x5243_4154_5641_5441; // "RCATVATA" (unique-ish)

static AVATAR_GATE_HWND: AtomicIsize = AtomicIsize::new(0);
static AVATAR_ROOT_HWND: AtomicIsize = AtomicIsize::new(0);

pub(crate) fn load_avatar_root_hwnd() -> Option<HWND> {
    let raw = AVATAR_ROOT_HWND.load(Ordering::Relaxed);
    if raw == 0 {
        None
    } else {
        Some(HWND(raw as *mut core::ffi::c_void))
    }
}

pub(crate) fn store_avatar_root_hwnd(hwnd: HWND) {
    AVATAR_ROOT_HWND.store(hwnd.0 as isize, Ordering::Relaxed);
}

pub(crate) fn load_avatar_gate_hwnd() -> Option<HWND> {
    let raw = AVATAR_GATE_HWND.load(Ordering::Relaxed);
    if raw == 0 {
        None
    } else {
        Some(HWND(raw as *mut core::ffi::c_void))
    }
}

pub(crate) fn store_avatar_gate_hwnd(hwnd: HWND) {
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

pub(crate) fn refresh_avatar_gate_hwnd(root: HWND) -> HWND {
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

#[derive(Debug, Clone, Copy)]
pub(crate) struct AvatarGateClientPoint {
    pub gate_hwnd: HWND,
    pub client: POINT,
    pub client_w: i32,
    pub client_h: i32,
    pub in_client: bool,
}

pub(crate) fn map_screen_to_avatar_client(root: HWND, screen: POINT) -> Option<AvatarGateClientPoint> {
    let mut gate_hwnd = load_avatar_gate_hwnd().unwrap_or(root);
    if gate_hwnd.0.is_null() {
        gate_hwnd = root;
    }

    if unsafe { GetAncestor(gate_hwnd, GA_ROOT) }.0 != root.0 {
        gate_hwnd = refresh_avatar_gate_hwnd(root);
    }

    let mut pt = screen;
    if !unsafe { ScreenToClient(gate_hwnd, &mut pt) }.as_bool() {
        gate_hwnd = refresh_avatar_gate_hwnd(root);
        pt = screen;
        if !unsafe { ScreenToClient(gate_hwnd, &mut pt) }.as_bool() {
            gate_hwnd = root;
            pt = screen;
            if !unsafe { ScreenToClient(gate_hwnd, &mut pt) }.as_bool() {
                return None;
            }
        }
    }

    let mut client_rect = RECT::default();
    if unsafe { GetClientRect(gate_hwnd, &mut client_rect) }.is_err() {
        gate_hwnd = refresh_avatar_gate_hwnd(root);
        if unsafe { GetClientRect(gate_hwnd, &mut client_rect) }.is_err() {
            gate_hwnd = root;
            if unsafe { GetClientRect(gate_hwnd, &mut client_rect) }.is_err() {
                return None;
            }
        }
    }

    let cw = (client_rect.right - client_rect.left).max(1);
    let ch = (client_rect.bottom - client_rect.top).max(1);
    let in_client = pt.x >= 0 && pt.y >= 0 && pt.x < cw && pt.y < ch;

    Some(AvatarGateClientPoint {
        gate_hwnd,
        client: pt,
        client_w: cw,
        client_h: ch,
        in_client,
    })
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

pub fn install_avatar_subclass(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let hwnd = window.hwnd()?;
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let root = if !root.0.is_null() { root } else { hwnd };
    store_avatar_root_hwnd(root);

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
        let ok = unsafe { SetWindowSubclass(target, Some(avatar_subclass_proc), AVATAR_SUBCLASS_ID, ref_data) };
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

pub fn remove_avatar_subclass(window: &tauri::Window) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let root = if !root.0.is_null() { root } else { hwnd };

    let targets = collect_descendant_hwnds(root);
    for target in targets.iter().copied() {
        let _ = unsafe { RemoveWindowSubclass(target, Some(avatar_subclass_proc), AVATAR_SUBCLASS_ID) };
    }
    log::info!(
        "AvatarWindow subclass removed (hwnd={:?}, root={:?}, targets={})",
        hwnd,
        root,
        targets.len()
    );

    store_avatar_gate_hwnd(HWND(core::ptr::null_mut()));
    store_avatar_root_hwnd(HWND(core::ptr::null_mut()));
    super::service::stop_avatar_windows_service();
}
