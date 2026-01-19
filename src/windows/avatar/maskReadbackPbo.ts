export type PboReadbackMeta = {
  maskW: number;
  maskH: number;
  viewportW: number;
  viewportH: number;
};

type PendingReadback = {
  gl: WebGL2RenderingContext;
  buffer: WebGLBuffer;
  sync: WebGLSync;
  meta: PboReadbackMeta;
};

export const isWebGl2 = (
  gl: WebGLRenderingContext | WebGL2RenderingContext
): gl is WebGL2RenderingContext => {
  return typeof (gl as WebGL2RenderingContext).fenceSync === "function";
};

export class PboMaskReadback {
  private disabled = false;
  private context: WebGL2RenderingContext | null = null;
  private buffer: WebGLBuffer | null = null;
  private pending: PendingReadback | null = null;

  isDisabled() {
    return this.disabled;
  }

  dispose() {
    this.disable();
  }

  disable(gl?: WebGL2RenderingContext) {
    this.disabled = true;
    if (this.pending) {
      try {
        this.pending.gl.deleteSync(this.pending.sync);
      } catch {
        // Ignore sync deletion failures.
      }
      this.pending = null;
    }
    const ctx = gl ?? this.context;
    if (this.buffer && ctx) {
      try {
        ctx.deleteBuffer(this.buffer);
      } catch {
        // Ignore buffer deletion failures.
      }
    }
    this.buffer = null;
    this.context = null;
  }

  tryConsumePending(
    gl: WebGL2RenderingContext,
    getPixelsBuffer: (byteLen: number) => Uint8Array
  ): { pixels: Uint8Array; meta: PboReadbackMeta } | null {
    const pending = this.pending;
    if (!pending) return null;
    if (pending.gl !== gl || pending.buffer !== this.buffer) {
      this.disable(gl);
      return null;
    }

    const status = gl.clientWaitSync(pending.sync, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) {
      return null;
    }
    if (status === gl.WAIT_FAILED) {
      this.disable(gl);
      return null;
    }

    const expectedLen = pending.meta.maskW * pending.meta.maskH * 4;
    const pixels = getPixelsBuffer(expectedLen);

    try {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pending.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
    } catch {
      this.disable(gl);
      return null;
    } finally {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      try {
        gl.deleteSync(pending.sync);
      } catch {
        // Ignore.
      }
      this.pending = null;
    }

    return { pixels, meta: pending.meta };
  }

  scheduleReadback(gl: WebGL2RenderingContext, meta: PboReadbackMeta): boolean {
    if (this.pending) return true;
    if (this.disabled) return false;

    if (!this.buffer || this.context !== gl) {
      this.disable(gl);
      this.disabled = false;
      const buffer = gl.createBuffer();
      if (!buffer) {
        this.disable(gl);
        return false;
      }
      this.buffer = buffer;
      this.context = gl;
    }

    const buffer = this.buffer;
    if (!buffer) return false;

    const byteLen = meta.maskW * meta.maskH * 4;
    try {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLen, gl.STREAM_READ);
      gl.readPixels(0, 0, meta.maskW, meta.maskH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        this.disable(gl);
        return false;
      }
      gl.flush();
      this.pending = {
        gl,
        buffer,
        sync,
        meta,
      };
      return true;
    } catch {
      this.disable(gl);
      return false;
    } finally {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
  }
}

