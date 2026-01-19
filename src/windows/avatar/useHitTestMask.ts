import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { VrmRendererFrameContext } from "@/components/vrm/vrmRendererTypes";
import { useVrmState } from "@/components/vrm/vrmStore";
import { setAvatarHitTestMaskRuntime } from "@/components/vrm/avatarHitTestMaskRuntime";
import { MaskGenerator } from "@/windows/avatar/MaskGenerator";
import {
  resolveHitTestMaskTuning,
  type HitTestMaskTuning,
} from "@/windows/avatar/hittestDebugSettings";

const SLOW_INTERVAL_MS = 100;
const FAST_INTERVAL_MS = 33;
const CAMERA_ACTIVE_WINDOW_MS = 300;
const RESIZE_ACTIVE_WINDOW_MS = 500;

export type { HitTestMaskTuning } from "@/windows/avatar/hittestDebugSettings";

export type HitTestMaskDebugInfo = {
  seq: number;
  mode: "slow" | "fast";
  intervalMs: number;
  lastUpdateAtMs: number;
  genMs: number;
  readback: "sync" | "pbo";
  dpr: number;
  maskW: number;
  maskH: number;
  viewportW: number;
  viewportH: number;
  clientW: number;
  clientH: number;
  rect: { minX: number; minY: number; maxX: number; maxY: number };
};

