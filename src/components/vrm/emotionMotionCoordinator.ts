import type { EmotionId } from "@/components/vrm/emotionTypes";
import type { MotionController } from "@/components/vrm/motion/MotionController";

type MotionPlayer = (
  id: string,
  options: { loop: boolean; fadeIn?: number }
) => Promise<boolean>;

const EMOTION_MOTION_RETRY_MS = 3000;

const nowMs = () => (typeof performance === "undefined" ? Date.now() : performance.now());

export class EmotionMotionCoordinator {
  private lastEmotion: EmotionId | null = null;
  private activeMotionId: string | null = null;
  private pendingMotionId: string | null = null;
  private seq = 0;
  private lastFailure: { id: string; at: number } | null = null;

  reset() {
    this.lastEmotion = null;
    this.activeMotionId = null;
    this.pendingMotionId = null;
    this.lastFailure = null;
    this.seq += 1;
  }

  onControllerStopped() {
    this.activeMotionId = null;
    this.pendingMotionId = null;
    this.lastFailure = null;
    this.seq += 1;
  }

  update(options: {
    controller: MotionController | null;
    emotion: EmotionId;
    desiredMotionId: string | null;
    desiredLoopMotion: boolean;
    playMotion: MotionPlayer;
  }) {
    const { controller, emotion, desiredMotionId, desiredLoopMotion, playMotion } = options;

    if (!controller) {
      this.lastEmotion = emotion;
      this.activeMotionId = null;
      this.pendingMotionId = null;
      return;
    }

    const currentMotionId = controller.getCurrentMotionId();

    // If some other motion took over, clear our ownership.
    if (currentMotionId && this.activeMotionId && currentMotionId !== this.activeMotionId) {
      this.activeMotionId = null;
    }

    // If the controller started a different motion while we were pending, cancel the pending request.
    if (currentMotionId && this.pendingMotionId && currentMotionId !== this.pendingMotionId) {
      this.cancelPending();
    }

    const emotionMotionActive = Boolean(
      this.activeMotionId && currentMotionId === this.activeMotionId
    );
    const emotionChanged = this.lastEmotion !== emotion;

    if (emotionChanged) {
      this.lastEmotion = emotion;

      if (desiredMotionId) {
        const canReplace = !currentMotionId || emotionMotionActive;
        if (canReplace && this.pendingMotionId !== desiredMotionId) {
          if (currentMotionId !== desiredMotionId) {
            this.requestMotion(desiredMotionId, { loop: desiredLoopMotion }, playMotion);
          } else if (emotionMotionActive) {
            this.activeMotionId = desiredMotionId;
          }
        } else if (this.pendingMotionId && this.pendingMotionId !== desiredMotionId) {
          this.cancelPending();
        }
      } else {
        if (this.pendingMotionId) {
          this.cancelPending();
        }
        if (emotionMotionActive) {
          void controller.stop();
        }
        this.activeMotionId = null;
      }

      return;
    }

    // Emotion unchanged: clean up stale pending.
    if (this.pendingMotionId && desiredMotionId !== this.pendingMotionId) {
      this.cancelPending();
    }

    if (emotionMotionActive) {
      if (!desiredMotionId) {
        void controller.stop();
        this.activeMotionId = null;
        return;
      }

      if (desiredMotionId !== currentMotionId) {
        this.requestMotion(desiredMotionId, { loop: desiredLoopMotion }, playMotion);
      }
      return;
    }

    // Only auto-play looped emotion motions when the user isn't already playing something.
    if (
      desiredMotionId &&
      desiredLoopMotion &&
      !currentMotionId &&
      !this.activeMotionId &&
      !this.pendingMotionId
    ) {
      this.requestMotion(desiredMotionId, { loop: true }, playMotion);
    }
  }

  private cancelPending() {
    this.pendingMotionId = null;
    this.seq += 1;
  }

  private requestMotion(id: string, options: { loop: boolean }, playMotion: MotionPlayer) {
    const now = nowMs();
    const failure = this.lastFailure;
    if (failure && failure.id === id && now - failure.at < EMOTION_MOTION_RETRY_MS) {
      return;
    }

    if (this.pendingMotionId === id) return;

    this.seq += 1;
    const seq = this.seq;
    this.pendingMotionId = id;

    void (async () => {
      const ok = await playMotion(id, { loop: options.loop, fadeIn: 0.25 });
      if (seq !== this.seq) return;

      this.pendingMotionId = null;
      if (!ok) {
        this.lastFailure = { id, at: nowMs() };
        if (this.activeMotionId === id) {
          this.activeMotionId = null;
        }
        return;
      }

      this.lastFailure = null;
      this.activeMotionId = id;
    })();
  }
}

