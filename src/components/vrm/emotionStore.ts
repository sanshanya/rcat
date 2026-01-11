import { useCallback, useSyncExternalStore } from "react";

import type { EmotionId } from "@/components/vrm/emotionTypes";

export type EmotionState = {
  emotion: EmotionId;
  intensity: number;
  updatedAt: number | null;
};

const clampIntensity = (value: number) => Math.max(0, Math.min(2, value));

let state: EmotionState = { emotion: "neutral", intensity: 1, updatedAt: null };

const listeners = new Set<() => void>();

const emitChange = () => listeners.forEach((listener) => listener());

export const getEmotionState = () => state;

export const subscribeEmotionState = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setEmotion = (emotion: EmotionId, intensity?: number) => {
  const nextIntensity =
    typeof intensity === "number" ? clampIntensity(intensity) : state.intensity;
  state = {
    emotion,
    intensity: nextIntensity,
    updatedAt: typeof performance === "undefined" ? null : performance.now(),
  };
  emitChange();
};

export const useEmotion = () => {
  const snapshot = useSyncExternalStore(
    subscribeEmotionState,
    getEmotionState,
    getEmotionState
  );

  const set = useCallback((emotion: EmotionId, intensity?: number) => {
    setEmotion(emotion, intensity);
  }, []);

  return { ...snapshot, set };
};
