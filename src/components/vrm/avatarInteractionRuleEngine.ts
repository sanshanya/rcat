import type { ExpressionValues, ExpressionMixer } from "@/components/vrm/ExpressionMixer";
import type { AvatarZoneId } from "@/components/vrm/avatarInteractionZones";
import type { AvatarBehaviorEvent } from "@/components/vrm/avatarBehaviorEventRuntime";
import type {
  AvatarInteractionEvent,
  AvatarInteractionUpdateResult,
} from "@/components/vrm/avatarInteractionController";
import type { MotionController } from "@/components/vrm/motion/MotionController";
import { showAvatarBubble } from "@/components/vrm/avatarBubbleStore";
import { playAvatarSfx } from "@/components/vrm/avatarSfxBus";

type Pulse = {
  startedAtMs: number;
  untilMs: number;
  values: ExpressionValues;
};

type RuleEvent = AvatarInteractionEvent | AvatarBehaviorEvent;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const scaleValues = (values: ExpressionValues, factor: number): ExpressionValues => {
  const out: ExpressionValues = {};
  const clamped = clamp01(factor);
  Object.entries(values).forEach(([key, value]) => {
    if (typeof value !== "number") return;
    const next = value * clamped;
    if (next <= 0.0005) return;
    out[key as keyof ExpressionValues] = next;
  });
  return out;
};

const CLICK_VALUES_BY_ZONE: Record<AvatarZoneId, ExpressionValues> = {
  head: { happy: 0.7 },
  chest: { blush: 1, shy: 0.45, happy: 0.25 },
  abdomen: { surprised: 0.35, happy: 0.2 },
};
const DEFAULT_CLICK_VALUES: ExpressionValues = { happy: 0.35 };

const PAT_BUBBLE_BY_ZONE: Record<AvatarZoneId, string> = {
  head: "pat(head)",
  chest: "pat(chest)",
  abdomen: "pat(abdomen)",
};
const bubbleMessageFor = (event: AvatarInteractionEvent): string | null =>
  event.type === "pat" ? (event.zone ? PAT_BUBBLE_BY_ZONE[event.zone] : "pat") : null;

export class InteractionRuleEngine {
  private clickPulse: Pulse | null = null;
  private dragPulse: Pulse | null = null;
  private speechTarget = 0;
  private speechLevel = 0;

  private static readonly SPEECH_ATTACK_SEC = 0.12;
  private static readonly SPEECH_RELEASE_SEC = 0.22;

  update(options: {
    delta: number;
    nowMs: number;
    result: AvatarInteractionUpdateResult;
    events: RuleEvent[];
    mixer: ExpressionMixer;
    motionController: MotionController | null;
  }) {
    const { delta, nowMs, mixer, events } = options;

    for (const event of events) {
      this.applyEvent(event, nowMs);
    }

    // Apply continuous outputs (e.g. click/drag pulses).
    const click = this.samplePulse(this.clickPulse, nowMs);
    if (!click) {
      this.clickPulse = null;
    }
    const drag = this.samplePulse(this.dragPulse, nowMs);
    if (!drag) {
      this.dragPulse = null;
    }
    if (click || drag) {
      mixer.setChannel("click", {
        ...(click ?? {}),
        ...(drag ?? {}),
      });
    }

    const speechLevel = this.updateSpeechLevel(delta);
    if (speechLevel > 0.001) {
      mixer.setChannel("speech", {
        relaxed: 0.08 * speechLevel,
      });
    }
  }

  private applyEvent(event: RuleEvent, nowMs: number) {
    switch (event.type) {
      case "click":
        playAvatarSfx("click");
        this.clickPulse = this.makePulse(
          nowMs,
          220,
          event.zone ? CLICK_VALUES_BY_ZONE[event.zone] : DEFAULT_CLICK_VALUES
        );
        return;
      case "pat":
        playAvatarSfx("pat");
        this.clickPulse = this.makePulse(
          nowMs,
          260,
          event.zone ? CLICK_VALUES_BY_ZONE[event.zone] : DEFAULT_CLICK_VALUES
        );
        {
          const message = bubbleMessageFor(event);
          if (message) {
            showAvatarBubble(message, { zone: event.zone, nowMs });
          }
        }
        return;
      case "dragStart":
        playAvatarSfx("dragStart");
        this.dragPulse = this.makePulse(nowMs, 140, { surprised: 0.18 });
        return;
      case "dragEnd":
        playAvatarSfx("dragEnd");
        this.dragPulse = null;
        return;
      case "speechStart":
        this.speechTarget = 1;
        return;
      case "speechEnd":
        this.speechTarget = 0;
        return;
      default:
        return;
    }
  }

  private makePulse(nowMs: number, durationMs: number, values: ExpressionValues): Pulse {
    const dur = Math.max(1, durationMs);
    return {
      startedAtMs: nowMs,
      untilMs: nowMs + dur,
      values,
    };
  }

  private samplePulse(pulse: Pulse | null, nowMs: number): ExpressionValues | null {
    if (!pulse) return null;
    const remaining = pulse.untilMs - nowMs;
    const duration = pulse.untilMs - pulse.startedAtMs;
    if (remaining <= 0 || duration <= 0) return null;
    const t = remaining / duration;
    return scaleValues(pulse.values, t);
  }

  private updateSpeechLevel(delta: number) {
    if (!Number.isFinite(delta) || delta <= 0) {
      this.speechLevel = clamp01(this.speechTarget);
      return this.speechLevel;
    }

    const current = this.speechLevel;
    const target = clamp01(this.speechTarget);
    const tau =
      target > current
        ? InteractionRuleEngine.SPEECH_ATTACK_SEC
        : InteractionRuleEngine.SPEECH_RELEASE_SEC;
    const step = tau <= 0 ? 1 : 1 - Math.exp(-delta / tau);
    this.speechLevel = clamp01(current + (target - current) * step);
    return this.speechLevel;
  }
}
