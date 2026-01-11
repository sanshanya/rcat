import type { Object3D } from "three";
import { Box3, Raycaster, Vector2, Vector3, type PerspectiveCamera } from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";

export type AvatarZoneId = "head" | "chest" | "abdomen";

type ZoneConfig = {
  id: AvatarZoneId;
  bone: VRMHumanBoneName;
  priority: number;
  radiusRatio: number;
  offset?: [number, number, number];
};

type ZoneRuntime = ZoneConfig & {
  node: Object3D;
  baseRadius: number;
  offsetVec: Vector3;
};

export type AvatarZoneHit = {
  id: AvatarZoneId;
  distance: number;
};

const DEFAULT_ZONES: ZoneConfig[] = [
  { id: "head", bone: VRMHumanBoneName.Head, priority: 3, radiusRatio: 0.085 },
  { id: "chest", bone: VRMHumanBoneName.Chest, priority: 2, radiusRatio: 0.17 },
  { id: "abdomen", bone: VRMHumanBoneName.Hips, priority: 1, radiusRatio: 0.19 },
];

const raySphereDistance = (
  rayOrigin: Vector3,
  rayDir: Vector3,
  center: Vector3,
  radius: number,
  scratch: Vector3
): number | null => {
  if (!Number.isFinite(radius) || radius <= 0) return null;
  scratch.copy(rayOrigin).sub(center);
  const b = scratch.dot(rayDir);
  const c = scratch.dot(scratch) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0) return null;
  return t;
};

const resolveBoneNode = (vrm: VRM, bone: VRMHumanBoneName): Object3D | null => {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;
  const direct =
    humanoid.getRawBoneNode(bone) ?? humanoid.getNormalizedBoneNode(bone) ?? null;
  if (direct) return direct;
  if (bone === VRMHumanBoneName.Head) {
    return (
      humanoid.getRawBoneNode(VRMHumanBoneName.Neck) ??
      humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck) ??
      null
    );
  }
  if (bone === VRMHumanBoneName.Chest) {
    return (
      humanoid.getRawBoneNode(VRMHumanBoneName.UpperChest) ??
      humanoid.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) ??
      humanoid.getRawBoneNode(VRMHumanBoneName.Spine) ??
      humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine) ??
      null
    );
  }
  if (bone === VRMHumanBoneName.Hips) {
    return (
      humanoid.getRawBoneNode(VRMHumanBoneName.Spine) ??
      humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine) ??
      null
    );
  }
  return null;
};

const estimateAvatarHeight = (vrm: VRM) => {
  vrm.scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(vrm.scene);
  if (box.isEmpty()) return 1.6;
  const size = box.getSize(new Vector3());
  return Math.max(0.2, Math.min(10, size.y));
};

const pickBestHit = (hits: AvatarZoneHit[], zones: ZoneRuntime[]) => {
  if (hits.length === 0) return null;
  const priorityMap = new Map<AvatarZoneId, number>();
  zones.forEach((zone) => priorityMap.set(zone.id, zone.priority));
  return hits.reduce((best, hit) => {
    if (!best) return hit;
    if (hit.distance !== best.distance) {
      return hit.distance < best.distance ? hit : best;
    }
    const a = priorityMap.get(best.id) ?? 0;
    const b = priorityMap.get(hit.id) ?? 0;
    if (b !== a) return b > a ? hit : best;
    return best;
  }, null as AvatarZoneHit | null);
};

export class AvatarZoneHitTester {
  private readonly root: Object3D;
  private readonly zones: ZoneRuntime[];
  private activeZone: AvatarZoneId | null = null;
  private readonly raycaster = new Raycaster();
  private readonly tmpVec2 = new Vector2();
  private readonly tmpWorld = new Vector3();
  private readonly tmpScratch = new Vector3();
  private readonly tmpScale = new Vector3();
  private readonly tmpOrigin = new Vector3();
  private readonly tmpDir = new Vector3();

