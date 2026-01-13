import { memo } from "react";

import VrmCanvas from "@/components/vrm/VrmCanvas";
import VrmDebugPanel from "@/components/vrm/VrmDebugPanel";
import { cn } from "@/lib/utils";

export type VrmStageProps = {
  enabled: boolean;
  url?: string;
  idleMotionUrl?: string;
  showDebugOverlay?: boolean;
  autoFitCamera?: boolean;
  className?: string;
};

const DEFAULT_VRM_URL = "/vrm/default.vrm";

function VrmStage({
  enabled,
  url,
  idleMotionUrl,
  showDebugOverlay = false,
  autoFitCamera = false,
  className,
}: VrmStageProps) {
  if (!enabled) return null;
  const resolvedUrl = url ?? DEFAULT_VRM_URL;

  return (
    <div className={cn("pointer-events-none absolute inset-0", className)}>
      <VrmCanvas
        url={resolvedUrl}
        idleMotionUrl={idleMotionUrl}
        autoFitCamera={autoFitCamera}
        className="pointer-events-auto"
      />
      {showDebugOverlay ? (
        <VrmDebugPanel className="pointer-events-auto" />
      ) : null}
    </div>
  );
}

export default memo(VrmStage);
