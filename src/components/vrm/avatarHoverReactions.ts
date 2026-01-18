import type { ExpressionName } from "@/components/vrm/ExpressionDriver";
import type { AvatarZoneId } from "@/components/vrm/avatarInteractionZones";

export type HoverReactionFrame = Partial<Record<ExpressionName, number>>;

export type HoverReactionSpec = {
  expressions: HoverReactionFrame;
  fadeInMs: number;
  fadeOutMs: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const moveTowards = (current: number, target: number, maxDelta: number) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

const step = (options: { current: number; target: number; delta: number; fadeMs: number }) => {
  const { current, target, delta, fadeMs } = options;
  if (delta <= 0) return clamp01(target);
  const fadeSeconds = Math.max(0.001, fadeMs / 1000);
  return clamp01(moveTowards(current, target, delta / fadeSeconds));
};

export type AvatarHoverReactionProfile = Record<AvatarZoneId, HoverReactionSpec>;

export const DEFAULT_AVATAR_HOVER_REACTIONS: AvatarHoverReactionProfile = {
  head: {
    expressions: { happy: 0.55 },
    fadeInMs: 120,
    fadeOutMs: 180,
  },
  chest: {
    // "shy": prefer blush if present; otherwise relaxed will still soften the face.
    expressions: { blush: 1, relaxed: 0.35, happy: 0.2 },
    fadeInMs: 140,
    fadeOutMs: 220,
  },
  abdomen: {
    expressions: { angry: 0.35 },
    fadeInMs: 160,
    fadeOutMs: 240,
  },
};

export class AvatarHoverReactionController {
  private zone: AvatarZoneId | null = null;
  private weights: HoverReactionFrame = {};
  private readonly profile: AvatarHoverReactionProfile;

  constructor(profile: AvatarHoverReactionProfile = DEFAULT_AVATAR_HOVER_REACTIONS) {
    this.profile = profile;
  }

  getZone() {
    return this.zone;
  }

  update(options: { delta: number; zone: AvatarZoneId | null }): HoverReactionFrame {
    const { delta, zone } = options;
    const prevZone = this.zone;
    this.zone = zone;

    const prevSpec = prevZone ? this.profile[prevZone] : null;
    const nextSpec = zone ? this.profile[zone] : null;

    const allKeys = new Set<ExpressionName>();
    if (prevSpec) Object.keys(prevSpec.expressions).forEach((key) => allKeys.add(key as ExpressionName));
    if (nextSpec) Object.keys(nextSpec.expressions).forEach((key) => allKeys.add(key as ExpressionName));

    const nextWeights: HoverReactionFrame = { ...this.weights };

    allKeys.forEach((key) => {
      const current = typeof nextWeights[key] === "number" ? nextWeights[key]! : 0;
      const target = (nextSpec?.expressions[key] ?? 0) as number;
      const fadeMs =
        target > current ? (nextSpec?.fadeInMs ?? 120) : (prevSpec?.fadeOutMs ?? 180);
      nextWeights[key] = step({ current, target, delta, fadeMs });
      if (nextWeights[key] !== undefined && nextWeights[key]! <= 0.0005 && target === 0) {
        delete nextWeights[key];
      }
    });

    this.weights = nextWeights;
    return this.weights;
  }
}
