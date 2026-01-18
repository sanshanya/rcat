import type { PerspectiveCamera } from "three";
import type { VRM } from "@pixiv/three-vrm";

import type { ExpressionMixer } from "@/components/vrm/ExpressionMixer";
import { AvatarInteractionController } from "@/components/vrm/avatarInteractionController";
import { drainAvatarBehaviorEvents } from "@/components/vrm/avatarBehaviorEventRuntime";
import { drainAvatarPointerInputEvents } from "@/components/vrm/avatarInteractionInputRuntime";
import { AvatarDragSwayController } from "@/components/vrm/avatarDragSway";
import { hitTestAvatarMaskAtNdc } from "@/components/vrm/avatarHitTestMaskRuntime";
import { setAvatarInteractionRuntime } from "@/components/vrm/avatarInteractionStore";
import { InteractionRuleEngine } from "@/components/vrm/avatarInteractionRuleEngine";
import type { MotionController } from "@/components/vrm/motion/MotionController";

export class AvatarInteractionEngine {
  private readonly controller: AvatarInteractionController;
  private readonly rules = new InteractionRuleEngine();
  private readonly sway: AvatarDragSwayController;
  private lastRuntimeAtMs = 0;

  constructor(vrm: VRM) {
    this.controller = new AvatarInteractionController(vrm);
    this.sway = new AvatarDragSwayController(vrm);
  }

  update(options: {
    delta: number;
    nowMs: number;
    pointer: { x: number; y: number } | null;
    camera: PerspectiveCamera;
    mixer: ExpressionMixer;
    motionController: MotionController | null;
    applySpringWind: boolean;
  }) {
    const { delta, nowMs, pointer, camera, mixer, motionController, applySpringWind } = options;

    const gatedPointer = hitTestAvatarMaskAtNdc(pointer) ? pointer : null;
    const pointerEvents = drainAvatarPointerInputEvents().filter((ev) =>
      hitTestAvatarMaskAtNdc(ev.ndc)
    );
    const result = this.controller.update({
      delta,
      nowMs,
      pointer: gatedPointer,
      camera,
      pointerEvents,
    });

    mixer.setChannel("hover", result.hover);
    const behaviorEvents = drainAvatarBehaviorEvents();
    this.rules.update({
      delta,
      nowMs,
      result,
      events: [...behaviorEvents, ...result.events],
      mixer,
      motionController,
    });

    this.sway.update({
      delta,
      dragging: result.dragging,
      dragDeltaPx: result.dragDeltaPx,
      motionActive: motionController?.isPlaying() ?? false,
      camera,
      applySpringWind,
    });

    if (result.changed || nowMs - this.lastRuntimeAtMs > 200) {
      this.lastRuntimeAtMs = nowMs;
      setAvatarInteractionRuntime({
        zone: result.zone,
        distance: result.distance,
        updatedAt: nowMs,
      });
    }

    return result;
  }
}
