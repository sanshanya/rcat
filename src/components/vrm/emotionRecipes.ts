import type { ExpressionName } from "@/components/vrm/ExpressionDriver";
import type { ExpressionValues } from "@/components/vrm/ExpressionMixer";
import type { EmotionId } from "@/components/vrm/emotionTypes";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampScale = (value: number) => Math.max(0, Math.min(2, value));

const scaleValues = (values: ExpressionValues, scale: number) => {
  const factor = clampScale(scale);
  if (factor === 1) return values;
  const out: ExpressionValues = {};
  Object.entries(values).forEach(([key, value]) => {
    if (typeof value !== "number") return;
    out[key as ExpressionName] = clamp01(value * factor);
  });
  return out;
};

export const buildEmotionExpressions = (options: {
  emotion: EmotionId;
  driver: { supports: (name: ExpressionName) => boolean };
  intensity?: number;
}): ExpressionValues => {
  const { emotion, driver, intensity = 1 } = options;

  const fallback = (primary: ExpressionName, fallbackValues: ExpressionValues) =>
    driver.supports(primary) ? { [primary]: 1 } : fallbackValues;

  const recipe: ExpressionValues = (() => {
    switch (emotion) {
      case "neutral":
        return { neutral: 1 };
      case "happy":
        return { happy: 1 };
      case "sad":
        return { sad: 1 };
      case "angry":
        return { angry: 1 };
      case "surprised":
        return { surprised: 1 };
      case "shy":
        return fallback("shy", { blush: 1, relaxed: 0.35, happy: 0.2 });
      case "anxious":
        return fallback("anxious", { sad: 0.55, surprised: 0.15 });
      case "confused":
        return fallback("confused", { neutral: 0.55, surprised: 0.25, sad: 0.1 });
      default:
        return { neutral: 1 };
    }
  })();

  return scaleValues(recipe, intensity);
};
