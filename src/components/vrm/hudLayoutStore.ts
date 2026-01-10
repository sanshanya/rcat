import { useSyncExternalStore } from "react";

import { getVrmHudLayout, setVrmHudLayout } from "@/services/vrmSettings";
import {
  clampHudLayoutSettings,
  DEFAULT_VRM_HUD_LAYOUT_SETTINGS,
  type VrmHudLayoutSettings,
  type VrmHudPanelPosition,
} from "@/components/vrm/hudLayoutTypes";

const STORAGE_KEY = "rcat.vrm.hudLayout";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const parsePos = (value: unknown): VrmHudPanelPosition | null => {
  if (!isRecord(value)) return null;
  if (!isNumber(value.x) || !isNumber(value.y)) return null;
  return { x: value.x, y: value.y };
};

const parseSettings = (value: unknown): VrmHudLayoutSettings | null => {
  if (!isRecord(value)) return null;
  if (!isBoolean(value.locked)) return null;
  const debugPanel =
    value.debugPanel === null || value.debugPanel === undefined
      ? null
      : parsePos(value.debugPanel);
  if (value.debugPanel != null && !debugPanel) return null;
  return clampHudLayoutSettings({ locked: value.locked, debugPanel });
};

const readStored = (): VrmHudLayoutSettings => {
  if (typeof window === "undefined") return DEFAULT_VRM_HUD_LAYOUT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VRM_HUD_LAYOUT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return parseSettings(parsed) ?? DEFAULT_VRM_HUD_LAYOUT_SETTINGS;
  } catch {
    return DEFAULT_VRM_HUD_LAYOUT_SETTINGS;
  }
};

let state: VrmHudLayoutSettings = readStored();

const listeners = new Set<() => void>();
let dirty = false;

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

const persistNow = () => {
  if (typeof window === "undefined") return;
  if (!dirty) return;
  dirty = false;
  void setVrmHudLayout(state).catch(() => {});
};

const hydrateFromTauri = async () => {
  const persisted = await getVrmHudLayout();
  if (persisted) {
    const parsed = parseSettings(persisted);
    if (parsed) {
      state = parsed;
      emitChange();
      return;
    }
  }

  dirty = true;
  persistNow();
};

if (typeof window !== "undefined") {
  void hydrateFromTauri();
  window.addEventListener("pagehide", persistNow);
}

export const getVrmHudLayoutSettings = () => state;

export const subscribeVrmHudLayoutSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setVrmHudLayoutSettings = (
  next: VrmHudLayoutSettings,
  options: { persist?: boolean } = {}
) => {
  state = clampHudLayoutSettings(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage failures.
    }
  }
  dirty = true;
  if (options.persist !== false) {
    persistNow();
  }
  emitChange();
};

export const useVrmHudLayoutSettings = () =>
  useSyncExternalStore(
    subscribeVrmHudLayoutSettings,
    getVrmHudLayoutSettings,
    getVrmHudLayoutSettings
  );

