import { useSyncExternalStore } from "react";

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
  emitChange();
};

export const setRenderFpsStats = (partial: Partial<Omit<RenderFpsState, "mode">>) => {
  state = { ...state, ...partial };
  emitChange();
};

export const useRenderFpsState = () =>
  useSyncExternalStore(subscribeRenderFpsState, getRenderFpsState, getRenderFpsState);

