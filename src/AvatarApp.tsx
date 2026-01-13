import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import VrmStage from "@/components/vrm/VrmStage";
import { openContextPanel, scaleAvatarWindow } from "@/services";
import { isTauriContext, reportPromiseError } from "@/utils";

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  didDrag: boolean;
} | null;

const DRAG_THRESHOLD_PX = 6;

export default function AvatarApp() {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState>(null);
  const suppressClickRef = useRef(false);
  const wheelFrameRef = useRef<number | null>(null);
  const wheelFactorRef = useRef(1);

  const flushWheelScale = useCallback(() => {
    wheelFrameRef.current = null;
    const factor = wheelFactorRef.current;
    wheelFactorRef.current = 1;
    if (!Number.isFinite(factor) || factor <= 0) return;
    void scaleAvatarWindow(factor).catch(
      reportPromiseError("AvatarApp.scaleAvatarWindow", {
        onceKey: "AvatarApp.scaleAvatarWindow",
        devOnly: true,
      })
    );
  }, []);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!isTauriContext()) return;

    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = true;
      dragStateRef.current = null;
      handleOpenContext();
      return;
    }

    if (e.button !== 0) return;

    suppressClickRef.current = false;
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      didDrag: false,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture failures.
    }
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.pointerId !== e.pointerId) return;
    if (state.didDrag) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    state.didDrag = true;
    suppressClickRef.current = true;
    e.preventDefault();
    e.stopPropagation();

    void getCurrentWindow().startDragging().catch(
      reportPromiseError("AvatarApp.startDragging", {
        onceKey: "AvatarApp.startDragging",
        devOnly: true,
      })
    );
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.pointerId !== e.pointerId) return;

    dragStateRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore pointer release failures.
    }
  };

  const handleOpenContext = useCallback(() => {
    if (!isTauriContext()) return;
    void openContextPanel().catch(
      reportPromiseError("AvatarApp.openContextPanel", {
        onceKey: "AvatarApp.openContextPanel",
      })
    );
  }, []);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (!isTauriContext()) return;
      if (!dragStateRef.current) return;

      const factor = Math.exp(-event.deltaY * 0.001);
      if (!Number.isFinite(factor) || factor <= 0) return;

      event.preventDefault();
      event.stopPropagation();

      wheelFactorRef.current *= factor;
      if (wheelFrameRef.current != null) return;
      wheelFrameRef.current = window.requestAnimationFrame(flushWheelScale);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [flushWheelScale]);

  return (
    <div className="relative h-full w-full bg-transparent">
      <VrmStage enabled showDebugOverlay={false} autoFitCamera />

      <div
        ref={overlayRef}
        className="absolute inset-0 z-10 pointer-events-auto touch-none"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      />
    </div>
  );
}
