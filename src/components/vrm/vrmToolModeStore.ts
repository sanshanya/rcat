import { useSyncExternalStore } from "react";

export type VrmToolMode = "camera" | "avatar";

let state: VrmToolMode = "camera";

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

