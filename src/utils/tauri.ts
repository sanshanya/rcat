// src/utils/tauri.ts

export const isTauriContext = (): boolean => {
  if (typeof window === "undefined") return false;

  // Primary: modern Tauri APIs rely on `__TAURI_INTERNALS__`.
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } })
    .__TAURI_INTERNALS__;
  if (typeof internals?.invoke === "function") return true;

  // Optional: when `app.withGlobalTauri` is enabled, APIs are exposed on `window.__TAURI__`.
  const globalTauri = (window as unknown as { __TAURI__?: { core?: { invoke?: unknown } } })
    .__TAURI__;
  if (typeof globalTauri?.core?.invoke === "function") return true;

  return false;
};

export const getTauriScaleFactor = async (): Promise<number> => {
  if (typeof window === "undefined") return 1;
  if (!isTauriContext()) return window.devicePixelRatio || 1;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const scale = await getCurrentWindow().scaleFactor();
    if (Number.isFinite(scale) && scale > 0) return scale;
  } catch {
    // Ignore and fall back.
  }

  return window.devicePixelRatio || 1;
};
