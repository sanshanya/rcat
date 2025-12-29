import { invoke } from "@tauri-apps/api/core";
import type { AiConfig, AiModel, AiProvider } from "@/bindings/tauri-types";

export type { AiConfig, AiModel, AiProvider } from "@/bindings/tauri-types";

export const getAiConfig = () => invoke<AiConfig>("get_ai_config");

export const setAiProvider = (provider: AiProvider) =>
  invoke<AiConfig>("set_ai_provider", { provider });

export const setAiProfile = (params: {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  models: AiModel[];
}) => invoke<AiConfig>("set_ai_profile", params);

export const testAiProfile = (params: {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
}) => invoke<void>("test_ai_profile", params);
