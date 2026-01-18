import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";

import { reportError } from "@/utils";

type WindowMetrics = {
  outerX: number;
  outerY: number;
  outerW: number;
  outerH: number;
  borderW: number;
  borderH: number;
};

type DragState = {
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  startOuterX: number;
  startOuterY: number;
  scaleFactor: number;
  ready: boolean;
};

const AVATAR_WINDOW_SCALE_MIN_W = 240;
const AVATAR_WINDOW_SCALE_MIN_H = 360;
const AVATAR_WINDOW_SCALE_MAX_W = 1400;
const AVATAR_WINDOW_SCALE_MAX_H = 2100;

export class AvatarWindowTransformController {
  private disposed = false;
  private unlistenFns: Array<() => void> = [];
  private metrics: WindowMetrics | null = null;

  private pendingMove: { x: number; y: number } | null = null;
  private pendingScaleDeltaY = 0;
  private runnerInFlight = false;

  private dragState: DragState | null = null;

  constructor() {
    const win = getCurrentWindow();

    const track = (promise: Promise<() => void>, label: string) => {
      void promise
        .then((unlisten) => {
          if (this.disposed) {
            try {
              unlisten();
            } catch {
              // Ignore unlisten failures during shutdown.
            }
            return;
          }
          this.unlistenFns.push(unlisten);
        })
        .catch((err) => {
          reportError(err, `AvatarWindowTransform.${label}`, { devOnly: true });
        });
    };

    track(
      win.onMoved(() => {
        this.metrics = null;
      }),
      "onMoved"
    );
    track(
      win.onResized(() => {
        this.metrics = null;
      }),
      "onResized"
    );
    track(
      win.onScaleChanged(() => {
        this.metrics = null;
      }),
      "onScaleChanged"
    );
  }

  dispose() {
    this.disposed = true;
    this.metrics = null;
    this.pendingMove = null;
    this.pendingScaleDeltaY = 0;
    this.dragState = null;

    for (const unlisten of this.unlistenFns) {
      try {
        unlisten();
      } catch {
        // Ignore unlisten failures.
      }
    }
    this.unlistenFns = [];
  }