export const useHitTestMask = (
  frameContextRef: RefObject<VrmRendererFrameContext | null>,
  tuning?: Partial<HitTestMaskTuning>
) => {
  const { vrm, motionController } = useVrmState();
  const seqRef = useRef(0);
  const inFlightRef = useRef(false);
  const pointerDownRef = useRef(false);
  const cameraActiveUntilRef = useRef(0);
  const lastViewportRef = useRef<{ w: number; h: number } | null>(null);
  const smoothedRectRef = useRef<HitTestMaskDebugInfo["rect"] | null>(null);
  const controlsRef = useRef<VrmRendererFrameContext["controls"] | null>(null);
  const controlsCleanupRef = useRef<(() => void) | null>(null);

  const [debugInfo, setDebugInfo] = useState<HitTestMaskDebugInfo | null>(null);

  const resolvedTuning = useMemo<HitTestMaskTuning>(() => {
    return resolveHitTestMaskTuning(tuning);
  }, [tuning]);

  const generator = useMemo(
    () =>
      new MaskGenerator({
        maxEdge: resolvedTuning.maxEdge,
        alphaThreshold: resolvedTuning.alphaThreshold,
        dilation: resolvedTuning.dilation,
        asyncReadback: resolvedTuning.asyncReadback,
      }),
    [
      resolvedTuning.alphaThreshold,
      resolvedTuning.asyncReadback,
      resolvedTuning.dilation,
      resolvedTuning.maxEdge,
    ]
  );

  useEffect(() => {
    smoothedRectRef.current = null;
  }, [
    resolvedTuning.alphaThreshold,
    resolvedTuning.dilation,
    resolvedTuning.maxEdge,
    resolvedTuning.rectSmoothingAlpha,
  ]);

  useEffect(() => {
    return () => generator.dispose();
  }, [generator]);

  useEffect(() => {
    const onPointerDown = () => {
      pointerDownRef.current = true;
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (!vrm) {
      setAvatarHitTestMaskRuntime(null);
    }
  }, [vrm]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (inFlightRef.current) return;

      const ctx = frameContextRef.current;
      if (!ctx) return;
      if (controlsRef.current !== ctx.controls) {
        controlsCleanupRef.current?.();
        controlsRef.current = ctx.controls;
        const onChange = () => {
          cameraActiveUntilRef.current = performance.now() + CAMERA_ACTIVE_WINDOW_MS;
        };
        ctx.controls.addEventListener("change", onChange);
        controlsCleanupRef.current = () => ctx.controls.removeEventListener("change", onChange);
      }
      if (!vrm) return;

      const genStart = performance.now();
      const snapshot = generator.generate(ctx, vrm);
      const genMs = performance.now() - genStart;
      if (!snapshot) return;

      const now = performance.now();
      const lastViewport = lastViewportRef.current;
      if (!lastViewport || lastViewport.w !== snapshot.viewportW || lastViewport.h !== snapshot.viewportH) {
        lastViewportRef.current = { w: snapshot.viewportW, h: snapshot.viewportH };
        smoothedRectRef.current = null;
        cameraActiveUntilRef.current = Math.max(
          cameraActiveUntilRef.current,
          now + RESIZE_ACTIVE_WINDOW_MS
        );
      }

      const rawRect = snapshot.rect;
      const rectSmoothingAlpha = resolvedTuning.rectSmoothingAlpha;
      const prevRect = smoothedRectRef.current;
      const rect =
        rectSmoothingAlpha > 0 &&
        prevRect &&
        prevRect.maxX > prevRect.minX &&
        prevRect.maxY > prevRect.minY &&
        rawRect.maxX > rawRect.minX &&
        rawRect.maxY > rawRect.minY
          ? {
              minX:
                rawRect.minX < prevRect.minX
                  ? rawRect.minX
                  : Math.round(
                      prevRect.minX +
                        (rawRect.minX - prevRect.minX) * rectSmoothingAlpha
                    ),
              minY:
                rawRect.minY < prevRect.minY
                  ? rawRect.minY
                  : Math.round(
                      prevRect.minY +
                        (rawRect.minY - prevRect.minY) * rectSmoothingAlpha
                    ),
              maxX:
                rawRect.maxX > prevRect.maxX
                  ? rawRect.maxX
                  : Math.round(
                      prevRect.maxX +
                        (rawRect.maxX - prevRect.maxX) * rectSmoothingAlpha
                    ),
              maxY:
                rawRect.maxY > prevRect.maxY
                  ? rawRect.maxY
                  : Math.round(
                      prevRect.maxY +
                        (rawRect.maxY - prevRect.maxY) * rectSmoothingAlpha
                    ),
            }
          : rawRect;
      smoothedRectRef.current = rect;

      setAvatarHitTestMaskRuntime({
        maskW: snapshot.maskW,
        maskH: snapshot.maskH,
        stride: Math.ceil(snapshot.maskW / 8),
        rect,
        bitset: snapshot.bitset,
        updatedAtMs: now,
      });

      inFlightRef.current = true;
      seqRef.current += 1;
      const seq = seqRef.current;

      // WebView2 sometimes reports `window.devicePixelRatio = 1` even under DPI scaling.
      // Prefer the actual WebGL drawing buffer scale.
      const cssW = Math.max(1, ctx.canvas.clientWidth);
      const cssH = Math.max(1, ctx.canvas.clientHeight);
      const dprX = snapshot.viewportW / cssW;
      const dprY = snapshot.viewportH / cssH;
      const dpr =
        Number.isFinite(dprX) && Number.isFinite(dprY) && dprX > 0 && dprY > 0
          ? (dprX + dprY) / 2
          : window.devicePixelRatio || 1;
      const clientW = Math.round(cssW * dpr);
      const clientH = Math.round(cssH * dpr);

      void invoke("avatar_update_hittest_mask", {
        args: {
          seq,
          maskW: snapshot.maskW,
          maskH: snapshot.maskH,
          rect,
          bitsetBase64: snapshot.bitsetBase64,
          viewportW: snapshot.viewportW,
          viewportH: snapshot.viewportH,
          clientW,
          clientH,
          dpr,
        },
      })
        .catch(() => {})
        .finally(() => {
          inFlightRef.current = false;
        });

      const motionActive = Boolean(motionController?.isPlaying());
      const fast =
        pointerDownRef.current ||
        motionActive ||
        now < cameraActiveUntilRef.current;
      const intervalMs = fast ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
      setDebugInfo({
        seq,
        mode: fast ? "fast" : "slow",
        intervalMs,
        lastUpdateAtMs: now,
        genMs,
        readback: snapshot.readback,
        dpr,
        maskW: snapshot.maskW,
        maskH: snapshot.maskH,
        viewportW: snapshot.viewportW,
        viewportH: snapshot.viewportH,
        clientW,
        clientH,
        rect,
      });
    };

    let cancelled = false;
    let timer: number | null = null;

    const loop = () => {
      if (cancelled) return;
      const now = performance.now();
      const motionActive = Boolean(motionController?.isPlaying());
      const fast =
        pointerDownRef.current ||
        motionActive ||
        now < cameraActiveUntilRef.current;
      const intervalMs = fast ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;

      tick();
      timer = window.setTimeout(loop, intervalMs);
    };

    loop();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controlsCleanupRef.current?.();
      controlsCleanupRef.current = null;
      controlsRef.current = null;
      setAvatarHitTestMaskRuntime(null);
    };
  }, [frameContextRef, generator, motionController, resolvedTuning.rectSmoothingAlpha, vrm]);

  return debugInfo;
};
