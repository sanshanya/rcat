import { useEffect, useMemo, useRef, useState } from "react";

import type { VRMExpressionManager } from "@pixiv/three-vrm";
import { createExpressionDriver } from "@/components/vrm/ExpressionDriver";
import { setRenderFpsMode, useRenderFpsState } from "@/components/vrm/renderFpsStore";
import {
  setMouseTrackingSettings,
  useMouseTrackingSettings,
} from "@/components/vrm/mouseTrackingStore";
import { DEFAULT_VRM_MOUSE_TRACKING_SETTINGS } from "@/components/vrm/mouseTrackingTypes";
import { setVrmToolMode, useVrmToolMode } from "@/components/vrm/vrmToolModeStore";
import {
  getVrmHudLayoutSettings,
  setVrmHudLayoutSettings,
  useVrmHudLayoutSettings,
} from "@/components/vrm/hudLayoutStore";
import { setVmdMotionSettings, useVmdMotionSettings } from "@/components/vrm/vmdSettingsStore";
import { useGazeDebug } from "@/components/vrm/useGazeDebug";
import { useMotionCatalog } from "@/components/vrm/motion/motionCatalog";
import { useLipSyncDebug } from "@/components/vrm/useLipSyncDebug";
import { useVrmState } from "@/components/vrm/vrmStore";
import { cn } from "@/lib/utils";

type DebugExpressionName = "aa" | "happy";

type SliderConfig = {
  id: DebugExpressionName;
  label: string;
};

const SLIDERS: SliderConfig[] = [
  { id: "aa", label: "AA" },
  { id: "happy", label: "Happy" },
];

const EMPTY_VALUES: Record<DebugExpressionName, number> = {
  aa: 0,
  happy: 0,
};

export type VrmDebugPanelProps = {
  inline?: boolean;
  className?: string;
};

