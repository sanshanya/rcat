// src/utils/tauri.ts

export const isTauriContext = (): boolean => {
  if (typeof window === "undefined") return false;

  type TauriInternals = {
    invoke?: unknown;
    metadata?: {
      currentWindow?: {
        label?: unknown;
      };
    };
  };

  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
  if (!internals) return false;

  const hasInvoke = typeof internals.invoke === "function";
  const hasCurrentWindowLabel =
    typeof internals.metadata?.currentWindow?.label === "string";

  return hasInvoke && hasCurrentWindowLabel;
};
