import { memo, useMemo } from "react";

import type { HitTestMaskDebugInfo } from "@/windows/avatar/useHitTestMask";

type HitTestDebugOverlayProps = {
  debug: HitTestMaskDebugInfo;
  mouse: { x: number; y: number } | null;
  backend: {
    gateIgnoreTrue: number;
    gateIgnoreFalse: number;
    gateFailOpen: number;
    gateLastIgnore: boolean | null;
  } | null;
};

function HitTestDebugOverlay({ debug, mouse, backend }: HitTestDebugOverlayProps) {
  const rectStyle = useMemo(() => {
    const { rect, maskW, maskH } = debug;
    const left = (rect.minX / maskW) * 100;
    const top = (rect.minY / maskH) * 100;
    const width = ((rect.maxX - rect.minX) / maskW) * 100;
    const height = ((rect.maxY - rect.minY) / maskH) * 100;
    return {
      left: `${left}%`,
      top: `${top}%`,
      width: `${width}%`,
      height: `${height}%`,
    };
  }, [debug]);

  const infoText = useMemo(() => {
    const ageMs = Math.max(0, performance.now() - debug.lastUpdateAtMs);
    return `hitTest: ${debug.mode} (${debug.intervalMs}ms) seq=${debug.seq} age≈${ageMs.toFixed(
      0
    )}ms mask=${debug.maskW}x${debug.maskH}`;
  }, [debug]);

  const backendText = useMemo(() => {
    if (!backend) return null;
    const ignore = backend.gateLastIgnore;
    const ignoreText = ignore === null ? "?" : ignore ? "1" : "0";
    return `backend: ignore=${ignoreText} gate(set0/1)=${backend.gateIgnoreFalse}/${backend.gateIgnoreTrue} failOpen=${backend.gateFailOpen}`;
  }, [backend]);

  return (
    <div className="pointer-events-none absolute inset-0 z-50">
      <div
        className="absolute border border-red-500/80"
        style={rectStyle}
      />
      {mouse ? (
        <div
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/80"
          style={{ left: mouse.x, top: mouse.y }}
        />
      ) : null}
      <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white/80">
        <div>{infoText}</div>
        {backendText ? <div className="text-white/70">{backendText}</div> : null}
      </div>
    </div>
  );
}

export default memo(HitTestDebugOverlay);
