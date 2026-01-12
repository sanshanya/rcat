import { useMemo, useState, useSyncExternalStore } from "react";

import { EVT_VOICE_RMS, EVT_VOICE_SPEECH_END, EVT_VOICE_SPEECH_START } from "@/constants";
import { useTauriEvent } from "@/hooks";
import { isTauriContext } from "@/utils";
import {
  getLipSyncRuntimeDebug,
  subscribeLipSyncRuntimeDebug,
} from "@/components/vrm/useLipSync";

type VoiceRmsPayload = {
  rms: number;
  peak: number;
  bufferedMs: number;
  speaking: boolean;
};

type LipSyncDebugState = {
  rmsCount: number;
  lastRms: VoiceRmsPayload | null;
  lastRmsAt: number | null;
  speechState: "idle" | "speaking";
  lastSpeechAt: number | null;
  weight: number;
};

const GATE = 0.02;
const SCALE = 6.0;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const rmsToWeight = (rms: number) => {
  const gated = Math.max(0, rms - GATE);
  return clamp01(gated * SCALE);
};

export const useLipSyncDebug = () => {
  const hasTauri = useMemo(() => isTauriContext(), []);
  const runtime = useSyncExternalStore(
    subscribeLipSyncRuntimeDebug,
    getLipSyncRuntimeDebug,
    getLipSyncRuntimeDebug
  );
  const [state, setState] = useState<LipSyncDebugState>({
    rmsCount: 0,
    lastRms: null,
    lastRmsAt: null,
    speechState: "idle",
    lastSpeechAt: null,
    weight: 0,
  });

  useTauriEvent<VoiceRmsPayload>(EVT_VOICE_RMS, (event) => {
    const payload = event.payload;
    const normalized = {
      rms: Number(payload?.rms) || 0,
      peak: Number(payload?.peak) || 0,
      bufferedMs: Number(payload?.bufferedMs) || 0,
      speaking: Boolean(payload?.speaking),
    };
    const now = performance.now();
    setState((prev) => ({
      ...prev,
      rmsCount: prev.rmsCount + 1,
      lastRms: normalized,
      lastRmsAt: now,
      weight: rmsToWeight(normalized.rms),
    }));
  });

  useTauriEvent<{ turnId: number }>(EVT_VOICE_SPEECH_START, () => {
    const now = performance.now();
    setState((prev) => ({
      ...prev,
      speechState: "speaking",
      lastSpeechAt: now,
    }));
  });

  useTauriEvent<{ turnId: number }>(EVT_VOICE_SPEECH_END, () => {
    const now = performance.now();
    setState((prev) => ({
      ...prev,
      speechState: "idle",
      lastSpeechAt: now,
    }));
  });

  return { hasTauri, runtime, ...state };
};
