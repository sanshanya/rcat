import { memo } from "react";

import VrmSidePanel from "@/components/vrm/VrmSidePanel";

export type VrmStageProps = {
  enabled: boolean;
  url?: string;
  idleMotionUrl?: string;
  className?: string;
};

function VrmStage({ enabled, url, idleMotionUrl, className }: VrmStageProps) {
  if (!enabled) return null;
  return (
    <VrmSidePanel
      url={url}
      idleMotionUrl={idleMotionUrl}
      className={className}
    />
  );
}

export default memo(VrmStage);

