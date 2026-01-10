import { useSyncExternalStore } from "react";

import { getVrmFpsMode, setVrmFpsMode } from "@/services/vrmSettings";

export type RenderFps = 30 | 60;
export type RenderFpsMode = "auto" | RenderFps;

type RenderFpsState = {
  mode: RenderFpsMode;
  effective: RenderFps;
  rafEmaMs: number | null;
  workEmaMs: number | null;
};

const STORAGE_KEY = "rcat.vrm.fpsMode";

const isRenderFps = (value: string): value is `${RenderFps}` =>
  value === "30" || value === "60";

const readStoredMode = (): RenderFpsMode => {
  if (typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "auto") return "auto";
    if (stored && isRenderFps(stored)) return Number(stored) as RenderFps;
  } catch {
    // Ignore storage failures.
  }
  return "auto";
};

const parsePersistedMode = (value: string): RenderFpsMode | null => {
  if (value === "auto") return "auto";
  if (isRenderFps(value)) return Number(value) as RenderFps;
  return null;
};

let state: RenderFpsState = {
  mode: readStoredMode(),
  effective: 60,
  rafEmaMs: null,
  workEmaMs: null,
};

const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

const hydrateFromTauri = async () => {
  const persisted = await getVrmFpsMode();
  if (persisted) {
    const next = parsePersistedMode(persisted);
    if (next && next !== state.mode) {
      state = { ...state, mode: next };
      emitChange();
    }
    return;
  }

  // Migrate existing localStorage preference into settings.json once.
  const local = parsePersistedMode(String(state.mode));
  if (local && local !== "auto") {
    void setVrmFpsMode(String(local) as "30" | "60").catch(() => {});
  }
};

if (typeof window !== "undefined") {
  void hydrateFromTauri();
}

export const getRenderFpsState = () => state;

export const subscribeRenderFpsState = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setRenderFpsMode = (mode: RenderFpsMode) => {
  state = { ...state, mode };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(mode));
    } catch {
      // Ignore storage failures.
    }
  }
  void setVrmFpsMode(String(mode) as "auto" | "30" | "60").catch(() => {});
  emitChange();
};

export const setRenderFpsStats = (partial: Partial<Omit<RenderFpsState, "mode">>) => {
  state = { ...state, ...partial };
  emitChange();
};

export const useRenderFpsState = () =>
  useSyncExternalStore(subscribeRenderFpsState, getRenderFpsState, getRenderFpsState);
