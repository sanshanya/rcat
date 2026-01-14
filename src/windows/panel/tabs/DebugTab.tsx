import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RenderFpsMode } from "@/components/vrm/renderFpsStore";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriContext, reportPromiseError } from "@/utils";
import { EVT_DEBUG_HITTEST_SETTINGS } from "@/constants";
import type { VrmCommand, VrmStateSnapshot } from "@/windows/vrmBridgeTypes";

type DebugTabProps = {
  snapshot: VrmStateSnapshot | null;
  sendCommand: (cmd: VrmCommand) => void;
};

const HITTEST_DOT_STORAGE_KEY = "rcat.debug.hittestMouseDot";

const FPS_OPTIONS: Array<{ label: string; value: RenderFpsMode }> = [
  { label: "Auto", value: "auto" },
  { label: "60", value: 60 },
  { label: "30", value: 30 },
];

const readStorageFlag = (key: string): boolean => {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

export default function DebugTab({ snapshot, sendCommand }: DebugTabProps) {
  const fpsMode: RenderFpsMode = snapshot?.fpsMode ?? "auto";
  const mouse = snapshot?.mouseTracking ?? null;
  const hud = snapshot?.hudLayout ?? null;
  const [showHitTestDot, setShowHitTestDot] = useState(() =>
    readStorageFlag(HITTEST_DOT_STORAGE_KEY)
  );

  return (
    <div className="flex w-[min(520px,calc(100vw-24px))] flex-col gap-3 rounded-lg bg-background/60 p-3 text-sm backdrop-blur">
      <div className="text-xs font-semibold text-foreground/70">Debug</div>

      {import.meta.env.DEV ? (
        <div className="flex items-center gap-2">
          <div className="w-24 text-xs text-foreground/60">HitTest Dot</div>
          <Button
            size="sm"
            variant={showHitTestDot ? "default" : "secondary"}
            onClick={() => {
              const next = !showHitTestDot;
              setShowHitTestDot(next);
              try {
                window.localStorage.setItem(
                  HITTEST_DOT_STORAGE_KEY,
                  next ? "1" : "0"
                );
              } catch {
                // Ignore storage failures.
              }

              if (!isTauriContext()) return;

              void getCurrentWebviewWindow()
                .emitTo("avatar", EVT_DEBUG_HITTEST_SETTINGS, {
                  showMouseDot: next,
                })
                .catch(
                  reportPromiseError("DebugTab.emitTo:debug-hittest-settings", {
                    devOnly: true,
                    onceKey: "DebugTab.emitTo:debug-hittest-settings",
                  })
                );
            }}
          >
            {showHitTestDot ? "Enabled" : "Disabled"}
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="w-24 text-xs text-foreground/60">FPS</div>
        <Select
          value={String(fpsMode)}
          onValueChange={(raw) => {
            const parsed: RenderFpsMode =
              raw === "auto" ? "auto" : raw === "30" ? 30 : 60;
            sendCommand({ type: "setFpsMode", mode: parsed });
          }}
        >
          <SelectTrigger className="h-9 w-full px-2 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FPS_OPTIONS.map((opt) => (
              <SelectItem key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
