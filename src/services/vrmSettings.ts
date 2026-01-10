import { invoke } from "@tauri-apps/api/core";

import { isTauriContext, reportPromiseError } from "@/utils";

export type PersistedVrmFpsMode = "auto" | "30" | "60";

export type PersistedVrmViewState = {
  cameraPosition: [number, number, number];
  target: [number, number, number];
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

