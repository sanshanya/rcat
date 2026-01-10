import { invoke } from "@tauri-apps/api/core";

import { isTauriContext, reportPromiseError } from "@/utils";

export type PersistedVrmFpsMode = "auto" | "30" | "60";

export type PersistedVrmViewState = {
  cameraPosition: [number, number, number];
  target: [number, number, number];
};

export type PersistedVrmAvatarState = {
  position: [number, number, number];
  scale: number;
};

export type PersistedVrmHudPanelPosition = {
  x: number;
  y: number;
};

export type PersistedVrmHudLayoutSettings = {
  locked: boolean;
  debugPanel?: PersistedVrmHudPanelPosition | null;
};

export type PersistedVrmMouseTrackingPart = {
  enabled: boolean;
  yawLimitDeg: number;
  pitchLimitDeg: number;
  smoothness: number;
  blend: number;
};

export type PersistedVrmSpineTracking = {
  enabled: boolean;
  minYawDeg: number;
  maxYawDeg: number;
  smoothness: number;
  fadeSpeed: number;
  falloff: number;
  blend: number;
};

export type PersistedVrmMouseTrackingSettings = {
  enabled: boolean;
  head: PersistedVrmMouseTrackingPart;
  spine: PersistedVrmSpineTracking;
  eyes: PersistedVrmMouseTrackingPart;
};

const reporters = {
  getFpsMode: reportPromiseError("vrmSettings.getFpsMode", {
    onceKey: "vrmSettings.getFpsMode",
    devOnly: true,
  }),
  setFpsMode: reportPromiseError("vrmSettings.setFpsMode", {
    onceKey: "vrmSettings.setFpsMode",
    devOnly: true,
  }),
  getViewState: reportPromiseError("vrmSettings.getViewState", {
    onceKey: "vrmSettings.getViewState",
    devOnly: true,
  }),
  setViewState: reportPromiseError("vrmSettings.setViewState", {
    onceKey: "vrmSettings.setViewState",
    devOnly: true,
  }),
  getAvatarState: reportPromiseError("vrmSettings.getAvatarState", {
    onceKey: "vrmSettings.getAvatarState",
    devOnly: true,
  }),
  setAvatarState: reportPromiseError("vrmSettings.setAvatarState", {
    onceKey: "vrmSettings.setAvatarState",
    devOnly: true,
  }),
  getHudLayout: reportPromiseError("vrmSettings.getHudLayout", {
    onceKey: "vrmSettings.getHudLayout",
    devOnly: true,
  }),
  setHudLayout: reportPromiseError("vrmSettings.setHudLayout", {
    onceKey: "vrmSettings.setHudLayout",
    devOnly: true,
  }),
  getMouseTracking: reportPromiseError("vrmSettings.getMouseTracking", {
    onceKey: "vrmSettings.getMouseTracking",
    devOnly: true,
  }),
  setMouseTracking: reportPromiseError("vrmSettings.setMouseTracking", {
    onceKey: "vrmSettings.setMouseTracking",
    devOnly: true,
  }),
} as const;

export const getVrmFpsMode = async (): Promise<PersistedVrmFpsMode | null> => {
  if (!isTauriContext()) return null;
  try {
    return await invoke<PersistedVrmFpsMode | null>("get_vrm_fps_mode");
  } catch (err) {
    reporters.getFpsMode(err);
    return null;
  }
};

export const setVrmFpsMode = async (mode: PersistedVrmFpsMode): Promise<void> => {
  if (!isTauriContext()) return;
  try {
    await invoke<void>("set_vrm_fps_mode", { mode });
  } catch (err) {
    reporters.setFpsMode(err);
  }
};

export const getVrmViewState = async (
  url: string
): Promise<PersistedVrmViewState | null> => {
  const normalized = url.trim();
  if (!normalized) return null;
  if (!isTauriContext()) return null;
  try {
    return await invoke<PersistedVrmViewState | null>("get_vrm_view_state", {
      url: normalized,
    });
  } catch (err) {
    reporters.getViewState(err);
    return null;
  }
};

export const setVrmViewState = async (
  url: string,
  viewState: PersistedVrmViewState
): Promise<void> => {
  const normalized = url.trim();
  if (!normalized) return;
  if (!isTauriContext()) return;
  try {
    await invoke<void>("set_vrm_view_state", { url: normalized, viewState });
  } catch (err) {
    reporters.setViewState(err);
  }
};

export const getVrmAvatarState = async (
  url: string
): Promise<PersistedVrmAvatarState | null> => {
  const normalized = url.trim();
  if (!normalized) return null;
  if (!isTauriContext()) return null;
  try {
    return await invoke<PersistedVrmAvatarState | null>("get_vrm_avatar_state", {
      url: normalized,
    });
  } catch (err) {
    reporters.getAvatarState(err);
    return null;
  }
};

export const setVrmAvatarState = async (
  url: string,
  avatarState: PersistedVrmAvatarState
): Promise<void> => {
  const normalized = url.trim();
  if (!normalized) return;
  if (!isTauriContext()) return;
  try {
    await invoke<void>("set_vrm_avatar_state", { url: normalized, avatarState });
  } catch (err) {
    reporters.setAvatarState(err);
  }
};

export const getVrmHudLayout = async (): Promise<PersistedVrmHudLayoutSettings | null> => {
  if (!isTauriContext()) return null;
  try {
    return await invoke<PersistedVrmHudLayoutSettings>("get_vrm_hud_layout");
  } catch (err) {
    reporters.getHudLayout(err);
    return null;
  }
};

export const setVrmHudLayout = async (
  hudLayout: PersistedVrmHudLayoutSettings
): Promise<void> => {
  if (!isTauriContext()) return;
  try {
    await invoke<void>("set_vrm_hud_layout", { hudLayout });
  } catch (err) {
    reporters.setHudLayout(err);
  }
};

export const getVrmMouseTracking = async (): Promise<PersistedVrmMouseTrackingSettings | null> => {
  if (!isTauriContext()) return null;
  try {
    return await invoke<PersistedVrmMouseTrackingSettings>("get_vrm_mouse_tracking");
  } catch (err) {
    reporters.getMouseTracking(err);
    return null;
  }
};

export const setVrmMouseTracking = async (
  mouseTracking: PersistedVrmMouseTrackingSettings
): Promise<void> => {
  if (!isTauriContext()) return;
  try {
    await invoke<void>("set_vrm_mouse_tracking", { mouseTracking });
  } catch (err) {
    reporters.setMouseTracking(err);
  }
};
