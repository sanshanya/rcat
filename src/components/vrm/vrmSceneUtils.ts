import { Box3, Material, MathUtils, Mesh, Object3D, Texture, Vector3, type PerspectiveCamera } from "three";
import type { VRM } from "@pixiv/three-vrm";

const disposeMaterial = (material: Material) => {
  for (const value of Object.values(material)) {
    if (value && typeof value === "object" && (value as Texture).isTexture) {
      (value as Texture).dispose();
    }
  }
  material.dispose();
};

const disposeObject = (object: Object3D) => {
  const mesh = object as Mesh;
  if (mesh.geometry) {
    mesh.geometry.dispose();
  }
  const { material } = mesh;
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
  } else if (material) {
    disposeMaterial(material);
  }
};

export const disposeVrm = (vrm: VRM) => {
  vrm.scene.traverse(disposeObject);
  if ("dispose" in vrm && typeof vrm.dispose === "function") {
    vrm.dispose();
  }
};

export const centerObjectOnFloor = (object: Object3D) => {
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new Vector3());
  const minY = box.min.y;
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= minY;
  object.updateMatrixWorld(true);
  return new Box3().setFromObject(object);
};

export const fitCameraToBox = (
  camera: PerspectiveCamera,
  box: Box3,
  options: { margin?: number } = {}
) => {
  if (box.isEmpty()) return;
  const margin = options.margin ?? 1.2;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  const vFov = MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distanceForHeight = (size.y / 2) / Math.tan(vFov / 2);
  const distanceForWidth = (size.x / 2) / Math.tan(hFov / 2);
  const distance = Math.max(distanceForHeight, distanceForWidth) * margin + size.z / 2;

  camera.position.set(center.x, center.y, center.z + distance);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = Math.max(100, distance * 10);
  camera.updateProjectionMatrix();
  camera.lookAt(center);
};

