import { useCallback, useSyncExternalStore } from "react";

export type GazeSource = "manual" | "local" | "global" | "drift";

export type GazeRuntimeDebug = {
  x: number;
  y: number;
  source: GazeSource;
  updatedAt: number | null;
  manualEnabled: boolean;
  manualX: number;
  manualY: number;
};

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

let gazeRuntimeDebug: GazeRuntimeDebug = {
  x: 0,
  y: 0,
  source: "drift",
  updatedAt: null,
  manualEnabled: false,
  manualX: 0,
  manualY: 0,
};

const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

export const subscribeGazeRuntimeDebug = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getGazeRuntimeDebug = () => gazeRuntimeDebug;

export const setGazeRuntimeDebug = (next: Partial<GazeRuntimeDebug>) => {
  const manualX =
    typeof next.manualX === "number" ? clamp(next.manualX) : gazeRuntimeDebug.manualX;
  const manualY =
    typeof next.manualY === "number" ? clamp(next.manualY) : gazeRuntimeDebug.manualY;

  gazeRuntimeDebug = {
    ...gazeRuntimeDebug,
    ...next,
    manualX,
    manualY,
  };
  emitChange();
};

export const useGazeDebug = () => {
  const runtime = useSyncExternalStore(
    subscribeGazeRuntimeDebug,
    getGazeRuntimeDebug,
    getGazeRuntimeDebug
  );

  const setManualEnabled = useCallback((enabled: boolean) => {
    setGazeRuntimeDebug({ manualEnabled: enabled });
  }, []);

  const setManual = useCallback((x: number, y: number) => {
    setGazeRuntimeDebug({ manualX: x, manualY: y });
  }, []);

  const resetManual = useCallback(() => {
    setGazeRuntimeDebug({ manualX: 0, manualY: 0 });
  }, []);

  return { runtime, setManualEnabled, setManual, resetManual };
};
