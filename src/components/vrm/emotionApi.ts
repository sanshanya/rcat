import type { EmotionId } from "@/components/vrm/emotionTypes";
import { EMOTION_OPTIONS } from "@/components/vrm/emotionTypes";
import {
  getEmotionState,
  setEmotion,
  subscribeEmotionState,
} from "@/components/vrm/emotionStore";

export type SetVrmEmotionOptions = {
  intensity?: number;
};

export const getVrmEmotionState = () => getEmotionState();

export const subscribeVrmEmotionState = (listener: () => void) =>
  subscribeEmotionState(listener);

export const setVrmEmotion = (emotion: EmotionId, options: SetVrmEmotionOptions = {}) => {
  setEmotion(emotion, options.intensity);
};

export const resetVrmEmotion = () => {
  setEmotion("neutral", 1);
};

const normalize = (value: string) => value.trim().toLowerCase();

const EMOTION_ALIASES: Record<EmotionId, string[]> = {
  neutral: ["neutral", "normal", "none", "中性", "平静", "默认"],
  happy: ["happy", "joy", "开心", "高兴", "喜悦", "愉快"],
  sad: ["sad", "sorrow", "难过", "伤心", "悲伤"],
  angry: ["angry", "mad", "生气", "愤怒"],
  shy: ["shy", "embarrassed", "blush", "害羞", "脸红", "不好意思"],
  surprised: ["surprised", "surprise", "惊讶", "震惊"],
  anxious: ["anxious", "worried", "nervous", "担心", "焦虑", "紧张"],
  confused: ["confused", "confuse", "困惑", "疑惑", "迷茫"],
};

export const resolveEmotionId = (input: string): EmotionId | null => {
  const normalized = normalize(input);
  if (!normalized) return null;

  if (EMOTION_OPTIONS.some((item) => item.id === normalized)) {
    return normalized as EmotionId;
  }

  const entries = Object.entries(EMOTION_ALIASES) as Array<[EmotionId, string[]]>;
  for (const [id, aliases] of entries) {
    if (aliases.some((alias) => normalize(alias) === normalized)) return id;
  }
  return null;
};

export const setVrmEmotionFromLabel = (
  label: string,
  options: SetVrmEmotionOptions = {}
): EmotionId | null => {
  const resolved = resolveEmotionId(label);
  if (resolved) setVrmEmotion(resolved, options);
  return resolved;
};

