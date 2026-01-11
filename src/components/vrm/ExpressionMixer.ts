import type { ExpressionName } from "@/components/vrm/ExpressionDriver";

export type ExpressionMixerChannel =
  | "base"
  | "hover"
  | "click"
  | "blink"
  | "mouth"
  | "manual";

export type ExpressionValues = Partial<Record<ExpressionName, number>>;

type ManualValues = Partial<Record<ExpressionName, number | null>>;

const ALL_EXPRESSIONS: ExpressionName[] = [
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "blink",
  "blush",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "shy",
  "anxious",
  "confused",
  "neutral",
];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export class ExpressionMixer {
  private readonly channels: Record<Exclude<ExpressionMixerChannel, "manual">, ExpressionValues> =
    {
      base: {},
      hover: {},
      click: {},
      blink: {},
      mouth: {},
    };

  private manual: ManualValues = {};

  setChannel(channel: Exclude<ExpressionMixerChannel, "manual">, values: ExpressionValues) {
    this.channels[channel] = { ...values };
  }

  setValue(channel: Exclude<ExpressionMixerChannel, "manual">, name: ExpressionName, value: number) {
    this.channels[channel] = { ...this.channels[channel], [name]: clamp01(value) };
  }

  clearChannel(channel: Exclude<ExpressionMixerChannel, "manual">) {
    this.channels[channel] = {};
  }

  setManual(values: ManualValues) {
    this.manual = { ...values };
  }

  clearManual() {
    this.manual = {};
  }

  apply(driver: {
    setValue: (name: ExpressionName, value: number) => void;
  }) {
    for (const name of ALL_EXPRESSIONS) {
      const manualValue = this.manual[name];
      if (typeof manualValue === "number") {
        driver.setValue(name, clamp01(manualValue));
        continue;
      }
      if (manualValue === null) {
        // Explicitly reset even if other channels would set it.
        driver.setValue(name, 0);
        continue;
      }

      let value = 0;
      for (const channelValues of Object.values(this.channels)) {
        const next = channelValues[name];
        if (typeof next === "number" && next > value) value = next;
      }
      driver.setValue(name, clamp01(value));
    }
  }
}
