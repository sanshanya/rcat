import {
  MeshBasicMaterial,
  WebGLRenderTarget,
  type Material,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import type { VRM } from "@pixiv/three-vrm";

import type { VrmRendererFrameContext } from "@/components/vrm/vrmRendererTypes";
import { isWebGl2, PboMaskReadback } from "@/windows/avatar/maskReadbackPbo";
import {
  DEFAULT_HITTEST_ALPHA_THRESHOLD,
  DEFAULT_HITTEST_ASYNC_READBACK,
  DEFAULT_HITTEST_DILATION,
  DEFAULT_HITTEST_MASK_MAX_EDGE,
} from "@/windows/avatar/hittestDebugSettings";

export type MaskRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type HitTestMaskSnapshot = {
  maskW: number;
  maskH: number;
  rect: MaskRect;
  bitset: Uint8Array;
  bitsetBase64: string;
  viewportW: number;
  viewportH: number;
  readback: "sync" | "pbo";
};

type MaskGeneratorOptions = {
  maxEdge?: number;
  alphaThreshold?: number;
  dilation?: number;
  asyncReadback?: boolean;
};

const encodeBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
};

export class MaskGenerator {
  private readonly options: Required<MaskGeneratorOptions>;
  private readonly material: MeshBasicMaterial;
  private renderTarget: WebGLRenderTarget | null = null;
  private pixels = new Uint8Array(0);
  private mask = new Uint8Array(0);
  private scratch = new Uint8Array(0);
  private bitset = new Uint8Array(0);
  private readonly pboReadback = new PboMaskReadback();

  constructor(options: MaskGeneratorOptions = {}) {
    this.options = {
      maxEdge: options.maxEdge ?? DEFAULT_HITTEST_MASK_MAX_EDGE,
      alphaThreshold: options.alphaThreshold ?? DEFAULT_HITTEST_ALPHA_THRESHOLD,
      dilation: options.dilation ?? DEFAULT_HITTEST_DILATION,
      asyncReadback: options.asyncReadback ?? DEFAULT_HITTEST_ASYNC_READBACK,
    };
    this.material = new MeshBasicMaterial({ color: 0xffffff });
    this.material.transparent = false;
  }

  dispose() {
    this.pboReadback.dispose();
    this.renderTarget?.dispose();
    this.renderTarget = null;
    this.material.dispose();
  }

  private ensurePixels(byteLen: number) {
    if (this.pixels.length !== byteLen) {
      this.pixels = new Uint8Array(byteLen);
    }
    return this.pixels;
  }

