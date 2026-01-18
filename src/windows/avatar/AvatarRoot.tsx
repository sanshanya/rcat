import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import VrmCanvas from "@/components/vrm/VrmCanvas";
import type { VrmRendererFrameContext } from "@/components/vrm/useVrmRenderer";
import {
  EVT_AVATAR_HITTEST_STATS,
  EVT_AVATAR_INPUT_WHEEL,
  EVT_CAPSULE_DISMISS,
  EVT_DEBUG_HITTEST_SETTINGS,
} from "@/constants";
import { useTauriEvent } from "@/hooks";
import { useHitTestMask, type HitTestMaskTuning } from "@/windows/avatar/useHitTestMask";
import HitTestDebugOverlay from "@/windows/avatar/HitTestDebugOverlay";
import { useAvatarVrmBridge } from "@/windows/avatar/useAvatarVrmBridge";
import { isTauriContext } from "@/utils";
import {
  type DebugHitTestSettingsPayload,
  applyHitTestMaskTuningPatch,
  readHitTestDotFromStorage,
  readHitTestMaskTuningFromStorage,
} from "@/windows/avatar/hittestDebugSettings";

const DEFAULT_VRM_URL = "/vrm/default.vrm";

type AvatarHitTestStats = {
  gateIgnoreTrue: number;
  gateIgnoreFalse: number;
  gateFailOpen: number;
  gateLastIgnore: boolean | null;
  viewportClientMismatch?: number;
  viewportClientLast?: {
    clientW: number;
    clientH: number;
    viewportW: number;
    viewportH: number;
  } | null;
};

export default function AvatarRoot() {
  const frameContextRef = useRef<VrmRendererFrameContext | null>(null);
  const [hitTestTuning, setHitTestTuning] = useState<HitTestMaskTuning>(() =>
    readHitTestMaskTuningFromStorage()
  );
  const debugInfo = useHitTestMask(frameContextRef, hitTestTuning);
  useAvatarVrmBridge();
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [showHitTestDot, setShowHitTestDot] = useState(() => readHitTestDotFromStorage());
  const [backendStats, setBackendStats] = useState<AvatarHitTestStats | null>(null);

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
    if (!isTauriContext()) return;

    // Use Win32 `GetCursorPos` in Rust to avoid DPI/multi-monitor coordinate pitfalls.
    void invoke("toggle_capsule", { args: { tab: "chat", anchorX: -1, anchorY: -1 } }).catch(
      () => {}
    );
  }, []);

  useTauriEvent<{ deltaY: number }>(
    EVT_AVATAR_INPUT_WHEEL,
    (event) => {
      const payload = event.payload;
      if (!payload || !Number.isFinite(payload.deltaY)) return;

      const canvas = frameContextRef.current?.canvas;
      if (!canvas) return;
      const synthetic = new WheelEvent("wheel", {
        deltaY: payload.deltaY,
        bubbles: true,
        cancelable: true,
      });
      canvas.dispatchEvent(synthetic);
    }
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

  useTauriEvent<DebugHitTestSettingsPayload>(
    EVT_DEBUG_HITTEST_SETTINGS,
    (event) => {
      const payload = event.payload;
      if (!payload) return;

      if (typeof payload.showMouseDot === "boolean") {
        const next = payload.showMouseDot;
        setShowHitTestDot(next);
      }

      setHitTestTuning((prev) => applyHitTestMaskTuningPatch(prev, payload));
    }
  );

  useTauriEvent<AvatarHitTestStats>(EVT_AVATAR_HITTEST_STATS, (event) => {
    if (!event.payload) return;
    setBackendStats(event.payload);
  });

  return (
    <div
      className="absolute inset-0 bg-transparent"
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
      onMouseMove={debugEnabled && showHitTestDot ? handleMouseMove : undefined}
    >
      <VrmCanvas url={DEFAULT_VRM_URL} onFrameContext={handleFrameContext} />
      {debugEnabled && debugInfo ? (
        <HitTestDebugOverlay
          debug={debugInfo}
          mouse={mouse}
          backend={backendStats}
          settings={hitTestTuning}
        />
      ) : null}
    </div>
  );
}
