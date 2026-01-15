import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import VrmCanvas from "@/components/vrm/VrmCanvas";
import type { VrmRendererFrameContext } from "@/components/vrm/useVrmRenderer";
import { useVrmToolMode } from "@/components/vrm/vrmToolModeStore";
import { EVT_CAPSULE_DISMISS, EVT_DEBUG_HITTEST_SETTINGS } from "@/constants";
import { useTauriEvent } from "@/hooks";
import { useHitTestMask } from "@/windows/avatar/useHitTestMask";
import HitTestDebugOverlay from "@/windows/avatar/HitTestDebugOverlay";
import { useAvatarVrmBridge } from "@/windows/avatar/useAvatarVrmBridge";
import { isTauriContext } from "@/utils";

const DEFAULT_VRM_URL = "/vrm/default.vrm";
const HITTEST_DOT_STORAGE_KEY = "rcat.debug.hittestMouseDot";

const WINDOW_SCALE_MIN_W = 240;
const WINDOW_SCALE_MIN_H = 360;
const WINDOW_SCALE_MAX_W = 1400;
const WINDOW_SCALE_MAX_H = 2100;

const readStorageFlag = (key: string): boolean => {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

export default function AvatarRoot() {
  const frameContextRef = useRef<VrmRendererFrameContext | null>(null);
  const debugInfo = useHitTestMask(frameContextRef);
  useAvatarVrmBridge();
  const toolMode = useVrmToolMode();
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [showHitTestDot, setShowHitTestDot] = useState(() =>
    readStorageFlag(HITTEST_DOT_STORAGE_KEY)
  );
  const windowMetricsRef = useRef<{
    outerX: number;
    outerY: number;
    outerW: number;
    outerH: number;
    borderW: number;
    borderH: number;
  } | null>(null);
  const wheelPendingRef = useRef(0);
  const wheelInFlightRef = useRef(false);

  const debugEnabled = useMemo(() => {
    if (import.meta.env.DEV) return true;
    try {
      return window.localStorage.getItem("rcat.debug.hittestOverlay") === "1";
    } catch {
      return false;
    }
  }, []);

  const handleFrameContext = useCallback((ctx: VrmRendererFrameContext) => {
    frameContextRef.current = ctx;
  }, []);

  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    const dpr = window.devicePixelRatio || 1;
    const anchorX = Math.round(event.screenX * dpr);
    const anchorY = Math.round(event.screenY * dpr);
    void invoke("toggle_capsule", { args: { tab: "chat", anchorX, anchorY } });
  }, []);

  const handlePointerDownCapture = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (toolMode !== "avatar") return;
      if (event.button !== 0) return;
      if (event.altKey) return;
      if (!isTauriContext()) return;

      // Drag the whole avatar window (and thus the model) when in "avatar" tool mode.
      // Alt+drag is reserved for moving the model within the window.
      event.preventDefault();
      event.stopPropagation();
      windowMetricsRef.current = null;
      void getCurrentWindow().startDragging().catch(() => {});
    },
    [toolMode]
  );

  const handleWheelCapture = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (toolMode !== "avatar") return;
      if (event.altKey) return;
      if (!isTauriContext()) return;

      event.preventDefault();
      event.stopPropagation();

      wheelPendingRef.current += event.deltaY;
      if (wheelInFlightRef.current) return;
      wheelInFlightRef.current = true;

      const apply = async () => {
        const pending = wheelPendingRef.current;
        wheelPendingRef.current = 0;
        if (!Number.isFinite(pending) || pending === 0) return;

        const win = getCurrentWindow();
        let metrics = windowMetricsRef.current;
        if (!metrics) {
          const [outerPos, outerSize, innerSize] = await Promise.all([
            win.outerPosition(),
            win.outerSize(),
            win.innerSize(),
          ]);
          const borderW = Math.max(0, outerSize.width - innerSize.width);
          const borderH = Math.max(0, outerSize.height - innerSize.height);
          metrics = {
            outerX: outerPos.x,
            outerY: outerPos.y,
            outerW: outerSize.width,
            outerH: outerSize.height,
            borderW,
            borderH,
          };
        }

        const factor = Math.exp(-pending * 0.001);
        if (!Number.isFinite(factor) || factor <= 0) return;

        const minFactor = Math.max(
          WINDOW_SCALE_MIN_W / metrics.outerW,
          WINDOW_SCALE_MIN_H / metrics.outerH
        );
        const maxFactor = Math.min(
          WINDOW_SCALE_MAX_W / metrics.outerW,
          WINDOW_SCALE_MAX_H / metrics.outerH
        );
        const nextFactor = Math.min(maxFactor, Math.max(minFactor, factor));

        const desiredOuterW = Math.round(metrics.outerW * nextFactor);
        const desiredOuterH = Math.round(metrics.outerH * nextFactor);
        const desiredInnerW = Math.max(1, desiredOuterW - metrics.borderW);
        const desiredInnerH = Math.max(1, desiredOuterH - metrics.borderH);
        const nextOuterW = desiredInnerW + metrics.borderW;
        const nextOuterH = desiredInnerH + metrics.borderH;

        if (nextOuterW === metrics.outerW && nextOuterH === metrics.outerH) return;

        const centerX = metrics.outerX + metrics.outerW / 2;
        const centerY = metrics.outerY + metrics.outerH / 2;
        const nextOuterX = Math.round(centerX - nextOuterW / 2);
        const nextOuterY = Math.round(centerY - nextOuterH / 2);

        await win.setSize(new PhysicalSize(desiredInnerW, desiredInnerH));
        await win.setPosition(new PhysicalPosition(nextOuterX, nextOuterY));

        windowMetricsRef.current = {
          outerX: nextOuterX,
          outerY: nextOuterY,
          outerW: nextOuterW,
          outerH: nextOuterH,
          borderW: metrics.borderW,
          borderH: metrics.borderH,
        };
      };

      void (async () => {
        try {
          await apply();
          if (wheelPendingRef.current !== 0) {
            await apply();
          }
        } finally {
          wheelInFlightRef.current = false;
        }
      })();
    },
    [toolMode]
  );

  const handleMouseDown = useCallback((event: MouseEvent) => {
    // Right-click opens the capsule; left-click should dismiss it.
    if (event.button !== 0) return;
    if (!isTauriContext()) return;
    void getCurrentWebviewWindow()
      .emitTo("main", EVT_CAPSULE_DISMISS, {})
      .catch(() => {});
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    setMouse({ x: event.clientX, y: event.clientY });
  }, []);

  useEffect(() => {
    if (!debugEnabled || !showHitTestDot) {
      setMouse(null);
    }
  }, [debugEnabled, showHitTestDot]);

  useTauriEvent<{ showMouseDot?: boolean }>(
    EVT_DEBUG_HITTEST_SETTINGS,
    (event) => {
      const next = event.payload?.showMouseDot;
      if (typeof next !== "boolean") return;
      setShowHitTestDot(next);
      try {
        window.localStorage.setItem(HITTEST_DOT_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures.
      }
    }
  );

  return (
    <div
      className="absolute inset-0 bg-transparent"
      onContextMenu={handleContextMenu}
      onPointerDownCapture={handlePointerDownCapture}
      onWheelCapture={handleWheelCapture}
      onMouseDown={handleMouseDown}
      onMouseMove={debugEnabled && showHitTestDot ? handleMouseMove : undefined}
    >
      <VrmCanvas url={DEFAULT_VRM_URL} onFrameContext={handleFrameContext} />
      {debugEnabled && debugInfo ? (
        <HitTestDebugOverlay debug={debugInfo} mouse={mouse} />
      ) : null}
    </div>
  );
}
