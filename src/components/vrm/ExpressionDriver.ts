import type { VRMExpressionManager } from "@pixiv/three-vrm";

export type ExpressionName =
  | "aa"
  | "ih"
  | "ou"
  | "ee"
  | "oh"
  | "blink"
  | "happy"
  | "angry"
  | "sad"
  | "relaxed"
  | "surprised"
  | "neutral";

const EXPRESSION_ALIASES: Record<ExpressionName, string[]> = {
  aa: ["aa", "A", "a"],
  ih: ["ih", "I", "i"],
  ou: ["ou", "U", "u"],
  ee: ["ee", "E", "e"],
  oh: ["oh", "O", "o"],
  blink: ["blink", "Blink"],
  happy: ["happy", "Joy", "joy"],
  angry: ["angry", "Angry"],
  sad: ["sad", "Sorrow", "sorrow"],
  relaxed: ["relaxed", "Fun", "fun"],
  surprised: ["surprised", "Surprised"],
  neutral: ["neutral", "Neutral"],
};

const BLINK_LEFT_ALIASES = ["blinkLeft", "Blink_L"];
const BLINK_RIGHT_ALIASES = ["blinkRight", "Blink_R"];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const getExpressionEntry = (
  manager: VRMExpressionManager | null | undefined,
  name: string
): unknown | null => {
  if (!manager || typeof manager !== "object") {
    return null;
  }

  const getExpression = (manager as { getExpression?: (key: string) => unknown })
    ?.getExpression;
  if (typeof getExpression === "function") {
    return getExpression.call(manager, name) ?? null;
  }

  const map =
    (manager as { expressionMap?: Map<string, unknown> })?.expressionMap ??
    (manager as { expressions?: Map<string, unknown> })?.expressions;
  if (map && typeof map.get === "function") {
    return map.get(name) ?? null;
  }

  return null;
};

export const createExpressionDriver = (manager: VRMExpressionManager | null) => {
  const resolveAlias = (aliases: string[]) => {
    if (!manager) return null;
    for (const alias of aliases) {
      if (getExpressionEntry(manager, alias)) {
        return alias;
      }
    }
    return null;
  };

  const resolved: Record<ExpressionName, string | null> = {} as Record<
    ExpressionName,
    string | null
  >;
  (Object.keys(EXPRESSION_ALIASES) as ExpressionName[]).forEach((name) => {
    resolved[name] = resolveAlias(EXPRESSION_ALIASES[name]);
  });

  const blinkLeftName = resolveAlias(BLINK_LEFT_ALIASES);
  const blinkRightName = resolveAlias(BLINK_RIGHT_ALIASES);

  const supports = (name: ExpressionName) => {
    if (!manager) return false;
    if (name === "blink") {
      return Boolean(resolved.blink || blinkLeftName || blinkRightName);
    }
    return Boolean(resolved[name]);
  };

  const setValue = (name: ExpressionName, value: number) => {
    if (!manager) return;
    if (!supports(name)) return;
    const clamped = clamp01(value);
    if (name === "blink" && !resolved.blink) {
      if (blinkLeftName) manager.setValue(blinkLeftName, clamped);
      if (blinkRightName) manager.setValue(blinkRightName, clamped);
      return;
    }
    const resolvedName = resolved[name];
    if (!resolvedName) return;
    manager.setValue(resolvedName, clamped);
  };

  const getValue = (name: ExpressionName) => {
    if (!manager) return 0;
    const getter = (manager as { getValue?: (key: string) => number }).getValue;
    if (typeof getter === "function") {
      if (name === "blink" && !resolved.blink) {
        const left = blinkLeftName ? getter.call(manager, blinkLeftName) ?? 0 : 0;
        const right = blinkRightName ? getter.call(manager, blinkRightName) ?? 0 : 0;
        const count = (blinkLeftName ? 1 : 0) + (blinkRightName ? 1 : 0);
        return clamp01(count > 0 ? (left + right) / count : 0);
      }
      const resolvedName = resolved[name];
      if (!resolvedName) return 0;
      return clamp01(getter.call(manager, resolvedName) ?? 0);
    }
    return 0;
  };

  return { supports, setValue, getValue };
};
