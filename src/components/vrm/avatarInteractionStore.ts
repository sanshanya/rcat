import { useSyncExternalStore } from "react";
import type { AvatarZoneId } from "@/components/vrm/avatarInteractionZones";

export type AvatarInteractionRuntime = {
  zone: AvatarZoneId | null;
  distance: number | null;
  updatedAt: number | null;
};

let runtime: AvatarInteractionRuntime = {
  zone: null,
  distance: null,
  updatedAt: null,
};

const listeners = new Set<() => void>();

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

export const getAvatarInteractionRuntime = () => runtime;

export const setAvatarInteractionRuntime = (
  next: Partial<AvatarInteractionRuntime>
) => {
  runtime = { ...runtime, ...next };
  emitChange();
};

export const subscribeAvatarInteractionRuntime = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAvatarInteractionRuntime = () =>
  useSyncExternalStore(
    subscribeAvatarInteractionRuntime,
    getAvatarInteractionRuntime,
    getAvatarInteractionRuntime
  );

