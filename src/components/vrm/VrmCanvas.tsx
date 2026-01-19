import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useVrmRenderer } from "@/components/vrm/useVrmRenderer";
import type { VrmRendererFrameContext } from "@/components/vrm/vrmRendererTypes";
import { setVrmState } from "@/components/vrm/vrmStore";
import { useVrmBehavior } from "@/components/vrm/useVrmBehavior";
import { useRenderFpsState } from "@/components/vrm/renderFpsStore";
import { useVrmToolMode } from "@/components/vrm/vrmToolModeStore";

export type VrmCanvasProps = {
  url: string;
  className?: string;
  idleMotionUrl?: string;
  onFrameContext?: (ctx: VrmRendererFrameContext) => void;
};

const LOAD_TIMEOUT_MS = 5000;

export default function VrmCanvas({
  url,
  className,
  idleMotionUrl,
  onFrameContext,
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
  const { handleRef, ready } = useVrmRenderer(canvasRef, {
    fpsMode,
    onFrame: (vrm, delta, ctx) => {
      void vrm;
      onFrameContext?.(ctx);
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
    [getMotionController, handleRef, ready, setVrm]
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
          toolMode === "camera"
            ? "cursor-grab active:cursor-grabbing"
            : "cursor-default"
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
