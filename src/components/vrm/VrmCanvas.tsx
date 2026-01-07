import { useEffect, useRef, useState } from "react";

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
  const { handleRef, ready } = useVrmRenderer(canvasRef, {
    onFrame: (vrm, delta) => {
      void vrm;
      behavior.onFrame(delta);
    },
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const handle = handleRef.current;
    if (!handle) return;

    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LOAD_TIMEOUT_MS);
    let active = true;

    setError(null);
    setVrmState(null);
    behavior.setVrm(null);
    handle
      .loadVrm(url, { signal: controller.signal })
      .then((vrm) => {
        if (!active) return;
        setVrmState(vrm);
        behavior.setVrm(vrm);
      })
      .catch((err) => {
        if (!active) return;
        if (controller.signal.aborted) {
          if (timedOut) {
            console.error("VRM load timed out", { url });
            setError("VRM load timed out");
          }
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error("VRM load failed", err);
        setError(message);
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
      setVrmState(null);
      behavior.setVrm(null);
      handle.clearVrm();
    };
  }, [handleRef, ready, url]);

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
