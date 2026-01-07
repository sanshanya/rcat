import VrmCanvas from "@/components/vrm/VrmCanvas";
import VrmDebugPanel from "@/components/vrm/VrmDebugPanel";

export type VrmSidePanelProps = {
  url?: string;
};

const DEFAULT_VRM_URL = "/vrm/default.vrm";

export default function VrmSidePanel({ url = DEFAULT_VRM_URL }: VrmSidePanelProps) {
  return (
    <div className="flex shrink-0 items-stretch gap-3">
      <div className="relative w-[360px] overflow-hidden rounded-2xl border border-border/50 bg-muted/40">
        <VrmCanvas url={url} />
      </div>
      <div className="w-[200px] rounded-2xl border border-border/50 bg-background/70 p-2 shadow-sm">
        <VrmDebugPanel inline />
      </div>
    </div>
  );
}
