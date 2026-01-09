import { VRMHumanBoneName, VRMHumanBoneParentMap } from "@pixiv/three-vrm";
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  Matrix4,
  NumberKeyframeTrack,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";

import type { VRMAnimation } from "@/components/vrm/motion/vrma/VRMAnimation";
import { VRMAnimation as VRMAnimationImpl } from "@/components/vrm/motion/vrma/VRMAnimation";
import type { VRMCVRMAnimation } from "@/components/vrm/motion/vrma/VRMCVRMAnimation";
import { arrayChunk } from "@/components/vrm/motion/vrma/utils/arrayChunk";

const EXTENSION_NAME = "VRMC_vrm_animation";
const MAT4_IDENTITY = new Matrix4();

const vec3A = new Vector3();
const quatA = new Quaternion();
const quatB = new Quaternion();
const quatC = new Quaternion();

type NodeMap = {
  humanoidIndexToName: Map<number, VRMHumanBoneName>;
  expressionsIndexToName: Map<number, string>;
  lookAtIndex: number | null;
};

type WorldMatrixMap = Map<VRMHumanBoneName | "hipsParent", Matrix4>;

type GltfJson = {
  extensionsUsed?: unknown;
  extensions?: Record<string, unknown>;
  animations?: unknown[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export class VRMAnimationLoaderPlugin implements GLTFLoaderPlugin {
  public readonly parser: GLTFParser;

  constructor(parser: GLTFParser) {
    this.parser = parser;
  }

  get name(): string {
    return EXTENSION_NAME;
  }

  async afterRoot(gltf: GLTF): Promise<void> {
    const defGltf = gltf.parser.json as unknown as GltfJson;
    const extensionsUsedValue = defGltf.extensionsUsed;
    const extensionsUsed = Array.isArray(extensionsUsedValue)
      ? (extensionsUsedValue.filter((value) => typeof value === "string") as string[])
      : null;
    if (!extensionsUsed?.includes(EXTENSION_NAME)) return;

    const defExtension = (defGltf.extensions?.[EXTENSION_NAME] ?? null) as VRMCVRMAnimation | null;
    if (!defExtension) return;

    const nodeMap = this.createNodeMap(defExtension);
    const worldMatrixMap = await this.createBoneWorldMatrixMap(gltf, defExtension);

    const hipsNodeIndex = defExtension.humanoid.humanBones.hips?.node;
    if (typeof hipsNodeIndex !== "number") return;
    const hipsNode = (await gltf.parser.getDependency("node", hipsNodeIndex)) as Object3D;
    const restHipsPosition = hipsNode.getWorldPosition(new Vector3());

    const clips = gltf.animations;
    const defAnimations = Array.isArray(defGltf.animations) ? defGltf.animations : null;
    if (!defAnimations) return;

    const animations: VRMAnimation[] = clips.map((clip, clipIndex) => {
      const defAnimation = defAnimations[clipIndex];
      const parsed = this.parseAnimation(clip, defAnimation, nodeMap, worldMatrixMap);
      parsed.restHipsPosition = restHipsPosition;
      return parsed;
    });

    gltf.userData.vrmAnimations = animations;
  }

  private createNodeMap(defExtension: VRMCVRMAnimation): NodeMap {
    const humanoidIndexToName = new Map<number, VRMHumanBoneName>();
    const expressionsIndexToName = new Map<number, string>();

    Object.entries(defExtension.humanoid?.humanBones ?? {}).forEach(([name, bone]) => {
      if (!bone) return;
      humanoidIndexToName.set(bone.node, name as VRMHumanBoneName);
    });

    const preset = defExtension.expressions?.preset ?? null;
    if (preset) {
      Object.entries(preset).forEach(([name, expression]) => {
        if (!expression) return;
        expressionsIndexToName.set(expression.node, name);
      });
    }

    const custom = defExtension.expressions?.custom ?? null;
    if (custom) {
      Object.entries(custom).forEach(([name, expression]) => {
        if (!expression) return;
        expressionsIndexToName.set(expression.node, name);
      });
    }

    return {
      humanoidIndexToName,
      expressionsIndexToName,
      lookAtIndex: defExtension.lookAt?.node ?? null,
    };
  }

  private async createBoneWorldMatrixMap(
    gltf: GLTF,
    defExtension: VRMCVRMAnimation
  ): Promise<WorldMatrixMap> {
    gltf.scene.updateWorldMatrix(false, true);
    const threeNodes = (await gltf.parser.getDependencies("node")) as Object3D[];

    const worldMatrixMap: WorldMatrixMap = new Map();

    Object.entries(defExtension.humanoid.humanBones).forEach(([boneName, bone]) => {
      if (!bone) return;
      const node = threeNodes[bone.node];
      if (!node) return;
      worldMatrixMap.set(boneName as VRMHumanBoneName, node.matrixWorld);
      if (boneName === "hips") {
        worldMatrixMap.set("hipsParent", node.parent?.matrixWorld ?? MAT4_IDENTITY);
      }
    });

    return worldMatrixMap;
  }

  private parseAnimation(
    animationClip: import("three").AnimationClip,
    defAnimation: unknown,
    nodeMap: NodeMap,
    worldMatrixMap: WorldMatrixMap
  ): VRMAnimationImpl {
    const tracks = animationClip.tracks;
    const defChannelsValue = isRecord(defAnimation) ? defAnimation.channels : null;
    const defChannels = Array.isArray(defChannelsValue) ? defChannelsValue : [];

    const result = new VRMAnimationImpl();
    result.duration = animationClip.duration;

    defChannels.forEach((channel, channelIndex) => {
      if (!isRecord(channel)) return;
      const target = isRecord(channel.target) ? channel.target : null;
      if (!target) return;
      const nodeIndex = typeof target.node === "number" ? target.node : null;
      const path = typeof target.path === "string" ? target.path : null;
      if (nodeIndex === null || !path) return;

      const origTrack = tracks[channelIndex] ?? null;
      if (!origTrack) return;

      const boneName = nodeMap.humanoidIndexToName.get(nodeIndex);
      if (boneName) {
        let parentBoneName: VRMHumanBoneName | "hipsParent" | null =
          VRMHumanBoneParentMap[boneName] ?? null;
        while (parentBoneName && !worldMatrixMap.get(parentBoneName)) {
          parentBoneName = VRMHumanBoneParentMap[parentBoneName] ?? null;
        }
        if (!parentBoneName) parentBoneName = "hipsParent";

        if (path === "translation") {
          if (!(origTrack instanceof VectorKeyframeTrack)) return;
          const hipsParentWorldMatrix = worldMatrixMap.get("hipsParent")!;
          const trackValues = arrayChunk(origTrack.values, 3).flatMap((values) =>
            vec3A.fromArray(values).applyMatrix4(hipsParentWorldMatrix).toArray()
          );
          const track = origTrack.clone();
          track.values = new Float32Array(trackValues);
          result.humanoidTracks.translation.set(boneName, track);
          return;
        }

        if (path === "rotation") {
          if (!(origTrack instanceof QuaternionKeyframeTrack)) return;
          const worldMatrix = worldMatrixMap.get(boneName)!;
          const parentWorldMatrix = worldMatrixMap.get(parentBoneName)!;

          quatA.setFromRotationMatrix(worldMatrix).normalize().invert();
          quatB.setFromRotationMatrix(parentWorldMatrix).normalize();

          const trackValues = arrayChunk(origTrack.values, 4).flatMap((values) =>
            quatC.fromArray(values).premultiply(quatB).multiply(quatA).toArray()
          );

          const track = origTrack.clone();
          track.values = new Float32Array(trackValues);
          result.humanoidTracks.rotation.set(boneName, track);
          return;
        }

        throw new Error(`VRMAnimationLoaderPlugin: invalid path "${String(path)}"`);
      }

      const expressionName = nodeMap.expressionsIndexToName.get(nodeIndex);
      if (expressionName) {
        if (path !== "translation") {
          throw new Error(`VRMAnimationLoaderPlugin: invalid expression path "${String(path)}"`);
        }
        if (!(origTrack instanceof VectorKeyframeTrack)) return;
        const times = origTrack.times;
        const values = new Float32Array(origTrack.values.length / 3);
        for (let i = 0; i < values.length; i += 1) {
          values[i] = origTrack.values[3 * i];
        }
        const newTrack = new NumberKeyframeTrack(
          `${expressionName}.weight`,
          times,
          values
        );
        result.expressionTracks.set(expressionName, newTrack);
        return;
      }

      if (nodeIndex === nodeMap.lookAtIndex) {
        if (path !== "rotation") {
          throw new Error(`VRMAnimationLoaderPlugin: invalid lookAt path "${String(path)}"`);
        }
        result.lookAtTrack = origTrack instanceof QuaternionKeyframeTrack ? origTrack : null;
      }
    });

    return result;
  }
}
