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
