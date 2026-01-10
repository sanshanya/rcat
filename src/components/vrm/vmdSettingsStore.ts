import { useSyncExternalStore } from "react";

import {
  clampVmdMotionSettings,
  DEFAULT_VMD_MOTION_SETTINGS,
  type VmdMotionSettings,
} from "@/components/vrm/vmdSettingsTypes";

const STORAGE_KEY = "rcat.vrm.vmdSettings";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const parseSettings = (value: unknown): VmdMotionSettings | null => {
  if (!isRecord(value)) return null;
  if (!isBoolean(value.enableIk)) return null;
  if (!isBoolean(value.includeFingers)) return null;
  if (!isNumber(value.smoothingTauSeconds)) return null;
  return clampVmdMotionSettings({
    enableIk: value.enableIk,
    includeFingers: value.includeFingers,
    smoothingTauSeconds: value.smoothingTauSeconds,
  });
};

const readStored = (): VmdMotionSettings => {
  if (typeof window === "undefined") return DEFAULT_VMD_MOTION_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VMD_MOTION_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return parseSettings(parsed) ?? DEFAULT_VMD_MOTION_SETTINGS;
  } catch {
    return DEFAULT_VMD_MOTION_SETTINGS;
  }
};

let state: VmdMotionSettings = readStored();

const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

export const getVmdMotionSettings = () => state;

export const subscribeVmdMotionSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setVmdMotionSettings = (next: VmdMotionSettings) => {
  state = clampVmdMotionSettings(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage failures.
    }
  }
  emitChange();
};

export const useVmdMotionSettings = () =>
  useSyncExternalStore(subscribeVmdMotionSettings, getVmdMotionSettings, getVmdMotionSettings);

