import { useSyncExternalStore } from "react";
import type { VRM } from "@pixiv/three-vrm";

type VrmState = {
  vrm: VRM | null;
};

let state: VrmState = { vrm: null };
const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

export const setVrmState = (vrm: VRM | null) => {
  state = { vrm };
  emitChange();
};

export const getVrmState = () => state;

export const subscribeVrmState = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useVrmState = () =>
  useSyncExternalStore(subscribeVrmState, getVrmState, getVrmState);
