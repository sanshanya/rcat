import VrmCanvas from "@/components/vrm/VrmCanvas";
import VrmDebugPanel from "@/components/vrm/VrmDebugPanel";
import { cn } from "@/lib/utils";

export type VrmSidePanelProps = {
  url?: string;
  idleMotionUrl?: string;
  className?: string;
};

const DEFAULT_VRM_URL = "/vrm/default.vrm";

export default function VrmSidePanel({
  url = DEFAULT_VRM_URL,
  idleMotionUrl,
  className,
}: VrmSidePanelProps) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-stretch gap-3", className)}>
      <div className="relative min-w-[var(--vrm-stage-min)] max-w-[var(--vrm-stage-max)] flex-1 overflow-hidden rounded-2xl border border-border/50 bg-muted/40">
        <VrmCanvas url={url} idleMotionUrl={idleMotionUrl} />
      </div>
      <div className="w-[var(--vrm-debug-width)] shrink-0 rounded-2xl border border-border/50 bg-background/70 p-2 shadow-sm">
        <VrmDebugPanel inline />
      </div>
    </div>
  );
}
