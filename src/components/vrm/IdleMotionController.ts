import { AnimationMixer, LoopRepeat, type Object3D } from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

import type { AvatarMouseTracking } from "@/components/vrm/AvatarMouseTracking";
import {
  DEFAULT_IDLE_MOTION,
  buildIdleClip,
  captureRestPose,
  loadIdleMotionSpec,
  type RestPoseMap,
} from "@/components/vrm/idleMotion";
import { loadVrmAnimation } from "@/components/vrm/motion/vrma/loadVrmAnimation";
import { loadMixamoAnimation } from "@/components/vrm/motion/mixamo/loadMixamoAnimation";
import { applyDesktopInPlaceRootMotion } from "@/components/vrm/motion/desktopRootMotion";

type IdleMotionStartOptions = {
  vrm: VRM;
  url: string | null | undefined;
  restPose: RestPoseMap | null;
  tracker: AvatarMouseTracking | null;
};

export class IdleMotionController {
  private mixer: AnimationMixer | null = null;
  private root: Object3D | null = null;
  private action: ReturnType<AnimationMixer["clipAction"]> | null = null;
  private vrm: VRM | null = null;
  private baseHipsPosition: { x: number; y: number; z: number } | null = null;
  private seq = 0;

  stop(tracker: AvatarMouseTracking | null) {
    this.seq += 1;

    const mixer = this.mixer;
    const root = this.root;
    if (mixer && root) {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    }

    this.mixer = null;
    this.root = null;
    this.action = null;
    this.vrm = null;
    this.baseHipsPosition = null;
    tracker?.setAnimatedClip(null);
  }

  update(delta: number) {
    this.mixer?.update(delta);
  }

  start(options: IdleMotionStartOptions) {
    const url = options.url?.trim();
    if (!url) return;

    const vrm = options.vrm;
    const tracker = options.tracker;

    this.stop(tracker);
    const seq = this.seq;

    this.vrm = vrm;
    this.root = vrm.scene;
    this.mixer = new AnimationMixer(vrm.scene);
    const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips) ?? null;
    this.baseHipsPosition = hips
      ? { x: hips.position.x, y: hips.position.y, z: hips.position.z }
      : null;

    const restPose = options.restPose ?? captureRestPose(vrm);
    const fallbackClip = buildIdleClip(vrm, DEFAULT_IDLE_MOTION, restPose);
    if (fallbackClip) {
      const action = this.mixer.clipAction(fallbackClip);
      action.setLoop(LoopRepeat, Infinity);
      action.play();
      this.action = action;
      tracker?.setAnimatedClip(fallbackClip);
    } else {
      tracker?.setAnimatedClip(null);
    }

    void (async () => {
      const lowerUrl = url.toLowerCase();
      const loadedClip = await (async () => {
        if (lowerUrl.endsWith(".vrma") || lowerUrl.endsWith(".glb") || lowerUrl.endsWith(".gltf")) {
          try {
            return await loadVrmAnimation(url, vrm);
          } catch {
            return null;
          }
        }

        if (lowerUrl.endsWith(".fbx")) {
          try {
            return await loadMixamoAnimation(url, vrm);
          } catch {
            return null;
          }
        }

        const loaded = await loadIdleMotionSpec(url);
        if (!loaded) return null;
        return buildIdleClip(vrm, loaded, restPose);
      })();

      if (!loadedClip) return;
      if (seq !== this.seq || this.vrm !== vrm) return;

      const mixer = this.mixer;
      if (!mixer) return;

      applyDesktopInPlaceRootMotion(
        loadedClip,
        vrm,
        lowerUrl.endsWith(".fbx") ? "lock-horizontal" : "remove-net-displacement",
        this.baseHipsPosition ?? undefined
      );
      const nextAction = mixer.clipAction(loadedClip);
      nextAction.reset();
      nextAction.setLoop(LoopRepeat, Infinity);
      nextAction.fadeIn(0.25);
      nextAction.play();
      this.action?.fadeOut(0.25);
      this.action = nextAction;
      tracker?.setAnimatedClip(loadedClip);
    })();
  }
}
