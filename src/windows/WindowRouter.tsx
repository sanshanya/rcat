import React, { Suspense, useMemo } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { reportError } from "@/utils";

const AvatarRoot = React.lazy(() => import("./avatar/AvatarRoot"));
const PanelRoot = React.lazy(() => import("./panel/PanelRoot"));

const resolveWindowLabel = () => {
  try {
    return getCurrentWebviewWindow().label;
  } catch (err) {
    reportError(err, "WindowRouter.resolveWindowLabel", { devOnly: true });
    return "main";
  }
};

export default function WindowRouter() {
  const label = useMemo(() => resolveWindowLabel(), []);

  return (
    <Suspense fallback={null}>
      {label === "avatar" ? <AvatarRoot /> : <PanelRoot />}
    </Suspense>
  );
}
