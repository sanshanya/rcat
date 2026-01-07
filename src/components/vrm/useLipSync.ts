import { useCallback, useRef } from "react";

import { useTauriEvent } from "@/hooks";
import {
  EVT_VOICE_RMS,
  EVT_VOICE_SPEECH_END,
  EVT_VOICE_SPEECH_START,
} from "@/constants";

type VoiceRmsPayload = {
  rms: number;
  peak: number;
  bufferedMs: number;
  speaking: boolean;
};

type QueueItem = {
  applyAt: number;
  value: number;
  speaking: boolean;
};

export type LipSyncRuntimeDebug = {
  queueLen: number;
  nextApplyInMs: number | null;
  value: number;
  target: number;
  rmsRecent: boolean;
  lastEventAgeMs: number;
  hadRms: boolean;
  fallbackActive: boolean;
};

let lipSyncRuntimeDebug: LipSyncRuntimeDebug = {
  queueLen: 0,
  nextApplyInMs: null,
  value: 0,
  target: 0,
  rmsRecent: false,
  lastEventAgeMs: 0,
  hadRms: false,
  fallbackActive: false,
};

const lipSyncRuntimeListeners = new Set<() => void>();

export const subscribeLipSyncRuntimeDebug = (listener: () => void) => {
  lipSyncRuntimeListeners.add(listener);
  return () => {
    lipSyncRuntimeListeners.delete(listener);
  };
};

export const getLipSyncRuntimeDebug = () => lipSyncRuntimeDebug;

const setLipSyncRuntimeDebug = (next: LipSyncRuntimeDebug) => {
  lipSyncRuntimeDebug = next;
  lipSyncRuntimeListeners.forEach((listener) => listener());
};

const GATE = 0.02;
const SCALE = 6.0;
const ATTACK_SEC = 0.05;
const RELEASE_SEC = 0.14;
const SILENCE_TIMEOUT_MS = 200;
const FALLBACK_BASE = 0.2;
const FALLBACK_AMP = 0.2;
const FALLBACK_HZ = 4.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const rmsToWeight = (rms: number) => {
  const gated = Math.max(0, rms - GATE);
  return clamp01(gated * SCALE);
};

export const useLipSync = () => {
  const queueRef = useRef<QueueItem[]>([]);
  const targetRef = useRef(0);
  const valueRef = useRef(0);
  const lastRmsEventRef = useRef(0);
  const lastDebugEmitRef = useRef(0);
  const fallbackActiveRef = useRef(false);
  const fallbackPhaseRef = useRef(0);
  const hadRmsRef = useRef(false);

  const enqueue = useCallback((payload: VoiceRmsPayload) => {
    const now = performance.now();
    const applyAt = now + Math.max(0, payload.bufferedMs || 0);
    const value = rmsToWeight(payload.rms || 0);
    queueRef.current.push({ applyAt, value, speaking: payload.speaking });
    lastRmsEventRef.current = now;
    hadRmsRef.current = true;
  }, []);

  useTauriEvent<VoiceRmsPayload>(EVT_VOICE_RMS, (event) => {
    enqueue({
      rms: Number(event.payload.rms) || 0,
      peak: Number(event.payload.peak) || 0,
      bufferedMs: Number(event.payload.bufferedMs) || 0,
      speaking: Boolean(event.payload.speaking),
    });
  });

  useTauriEvent<void>(EVT_VOICE_SPEECH_START, () => {
    fallbackActiveRef.current = true;
    fallbackPhaseRef.current = 0;
    hadRmsRef.current = false;
  });

  useTauriEvent<void>(EVT_VOICE_SPEECH_END, () => {
    fallbackActiveRef.current = false;
  });

  const onFrame = useCallback((delta: number) => {
    const now = performance.now();
    const queue = queueRef.current;

    if (queue.length > 0) {
      let next = targetRef.current;
      let hadSpeakingFalse = false;
      let idx = 0;
      while (idx < queue.length && queue[idx].applyAt <= now) {
        const item = queue[idx];
        next = item.value;
        hadSpeakingFalse = hadSpeakingFalse || !item.speaking;
        idx += 1;
      }
      if (idx > 0) {
        queue.splice(0, idx);
        targetRef.current = next;
        if (hadSpeakingFalse && queue.length === 0) {
          targetRef.current = 0;
        }
      }
    }

    const rmsRecent = now - lastRmsEventRef.current <= SILENCE_TIMEOUT_MS;
    if (!rmsRecent) {
      if (fallbackActiveRef.current && !hadRmsRef.current) {
        fallbackPhaseRef.current += delta * FALLBACK_HZ * Math.PI * 2;
        const wave = 0.5 + 0.5 * Math.sin(fallbackPhaseRef.current);
        targetRef.current = clamp01(FALLBACK_BASE + FALLBACK_AMP * wave);
      } else if (queue.length === 0) {
        targetRef.current = 0;
      }
    }

    const current = valueRef.current;
    const target = targetRef.current;
    const tau = target > current ? ATTACK_SEC : RELEASE_SEC;
    const step = tau <= 0 ? 1 : 1 - Math.exp(-delta / tau);
    valueRef.current = current + (target - current) * step;
    valueRef.current = clamp01(valueRef.current);

    if (import.meta.env.DEV && lipSyncRuntimeListeners.size > 0) {
      const intervalMs = 100;
      if (now - lastDebugEmitRef.current >= intervalMs) {
        lastDebugEmitRef.current = now;
        let minApplyAt: number | null = null;
        for (const item of queue) {
          if (minApplyAt === null || item.applyAt < minApplyAt) {
            minApplyAt = item.applyAt;
          }
        }
        const nextApplyInMs =
          minApplyAt === null ? null : Math.max(0, Math.round(minApplyAt - now));
        setLipSyncRuntimeDebug({
          queueLen: queue.length,
          nextApplyInMs,
          value: valueRef.current,
          target: targetRef.current,
          rmsRecent,
          lastEventAgeMs: Math.max(0, Math.round(now - lastRmsEventRef.current)),
          hadRms: hadRmsRef.current,
          fallbackActive: fallbackActiveRef.current,
        });
      }
    }

    const shouldDrive =
      queue.length > 0 ||
      (hadRmsRef.current && rmsRecent) ||
      fallbackActiveRef.current;
    if (!shouldDrive && valueRef.current <= 0.001 && targetRef.current === 0) {
      return null;
    }
    return valueRef.current;
  }, []);

  const reset = useCallback(() => {
    queueRef.current = [];
    targetRef.current = 0;
    valueRef.current = 0;
    lastRmsEventRef.current = 0;
    fallbackActiveRef.current = false;
    fallbackPhaseRef.current = 0;
    hadRmsRef.current = false;
  }, []);

  return { onFrame, reset };
};
