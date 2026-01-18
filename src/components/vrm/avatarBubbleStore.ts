import { useSyncExternalStore } from "react";
import type { AvatarZoneId } from "@/components/vrm/avatarInteractionZones";

export type AvatarBubble = {
  message: string;
  zone: AvatarZoneId | null;
  createdAtMs: number;
  ttlMs: number;
};

let bubble: AvatarBubble | null = null;

const listeners = new Set<() => void>();
const emitChange = () => {
  listeners.forEach((listener) => listener());
};

export const getAvatarBubble = () => bubble;

export const showAvatarBubble = (
  message: string,
  options?: { zone?: AvatarZoneId | null; ttlMs?: number; nowMs?: number }
) => {
  const ttlMs = Math.max(1, options?.ttlMs ?? 1200);
  const nowMs = options?.nowMs ?? performance.now();
  bubble = {
    message,
    zone: options?.zone ?? null,
    createdAtMs: nowMs,
    ttlMs,
  };
  emitChange();
};

export const clearAvatarBubble = () => {
  bubble = null;
  emitChange();
};

export const subscribeAvatarBubble = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAvatarBubble = () =>
  useSyncExternalStore(subscribeAvatarBubble, getAvatarBubble, getAvatarBubble);

