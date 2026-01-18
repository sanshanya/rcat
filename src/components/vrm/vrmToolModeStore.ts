import { useSyncExternalStore } from "react";

export type VrmToolMode = "avatar" | "model" | "camera";

let state: VrmToolMode = "avatar";

const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

export const getVrmToolMode = () => state;

export const setVrmToolMode = (next: VrmToolMode) => {
  state = next;
  emitChange();
};

export const subscribeVrmToolMode = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useVrmToolMode = () =>
  useSyncExternalStore(subscribeVrmToolMode, getVrmToolMode, getVrmToolMode);
