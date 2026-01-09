import { useEffect, useRef, useState } from "react";

import type { ModelOption } from "@/constants";
import type { AiConfig } from "@/services";

const DEFAULT_MODEL_ID = "deepseek-reasoner";

export function useModelSelection(
  aiConfig: AiConfig | null,
  modelOptions: ModelOption[]
) {
  const [selectedModel, setSelectedModel] = useState(
    () => modelOptions[0]?.id ?? DEFAULT_MODEL_ID
  );
  const didInitModelFromBackendRef = useRef(false);

  useEffect(() => {
    const configured = aiConfig?.model?.trim();
    if (!aiConfig) return;

    if (!didInitModelFromBackendRef.current) {
      didInitModelFromBackendRef.current = true;
      if (configured && modelOptions.some((m) => m.id === configured)) {
        setSelectedModel(configured);
        return;
      }
      if (modelOptions.length > 0) {
        setSelectedModel(modelOptions[0].id);
      }
      return;
    }

    const allowed = modelOptions.some((m) => m.id === selectedModel);
    if (allowed) return;

    if (configured && modelOptions.some((m) => m.id === configured)) {
      setSelectedModel(configured);
      return;
    }
    if (modelOptions.length > 0) {
      setSelectedModel(modelOptions[0].id);
    }
  }, [aiConfig, modelOptions, selectedModel]);

  return { selectedModel, setSelectedModel };
}