  private buildSnapshot(
    maskW: number,
    maskH: number,
    viewportW: number,
    viewportH: number,
    readback: "sync" | "pbo"
  ): HitTestMaskSnapshot | null {
    if (this.pixels.length !== maskW * maskH * 4) {
      return null;
    }

    if (this.mask.length !== maskW * maskH) {
      this.mask = new Uint8Array(maskW * maskH);
    }
    if (this.scratch.length !== maskW * maskH) {
      this.scratch = new Uint8Array(maskW * maskH);
    }

    const threshold = this.options.alphaThreshold;
    // WebGL readPixels origin is bottom-left; flip Y to get top-left origin mask.
    for (let y = 0; y < maskH; y++) {
      const srcY = maskH - 1 - y;
      for (let x = 0; x < maskW; x++) {
        const src = (srcY * maskW + x) * 4;
        const alpha = this.pixels[src + 3];
        this.mask[y * maskW + x] = alpha >= threshold ? 1 : 0;
      }
    }

    const dilation = this.options.dilation;
    let finalMask = this.mask;
    if (dilation > 0) {
      this.scratch.fill(0);
      for (let y = 0; y < maskH; y++) {
        for (let x = 0; x < maskW; x++) {
          if (this.mask[y * maskW + x] !== 1) continue;
          const x0 = Math.max(0, x - dilation);
          const x1 = Math.min(maskW - 1, x + dilation);
          const y0 = Math.max(0, y - dilation);
          const y1 = Math.min(maskH - 1, y + dilation);
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
              this.scratch[yy * maskW + xx] = 1;
            }
          }
        }
      }
      finalMask = this.scratch;
    }

    let minX = maskW;
    let minY = maskH;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < maskH; y++) {
      for (let x = 0; x < maskW; x++) {
        if (finalMask[y * maskW + x] !== 1) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    const rect: MaskRect =
      maxX >= 0 && maxY >= 0
        ? { minX, minY, maxX: maxX + 1, maxY: maxY + 1 }
        : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    const stride = Math.ceil(maskW / 8);
    const expectedLen = stride * maskH;
    if (this.bitset.length !== expectedLen) {
      this.bitset = new Uint8Array(expectedLen);
    }
    this.bitset.fill(0);

    for (let y = 0; y < maskH; y++) {
      const rowBase = y * maskW;
      const outBase = y * stride;
      for (let x = 0; x < maskW; x++) {
        if (finalMask[rowBase + x] !== 1) continue;
        const byteIndex = outBase + (x >> 3);
        this.bitset[byteIndex] |= 1 << (x & 7);
      }
    }

    return {
      maskW,
      maskH,
      rect,
      bitset: this.bitset,
      bitsetBase64: encodeBase64(this.bitset),
      viewportW,
      viewportH,
      readback,
    };
  }

  generate(ctx: VrmRendererFrameContext, vrm: VRM): HitTestMaskSnapshot | null {
    const renderer = ctx.renderer;
    const scene = ctx.scene;
    const camera = ctx.camera;

    if (!vrm) return null;

    const gl = renderer.getContext();
    const viewportW = gl.drawingBufferWidth;
    const viewportH = gl.drawingBufferHeight;
    if (!viewportW || !viewportH) return null;

    const gl2 =
      this.options.asyncReadback && !this.pboReadback.isDisabled() && isWebGl2(gl)
        ? gl
        : null;
    const pending =
      gl2
        ? this.pboReadback.tryConsumePending(gl2, (byteLen) => this.ensurePixels(byteLen))
        : null;
    const pendingSnapshot = pending
      ? this.buildSnapshot(
          pending.meta.maskW,
          pending.meta.maskH,
          pending.meta.viewportW,
          pending.meta.viewportH,
          "pbo"
        )
      : null;

    const maxEdge = Math.max(8, this.options.maxEdge);
    const scale = maxEdge / Math.max(viewportW, viewportH);
    const maskW = Math.max(1, Math.round(viewportW * scale));
    const maskH = Math.max(1, Math.round(viewportH * scale));

    if (!this.renderTarget || this.renderTarget.width !== maskW || this.renderTarget.height !== maskH) {
      this.renderTarget?.dispose();
      this.renderTarget = new WebGLRenderTarget(maskW, maskH, {
        depthBuffer: true,
        stencilBuffer: false,
        magFilter: NearestFilter,
        minFilter: NearestFilter,
        format: RGBAFormat,
        type: UnsignedByteType,
      });
    }

    const rt = this.renderTarget;

    const prevRt = renderer.getRenderTarget();
    const prevOverride: Material | null = scene.overrideMaterial ?? null;

    scene.overrideMaterial = this.material;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);

    let snapshot: HitTestMaskSnapshot | null = null;
    if (gl2) {
      const scheduled = this.pboReadback.scheduleReadback(gl2, {
        maskW,
        maskH,
        viewportW,
        viewportH,
      });
      if (!scheduled) {
        // PBO path failed; fall back to sync readback for this frame.
        this.pboReadback.disable(gl2);
      }
    }

    if (!gl2 || this.pboReadback.isDisabled()) {
      const expectedLen = maskW * maskH * 4;
      this.ensurePixels(expectedLen);
      renderer.readRenderTargetPixels(rt, 0, 0, maskW, maskH, this.pixels);
      snapshot = this.buildSnapshot(maskW, maskH, viewportW, viewportH, "sync");
    } else {
      snapshot = pendingSnapshot;
    }

    renderer.setRenderTarget(prevRt);
    scene.overrideMaterial = prevOverride;

    return snapshot;
  }
}
