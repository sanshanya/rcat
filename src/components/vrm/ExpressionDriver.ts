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
  aa: ["aa", "AA", "Aa", "A", "a", "Ah", "ah"],
  ih: ["ih", "I", "i"],
  ou: ["ou", "U", "u"],
  ee: ["ee", "E", "e"],
  oh: ["oh", "O", "o"],
  blink: ["blink", "Blink"],
  happy: ["happy", "Happy", "Joy", "joy", "Smile", "smile"],
  angry: ["angry", "Angry"],
  sad: ["sad", "Sorrow", "sorrow"],
  relaxed: ["relaxed", "Fun", "fun"],
  surprised: ["surprised", "Surprised"],
  neutral: ["neutral", "Neutral"],
};

const BLINK_LEFT_ALIASES = ["blinkLeft", "Blink_L"];
const BLINK_RIGHT_ALIASES = ["blinkRight", "Blink_R"];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

  const managerAny = manager as unknown as { expressionMap?: unknown; expressions?: unknown };
  const map = managerAny.expressionMap ?? managerAny.expressions;
  if (map && typeof (map as { get?: unknown }).get === "function") {
    return (map as { get: (key: string) => unknown }).get(name) ?? null;
  }
  if (isRecord(map)) {
    return map[name] ?? null;
  }

  return null;
};

const getExpressionNames = (
  manager: VRMExpressionManager | null | undefined
): string[] => {
  if (!manager) return [];
  const managerAny = manager as unknown as { expressionMap?: unknown; expressions?: unknown };
  const map = managerAny.expressionMap ?? managerAny.expressions;
  if (map && typeof (map as { keys?: unknown }).keys === "function") {
    return Array.from((map as { keys: () => IterableIterator<string> }).keys());
  }
  if (isRecord(map)) {
    return Object.keys(map);
  }
  const list = (manager as { expressions?: unknown[] })?.expressions;
  if (Array.isArray(list)) {
    return list
      .map((entry) =>
        isRecord(entry) && typeof entry.expressionName === "string"
          ? entry.expressionName
          : null
      )
      .filter((name): name is string => Boolean(name));
  }
  return [];
};

const getBindingsCount = (entry: unknown): number => {
  if (!isRecord(entry)) return 0;
  const binds = entry.binds;
  return Array.isArray(binds) ? binds.length : 0;
};

export const createExpressionDriver = (manager: VRMExpressionManager | null) => {
  const resolveAlias = (aliases: string[]) => {
    if (!manager) return null;
    for (const alias of aliases) {
      if (getExpressionEntry(manager, alias)) {
        return alias;
      }
    }
    const aliasSet = new Set(aliases.map((alias) => alias.toLowerCase()));
    const names = getExpressionNames(manager);
    for (const name of names) {
      if (aliasSet.has(name.toLowerCase())) {
        return name;
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

  const bindingCountForName = (name: string | null) => {
    if (!manager || !name) return 0;
    return getBindingsCount(getExpressionEntry(manager, name));
  };

  const supports = (name: ExpressionName) => {
    if (!manager) return false;
    if (name === "blink") {
      return (
        bindingCountForName(resolved.blink) > 0 ||
        bindingCountForName(blinkLeftName) > 0 ||
        bindingCountForName(blinkRightName) > 0
      );
    }
    return bindingCountForName(resolved[name]) > 0;
  };

  const getBindings = (name: ExpressionName) => {
    if (!manager) return 0;
    if (name === "blink") {
      return (
        bindingCountForName(resolved.blink) +
        bindingCountForName(blinkLeftName) +
        bindingCountForName(blinkRightName)
      );
    }
    return bindingCountForName(resolved[name]);
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

  return { supports, setValue, getValue, getBindings };
};
