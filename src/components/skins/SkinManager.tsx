import type { SkinMode } from "@/types";
import VrmCanvas from "@/components/vrm/VrmCanvas";

export type SkinManagerProps = {
  mode: SkinMode;
  vrmUrl?: string;
};

const DEFAULT_VRM_URL = "/vrm/default.vrm";

export default function SkinManager({
  mode,
  vrmUrl = DEFAULT_VRM_URL,
}: SkinManagerProps) {
  if (mode !== "vrm") return null;
  return (
    <div className="absolute inset-0 pointer-events-none">
      <VrmCanvas url={vrmUrl} />
    </div>
  );
}
