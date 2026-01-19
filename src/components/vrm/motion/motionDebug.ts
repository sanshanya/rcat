export const MOTION_DEBUG_LOGS_KEY = "rcat.debug.motionLogs";

export const readMotionDebugLogsFromStorage = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MOTION_DEBUG_LOGS_KEY) === "1";
  } catch {
    return false;
  }
};

export const writeMotionDebugLogsToStorage = (enabled: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOTION_DEBUG_LOGS_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
};

