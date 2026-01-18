import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  HITTEST_ALPHA_THRESHOLD_MAX,
  HITTEST_ALPHA_THRESHOLD_MIN,
  HITTEST_ALPHA_THRESHOLD_KEY,
  HITTEST_ASYNC_READBACK_KEY,
  HITTEST_DILATION_MAX,
  HITTEST_DILATION_MIN,
  HITTEST_DILATION_KEY,
  HITTEST_DOT_STORAGE_KEY,
  HITTEST_MASK_MAX_EDGE_MAX,
  HITTEST_MASK_MAX_EDGE_MIN,
  HITTEST_MASK_MAX_EDGE_KEY,
  HITTEST_RECT_SMOOTH_ALPHA_MAX,
  HITTEST_RECT_SMOOTH_ALPHA_MIN,
  HITTEST_RECT_SMOOTH_ALPHA_KEY,
  applyHitTestMaskTuningPatch,
  readHitTestDotFromStorage,
  readHitTestMaskTuningFromStorage,
  type DebugHitTestSettingsPayload,
  type HitTestMaskTuning,
  writeStorageFlag,
  writeStorageNumber,
} from "@/windows/avatar/hittestDebugSettings";

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
  const [showHitTestDot, setShowHitTestDot] = useState(() => readHitTestDotFromStorage());
  const [hitTestTuning, setHitTestTuning] = useState<HitTestMaskTuning>(() =>
    readHitTestMaskTuningFromStorage()
  );

  const emitTimerRef = useRef<number | null>(null);
  const pendingEmitRef = useRef<DebugHitTestSettingsPayload>({});

  const emitHitTestSettings = useCallback((payload: DebugHitTestSettingsPayload) => {
    if (!isTauriContext()) return;
    void getCurrentWebviewWindow()
      .emitTo("avatar", EVT_DEBUG_HITTEST_SETTINGS, payload)
      .catch(
        reportPromiseError("DebugTab.emitTo:debug-hittest-settings", {
          devOnly: true,
          onceKey: "DebugTab.emitTo:debug-hittest-settings",
        })
      );
  }, []);

  const scheduleEmitHitTestSettings = useCallback(
    (patch: DebugHitTestSettingsPayload) => {
      Object.assign(pendingEmitRef.current, patch);
      if (emitTimerRef.current) {
        window.clearTimeout(emitTimerRef.current);
      }
      emitTimerRef.current = window.setTimeout(() => {
        emitTimerRef.current = null;
        const payload = pendingEmitRef.current;
        pendingEmitRef.current = {};
        emitHitTestSettings(payload);
      }, 120);
    },
    [emitHitTestSettings]
  );

  useEffect(() => {
    return () => {
      if (emitTimerRef.current) {
        window.clearTimeout(emitTimerRef.current);
        emitTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex w-[min(520px,calc(100vw-24px))] flex-col gap-3 rounded-lg bg-background/60 p-3 text-sm backdrop-blur">
      <div className="text-xs font-semibold text-foreground/70">Debug</div>

      {import.meta.env.DEV ? (
        <>
          <div className="flex items-center gap-2">
            <div className="w-24 text-xs text-foreground/60">HitTest Dot</div>
            <Button
              size="sm"
              variant={showHitTestDot ? "default" : "secondary"}
              onClick={() => {
                const next = !showHitTestDot;
                setShowHitTestDot(next);
                writeStorageFlag(HITTEST_DOT_STORAGE_KEY, next);
                scheduleEmitHitTestSettings({ showMouseDot: next });
              }}
            >
              {showHitTestDot ? "Enabled" : "Disabled"}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-24 text-xs text-foreground/60">Async Readback</div>
            <Button
              size="sm"
              variant={hitTestTuning.asyncReadback ? "default" : "secondary"}
              onClick={() => {
                const next = !hitTestTuning.asyncReadback;
                setHitTestTuning((prev) => applyHitTestMaskTuningPatch(prev, { asyncReadback: next }));
                writeStorageFlag(HITTEST_ASYNC_READBACK_KEY, next);
                scheduleEmitHitTestSettings({ asyncReadback: next });
              }}
            >
              {hitTestTuning.asyncReadback ? "Enabled" : "Disabled"}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-24 text-xs text-foreground/60">Mask MaxEdge</div>
            <input
              className="w-full"
              type="range"
              min={HITTEST_MASK_MAX_EDGE_MIN}
              max={HITTEST_MASK_MAX_EDGE_MAX}
              step={8}
              value={hitTestTuning.maxEdge}
              onChange={(e) => {
                const next = Number(e.target.value);
                setHitTestTuning((prev) => applyHitTestMaskTuningPatch(prev, { maxEdge: next }));
                writeStorageNumber(HITTEST_MASK_MAX_EDGE_KEY, next);
                scheduleEmitHitTestSettings({ maxEdge: next });
              }}
            />
            <div className="w-10 text-right font-mono text-xs text-foreground/70">
              {hitTestTuning.maxEdge}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-24 text-xs text-foreground/60">Alpha Thr</div>
            <input
              className="w-full"
              type="range"
              min={HITTEST_ALPHA_THRESHOLD_MIN}
              max={HITTEST_ALPHA_THRESHOLD_MAX}
              step={1}
              value={hitTestTuning.alphaThreshold}
              onChange={(e) => {
                const next = Number(e.target.value);
                setHitTestTuning((prev) => applyHitTestMaskTuningPatch(prev, { alphaThreshold: next }));
                writeStorageNumber(HITTEST_ALPHA_THRESHOLD_KEY, next);
                scheduleEmitHitTestSettings({ alphaThreshold: next });
              }}
            />
            <div className="w-10 text-right font-mono text-xs text-foreground/70">
              {hitTestTuning.alphaThreshold}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-24 text-xs text-foreground/60">Dilation</div>
            <input
              className="w-full"
              type="range"
              min={HITTEST_DILATION_MIN}
              max={HITTEST_DILATION_MAX}
              step={1}
              value={hitTestTuning.dilation}
              onChange={(e) => {
                const next = Number(e.target.value);
                setHitTestTuning((prev) => applyHitTestMaskTuningPatch(prev, { dilation: next }));
                writeStorageNumber(HITTEST_DILATION_KEY, next);
                scheduleEmitHitTestSettings({ dilation: next });
              }}
            />
            <div className="w-10 text-right font-mono text-xs text-foreground/70">
              {hitTestTuning.dilation}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-24 text-xs text-foreground/60">Rect Smooth</div>
            <input
              className="w-full"
              type="range"
              min={HITTEST_RECT_SMOOTH_ALPHA_MIN}
              max={HITTEST_RECT_SMOOTH_ALPHA_MAX}
              step={0.05}
              value={hitTestTuning.rectSmoothingAlpha}
              onChange={(e) => {
                const next = Number(e.target.value);
                setHitTestTuning((prev) => applyHitTestMaskTuningPatch(prev, { rectSmoothingAlpha: next }));
                writeStorageNumber(HITTEST_RECT_SMOOTH_ALPHA_KEY, next);
                scheduleEmitHitTestSettings({ rectSmoothingAlpha: next });
              }}
            />
            <div className="w-10 text-right font-mono text-xs text-foreground/70">
              {hitTestTuning.rectSmoothingAlpha.toFixed(2)}
            </div>
          </div>
        </>
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
