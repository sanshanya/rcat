import { useEffect, useState } from "react";

import { getAiPublicConfig, type AiPublicConfig } from "@/services";
import { isTauriContext, reportPromiseError } from "@/utils";

export function useAiPublicConfig(): AiPublicConfig | null {
  const [config, setConfig] = useState<AiPublicConfig | null>(null);

  useEffect(() => {
    if (!isTauriContext()) return;

    let active = true;
    void getAiPublicConfig()
      .then((next) => {
        if (active) setConfig(next);
      })
      .catch(reportPromiseError("useAiPublicConfig", { onceKey: "useAiPublicConfig" }));

    return () => {
      active = false;
    };
  }, []);

  return config;
}
