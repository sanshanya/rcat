import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMSpringBoneLoaderPlugin } from "@pixiv/three-vrm";

type SpringBoneSchema = {
  colliders?: unknown[];
  colliderGroups?: unknown[];
  springs?: Array<{
    joints?: unknown[];
    colliderGroups?: unknown[];
  }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const sanitizeSpringBone = (json: unknown) => {
  if (!json || typeof json !== "object") return false;
  const root = json as Record<string, unknown>;
  const extensions = root.extensions;
  if (!extensions || typeof extensions !== "object") return false;
  const springBone = (extensions as Record<string, unknown>).VRMC_springBone;
  if (!springBone || typeof springBone !== "object") return false;
  const schema = springBone as SpringBoneSchema;
  let patched = false;

  if (!Array.isArray(schema.colliders)) {
    schema.colliders = [];
    patched = true;
  } else {
    schema.colliders = schema.colliders.map((collider) => {
      if (isRecord(collider)) return collider;
      patched = true;
      return {
        node: -1,
        shape: { sphere: { offset: [0, 0, 0], radius: 0 } },
      };
    });
  }
  if (!Array.isArray(schema.colliderGroups)) {
    schema.colliderGroups = [];
    patched = true;
  } else {
    schema.colliderGroups = schema.colliderGroups.map((group) => {
      if (isRecord(group)) return group;
      patched = true;
      return { colliders: [] };
    });
  }
  if (!Array.isArray(schema.springs)) {
    schema.springs = [];
    patched = true;
  }

  const maxColliderGroup = Array.isArray(schema.colliderGroups)
    ? schema.colliderGroups.length
    : 0;

  schema.springs.forEach((spring, index) => {
    if (!isRecord(spring)) {
      schema.springs![index] = { joints: [] };
      patched = true;
      return;
    }
    if (!Array.isArray(spring.joints)) {
      spring.joints = [];
      patched = true;
    } else {
      const filtered = spring.joints.filter(
        (joint) => isRecord(joint) && typeof joint.node === "number"
      );
      if (filtered.length !== spring.joints.length) {
        spring.joints = filtered;
        patched = true;
      }
    }
    if (spring.colliderGroups && !Array.isArray(spring.colliderGroups)) {
      spring.colliderGroups = [];
      patched = true;
    } else if (Array.isArray(spring.colliderGroups)) {
      const filtered = spring.colliderGroups.filter(
        (group) => typeof group === "number" && group >= 0 && group < maxColliderGroup
      );
      if (filtered.length !== spring.colliderGroups.length) {
        spring.colliderGroups = filtered;
        patched = true;
      }
    }
  });

  return patched;
};

export class SafeSpringBoneLoaderPlugin extends VRMSpringBoneLoaderPlugin {
  override async afterRoot(gltf: GLTF): Promise<void> {
    const patched = sanitizeSpringBone(gltf.parser.json);
    if (patched) {
      console.warn("VRM spring bone data sanitized; continuing with defaults.");
    }
    try {
      await super.afterRoot(gltf);
    } catch (err) {
      console.warn("VRM spring bone load failed; continuing without spring bones.", err);
      gltf.userData.vrmSpringBoneManager = null;
    }
  }
}

