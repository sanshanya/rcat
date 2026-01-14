import { Button } from "@/components/ui/button";
import type { RenderFpsMode } from "@/components/vrm/renderFpsStore";
import type { VrmCommand, VrmStateSnapshot } from "@/windows/vrmBridgeTypes";

type DebugTabProps = {
  snapshot: VrmStateSnapshot | null;
  sendCommand: (cmd: VrmCommand) => void;
};

const FPS_OPTIONS: Array<{ label: string; value: RenderFpsMode }> = [
  { label: "Auto", value: "auto" },
  { label: "60", value: 60 },
  { label: "30", value: 30 },
];

export default function DebugTab({ snapshot, sendCommand }: DebugTabProps) {
  const fpsMode: RenderFpsMode = snapshot?.fpsMode ?? "auto";
  const mouse = snapshot?.mouseTracking ?? null;
  const hud = snapshot?.hudLayout ?? null;

  return (
    <div className="flex w-[min(520px,calc(100vw-24px))] flex-col gap-3 rounded-lg bg-background/60 p-3 text-sm backdrop-blur">
      <div className="text-xs font-semibold text-foreground/70">Debug</div>

      <div className="flex items-center gap-2">
        <div className="w-24 text-xs text-foreground/60">FPS</div>
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={String(fpsMode)}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed: RenderFpsMode =
              raw === "auto" ? "auto" : raw === "30" ? 30 : 60;
            sendCommand({ type: "setFpsMode", mode: parsed });
          }}
        >
          {FPS_OPTIONS.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-24 text-xs text-foreground/60">Mouse Tracking</div>
        <Button
          size="sm"
          variant={mouse?.enabled ? "default" : "secondary"}
          onClick={() => {
            if (!mouse) return;
            sendCommand({
              type: "setMouseTracking",
              settings: { ...mouse, enabled: !mouse.enabled },
            });
          }}
          disabled={!mouse}
        >
          {mouse?.enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-24 text-xs text-foreground/60">HUD Layout</div>
        <Button
          size="sm"
          variant={hud?.locked ? "default" : "secondary"}
          onClick={() => {
            if (!hud) return;
            sendCommand({
              type: "setHudLayout",
              settings: { ...hud, locked: !hud.locked },
            });
          }}
          disabled={!hud}
        >
          {hud?.locked ? "Locked" : "Editing"}
        </Button>
      </div>

      {!snapshot ? (
        <div className="text-xs text-foreground/50">waiting avatar…</div>
      ) : null}
    </div>
  );
}

