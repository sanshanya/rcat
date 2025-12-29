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

const MODEL_NAME_MAP = new Map<string, string>([
  ...DEEPSEEK_MODEL_OPTIONS,
  ...OPENAI_MODEL_OPTIONS,
].map((m) => [m.id, m.name]));

type ModelLike = { id: string; name?: string | null };

const normalizeModels = (models: ModelLike[]) => {
  const out: ModelLike[] = [];
  for (const m of models) {
    const trimmed = (m?.id ?? "").trim();
    if (!trimmed) continue;
    if (out.some((x) => x.id === trimmed)) continue;
    out.push({ ...m, id: trimmed });
  }
  return out;
};

const modelsToOptions = (models: ModelLike[]) =>
  normalizeModels(models).map((m) => ({
    id: m.id,
    name: (m.name ?? "").trim() || MODEL_NAME_MAP.get(m.id) || m.id,
  }));

export const getRegisteredModelOptions = (
  provider?: string | null,
  configuredModel?: string | null,
  availableModels?: ModelLike[] | null
): ModelOption[] => {
  const configured = (configuredModel ?? "").trim();

  if (availableModels && availableModels.length > 0) {
    const out = modelsToOptions(availableModels);
    if (configured && !out.some((m) => m.id === configured)) {
      out.unshift({ id: configured, name: MODEL_NAME_MAP.get(configured) ?? configured });
    }
    return out;
  }

  const withConfigured = (options: ModelOption[]) => {
    if (!configured) return options;
    if (options.some((m) => m.id === configured)) return options;
    return [{ id: configured, name: configured }, ...options];
  };

  switch ((provider ?? "").toLowerCase()) {
    case "openai":
      return withConfigured(OPENAI_MODEL_OPTIONS);
    case "deepseek":
      return withConfigured(DEEPSEEK_MODEL_OPTIONS);
    case "compatible": {
      return configured ? [{ id: configured, name: configured }] : [];
    }
    default:
      return DEEPSEEK_MODEL_OPTIONS;
  }
};

// Back-compat (existing imports). Prefer `getRegisteredModelOptions`.
export const MODEL_OPTIONS = DEEPSEEK_MODEL_OPTIONS;
