import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import VrmCanvas from "@/components/vrm/VrmCanvas";
import type { VrmRendererFrameContext } from "@/components/vrm/useVrmRenderer";
import { EVT_CAPSULE_DISMISS, EVT_DEBUG_HITTEST_SETTINGS } from "@/constants";
import { useTauriEvent } from "@/hooks";
import { useHitTestMask } from "@/windows/avatar/useHitTestMask";
import HitTestDebugOverlay from "@/windows/avatar/HitTestDebugOverlay";
import { useAvatarVrmBridge } from "@/windows/avatar/useAvatarVrmBridge";
import { isTauriContext } from "@/utils";

const DEFAULT_VRM_URL = "/vrm/default.vrm";
const HITTEST_DOT_STORAGE_KEY = "rcat.debug.hittestMouseDot";

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
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [showHitTestDot, setShowHitTestDot] = useState(() =>
    readStorageFlag(HITTEST_DOT_STORAGE_KEY)
  );

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
    void invoke("open_capsule", { args: { tab: "chat", anchorX, anchorY } });
  }, []);

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
