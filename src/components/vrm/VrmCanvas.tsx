import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useVrmRenderer } from "@/components/vrm/useVrmRenderer";
import { setVrmState } from "@/components/vrm/vrmStore";
import { useVrmBehavior } from "@/components/vrm/useVrmBehavior";

export type VrmCanvasProps = {
  url: string;
  className?: string;
};

const LOAD_TIMEOUT_MS = 5000;

export default function VrmCanvas({ url, className }: VrmCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const behavior = useVrmBehavior();
  const loadSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef(url);
  const reloadRef = useRef<(() => void) | null>(null);
  const { handleRef, ready } = useVrmRenderer(canvasRef, {
    onFrame: (vrm, delta) => {
      void vrm;
      behavior.onFrame(delta);
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
      setVrmState(null);
      behavior.setVrm(null);

      if (logReload) {
        console.info("VRM renderer: reloading VRM");
      }

      handle
        .loadVrm(nextUrl, { signal: controller.signal })
        .then((vrm) => {
          if (seq !== loadSeqRef.current) return;
          setVrmState(vrm);
          behavior.setVrm(vrm);
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
    [behavior, handleRef, ready]
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
    loadVrm(url, false);

    return () => {
      loadSeqRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setVrmState(null);
      behavior.setVrm(null);
      handleRef.current?.clearVrm();
    };
  }, [behavior, handleRef, loadVrm, ready, url]);

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      <canvas ref={canvasRef} className="block h-full w-full" />
      {error ? (
        <div className="absolute bottom-2 right-2 max-w-[70%] rounded-md bg-black/70 px-2 py-1 text-[10px] text-white/80">
          <div className="font-semibold">VRM 加载失败</div>
          <div className="mt-1 break-words whitespace-pre-wrap">{error}</div>
        </div>
      ) : null}
    </div>
  );
}
