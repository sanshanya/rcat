import { invoke } from "@tauri-apps/api/core";

export type AiProvider = "openai" | "deepseek" | "compatible";

export type AiPublicConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

export const getAiPublicConfig = () =>
  invoke<AiPublicConfig>("get_ai_public_config");

