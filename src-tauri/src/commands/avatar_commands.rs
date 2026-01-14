use base64::Engine;
use serde::Deserialize;

use crate::windows::hittest_mask::{HitTestMaskStore, MaskRect, MaskSnapshot};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarUpdateHitTestMaskArgs {
    pub seq: u64,
    pub mask_w: u32,
    pub mask_h: u32,
    pub rect: MaskRect,
    pub bitset_base64: String,
    pub viewport_w: u32,
    pub viewport_h: u32,
    pub client_w: Option<u32>,
    pub client_h: Option<u32>,
    pub dpr: Option<f64>,
}

#[tauri::command]
pub fn avatar_update_hittest_mask(
    window: tauri::WebviewWindow,
    mask_store: tauri::State<HitTestMaskStore>,
    args: AvatarUpdateHitTestMaskArgs,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    let _ = window.label();

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(args.bitset_base64.as_bytes())
        .map_err(|e| format!("bitsetBase64 decode failed: {e}"))?;

    let Some(snapshot) = MaskSnapshot::new(
        args.seq,
        args.mask_w,
        args.mask_h,
        args.rect,
        decoded,
        args.viewport_w,
        args.viewport_h,
    ) else {
        return Err("Invalid mask snapshot".into());
    };

    let stored = mask_store.update(snapshot);

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

        if let Ok(hwnd) = window.hwnd() {
            let mut rect = RECT::default();
            if unsafe { GetClientRect(hwnd, &mut rect) }.is_ok() {
                let cw = (rect.right - rect.left).max(1) as u32;
                let ch = (rect.bottom - rect.top).max(1) as u32;

                let vw = args.viewport_w.max(1);
                let vh = args.viewport_h.max(1);

                let dw = cw.abs_diff(vw);
                let dh = ch.abs_diff(vh);
                if dw > 32 || dh > 32 {
                    log::warn!(
                        "HitTest viewport/client mismatch (label={}, client={}x{}, viewport={}x{}, dpr={:?}, providedClient={:?}x{:?})",
                        window.label(),
                        cw,
                        ch,
                        vw,
                        vh,
                        args.dpr,
                        args.client_w,
                        args.client_h
                    );
                }
            }
        }
    }

    if !stored {
        // Quiet: out-of-order updates are expected when JS is under load.
        return Ok(());
    }
    Ok(())
}
