import { useCallback, useRef, useState } from "react";

import type { WindowMode } from "@/types";
import { reportPromiseError } from "@/utils";

export type AppRoute = "main" | "settings";

type UseRouteControllerParams = {
  windowMode: WindowMode;
  changeMode: (mode: WindowMode) => Promise<void>;
};

export function useRouteController({
  windowMode,
  changeMode,
}: UseRouteControllerParams) {
  const [activeRoute, setActiveRoute] = useState<AppRoute>("main");
  const settingsReturnModeRef = useRef<WindowMode>("input");

  const isSettingsOpen = activeRoute === "settings";

  const openSettings = useCallback(() => {
    settingsReturnModeRef.current =
      windowMode === "mini" ? "input" : windowMode;
    setActiveRoute("settings");
    void changeMode("result").catch(
      reportPromiseError("App.changeMode:openSettings", {
        onceKey: "App.changeMode:openSettings",
      })
    );
  }, [changeMode, windowMode]);

  const closeSettings = useCallback(() => {
    setActiveRoute("main");
    const target = settingsReturnModeRef.current;
    if (target !== windowMode) {
      void changeMode(target).catch(
        reportPromiseError("App.changeMode:closeSettings", {
          onceKey: "App.changeMode:closeSettings",
        })
      );
    }
  }, [changeMode, windowMode]);

  const goMain = useCallback(() => setActiveRoute("main"), []);

  return {
    activeRoute,
    isSettingsOpen,
    openSettings,
    closeSettings,
    goMain,
    setActiveRoute,
  };
}
