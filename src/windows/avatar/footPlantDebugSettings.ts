export const FOOTPLANT_ENABLED_STORAGE_KEY = "rcat.debug.footPlantEnabled";

export type DebugFootPlantSettingsPayload = {
  enabled?: boolean;
};

export const readFootPlantEnabledFromStorage = () => {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(FOOTPLANT_ENABLED_STORAGE_KEY);
    if (!raw) return true;
    return raw === "1";
  } catch {
    return true;
  }
};

export const writeFootPlantEnabledToStorage = (value: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FOOTPLANT_ENABLED_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
};