  private static readonly EXIT_RADIUS_SCALE = 1.25;
  private static readonly SWITCH_DISTANCE_RATIO = 0.75;

  constructor(vrm: VRM) {
    this.root = vrm.scene;
    const avatarHeight = estimateAvatarHeight(vrm);
    const zones: ZoneRuntime[] = [];
    for (const zone of DEFAULT_ZONES) {
      const node = resolveBoneNode(vrm, zone.bone);
      if (!node) continue;
      zones.push({
        ...zone,
        node,
        baseRadius: avatarHeight * zone.radiusRatio,
        offsetVec: new Vector3(...(zone.offset ?? [0, 0, 0])),
      });
    }
    if (zones.length === 0) {
      throw new Error("Missing humanoid bones for avatar interaction zones");
    }
    this.zones = zones;
  }

  getActiveZone() {
    return this.activeZone;
  }

  hitTest(options: {
    pointer: { x: number; y: number } | null;
    camera: PerspectiveCamera;
  }): { zone: AvatarZoneId | null; changed: boolean; hit: AvatarZoneHit | null } {
    const { pointer, camera } = options;
    const prev = this.activeZone;
    if (!pointer) {
      this.activeZone = null;
      return { zone: null, changed: prev !== null, hit: null };
    }

    this.tmpVec2.set(pointer.x, pointer.y);
    this.raycaster.setFromCamera(this.tmpVec2, camera);
    this.tmpOrigin.copy(this.raycaster.ray.origin);
    this.tmpDir.copy(this.raycaster.ray.direction);

    const scale = Math.abs(this.root.getWorldScale(this.tmpScale).x) || 1;

    const enterHits: AvatarZoneHit[] = [];
    let activeExitHit: AvatarZoneHit | null = null;

    for (const zone of this.zones) {
      zone.node.getWorldPosition(this.tmpWorld);
      this.tmpWorld.add(zone.offsetVec);
      const baseRadius = zone.baseRadius * scale;

      const enterDist = raySphereDistance(
        this.tmpOrigin,
        this.tmpDir,
        this.tmpWorld,
        baseRadius,
        this.tmpScratch
      );
      if (enterDist !== null) {
        enterHits.push({ id: zone.id, distance: enterDist });
      }

      if (this.activeZone === zone.id) {
        const exitDist = raySphereDistance(
          this.tmpOrigin,
          this.tmpDir,
          this.tmpWorld,
          baseRadius * AvatarZoneHitTester.EXIT_RADIUS_SCALE,
          this.tmpScratch
        );
        if (exitDist !== null) {
          activeExitHit = { id: zone.id, distance: exitDist };
        }
      }
    }

    const candidate = pickBestHit(enterHits, this.zones);
    const activeEnterHit =
      this.activeZone ? enterHits.find((hit) => hit.id === this.activeZone) ?? null : null;

    if (this.activeZone && activeExitHit) {
      if (!candidate || candidate.id === this.activeZone) {
        // Keep active zone.
      } else {
        // When we are only in the exit buffer (not the enter radius), allow switching freely.
        if (!activeEnterHit) {
          this.activeZone = candidate.id;
        } else {
          const activePriority =
            this.zones.find((zone) => zone.id === this.activeZone)?.priority ?? 0;
          const candidatePriority =
            this.zones.find((zone) => zone.id === candidate.id)?.priority ?? 0;
          const allowPrioritySwitch = candidatePriority > activePriority;
          const allowDistanceSwitch =
            candidate.distance <
            activeExitHit.distance * AvatarZoneHitTester.SWITCH_DISTANCE_RATIO;
          if (allowPrioritySwitch || allowDistanceSwitch) {
            this.activeZone = candidate.id;
          }
        }
      }
    } else {
      this.activeZone = candidate?.id ?? null;
    }

    const zone = this.activeZone;
    const changed = zone !== prev;

    if (!zone) return { zone: null, changed, hit: null };
    const best = enterHits.find((hit) => hit.id === zone) ?? null;
    return { zone, changed, hit: best };
  }
}
