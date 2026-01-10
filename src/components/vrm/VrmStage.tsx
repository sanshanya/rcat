import { memo } from "react";

import VrmCanvas from "@/components/vrm/VrmCanvas";
import VrmDebugPanel from "@/components/vrm/VrmDebugPanel";
import { cn } from "@/lib/utils";

export type VrmStageProps = {
  enabled: boolean;
  url?: string;
  idleMotionUrl?: string;
  className?: string;
};

const DEFAULT_VRM_URL = "/vrm/default.vrm";

function VrmStage({ enabled, url, idleMotionUrl, className }: VrmStageProps) {
  if (!enabled) return null;
  const resolvedUrl = url ?? DEFAULT_VRM_URL;

  return (
    <div className={cn("pointer-events-none absolute inset-0", className)}>
      <VrmCanvas
        url={resolvedUrl}
        idleMotionUrl={idleMotionUrl}
        className="pointer-events-auto"
      />
      <VrmDebugPanel className="pointer-events-auto" />
    </div>
  );
}

export default memo(VrmStage);
