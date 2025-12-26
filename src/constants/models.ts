// src/constants/models.ts

export type ModelOption = {
  id: string;
  name: string;
};

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "deepseek-reasoner", name: "DeepSeek R1" },
  { id: "deepseek-chat", name: "DeepSeek V3" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
];

