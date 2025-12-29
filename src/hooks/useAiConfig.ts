import { useCallback, useEffect, useState } from "react";

import { getAiConfig, type AiConfig } from "@/services";
import { isTauriContext, reportPromiseError } from "@/utils";

export function useAiConfig(): {
  config: AiConfig | null;
  refresh: () => Promise<AiConfig | null>;
} {
  const [config, setConfig] = useState<AiConfig | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauriContext()) return null;
    const next = await getAiConfig();
    setConfig(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isTauriContext()) return;

    let active = true;
    void getAiConfig()
      .then((next) => {
        if (active) setConfig(next);
      })
      .catch(reportPromiseError("useAiConfig", { onceKey: "useAiConfig" }));

    return () => {
      active = false;
    };
  }, []);

  return { config, refresh };
}