export default function VrmDebugPanel({ inline = false, className }: VrmDebugPanelProps) {
  const { vrm, motionController } = useVrmState();
  const manager = (vrm?.expressionManager ?? null) as VRMExpressionManager | null;
  const driver = useMemo(() => createExpressionDriver(manager), [manager]);
  const renderFps = useRenderFpsState();
  const gaze = useGazeDebug();
  const mouseTracking = useMouseTrackingSettings();
  const toolMode = useVrmToolMode();
  const hudLayout = useVrmHudLayoutSettings();
  const vmdSettings = useVmdMotionSettings();
  const lipSync = useLipSyncDebug();
  const motionCatalog = useMotionCatalog();
  const [motionId, setMotionId] = useState<string>("");
  const [motionLoop, setMotionLoop] = useState(true);
  const [motionBusy, setMotionBusy] = useState(false);
  const [values, setValues] = useState<Record<DebugExpressionName, number>>(EMPTY_VALUES);
  const [collapsed, setCollapsed] = useState(false);
  const [followAuto, setFollowAuto] = useState(false);
  const [rmsAgeMs, setRmsAgeMs] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!manager) {
      setValues(EMPTY_VALUES);
      return;
    }

    setValues({
      aa: driver.getValue("aa"),
      happy: driver.getValue("happy"),
    });
  }, [driver, manager]);

  useEffect(() => {
    if (motionId || motionCatalog.length === 0) return;
    setMotionId(motionCatalog[0].id);
    setMotionLoop(motionCatalog[0].loop ?? true);
  }, [motionCatalog, motionId]);

  useEffect(() => {
    if (!manager) return;
    if (followAuto) return;
    (Object.keys(values) as DebugExpressionName[]).forEach((key) => {
      driver.setValue(key, values[key]);
    });
  }, [driver, followAuto, manager, values]);

  useEffect(() => {
    if (!manager || !followAuto) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    let active = true;
    const tick = () => {
      if (!active) return;
      setValues((prev) => {
        const next = {
          aa: driver.getValue("aa"),
          happy: driver.getValue("happy"),
        };
        const diff =
          Math.abs(prev.aa - next.aa) > 0.001 ||
          Math.abs(prev.happy - next.happy) > 0.001;
        return diff ? next : prev;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [driver, followAuto, manager]);

  const containerClass = inline
    ? "w-full rounded-xl border border-border/60 bg-background/60 p-2 shadow-sm"
    : cn(
        "absolute z-20 w-[min(340px,calc(100vw-24px))] max-h-[calc(100vh-24px)] overflow-x-hidden overflow-y-auto rounded-xl border border-border/60 bg-background/80 p-3 shadow-lg backdrop-blur",
        hudLayout.debugPanel ? "" : "right-3 top-3"
      );

  const panelStyle =
    inline || !hudLayout.debugPanel
      ? undefined
      : {
          left: Math.round(hudLayout.debugPanel.x),
          top: Math.round(hudLayout.debugPanel.y),
        };

  useEffect(() => {
    if (inline) return;
    if (!dragging) return;

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event.pointerId !== drag.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const width = Math.max(1, drag.width);
      const height = Math.max(1, drag.height);
      const maxX = Math.max(0, window.innerWidth - width);
      const maxY = Math.max(0, window.innerHeight - height);
      const x = Math.max(0, Math.min(maxX, drag.originX + dx));
      const y = Math.max(0, Math.min(maxY, drag.originY + dy));
      const current = getVrmHudLayoutSettings();
      setVrmHudLayoutSettings(
        { ...current, debugPanel: { x, y } },
        { persist: false }
      );
    };

    const end = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      setVrmHudLayoutSettings(getVrmHudLayoutSettings(), { persist: true });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, inline]);

  const startDrag = (event: React.PointerEvent) => {
    if (inline) return;
    if (hudLayout.locked) return;
    if (event.button !== 0) return;

    const panel = panelRef.current;
    if (!panel) return;

    event.preventDefault();

    const rect = panel.getBoundingClientRect();
    const originX = hudLayout.debugPanel?.x ?? rect.left;
    const originY = hudLayout.debugPanel?.y ?? rect.top;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX,
      originY,
      width: rect.width,
      height: rect.height,
    };
    setDragging(true);

    if (!hudLayout.debugPanel) {
      setVrmHudLayoutSettings(
        { ...hudLayout, debugPanel: { x: originX, y: originY } },
        { persist: false }
      );
    }

    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures.
    }
  };

  useEffect(() => {
    const lastRmsAt = lipSync.lastRmsAt;
    if (!lastRmsAt) {
      setRmsAgeMs(null);
      return;
    }
    if (typeof window === "undefined") return;

    const update = () => {
      setRmsAgeMs(Math.max(0, Math.round(performance.now() - lastRmsAt)));
    };
    update();
    const handle = window.setInterval(update, 250);
    return () => window.clearInterval(handle);
  }, [lipSync.lastRmsAt]);

  const fpsModeValue = String(renderFps.mode);

  return (
    <div ref={panelRef} className={cn(containerClass, className)} style={panelStyle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className={cn(
            "text-xs font-semibold text-foreground/80",
            inline || hudLayout.locked ? "cursor-default" : "cursor-move select-none"
          )}
          onPointerDown={startDrag}
        >
          VRM Debug
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <div className="flex items-center gap-1">
            <select
              className="h-6 rounded-md border border-border/50 bg-background/70 px-1 text-[10px] text-foreground"
              value={fpsModeValue}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "auto") {
                  setRenderFpsMode("auto");
                } else if (next === "30") {
                  setRenderFpsMode(30);
                } else {
                  setRenderFpsMode(60);
                }
              }}
            >
              <option value="auto">Auto</option>
              <option value="60">60</option>
              <option value="30">30</option>
            </select>
            <span className="text-[10px] text-muted-foreground">
              {renderFps.effective}fps
            </span>
          </div>
          <button
            type="button"
            className={cn(
              "rounded-md px-2 py-0.5 text-[10px]",
              followAuto
                ? "bg-primary/20 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setFollowAuto((prev) => !prev)}
          >
            {followAuto ? "Follow" : "Manual"}
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="mt-2 space-y-2">
          <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground/80">Tool</span>
              <span>{toolMode === "avatar" ? "Avatar" : "Camera"}</span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-1 text-[10px]",
                  toolMode === "camera"
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setVrmToolMode("camera")}
              >
                Camera
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-1 text-[10px]",
                  toolMode === "avatar"
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setVrmToolMode("avatar")}
              >
                Avatar
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span>HUD</span>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px]",
                  hudLayout.locked
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() =>
                  setVrmHudLayoutSettings(
                    { ...hudLayout, locked: !hudLayout.locked },
                    { persist: true }
                  )
                }
              >
                {hudLayout.locked ? "Locked" : "Unlocked"}
              </button>
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground/80">Perf</span>
              <span>{renderFps.effective}fps</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              <span>raf</span>
              <span>
                {renderFps.rafEmaMs === null ? "-" : `${renderFps.rafEmaMs.toFixed(1)}ms`}
              </span>
              <span>work</span>
              <span>
                {renderFps.workEmaMs === null ? "-" : `${renderFps.workEmaMs.toFixed(1)}ms`}
              </span>
            </div>
          </div>
          {manager ? null : (
            <div className="rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              没有检测到 VRM 表情通道
            </div>
          )}
          {SLIDERS.map((slider) => {
            const disabled = !driver.supports(slider.id) || followAuto;
            const bindings = manager ? driver.getBindings(slider.id) : 0;
            return (
              <label key={slider.id} className="grid gap-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/80">{slider.label}</span>
                    {manager && bindings === 0 ? (
                      <span className="text-[10px] text-muted-foreground">
                        无表情绑定
                      </span>
                    ) : null}
                  </div>
                  <span className="text-muted-foreground">
                    {values[slider.id].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={values[slider.id]}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setValues((prev) => ({ ...prev, [slider.id]: next }));
                  }}
                  className={cn(
                    "h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70",
                    "accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                  )}
                />
              </label>
            );
          })}
          <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground/80">Gaze</span>
              <span>{gaze.runtime.source}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              <span>x</span>
              <span>{gaze.runtime.x.toFixed(2)}</span>
              <span>y</span>
              <span>{gaze.runtime.y.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Manual</span>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px]",
                  gaze.runtime.manualEnabled
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => gaze.setManualEnabled(!gaze.runtime.manualEnabled)}
              >
                {gaze.runtime.manualEnabled ? "On" : "Off"}
              </button>
            </div>
            <label className="mt-2 grid gap-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-foreground/80">Gaze X</span>
                <span className="text-muted-foreground">
                  {gaze.runtime.manualX.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={gaze.runtime.manualX}
                disabled={!gaze.runtime.manualEnabled}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  gaze.setManual(next, gaze.runtime.manualY);
                }}
                className={cn(
                  "h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70",
                  "accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                )}
              />
            </label>
            <label className="mt-2 grid gap-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-foreground/80">Gaze Y</span>
                <span className="text-muted-foreground">
                  {gaze.runtime.manualY.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={gaze.runtime.manualY}
                disabled={!gaze.runtime.manualEnabled}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  gaze.setManual(gaze.runtime.manualX, next);
                }}
                className={cn(
                  "h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70",
                  "accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                )}
              />
            </label>
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>live</span>
              <span>
                {gaze.runtime.source === "drift" ? "drift" : "tracking"}
              </span>
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground/80">Mouse Tracking</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setMouseTrackingSettings(DEFAULT_VRM_MOUSE_TRACKING_SETTINGS)}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px]",
                    mouseTracking.enabled
                      ? "bg-primary/20 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() =>
                    setMouseTrackingSettings({
                      ...mouseTracking,
                      enabled: !mouseTracking.enabled,
                    })
                  }
                >
                  {mouseTracking.enabled ? "On" : "Off"}
                </button>
              </div>
            </div>

            <div className="mt-2 space-y-3">
              <div className="rounded-md border border-border/50 bg-background/40 px-2 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground/80">Eyes</span>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[10px]",
                      mouseTracking.eyes.enabled
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() =>
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        eyes: {
                          ...mouseTracking.eyes,
                          enabled: !mouseTracking.eyes.enabled,
                        },
                      })
                    }
                  >
                    {mouseTracking.eyes.enabled ? "On" : "Off"}
                  </button>
                </div>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Blend</span>
                    <span className="text-muted-foreground">
                      {mouseTracking.eyes.blend.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={mouseTracking.eyes.blend}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        eyes: { ...mouseTracking.eyes, blend: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Yaw</span>
                    <span className="text-muted-foreground">
                      {Math.round(mouseTracking.eyes.yawLimitDeg)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={45}
                    step={1}
                    value={mouseTracking.eyes.yawLimitDeg}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        eyes: { ...mouseTracking.eyes, yawLimitDeg: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Pitch</span>
                    <span className="text-muted-foreground">
                      {Math.round(mouseTracking.eyes.pitchLimitDeg)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={45}
                    step={1}
                    value={mouseTracking.eyes.pitchLimitDeg}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        eyes: { ...mouseTracking.eyes, pitchLimitDeg: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Smooth</span>
                    <span className="text-muted-foreground">
                      {mouseTracking.eyes.smoothness.toFixed(0)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={mouseTracking.eyes.smoothness}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        eyes: { ...mouseTracking.eyes, smoothness: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>
              </div>

              <div className="rounded-md border border-border/50 bg-background/40 px-2 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground/80">Head</span>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[10px]",
                      mouseTracking.head.enabled
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() =>
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        head: {
                          ...mouseTracking.head,
                          enabled: !mouseTracking.head.enabled,
                        },
                      })
                    }
                  >
                    {mouseTracking.head.enabled ? "On" : "Off"}
                  </button>
                </div>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Blend</span>
                    <span className="text-muted-foreground">
                      {mouseTracking.head.blend.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={mouseTracking.head.blend}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        head: { ...mouseTracking.head, blend: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Yaw</span>
                    <span className="text-muted-foreground">
                      {Math.round(mouseTracking.head.yawLimitDeg)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={1}
                    value={mouseTracking.head.yawLimitDeg}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        head: { ...mouseTracking.head, yawLimitDeg: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Pitch</span>
                    <span className="text-muted-foreground">
                      {Math.round(mouseTracking.head.pitchLimitDeg)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={1}
                    value={mouseTracking.head.pitchLimitDeg}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        head: { ...mouseTracking.head, pitchLimitDeg: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Smooth</span>
                    <span className="text-muted-foreground">
                      {mouseTracking.head.smoothness.toFixed(0)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={mouseTracking.head.smoothness}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        head: { ...mouseTracking.head, smoothness: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>
              </div>

              <div className="rounded-md border border-border/50 bg-background/40 px-2 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground/80">Spine</span>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[10px]",
                      mouseTracking.spine.enabled
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() =>
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        spine: {
                          ...mouseTracking.spine,
                          enabled: !mouseTracking.spine.enabled,
                        },
                      })
                    }
                  >
                    {mouseTracking.spine.enabled ? "On" : "Off"}
                  </button>
                </div>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Blend</span>
                    <span className="text-muted-foreground">
                      {mouseTracking.spine.blend.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={mouseTracking.spine.blend}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        spine: { ...mouseTracking.spine, blend: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Min Yaw</span>
                    <span className="text-muted-foreground">
                      {Math.round(mouseTracking.spine.minYawDeg)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-45}
                    max={45}
                    step={1}
                    value={mouseTracking.spine.minYawDeg}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        spine: { ...mouseTracking.spine, minYawDeg: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Max Yaw</span>
                    <span className="text-muted-foreground">
                      {Math.round(mouseTracking.spine.maxYawDeg)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-45}
                    max={45}
                    step={1}
                    value={mouseTracking.spine.maxYawDeg}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        spine: { ...mouseTracking.spine, maxYawDeg: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Smooth</span>
                    <span className="text-muted-foreground">
                      {mouseTracking.spine.smoothness.toFixed(0)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={1}
                    value={mouseTracking.spine.smoothness}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        spine: { ...mouseTracking.spine, smoothness: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Fade</span>
                    <span className="text-muted-foreground">
                      {mouseTracking.spine.fadeSpeed.toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={mouseTracking.spine.fadeSpeed}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        spine: { ...mouseTracking.spine, fadeSpeed: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>

                <label className="mt-2 grid gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground/80">Falloff</span>
                    <span className="text-muted-foreground">
                      {mouseTracking.spine.falloff.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={mouseTracking.spine.falloff}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setMouseTrackingSettings({
                        ...mouseTracking,
                        spine: { ...mouseTracking.spine, falloff: next },
                      });
                    }}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
                  />
                </label>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground/80">VMD</span>
              <span>{vmdSettings.enableIk ? "IK on" : "IK off"}</span>
            </div>

            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                className="rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setVmdMotionSettings({
                    ...vmdSettings,
                    enableIk: true,
                    includeFingers: false,
                    smoothingTauSeconds: 0.12,
                  })
                }
              >
                Low
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setVmdMotionSettings({
                    ...vmdSettings,
                    enableIk: true,
                    includeFingers: true,
                    smoothingTauSeconds: 0.08,
                  })
                }
              >
                High
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span>IK</span>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px]",
                  vmdSettings.enableIk
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() =>
                  setVmdMotionSettings({ ...vmdSettings, enableIk: !vmdSettings.enableIk })
                }
              >
                {vmdSettings.enableIk ? "On" : "Off"}
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span>Fingers</span>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px]",
                  vmdSettings.includeFingers
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() =>
                  setVmdMotionSettings({
                    ...vmdSettings,
                    includeFingers: !vmdSettings.includeFingers,
                  })
                }
              >
                {vmdSettings.includeFingers ? "On" : "Off"}
              </button>
            </div>

            <label className="mt-2 grid gap-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-foreground/80">Smooth</span>
                <span className="text-muted-foreground">
                  {vmdSettings.smoothingTauSeconds.toFixed(2)}s
                </span>
              </div>
              <input
                type="range"
                min={0.04}
                max={0.3}
                step={0.01}
                value={vmdSettings.smoothingTauSeconds}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setVmdMotionSettings({ ...vmdSettings, smoothingTauSeconds: next });
                }}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-primary"
              />
            </label>
            <div className="mt-2 text-[10px] text-muted-foreground/80">
              IK 与 smoothing 可实时切换；手指轨道通常需重新加载 VMD 才生效。
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground/80">Motion</span>
              <span>{motionController ? "ready" : "no vrm"}</span>
            </div>
            <div className="mt-2 grid gap-2">
              <label className="grid gap-1 text-[11px]">
                <span className="text-foreground/80">Preset</span>
                <select
                  className="h-7 rounded-md border border-border/50 bg-background/70 px-2 text-[11px] text-foreground"
                  value={motionId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setMotionId(next);
                    const entry = motionCatalog.find((item) => item.id === next);
                    setMotionLoop(entry?.loop ?? true);
                  }}
                  disabled={motionCatalog.length === 0 || motionBusy}
                >
                  {motionCatalog.length === 0 ? (
                    <option value="">No local motions</option>
                  ) : (
                    motionCatalog.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="flex items-center justify-between text-[11px]">
                <span className="text-foreground/80">Loop</span>
                <input
                  type="checkbox"
                  checked={motionLoop}
                  onChange={(event) => setMotionLoop(event.target.checked)}
                  disabled={motionBusy}
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={cn(
                    "rounded-md border border-border/60 px-2 py-1 text-[10px]",
                    motionController ? "hover:bg-muted/60" : "opacity-40"
                  )}
                  disabled={!motionController || !motionId || motionBusy}
                  onClick={async () => {
                    if (!motionController || !motionId) return;
                    setMotionBusy(true);
                    try {
                      await motionController.preloadById(motionId);
                    } finally {
                      setMotionBusy(false);
                    }
                  }}
                >
                  Preload
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md border border-border/60 px-2 py-1 text-[10px]",
                    motionController ? "hover:bg-muted/60" : "opacity-40"
                  )}
                  disabled={!motionController || !motionId || motionBusy}
                  onClick={async () => {
                    if (!motionController || !motionId) return;
                    setMotionBusy(true);
                    try {
                      await motionController.playById(motionId, { loop: motionLoop });
                    } finally {
                      setMotionBusy(false);
                    }
                  }}
                >
                  Play
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md border border-border/60 px-2 py-1 text-[10px]",
                    motionController ? "hover:bg-muted/60" : "opacity-40"
                  )}
                  disabled={!motionController || motionBusy}
                  onClick={() => motionController?.stop()}
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/30 px-2 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground/80">LipSync</span>
              <span>{lipSync.hasTauri ? "Tauri" : "No Tauri"}</span>
            </div>
            {lipSync.lastRms ? (
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                <span>rms</span>
                <span>{lipSync.lastRms.rms.toFixed(4)}</span>
                <span>peak</span>
                <span>{lipSync.lastRms.peak.toFixed(4)}</span>
                <span>buffer</span>
                <span>{lipSync.lastRms.bufferedMs}ms</span>
                <span>speaking</span>
                <span>
                  {lipSync.lastRms.speaking
                    ? "yes"
                    : lipSync.lastRms.bufferedMs > 0
                      ? "draining"
                      : "no"}
                </span>
                <span>applied</span>
                <span>{lipSync.runtime.value.toFixed(3)}</span>
                <span>target</span>
                <span>{lipSync.runtime.target.toFixed(3)}</span>
                <span>queue</span>
                <span>{lipSync.runtime.queueLen}</span>
                <span>next</span>
                <span>
                  {lipSync.runtime.nextApplyInMs === null
                    ? "-"
                    : `${lipSync.runtime.nextApplyInMs}ms`}
                </span>
                <span>lastRmsW</span>
                <span>{lipSync.weight.toFixed(3)}</span>
                <span>events</span>
                <span>{lipSync.rmsCount}</span>
                <span>age</span>
                <span>{rmsAgeMs ?? 0}ms</span>
              </div>
            ) : (
              <div className="mt-1">No RMS events yet</div>
            )}
            <div className="mt-1">
              speech: {lipSync.speechState}
              {lipSync.lastSpeechAt ? " @" + Math.round(lipSync.lastSpeechAt) : ""}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