  handlePointerDown(event: PointerEvent, canvas: HTMLCanvasElement): boolean {
    if (this.disposed) return false;
    if (event.button !== 0) return false;

    this.metrics = null;
    this.dragState = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startOuterX: 0,
      startOuterY: 0,
      scaleFactor: 1,
      ready: false,
    };

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture failures.
    }

    const pointerId = event.pointerId;
    const win = getCurrentWindow();
    void Promise.all([win.outerPosition(), win.scaleFactor()])
      .then(([pos, scaleFactor]) => {
        const state = this.dragState;
        if (!state || state.pointerId !== pointerId) return;
        state.startOuterX = pos.x;
        state.startOuterY = pos.y;
        if (Number.isFinite(scaleFactor) && scaleFactor > 0) {
          state.scaleFactor = scaleFactor;
        }
        state.ready = true;
      })
      .catch((err) => {
        this.dragState = null;
        reportError(err, "AvatarWindowTransform.dragInit", { devOnly: true });
      });

    return true;
  }

  handlePointerMove(event: PointerEvent): boolean {
    if (this.disposed) return false;
    const state = this.dragState;
    if (!state || state.pointerId !== event.pointerId) return false;
    if (!state.ready) return true;

    const scaleFactor = state.scaleFactor;
    const startX = Math.round(state.startScreenX * scaleFactor);
    const startY = Math.round(state.startScreenY * scaleFactor);
    const x = Math.round(event.screenX * scaleFactor);
    const y = Math.round(event.screenY * scaleFactor);
    const nextX = state.startOuterX + (x - startX);
    const nextY = state.startOuterY + (y - startY);
    this.queueMove(nextX, nextY);
    return true;
  }

  handlePointerUp(event: PointerEvent, canvas: HTMLCanvasElement): boolean {
    if (this.disposed) return false;
    const state = this.dragState;
    if (!state || state.pointerId !== event.pointerId) return false;

    this.dragState = null;
    this.metrics = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore capture release failures.
    }
    return true;
  }

  queueScale(deltaY: number) {
    if (this.disposed) return;
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    this.pendingScaleDeltaY += deltaY;
    this.ensureRunner();
  }

  private queueMove(x: number, y: number) {
    if (this.disposed) return;
    this.pendingMove = { x, y };
    this.ensureRunner();
  }

  private ensureRunner() {
    if (this.disposed) return;
    if (this.runnerInFlight) return;
    this.runnerInFlight = true;
    void this.runPending().finally(() => {
      this.runnerInFlight = false;
    });
  }

  private async runPending() {
    const win = getCurrentWindow();

    while (!this.disposed) {
      const move = this.pendingMove;
      const scaleDelta = this.pendingScaleDeltaY;
      if (!move && scaleDelta === 0) break;

      if (move) {
        this.pendingMove = null;
        try {
          await win.setPosition(new PhysicalPosition(move.x, move.y));
          if (this.metrics) {
            this.metrics.outerX = move.x;
            this.metrics.outerY = move.y;
          }
        } catch (err) {
          this.metrics = null;
          reportError(err, "AvatarWindowTransform.move", { devOnly: true });
        }
      }

      if (this.pendingScaleDeltaY !== 0) {
        const pending = this.pendingScaleDeltaY;
        this.pendingScaleDeltaY = 0;
        try {
          await this.applyScale(win, pending);
        } catch (err) {
          this.metrics = null;
          reportError(err, "AvatarWindowTransform.scale", { devOnly: true });
        }
      }
    }
  }

  private async applyScale(win: ReturnType<typeof getCurrentWindow>, deltaY: number) {
    if (!Number.isFinite(deltaY) || deltaY === 0) return;

    const factor = Math.exp(-deltaY * 0.001);
    if (!Number.isFinite(factor) || factor <= 0) return;

    let metrics = this.metrics;
    if (!metrics) {
      const [outerPos, outerSize, innerSize] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.innerSize(),
      ]);
      const borderW = Math.max(0, outerSize.width - innerSize.width);
      const borderH = Math.max(0, outerSize.height - innerSize.height);
      metrics = {
        outerX: outerPos.x,
        outerY: outerPos.y,
        outerW: outerSize.width,
        outerH: outerSize.height,
        borderW,
        borderH,
      };
    }

    const minFactor = Math.max(
      AVATAR_WINDOW_SCALE_MIN_W / metrics.outerW,
      AVATAR_WINDOW_SCALE_MIN_H / metrics.outerH
    );
    const maxFactor = Math.min(
      AVATAR_WINDOW_SCALE_MAX_W / metrics.outerW,
      AVATAR_WINDOW_SCALE_MAX_H / metrics.outerH
    );
    const nextFactor = Math.min(maxFactor, Math.max(minFactor, factor));

    const desiredOuterW = Math.round(metrics.outerW * nextFactor);
    const desiredOuterH = Math.round(metrics.outerH * nextFactor);
    const desiredInnerW = Math.max(1, desiredOuterW - metrics.borderW);
    const desiredInnerH = Math.max(1, desiredOuterH - metrics.borderH);
    const nextOuterW = desiredInnerW + metrics.borderW;
    const nextOuterH = desiredInnerH + metrics.borderH;

    if (nextOuterW === metrics.outerW && nextOuterH === metrics.outerH) {
      this.metrics = metrics;
      return;
    }

    const centerX = metrics.outerX + metrics.outerW / 2;
    const centerY = metrics.outerY + metrics.outerH / 2;
    const nextOuterX = Math.round(centerX - nextOuterW / 2);
    const nextOuterY = Math.round(centerY - nextOuterH / 2);

    await win.setSize(new PhysicalSize(desiredInnerW, desiredInnerH));
    await win.setPosition(new PhysicalPosition(nextOuterX, nextOuterY));

    this.metrics = {
      outerX: nextOuterX,
      outerY: nextOuterY,
      outerW: nextOuterW,
      outerH: nextOuterH,
      borderW: metrics.borderW,
      borderH: metrics.borderH,
    };
  }
}
