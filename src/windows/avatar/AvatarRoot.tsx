import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

import VrmCanvas from "@/components/vrm/VrmCanvas";
import type { VrmRendererFrameContext } from "@/components/vrm/useVrmRenderer";
import { useHitTestMask } from "@/windows/avatar/useHitTestMask";
import HitTestDebugOverlay from "@/windows/avatar/HitTestDebugOverlay";
import { useAvatarVrmBridge } from "@/windows/avatar/useAvatarVrmBridge";

const DEFAULT_VRM_URL = "/vrm/default.vrm";

export default function AvatarRoot() {
  const frameContextRef = useRef<VrmRendererFrameContext | null>(null);
  const debugInfo = useHitTestMask(frameContextRef);
  useAvatarVrmBridge();
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

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

  const handleMouseMove = useCallback((event: MouseEvent) => {
    setMouse({ x: event.clientX, y: event.clientY });
  }, []);

  return (
    <div
      className="absolute inset-0 bg-transparent"
      onContextMenu={handleContextMenu}
      onMouseMove={handleMouseMove}
    >
      <VrmCanvas url={DEFAULT_VRM_URL} onFrameContext={handleFrameContext} />
      {debugEnabled && debugInfo ? (
        <HitTestDebugOverlay debug={debugInfo} mouse={mouse} />
      ) : null}
    </div>
  );
}
