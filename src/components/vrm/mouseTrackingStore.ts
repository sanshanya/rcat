import { useSyncExternalStore } from "react";

import { getVrmMouseTracking, setVrmMouseTracking } from "@/services/vrmSettings";
import {
  clampMouseTrackingSettings,
  DEFAULT_VRM_MOUSE_TRACKING_SETTINGS,
  type VrmMouseTrackingSettings,
} from "@/components/vrm/mouseTrackingTypes";

const STORAGE_KEY = "rcat.vrm.mouseTracking";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const parsePart = (
  value: unknown
): VrmMouseTrackingSettings["head"] | VrmMouseTrackingSettings["eyes"] | null => {
  if (!isRecord(value)) return null;
  if (!isBoolean(value.enabled)) return null;
  if (!isNumber(value.yawLimitDeg)) return null;
  if (!isNumber(value.pitchLimitDeg)) return null;
  if (!isNumber(value.smoothness)) return null;
  if (!isNumber(value.blend)) return null;
  return {
    enabled: value.enabled,
    yawLimitDeg: value.yawLimitDeg,
    pitchLimitDeg: value.pitchLimitDeg,
    smoothness: value.smoothness,
    blend: value.blend,
  };
};

const parseSpine = (value: unknown): VrmMouseTrackingSettings["spine"] | null => {
  if (!isRecord(value)) return null;
  if (!isBoolean(value.enabled)) return null;
  if (!isNumber(value.minYawDeg)) return null;
  if (!isNumber(value.maxYawDeg)) return null;
  if (!isNumber(value.smoothness)) return null;
  if (!isNumber(value.fadeSpeed)) return null;
  if (!isNumber(value.falloff)) return null;
  if (!isNumber(value.blend)) return null;
  return {
    enabled: value.enabled,
    minYawDeg: value.minYawDeg,
    maxYawDeg: value.maxYawDeg,
    smoothness: value.smoothness,
    fadeSpeed: value.fadeSpeed,
    falloff: value.falloff,
    blend: value.blend,
  };
};

const parseSettings = (value: unknown): VrmMouseTrackingSettings | null => {
  if (!isRecord(value)) return null;
  if (!isBoolean(value.enabled)) return null;
  const head = parsePart(value.head);
  const eyes = parsePart(value.eyes);
  const spine = parseSpine(value.spine);
  if (!head || !eyes || !spine) return null;
  return clampMouseTrackingSettings({ enabled: value.enabled, head, spine, eyes });
};

const readStoredSettings = (): VrmMouseTrackingSettings => {
  if (typeof window === "undefined") return DEFAULT_VRM_MOUSE_TRACKING_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VRM_MOUSE_TRACKING_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return parseSettings(parsed) ?? DEFAULT_VRM_MOUSE_TRACKING_SETTINGS;
  } catch {
    return DEFAULT_VRM_MOUSE_TRACKING_SETTINGS;
  }
};

let state: VrmMouseTrackingSettings = readStoredSettings();

const listeners = new Set<() => void>();

const PERSIST_DEBOUNCE_MS = 250;
let persistTimer: number | null = null;

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

const persistNow = () => {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  void setVrmMouseTracking(state).catch(() => {});
};

const persistDebounced = () => {
  if (typeof window === "undefined") return;
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
};

const hydrateFromTauri = async () => {
  const persisted = await getVrmMouseTracking();
  if (persisted) {
    const parsed = parseSettings(persisted);
    if (parsed) {
      state = parsed;
      emitChange();
      return;
    }
  }

  // Migrate local settings into settings.json once.
  persistNow();
};

if (typeof window !== "undefined") {
  void hydrateFromTauri();
  window.addEventListener("pagehide", persistNow);
}

export const getMouseTrackingSettings = () => state;

export const subscribeMouseTrackingSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setMouseTrackingSettings = (next: VrmMouseTrackingSettings) => {
  state = clampMouseTrackingSettings(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage failures.
    }
  }
  persistDebounced();
  emitChange();
};

export const useMouseTrackingSettings = () =>
  useSyncExternalStore(
    subscribeMouseTrackingSettings,
    getMouseTrackingSettings,
    getMouseTrackingSettings
  );
