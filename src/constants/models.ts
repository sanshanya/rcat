// src/constants/models.ts

export type ModelOption = {
  id: string;
  name: string;
};

export const DEEPSEEK_MODEL_OPTIONS: ModelOption[] = [
  { id: "deepseek-reasoner", name: "DeepSeek R1" },
  { id: "deepseek-chat", name: "DeepSeek V3" },
];

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini" },
];

export const getRegisteredModelOptions = (
  provider?: string | null,
  configuredModel?: string | null
): ModelOption[] => {
  switch ((provider ?? "").toLowerCase()) {
    case "openai":
      return OPENAI_MODEL_OPTIONS;
    case "deepseek":
      return DEEPSEEK_MODEL_OPTIONS;
    case "compatible": {
      const model = (configuredModel ?? "").trim();
      return model ? [{ id: model, name: model }] : [];
    }
    default:
      return DEEPSEEK_MODEL_OPTIONS;
  }
};

// Back-compat (existing imports). Prefer `getRegisteredModelOptions`.
export const MODEL_OPTIONS = DEEPSEEK_MODEL_OPTIONS;
