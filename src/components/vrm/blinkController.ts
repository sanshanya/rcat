import type { ExpressionMixer } from "@/components/vrm/ExpressionMixer";

type BlinkState = {
  nextBlinkAt: number;
  phase: "idle" | "closing" | "opening";
  phaseStart: number;
};

type ExpressionDriverLike = {
  supports: (name: "blink") => boolean;
};

const BLINK_MIN_MS = 2000;
const BLINK_MAX_MS = 5000;
const BLINK_CLOSE_MS = 70;
const BLINK_OPEN_MS = 150;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

const randomRange = (min: number, max: number) => min + Math.random() * (max - min);

export class BlinkController {
  private state: BlinkState = {
    nextBlinkAt: 0,
    phase: "idle",
    phaseStart: 0,
  };

  reset(nowMs: number) {
    const now = Number.isFinite(nowMs) ? nowMs : performance.now();
    this.state = {
      nextBlinkAt: now + randomRange(BLINK_MIN_MS, BLINK_MAX_MS),
      phase: "idle",
      phaseStart: 0,
    };
  }

  update(options: {
    nowMs: number;
    enabled: boolean;
    mixer: ExpressionMixer | null;
    driver: ExpressionDriverLike | null;
  }) {
    const { nowMs, enabled, mixer, driver } = options;
    if (!enabled) return;
    if (!mixer || !driver || !driver.supports("blink")) return;

    const now = Number.isFinite(nowMs) ? nowMs : performance.now();
    const state = this.state;

    let weight = 0;

    if (state.phase === "idle") {
      if (now >= state.nextBlinkAt) {
        state.phase = "closing";
        state.phaseStart = now;
      } else {
        return;
      }
    }

    if (state.phase === "closing") {
      const t = (now - state.phaseStart) / BLINK_CLOSE_MS;
      if (t >= 1) {
        weight = 1;
        state.phase = "opening";
        state.phaseStart = now;
      } else {
        weight = easeOutCubic(Math.max(0, Math.min(1, t)));
      }
    }

    if (state.phase === "opening") {
      const t = (now - state.phaseStart) / BLINK_OPEN_MS;
      if (t >= 1) {
        weight = 0;
        state.phase = "idle";
        state.nextBlinkAt = now + randomRange(BLINK_MIN_MS, BLINK_MAX_MS);
      } else {
        weight = 1 - easeInCubic(Math.max(0, Math.min(1, t)));
      }
    }

    mixer.setValue("blink", "blink", weight);
  }
}
