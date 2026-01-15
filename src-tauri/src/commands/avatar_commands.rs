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

    if !stored {
        // Quiet: out-of-order updates are expected when JS is under load or during frontend reload.
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{SystemTime, UNIX_EPOCH};
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

        static LAST_MISMATCH_KEY: AtomicU64 = AtomicU64::new(0);
        static LAST_MISMATCH_AT_MS: AtomicU64 = AtomicU64::new(0);

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
                    let sx = (vw as f64) / (cw as f64);
                    let sy = (vh as f64) / (ch as f64);
                    let uniform = (sx - sy).abs() <= 0.05 && sx.is_finite() && sy.is_finite();
                    let reasonable = sx >= 0.5 && sx <= 4.0 && sy >= 0.5 && sy <= 4.0;
                    let expected = uniform && reasonable;

                    let mut key = 0xCBF29CE484222325u64;
                    for v in [cw as u64, ch as u64, vw as u64, vh as u64] {
                        key ^= v;
                        key = key.wrapping_mul(0x100000001B3);
                    }

                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let last_key = LAST_MISMATCH_KEY.load(Ordering::Relaxed);
                    let last_at = LAST_MISMATCH_AT_MS.load(Ordering::Relaxed);
                    let should_log = key != last_key || now_ms.saturating_sub(last_at) > 5_000;
                    if should_log {
                        LAST_MISMATCH_KEY.store(key, Ordering::Relaxed);
                        LAST_MISMATCH_AT_MS.store(now_ms, Ordering::Relaxed);

                        if expected {
                            log::debug!(
                                "HitTest viewport/client scale differs (expected on DPI scaling): label={}, client={}x{}, viewport={}x{}, impliedScale≈{:.3}x/{:.3}x, dpr={:?}, providedClient={:?}x{:?}",
                                window.label(),
                                cw,
                                ch,
                                vw,
                                vh,
                                sx,
                                sy,
                                args.dpr,
                                args.client_w,
                                args.client_h
                            );
                        } else {
                            log::warn!(
                                "HitTest viewport/client mismatch (suspicious): label={}, client={}x{}, viewport={}x{}, impliedScale≈{:.3}x/{:.3}x, dpr={:?}, providedClient={:?}x{:?}",
                                window.label(),
                                cw,
                                ch,
                                vw,
                                vh,
                                sx,
                                sy,
                                args.dpr,
                                args.client_w,
                                args.client_h
                            );
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarSetToolModeArgs {
    pub mode: String,
}

#[tauri::command]
pub fn avatar_set_tool_mode(args: AvatarSetToolModeArgs) -> Result<(), String> {
    let mode = args.mode.trim().to_ascii_lowercase();
    crate::windows::avatar_window::set_avatar_tool_mode_enabled(mode == "avatar");
    Ok(())
}
