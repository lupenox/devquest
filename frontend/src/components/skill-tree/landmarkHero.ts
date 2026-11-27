import * as T from "three";
import type { SkillTreeNode } from "../../types";

export interface HeroLandmark {
  group: T.Group;
  lookHeight: number;
  eyeDistance: number;
  eyeHeight: number;
  update(dt: number): void;
  dispose(): void;
}

/**
 * Builds a high-detail monumental Frutiger Aero landmark oriented in local tangent space:
 * +Y is skyward (surface normal), +Z is the sunlit stone promenade facing the visitor.
 * Human eye height is ~0.095 units (~1.7m), making Beginner conservatories feel ~30m tall,
 * Intermediate sky-spires ~60m tall, and Advanced / Boss citadels ~95-115m tall!
 */
export function createHeroLandmark(node: SkillTreeNode, scale: number, bubbleTexture: T.Texture | null): HeroLandmark {
  const rank =
    node.difficulty.toLowerCase() === "advanced"
      ? 2
      : node.difficulty.toLowerCase() === "intermediate"
      ? 1
      : 0;
  const boss = node.kind === "project";
  const tier = boss ? 3 : rank;

  const group = new T.Group();
  group.scale.setScalar(scale);

  const geometries: T.BufferGeometry[] = [];
  const materials: T.Material[] = [];

  const trackGeo = <G extends T.BufferGeometry>(g: G): G => {
    geometries.push(g);
    return g;
  };
  const trackMat = <M extends T.Material>(m: M): M => {
    materials.push(m);
    return m;
  };

  // Shared Frutiger Aero architectural materials
  const matMarble = trackMat(
    new T.MeshPhysicalMaterial({ color: "#f4fcff", roughness: 0.22, clearcoat: 0.75 })
  );
  const matStoneWarm = trackMat(
    new T.MeshPhysicalMaterial({ color: "#fff7dc", roughness: 0.36, clearcoat: 0.3 })
  );
  const matGrass = trackMat(
    new T.MeshPhysicalMaterial({ color: "#7ce84c", roughness: 0.52, clearcoat: 0.2 })
  );
  const matIslandBase = trackMat(
    new T.MeshPhysicalMaterial({ color: "#34b874", roughness: 0.48, clearcoat: 0.25 })
  );
  const matWater = trackMat(
    new T.MeshPhysicalMaterial({
      color: "#2ad8ff",
      roughness: 0.08,
      clearcoat: 1,
      transparent: true,
      opacity: 0.82,
    })
  );
  const glassColor = ["#2ee0f5", "#16b2f2", "#1472de", "#0f52c7"][tier];
  const matGlass = trackMat(
    new T.MeshPhysicalMaterial({
      color: glassColor,
      roughness: 0.1,
      metalness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: 0.86,
    })
  );
  const matGlassLight = trackMat(
    new T.MeshPhysicalMaterial({
      color: "#8ff6ff",
      roughness: 0.08,
      clearcoat: 1,
      transparent: true,
      opacity: 0.72,
    })
  );
  const matGlow = trackMat(
    new T.MeshBasicMaterial({
      color: "#c8fcff",
      transparent: true,
      opacity: 0.92,
    })
  );
  const beaconColor = node.completed ? "#6ef249" : node.unlocked ? "#1ae0ff" : "#9dc0d4";
  const matBeacon = trackMat(
    new T.MeshBasicMaterial({
      color: beaconColor,
    })
  );
  const matTrunk = trackMat(new T.MeshStandardMaterial({ color: "#8c6d4e", roughness: 0.75 }));
  const matFoliage = trackMat(
    new T.MeshPhysicalMaterial({ color: "#4dd448", roughness: 0.42, clearcoat: 0.3 })
  );
  const matFoliageBright = trackMat(
    new T.MeshPhysicalMaterial({ color: "#8df052", roughness: 0.38, clearcoat: 0.35 })
  );

  // Reusable primitive geometries
  const boxGeo = trackGeo(new T.BoxGeometry(1, 1, 1));
  const cylGeo = trackGeo(new T.CylinderGeometry(1, 1, 1, 20));
  const taperCylGeo = trackGeo(new T.CylinderGeometry(0.76, 1, 1, 16));
  const coneGeo = trackGeo(new T.ConeGeometry(1, 1, 16));
  const sphereGeo = trackGeo(new T.SphereGeometry(1, 24, 16));
  const domeGeo = trackGeo(new T.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2));
  const archRingGeo = trackGeo(new T.TorusGeometry(1, 0.07, 10, 40));

  function add(
    geo: T.BufferGeometry,
    mat: T.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
    ry = 0,
    rz = 0
  ) {
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    if (rx || ry || rz) mesh.rotation.set(rx, ry, rz);
    group.add(mesh);
    return mesh;
  }

  // ── 1. Expansive Flat Sunlit Meadow Plaza & Human-Scale Promenade ───────────
  // Top surface sits cleanly at y = 0.0 so the promenade, pools, bollards, steps & doorway are 100% visible!
  add(sphereGeo, matIslandBase, 0, -0.34, 0.55, 3.6, 0.34, 3.8);
  add(cylGeo, matGrass, 0, -0.09, 0.55, 3.35, 0.18, 3.55);

  // Broad sunlit cream-stone promenade receding from right under your feet (+Z) to the grand steps
  add(boxGeo, matStoneWarm, 0, 0.01, 1.55, 0.56, 0.02, 3.15);
  // Crisp marble curbs & glowing cyan promenade guide strips
  for (const side of [-1, 1]) {
    add(boxGeo, matMarble, side * 0.30, 0.02, 1.55, 0.048, 0.032, 3.15);
    add(boxGeo, matGlow, side * 0.268, 0.028, 1.55, 0.014, 0.008, 3.05);
  }

  // Human-scale waist-high glowing glass bollards lining the promenade (eye height ~0.13, bollard ~0.075)
  for (const z of [2.75, 2.30, 1.85, 1.40, 0.96]) {
    for (const side of [-1, 1]) {
      add(cylGeo, matMarble, side * 0.325, 0.045, z, 0.02, 0.072, 0.02);
      add(sphereGeo, matGlow, side * 0.325, 0.088, z, 0.024, 0.024, 0.024);
    }
  }

  // Twin crystal turquoise reflecting pools flanking the sunlit promenade
  for (const side of [-1, 1]) {
    add(boxGeo, matMarble, side * 0.86, 0.015, 1.58, 0.58, 0.03, 1.75);
    add(boxGeo, matWater, side * 0.86, 0.03, 1.58, 0.5, 0.012, 1.65);
  }

  // Human-scale Frutiger Aero park trees framing left & right edges for dramatic scale depth
  const treeSpots: Array<[number, number, number]> = [
    [-1.45, 2.25, 1.15],
    [1.45, 2.25, 1.1],
    [-1.55, 1.35, 1.25],
    [1.55, 1.35, 1.2],
    [-1.38, 0.55, 1.1],
    [1.38, 0.55, 1.15],
  ];
  for (const [tx, tz, ts] of treeSpots) {
    add(cylGeo, matTrunk, tx, 0.095 * ts, tz, 0.028 * ts, 0.19 * ts, 0.028 * ts);
    add(sphereGeo, matFoliage, tx, 0.23 * ts, tz, 0.135 * ts, 0.125 * ts, 0.135 * ts);
    add(sphereGeo, matFoliageBright, tx + 0.045 * ts, 0.285 * ts, tz - 0.025 * ts, 0.095 * ts, 0.09 * ts, 0.095 * ts);
  }

  // Grand terraced entrance steps & human-sized glowing glass portal doorway at the base
  add(boxGeo, matMarble, 0, 0.025, 0.72, 0.82, 0.032, 0.26);
  add(boxGeo, matMarble, 0, 0.056, 0.58, 0.72, 0.036, 0.22);
  add(boxGeo, matMarble, 0, 0.09, 0.46, 0.64, 0.038, 0.2);

  // Tiny human-height entrance arch (~0.17 tall) right at the base — visual anchor that makes the monument feel HUGE!
  const doorZ = tier === 0 ? 0.78 : tier === 1 ? 0.64 : 0.48;
  add(boxGeo, matMarble, -0.12, 0.175, doorZ, 0.04, 0.17, 0.06);
  add(boxGeo, matMarble, 0.12, 0.175, doorZ, 0.04, 0.17, 0.06);
  add(boxGeo, matMarble, 0, 0.27, doorZ, 0.31, 0.035, 0.08);
  add(boxGeo, matGlow, 0, 0.175, doorZ - 0.012, 0.2, 0.155, 0.02);

  // Animated summit elements
  const spinners: Array<{ obj: T.Object3D; speed: number; bobPhase?: number; baseY?: number }> = [];

  let lookHeight = 0.62;
  let eyeDistance = 2.48;
  const eyeHeight = 0.135;

  // ── 2. Tiered Monumental Frutiger Aero Architecture ──────────────────────────
  if (tier === 0) {
    // BEGINNER: Grand Sunlit Aero Glass Conservatory (~10 stories tall compared to human eye)
    lookHeight = 0.62;
    eyeDistance = 2.45;

    // Sweeping marble circular podium & perimeter colonnade
    add(cylGeo, matMarble, 0, 0.18, -0.05, 0.88, 0.22, 0.82);
    add(cylGeo, matGlassLight, 0, 0.36, -0.05, 0.8, 0.26, 0.74);
    add(cylGeo, matMarble, 0, 0.51, -0.05, 0.9, 0.055, 0.84);

    // Colonade pillars around the circular terrace
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      add(cylGeo, matMarble, Math.cos(a) * 0.82, 0.36, -0.05 + Math.sin(a) * 0.76, 0.032, 0.28, 0.032);
    }

    // Soaring turquoise glass rotunda dome with luminous white structural arch ribs
    add(domeGeo, matGlass, 0, 0.52, -0.05, 0.76, 0.78, 0.72);
    for (let i = 0; i < 4; i++) {
      add(archRingGeo, matMarble, 0, 0.52, -0.05, 0.77, 0.79, 0.77, 0, (i * Math.PI) / 4, 0);
    }

    // Crown lantern & softly hovering status crystal
    add(cylGeo, matMarble, 0, 1.32, -0.05, 0.22, 0.09, 0.22);
    add(domeGeo, matGlassLight, 0, 1.36, -0.05, 0.18, 0.2, 0.18);
    const crystal = add(coneGeo, matBeacon, 0, 1.66, -0.05, 0.085, 0.2, 0.085);
    spinners.push({ obj: crystal, speed: 0.9, bobPhase: 0.4, baseY: 1.66 });
  } else if (tier === 1) {
    // INTERMEDIATE: Sleek Frutiger Aero Sky-Spire (~20 stories towering overhead!)
    lookHeight = 1.18;
    eyeDistance = 2.88;

    // Podium base
    add(cylGeo, matMarble, 0, 0.16, -0.1, 0.78, 0.24, 0.72);

    // 4 soaring stepped glass tower tiers with white sky-balconies & glowing window ribs
    const tiers = 4;
    for (let l = 0; l < tiers; l++) {
      const w = 0.54 - l * 0.075;
      const y = 0.52 + l * 0.52;
      add(taperCylGeo, matGlass, 0, y, -0.1, w, 0.52, w);
      add(cylGeo, matMarble, 0, y + 0.26, -0.1, w + 0.09, 0.055, w + 0.09);
      add(cylGeo, matGlow, 0, y + 0.04, -0.1, w + 0.015, 0.032, w + 0.015);
    }

    // Sweeping vertical white aerodynamic fins framing the tower
    for (const side of [-1, 1]) {
      add(boxGeo, matMarble, side * 0.48, 1.24, -0.1, 0.06, 2.05, 0.16);
      // Flanking glass wing towers + elevated skybridge high above the visitor's head
      add(taperCylGeo, matGlassLight, side * 0.88, 0.72, -0.06, 0.24, 1.18, 0.24);
      add(coneGeo, matMarble, side * 0.88, 1.48, -0.06, 0.25, 0.36, 0.25);
      add(boxGeo, matGlassLight, side * 0.62, 0.96, -0.08, 0.44, 0.07, 0.12);
      add(boxGeo, matGlow, side * 0.62, 0.99, -0.08, 0.42, 0.018, 0.13);
    }

    // Observation halo & piercing crystalline sky-spire needle
    const ring = add(archRingGeo, matMarble, 0, 2.48, -0.1, 0.36, 0.36, 0.36, Math.PI / 2, 0, 0);
    spinners.push({ obj: ring, speed: 0.45 });
    add(coneGeo, matGlassLight, 0, 2.94, -0.1, 0.18, 0.88, 0.18);
    const beacon = add(sphereGeo, matBeacon, 0, 3.44, -0.1, 0.075, 0.075, 0.075);
    spinners.push({ obj: beacon, speed: 1.0, bobPhase: 1.2, baseY: 3.44 });
  } else {
    // ADVANCED & BOSS PROJECT: Colossal Aero Arcology Citadel (~32-40 stories! Towering & intimidating!)
    const isBoss = tier === 3;
    lookHeight = isBoss ? 1.86 : 1.58;
    eyeDistance = isBoss ? 3.22 : 3.04;

    // Colossal stepped marble acropolis podium
    add(boxGeo, matMarble, 0, 0.14, -0.16, 1.48, 0.22, 1.18);
    add(cylGeo, matMarble, 0, 0.32, -0.16, 0.86, 0.2, 0.86);

    // Towering multi-tiered central mega-skyscraper
    const levels = isBoss ? 6 : 5;
    for (let l = 0; l < levels; l++) {
      const w = 0.62 - l * 0.068;
      const y = 0.64 + l * 0.56;
      add(taperCylGeo, matGlass, 0, y, -0.16, w, 0.58, w);
      add(cylGeo, matMarble, 0, y + 0.28, -0.16, w + 0.11, 0.062, w + 0.11);
      add(cylGeo, matGlow, 0, y + 0.04, -0.16, w + 0.018, 0.036, w + 0.018);
    }

    // 4 sweeping white vertical cathedral buttress ribs climbing the mega-tower
    const ribHeight = levels * 0.56;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      add(
        boxGeo,
        matMarble,
        Math.cos(a) * 0.54,
        0.38 + ribHeight * 0.48,
        -0.16 + Math.sin(a) * 0.54,
        0.07,
        ribHeight * 0.96,
        0.16,
        0,
        -a,
        0
      );
    }

    // 4 colossal corner sentinel towers connected by double-decker glowing aerial skybridges!
    const sentinelHeight = isBoss ? 2.35 : 1.95;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = sx * 0.98;
        const pz = -0.16 + sz * 0.62;
        add(taperCylGeo, matMarble, px, 0.25 + sentinelHeight / 2, pz, 0.22, sentinelHeight, 0.22);
        add(cylGeo, matGlass, px, 0.25 + sentinelHeight * 0.52, pz, 0.235, sentinelHeight * 0.58, 0.235);
        add(coneGeo, matGlassLight, px, 0.34 + sentinelHeight + 0.32, pz, 0.24, 0.68, 0.24);
      }
      // Glowing skybridges arching high overhead between central spire & corner towers
      for (const bridgeY of [1.18, 2.02]) {
        add(boxGeo, matGlassLight, sx * 0.66, bridgeY, -0.16, 0.56, 0.08, 0.14);
        add(boxGeo, matGlow, sx * 0.66, bridgeY + 0.035, -0.16, 0.54, 0.02, 0.15);
      }
    }

    // Colossal upper glass cathedral spire + dual counter-rotating luminous crystal halos!
    const topBase = 0.64 + levels * 0.56;
    const outerHalo = add(archRingGeo, matGlow, 0, topBase - 0.18, -0.16, 0.62, 0.62, 0.62, Math.PI / 2, 0, 0.18);
    const innerHalo = add(archRingGeo, matMarble, 0, topBase + 0.12, -0.16, 0.4, 0.4, 0.4, Math.PI / 2, 0, -0.22);
    spinners.push({ obj: outerHalo, speed: 0.38 });
    spinners.push({ obj: innerHalo, speed: -0.58 });

    add(coneGeo, matGlassLight, 0, topBase + 0.55, -0.16, 0.22, 1.18, 0.22);
    const apexBeacon = add(sphereGeo, matBeacon, 0, topBase + 1.24, -0.16, 0.1, 0.1, 0.1);
    spinners.push({ obj: apexBeacon, speed: 1.2, bobPhase: 0.7, baseY: topBase + 1.24 });
  }

  // ── 3. Rising Glossy Frutiger Aero Bubbles Framing the Monument ──────────────
  const bubbleCount = 34;
  const bubblePos = new Float32Array(bubbleCount * 3);
  const bubbleSpeed = new Float32Array(bubbleCount);
  const bubbleMaxY = tier === 0 ? 2.1 : tier === 1 ? 3.8 : 5.4;
  for (let i = 0; i < bubbleCount; i++) {
    const angle = i * 2.39996;
    const radius = 0.55 + ((i * 37) % 100) / 100 * 1.15;
    bubblePos[i * 3] = Math.cos(angle) * radius;
    bubblePos[i * 3 + 1] = 0.18 + ((i * 53) % 100) / 100 * bubbleMaxY;
    bubblePos[i * 3 + 2] = -0.1 + Math.sin(angle) * radius;
    bubbleSpeed[i] = 0.16 + ((i * 29) % 10) * 0.025;
  }
  const bubbleGeo = trackGeo(new T.BufferGeometry());
  bubbleGeo.setAttribute("position", new T.BufferAttribute(bubblePos, 3));
  const bubbleMat = trackMat(
    new T.PointsMaterial({
      color: 0xffffff,
      map: bubbleTexture ?? undefined,
      size: scale * (bubbleTexture ? 0.26 : 0.06),
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      alphaTest: 0.02,
    })
  );
  const bubbles = new T.Points(bubbleGeo, bubbleMat);
  group.add(bubbles);

  let elapsed = 0;
  return {
    group,
    lookHeight,
    eyeDistance,
    eyeHeight,
    update(dt: number) {
      elapsed += dt;
      for (const s of spinners) {
        s.obj.rotation.y += dt * s.speed;
        if (s.baseY !== undefined && s.bobPhase !== undefined) {
          s.obj.position.y = s.baseY + Math.sin(elapsed * 2.2 + s.bobPhase) * 0.035;
        }
      }
      const attr = bubbleGeo.getAttribute("position") as T.BufferAttribute;
      for (let i = 0; i < bubbleCount; i++) {
        let y = attr.getY(i) + bubbleSpeed[i] * dt;
        if (y > bubbleMaxY) y = 0.14;
        attr.setY(i, y);
      }
      attr.needsUpdate = true;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
