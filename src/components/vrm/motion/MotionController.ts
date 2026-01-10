import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

import { loadMixamoAnimation } from "@/components/vrm/motion/mixamo/loadMixamoAnimation";
import { loadVrmAnimation } from "@/components/vrm/motion/vrma/loadVrmAnimation";
import { loadVmdAnimation } from "@/components/vrm/motion/vmd/loadVmdAnimation";
import VRMIKHandler from "@/components/vrm/motion/vmd/vrmIkHandler";
import { getMotionEntryById, type MotionEntry } from "./motionCatalog";
import { getVmdMotionSettings } from "@/components/vrm/vmdSettingsStore";

type MotionPlayOptions = {
  loop?: boolean;
  fadeIn?: number;
};

type MotionControllerOptions = {
  onStopped?: () => void;
};

export class MotionController {
  private vrm: VRM;
  private mixer: AnimationMixer;
  private currentAction: AnimationAction | null = null;
  private currentMotionId: string | null = null;
  private currentMotionType: MotionEntry["type"] | null = null;
  private currentLoop = false;
  private onStopped?: () => void;
  private preloadedMotions = new Map<string, AnimationClip>();
  private ikHandler: VRMIKHandler | null = null;
  private smoothBones: Array<{ node: Object3D; quaternion: Quaternion; position: Vector3 }> = [];
  private smoothingNeedsReset = true;
  private smoothingTauSeconds = 0.12;

  constructor(vrm: VRM, options: MotionControllerOptions = {}) {
    this.vrm = vrm;
    this.mixer = new AnimationMixer(vrm.scene);
    this.onStopped = options.onStopped;
    this.mixer.addEventListener("finished", this.handleFinished);
  }

  public dispose() {
    this.mixer.removeEventListener("finished", this.handleFinished);
    this.stop(false);
  }

  public getCurrentMotionId() {
    return this.currentMotionId;
  }

  public isPlaying() {
    return Boolean(this.currentAction);
  }

  public async preloadById(id: string) {
    const entry = await getMotionEntryById(id);
    if (!entry) return null;
    return await this.preloadEntry(entry);
  }

  public async playById(id: string, options: MotionPlayOptions = {}) {
    const entry = await getMotionEntryById(id);
    if (!entry) {
      console.warn(`Motion not found: ${id}`);
      return false;
    }
    return await this.playEntry(entry, options);
  }

  public async stop(notify: boolean = true) {
    if (this.currentAction) {
      this.currentAction.stop();
    }
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
    this.ikHandler?.disableAll();
    this.currentAction = null;
    this.currentMotionId = null;
    this.currentMotionType = null;
    this.currentLoop = false;
    this.smoothingNeedsReset = true;
    if (notify) {
      this.onStopped?.();
    }
  }

  public update(delta: number) {
    this.mixer.update(delta);
  }

  public postUpdate(delta: number) {
    if (this.currentMotionType !== "vmd") return;
    const vmdSettings = getVmdMotionSettings();
    this.smoothingTauSeconds = vmdSettings.smoothingTauSeconds;
    if (this.ikHandler) {
      if (vmdSettings.enableIk) {
        this.ikHandler.getAndEnableIK(VRMHumanBoneName.LeftFoot);
        this.ikHandler.getAndEnableIK(VRMHumanBoneName.RightFoot);
        this.ikHandler.getAndEnableIK(VRMHumanBoneName.LeftToes);
        this.ikHandler.getAndEnableIK(VRMHumanBoneName.RightToes);
        this.vrm.scene.updateMatrixWorld(true);
        this.ikHandler.update();
      } else {
        this.ikHandler.disableAll();
      }
    }
    this.applySmoothing(delta);
  }

  private ensureSmoothingInitialized() {
    const humanoid = this.vrm.humanoid;
    if (!humanoid) return;
    if (this.smoothBones.length === 0) {
      const boneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneName[];
      boneNames.forEach((boneName) => {
        const node = humanoid.getRawBoneNode(boneName);
        if (!node) return;
        this.smoothBones.push({
          node,
          quaternion: node.quaternion.clone(),
          position: node.position.clone(),
        });
      });
    }
    if (this.smoothingNeedsReset) {
      this.smoothBones.forEach((entry) => {
        entry.quaternion.copy(entry.node.quaternion);
        entry.position.copy(entry.node.position);
      });
      this.smoothingNeedsReset = false;
    }
  }

  private applySmoothing(delta: number) {
    this.ensureSmoothingInitialized();
    if (this.smoothBones.length === 0) return;
    if (delta <= 0) return;
    const tau = Math.max(0.001, this.smoothingTauSeconds);
    const alpha = 1 - Math.exp(-delta / tau);
    this.smoothBones.forEach((entry) => {
      entry.quaternion.slerp(entry.node.quaternion, alpha);
      entry.position.lerp(entry.node.position, alpha);
      entry.node.quaternion.copy(entry.quaternion);
      entry.node.position.copy(entry.position);
    });
  }

  private async preloadEntry(entry: MotionEntry) {
    if (this.preloadedMotions.has(entry.path)) {
      return this.preloadedMotions.get(entry.path) ?? null;
    }
    const clip = await this.loadMotionClip(entry);
    if (clip) {
      this.preloadedMotions.set(entry.path, clip);
    }
    return clip ?? null;
  }

  private async playEntry(entry: MotionEntry, options: MotionPlayOptions) {
    const clip = await this.preloadEntry(entry);
    if (!clip) {
      console.warn(`Failed to load motion: ${entry.id}`);
      return false;
    }

    if (entry.type !== "vmd" && this.ikHandler) {
      this.ikHandler.disableAll();
      this.ikHandler = null;
    }

    const loop = typeof options.loop === "boolean" ? options.loop : entry.loop ?? true;
    const fadeIn = options.fadeIn ?? 0.2;

    const previousAction = this.currentAction;
    const previousId = this.currentMotionId;
    const action =
      previousAction && previousId === entry.id
        ? previousAction
        : this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = true;
    if (action !== previousAction && previousAction) {
      if (fadeIn > 0) {
        previousAction.crossFadeTo(action, fadeIn, false);
      } else {
        previousAction.stop();
      }
    } else if (fadeIn > 0) {
      action.fadeIn(fadeIn);
    }
    action.play();

    this.currentAction = action;
    this.currentMotionId = entry.id;
    this.currentMotionType = entry.type;
    this.currentLoop = loop;
    this.smoothingNeedsReset = entry.type === "vmd";

    return true;
  }

  private async loadMotionClip(entry: MotionEntry) {
    switch (entry.type) {
      case "fbx":
        return await loadMixamoAnimation(entry.path, this.vrm);
      case "vrma":
      case "glb":
      case "gltf":
        return await loadVrmAnimation(entry.path, this.vrm);
      case "vmd":
        this.ikHandler = VRMIKHandler.get(this.vrm);
        return await loadVmdAnimation(entry.path, this.vrm);
      default:
        return null;
    }
  }

  private handleFinished = () => {
    if (this.currentLoop) return;
    this.currentAction = null;
    this.currentMotionId = null;
    this.currentMotionType = null;
    this.currentLoop = false;
    this.smoothingNeedsReset = true;
    this.onStopped?.();
  };
}
