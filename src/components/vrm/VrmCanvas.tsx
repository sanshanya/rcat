import { useCallback, useEffect, useRef, useState } from "react";
import type { PerspectiveCamera } from "three";
import { Box3, Vector3 } from "three";

import { cn } from "@/lib/utils";
import { useVrmRenderer } from "@/components/vrm/useVrmRenderer";
import { setVrmState } from "@/components/vrm/vrmStore";
import { useVrmBehavior } from "@/components/vrm/useVrmBehavior";
import { useRenderFpsState } from "@/components/vrm/renderFpsStore";
import { useVrmToolMode } from "@/components/vrm/vrmToolModeStore";
import { fitAvatarWindowToAspect, setAvatarInteractionBounds } from "@/services";
import { isTauriContext, reportPromiseError } from "@/utils";

export type VrmCanvasProps = {
  url: string;
  className?: string;
  idleMotionUrl?: string;
  autoFitCamera?: boolean;
};

const LOAD_TIMEOUT_MS = 5000;

const BOUNDS_THROTTLE_MS = 150;
const BOUNDS_CHANGE_EPSILON = 0.01;
const BOUNDS_MARGIN = 0.045;

const boundsCorners = Array.from({ length: 8 }, () => new Vector3());
const boundsProjected = new Vector3();

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const computeAvatarBounds = (box: Box3, camera: PerspectiveCamera) => {
  if (box.isEmpty()) return null;
  const { min, max } = box;
  boundsCorners[0].set(min.x, min.y, min.z);
  boundsCorners[1].set(min.x, min.y, max.z);
  boundsCorners[2].set(min.x, max.y, min.z);
  boundsCorners[3].set(min.x, max.y, max.z);
  boundsCorners[4].set(max.x, min.y, min.z);
  boundsCorners[5].set(max.x, min.y, max.z);
  boundsCorners[6].set(max.x, max.y, min.z);
  boundsCorners[7].set(max.x, max.y, max.z);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const corner of boundsCorners) {
    boundsProjected.copy(corner).project(camera);
    if (!Number.isFinite(boundsProjected.x) || !Number.isFinite(boundsProjected.y)) continue;
    minX = Math.min(minX, boundsProjected.x);
    maxX = Math.max(maxX, boundsProjected.x);
    minY = Math.min(minY, boundsProjected.y);
    maxY = Math.max(maxY, boundsProjected.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  const left = clamp01((minX + 1) * 0.5 - BOUNDS_MARGIN);
  const right = clamp01((maxX + 1) * 0.5 + BOUNDS_MARGIN);
  const top = clamp01((1 - maxY) * 0.5 - BOUNDS_MARGIN);
  const bottom = clamp01((1 - minY) * 0.5 + BOUNDS_MARGIN);

  if (left >= right || top >= bottom) return null;
  return { left, top, right, bottom };
};

export default function VrmCanvas({
  url,
  className,
  idleMotionUrl,
  autoFitCamera = false,
}: VrmCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { onFrame, afterVrmUpdate, setVrm, getMotionController } = useVrmBehavior({
    idleMotionUrl,
  });
  const { mode: fpsMode } = useRenderFpsState();
  const toolMode = useVrmToolMode();
  const loadSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef(url);
  const reloadRef = useRef<(() => void) | null>(null);
  const lastBoundsAtRef = useRef(0);
  const lastBoundsRef = useRef<ReturnType<typeof computeAvatarBounds> | null>(null);
  const { handleRef, ready } = useVrmRenderer(canvasRef, {
    fpsMode,
    autoFitCamera,
    onFrame: (vrm, delta, ctx) => {
      void vrm;
      const now = performance.now();
      if (
        autoFitCamera &&
        isTauriContext() &&
        now - lastBoundsAtRef.current > BOUNDS_THROTTLE_MS
      ) {
        lastBoundsAtRef.current = now;
        const box = new Box3().setFromObject(vrm.scene);
        const bounds = computeAvatarBounds(box, ctx.camera);
        const prev = lastBoundsRef.current;
        const changed =
          !prev ||
          !bounds ||
          Math.abs(prev.left - bounds.left) > BOUNDS_CHANGE_EPSILON ||
          Math.abs(prev.top - bounds.top) > BOUNDS_CHANGE_EPSILON ||
          Math.abs(prev.right - bounds.right) > BOUNDS_CHANGE_EPSILON ||
          Math.abs(prev.bottom - bounds.bottom) > BOUNDS_CHANGE_EPSILON;
        if (changed && bounds) {
          lastBoundsRef.current = bounds;
          void setAvatarInteractionBounds(bounds).catch(
            reportPromiseError("VrmCanvas.setAvatarInteractionBounds", {
              onceKey: "VrmCanvas.setAvatarInteractionBounds",
              devOnly: true,
            })
          );
        }
      }
      onFrame(delta, ctx.camera);
    },
    onAfterFrame: (_vrm, delta) => {
      void _vrm;
      afterVrmUpdate(delta);
    },
    onContextRestored: () => {
      reloadRef.current?.();
    },
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!autoFitCamera || !isTauriContext()) return;
    return () => {
      void setAvatarInteractionBounds(null).catch(() => {});
    };
  }, [autoFitCamera]);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const loadVrm = useCallback(
    (nextUrl: string, logReload: boolean) => {
      if (!ready) return;
      const handle = handleRef.current;
      if (!handle) return;

      loadSeqRef.current += 1;
      const seq = loadSeqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, LOAD_TIMEOUT_MS);

      setError(null);
      setVrmState(null, null, null);
      setVrm(null, null);

      if (logReload) {
        console.info("VRM renderer: reloading VRM");
      }

      handle
        .loadVrm(nextUrl, { signal: controller.signal })
        .then((vrm) => {
          if (seq !== loadSeqRef.current) return;
          setVrm(vrm, nextUrl);
          setVrmState(vrm, getMotionController(), nextUrl);

          if (autoFitCamera && isTauriContext()) {
            const box = new Box3().setFromObject(vrm.scene);
            if (!box.isEmpty()) {
              const size = box.getSize(new Vector3());
              const aspect = size.y > 0 ? size.x / size.y : 0;
              if (Number.isFinite(aspect) && aspect > 0) {
                void fitAvatarWindowToAspect(aspect).catch(
                  reportPromiseError("VrmCanvas.fitAvatarWindowToAspect", {
                    onceKey: "VrmCanvas.fitAvatarWindowToAspect",
                    devOnly: true,
                  })
                );
              }
            }
          }
        })
        .catch((err) => {
          if (seq !== loadSeqRef.current) return;
          if (controller.signal.aborted) {
            if (timedOut) {
              console.error("VRM load timed out", { url: nextUrl });
              setError("VRM load timed out");
            }
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          console.error("VRM load failed", err);
          setError(message);
        })
        .finally(() => {
          if (seq !== loadSeqRef.current) return;
          window.clearTimeout(timeout);
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        });
    },
    [handleRef, ready, setVrm]
  );

  useEffect(() => {
    reloadRef.current = () => {
      const nextUrl = urlRef.current;
      if (!nextUrl) return;
      loadVrm(nextUrl, true);
    };
  }, [loadVrm]);

  useEffect(() => {
    if (!ready) return;
    const handle = handleRef.current;
    loadVrm(url, false);

    return () => {
      loadSeqRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setVrmState(null, null, null);
      setVrm(null, null);
      handle?.clearVrm();
    };
  }, [handleRef, loadVrm, ready, setVrm, url]);

  return (
    <div className={cn("absolute inset-0 pointer-events-auto touch-none", className)}>
      <canvas
        ref={canvasRef}
        className={cn(
          "block h-full w-full touch-none",
          toolMode === "avatar"
            ? "cursor-move active:cursor-grabbing"
            : "cursor-grab active:cursor-grabbing"
        )}
      />
      {error ? (
        <div className="absolute bottom-2 right-2 max-w-[70%] rounded-md bg-black/70 px-2 py-1 text-[10px] text-white/80">
          <div className="font-semibold">VRM 加载失败</div>
          <div className="mt-1 break-words whitespace-pre-wrap">{error}</div>
        </div>
      ) : null}
    </div>
  );
}
