import { useSyncExternalStore } from "react";
import type { VRM } from "@pixiv/three-vrm";
import type { MotionController } from "@/components/vrm/motion/MotionController";

type VrmState = {
  vrm: VRM | null;
  motionController: MotionController | null;
  url: string | null;
};

let state: VrmState = { vrm: null, motionController: null, url: null };
const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

export const setVrmState = (
  vrm: VRM | null,
  motionController: MotionController | null,
  url: string | null
) => {
  state = { vrm, motionController, url };
  emitChange();
};

export const getVrmState = () => state;

export const subscribeVrmState = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useVrmState = () =>
  useSyncExternalStore(subscribeVrmState, getVrmState, getVrmState);
