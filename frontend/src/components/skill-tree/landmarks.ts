import * as T from "three";
import type { SkillTreeNode } from "../../types";

const geometry = () => ({
  island: new T.SphereGeometry(1, 20, 12),
  tower: new T.CylinderGeometry(0.82, 1, 1, 10),
  roof: new T.ConeGeometry(1, 1, 8),
  block: new T.BoxGeometry(),
  dome: new T.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
});

export function buildLandmarks(nodes: SkillTreeNode[], points: T.Vector3[]) {
  const shapes = geometry();
  type Shape = keyof typeof shapes;
  type Part = { matrix: T.Matrix4; color: string; owner: number };
  const batches = new Map<Shape, Part[]>();
  const footprints: number[] = [];
  const local = new T.Object3D();
  const site = new T.Object3D();
  const up = new T.Vector3(0, 1, 0);

  nodes.forEach((node, owner) => {
    const rank = node.difficulty.toLowerCase() === "advanced" ? 2
      : node.difficulty.toLowerCase() === "intermediate" ? 1 : 0;
    const boss = node.kind === "project";
    const size = Math.min(0.078, 0.98 / Math.sqrt(nodes.length)) * (1 + 0.23 * rank);
    footprints.push(size * 1.20);
    site.position.copy(points[owner]);
    site.quaternion.setFromUnitVectors(up, points[owner].clone().normalize());
    site.rotateY(owner * 2.4);
    site.scale.setScalar(size);
    site.updateMatrix();
    function add(shape: Shape, color: string, x: number, y: number, z: number, w: number, h: number, d: number) {
      local.position.set(x, y, z);
      local.scale.set(w, h, d);
      local.updateMatrix();
      const parts = batches.get(shape) ?? [];
      parts.push({matrix: new T.Matrix4().multiplyMatrices(site.matrix, local.matrix), color, owner});
      batches.set(shape, parts);
    }
    const glass = ["#3be0f5", "#1ab2ee", "#1874d2"][rank];
    const stone = "#f4fcff";
    const beacon = node.completed ? "#8df24d" : node.unlocked ? "#24d7ff" : "#96b5c2";
    add("island", "#3ec07a", 0, -0.15, 0, 1.14, 0.38, 1);
    add("island", "#98ef59", 0, 0, 0, 1.12, 0.22, 0.98);
    add("block", "#ffefa8", 0, 0.21, 0.55, 0.17, 0.04, 0.62);
    if (rank === 0 && !boss) {
      // Small conservatories and waterfront cottages.
      add("block", stone, 0, 0.45, 0, 0.88, 0.52, 0.64);
      if (owner % 2 === 0) add("dome", glass, 0, 0.71, 0, 0.53, 0.48, 0.41);
      else add("roof", glass, 0, 0.89, 0, 0.73, 0.46, 0.58);
      add("block", glass, 0, 0.44, 0.326, 0.53, 0.26, 0.025);
    } else {
      // Stepped civic towers and fortified multi-spire citadels.
      const levels = 2 + rank + Number(boss);
      for (let level = 0; level < levels; level++) {
        const width = 0.55 - 0.062 * level;
        add("tower", glass, 0, 0.46 + level * 0.48, 0, width, 0.55, width);
        add("tower", stone, 0, 0.68 + level * 0.48, 0, width + 0.06, 0.09, width + 0.06);
      }
      add("roof", "#cdfaff", 0, 0.46 + levels * 0.48, 0, 0.28, 0.67, 0.28);
      const wings = rank === 2 || boss ? 4 : 2;
      for (let j = 0; j < wings; j++) {
        const a = j * 2 * Math.PI / wings;
        const x = Math.cos(a)*0.68, z = Math.sin(a)*0.59;
        const height = rank === 2 || boss ? 1.2 : 0.56;
        add("tower", stone, x, 0.2 + height/2, z, 0.24, height, 0.24);
        add("roof", glass, x, 0.4 + height, z, 0.30, 0.47, 0.30);
      }
    }
    for (const [x, z] of [[-0.59, 0.42], [0.44, -0.63]]) {
      add("tower", "#876c4a", x, 0.33, z, 0.055, 0.32, 0.055);
      add("island", "#56aa52", x, 0.53, z, 0.18, 0.28, 0.18);
    }
    add("dome", beacon, 0, 0.20, 0.82, 0.14, 0.13, 0.14);
  });

  const material = new T.MeshPhysicalMaterial({roughness: 0.22, clearcoat: 1});
  const meshes: T.InstancedMesh[] = [];
  const baseMatrices = new Map<T.InstancedMesh, T.Matrix4[]>();
  const hiddenMatrix = new T.Matrix4().makeScale(0, 0, 0);
  for (const [shape, parts] of batches) {
    const mesh = new T.InstancedMesh(shapes[shape], material, parts.length);
    mesh.userData.owners = parts.map(part => part.owner);
    const saved: T.Matrix4[] = [];
    parts.forEach((part, index) => {
      mesh.setMatrixAt(index, part.matrix);
      mesh.setColorAt(index, new T.Color(part.color));
      saved.push(part.matrix.clone());
    });
    baseMatrices.set(mesh, saved);
    meshes.push(mesh);
  }
  let hiddenOwner: number | null = null;
  function setHidden(owner: number | null) {
    if (hiddenOwner === owner) return;
    const prev = hiddenOwner;
    hiddenOwner = owner;
    for (const mesh of meshes) {
      const owners: number[] = mesh.userData.owners;
      const saved = baseMatrices.get(mesh);
      if (!saved) continue;
      let dirty = false;
      for (let idx = 0; idx < owners.length; idx++) {
        if (owners[idx] === prev) {
          mesh.setMatrixAt(idx, saved[idx]);
          dirty = true;
        }
        if (owners[idx] === owner) {
          mesh.setMatrixAt(idx, hiddenMatrix);
          dirty = true;
        }
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    }
  }
  return {meshes, footprints, setHidden, dispose() {
    meshes.forEach(mesh => mesh.dispose());
    Object.values(shapes).forEach(shape => shape.dispose());
    material.dispose();
  }};
}
