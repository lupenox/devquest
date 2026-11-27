import * as T from "three";
import type { SkillTreeNode } from "../../types";
import { buildLandmarks } from "./landmarks";
import { createHeroLandmark, type HeroLandmark } from "./landmarkHero";

function createBubbleTexture(): T.CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const fill = ctx.createRadialGradient(32, 32, 4, 32, 32, 29);
  fill.addColorStop(0.0, "rgba(255, 255, 255, 0.06)");
  fill.addColorStop(0.62, "rgba(182, 246, 255, 0.16)");
  fill.addColorStop(0.86, "rgba(225, 254, 255, 0.68)");
  fill.addColorStop(0.95, "rgba(255, 255, 255, 0.94)");
  fill.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(32, 32, 29, 0, Math.PI * 2);
  ctx.fill();

  const glint = ctx.createRadialGradient(21, 20, 0.5, 21, 20, 9);
  glint.addColorStop(0.0, "rgba(255, 255, 255, 0.98)");
  glint.addColorStop(0.5, "rgba(255, 255, 255, 0.45)");
  glint.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");
  ctx.fillStyle = glint;
  ctx.beginPath();
  ctx.arc(21, 20, 9, 0, Math.PI * 2);
  ctx.fill();

  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createPlanet(
  canvas: HTMLCanvasElement,
  nodes: SkillTreeNode[],
  onVisit: (id: string) => void,
  onDrag: () => void,
  onPreview: (node: SkillTreeNode | null) => void
) {
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.04, 30);
  camera.position.set(0, 0, 4.1);
  const globe = new T.Group();
  scene.add(globe, new T.HemisphereLight(0xffffff, 0x6ae8ff, 2.0));
  const sun = new T.DirectionalLight(0xfffbe6, 2.25);
  sun.position.set(-3.2, 4.2, 3.6);
  scene.add(sun);
  const rimBounce = new T.DirectionalLight(0x88f4ff, 0.95);
  rimBounce.position.set(3.4, -2.6, 2.2);
  scene.add(rimBounce);

  let disposed = false;
  const map = new T.TextureLoader().load(
    new URL("../../assets/planet/earth-atlas.webp", import.meta.url).href,
    () => {
      if (!disposed) schedule();
    }
  );
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  // Crystal-clear luminous Frutiger Aero glass Earth core
  const core = new T.Mesh(
    new T.SphereGeometry(1, 96, 64),
    new T.ShaderMaterial({
      transparent: true,
      uniforms: {
        uMap: { value: map },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vec3 n = normalize(vNormalView);
          vec3 v = normalize(vViewDir);
          vec3 tex = texture2D(uMap, vUv).rgb;

          float oceanMask = smoothstep(0.06, 0.28, tex.b - tex.g) * (1.0 - smoothstep(0.52, 0.80, tex.r));
          float landMask = smoothstep(0.03, 0.22, tex.g - tex.b * 0.72);

          vec3 sunDir = normalize(vec3(-0.56, 0.62, 0.55));
          float ndl = dot(n, sunDir);
          float wrapLight = clamp(ndl * 0.45 + 0.68, 0.38, 1.12);

          vec3 bounceDir = normalize(vec3(0.48, -0.58, 0.65));
          float caustic = pow(max(dot(n, bounceDir), 0.0), 2.2);
          float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.1);

          vec3 crystalBlue = mix(vec3(0.11, 0.66, 0.98), vec3(0.46, 0.93, 1.0), 0.36 + 0.42 * caustic);
          vec3 baseCol = mix(tex, mix(tex, crystalBlue, 0.44), oceanMask);
          baseCol = mix(baseCol, baseCol * vec3(0.95, 1.08, 0.90) + vec3(0.02, 0.06, 0.0), landMask * 0.45);

          vec3 lit = baseCol * wrapLight;
          lit += vec3(0.24, 0.78, 1.0) * caustic * (0.28 + 0.20 * oceanMask);
          lit = mix(lit, vec3(0.76, 0.98, 1.0), fresnel * 0.52);

          vec3 halfVec = normalize(sunDir + v);
          float spec = pow(max(dot(n, halfVec), 0.0), 42.0);
          lit += vec3(1.0) * spec * (0.42 + 0.28 * oceanMask);

          float alpha = mix(0.95, 0.84 + 0.14 * fresnel, oceanMask);
          gl_FragColor = vec4(lit, alpha);
          #include <colorspace_fragment>
        }`,
    })
  );
  globe.add(core);

  // Outer crystal bubble atmosphere (fades cleanly out when landed in first-person ground view)
  const atmosphereUniforms = { uTime: { value: 0 }, uOpacity: { value: 1 } };
  const atmosphere = new T.Mesh(
    new T.SphereGeometry(1.042, 80, 56),
    new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: atmosphereUniforms,
      vertexShader: `
        varying vec3 vSurface;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vec4 eye = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-eye.xyz);
          vSurface = normal;
          gl_Position = projectionMatrix * eye;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        varying vec3 vSurface;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        float hash(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yxz + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float cloudNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          vec2 d = vec2(0.0, 1.0);
          return mix(
            mix(mix(hash(i), hash(i + d.yxx), f.x), mix(hash(i + d.xyx), hash(i + d.yyx), f.x), f.y),
            mix(mix(hash(i + d.xxy), hash(i + d.yxy), f.x), mix(hash(i + d.xyy), hash(i + d.yyy), f.x), f.y),
            f.z
          );
        }

        void main() {
          vec3 n = normalize(vNormalView);
          vec3 v = normalize(vViewDir);
          vec3 p = normalize(vSurface);

          float spin = uTime * 0.04;
          float cs = cos(spin), sn = sin(spin);
          vec3 sp = vec3(p.x * cs - p.z * sn, p.y, p.x * sn + p.z * cs);
          vec3 drift = vec3(sp.x * 3.4 + 0.55 * sin(sp.y * 5.0), sp.y * 6.5 + 1.1 * sin(3.5 * sp.z), sp.z * 3.4);
          float vapor = 0.54 * cloudNoise(drift) + 0.30 * cloudNoise(drift * 2.15) + 0.16 * cloudNoise(drift * 4.4);
          float clouds = smoothstep(0.53, 0.77, vapor);

          float ndv = max(0.0, dot(n, v));
          float rim = 1.0 - ndv;
          float haloRim = pow(rim, 1.85);
          float sharpGlassRim = smoothstep(0.68, 0.96, rim);
          float domeArc = smoothstep(0.18, 0.72, n.y * 0.82 - n.x * 0.42) * smoothstep(0.12, 0.70, ndv) * (1.0 - smoothstep(0.62, 0.94, ndv));

          vec3 glintDir = normalize(vec3(-0.46, 0.54, 0.70));
          float coreGlint = pow(max(dot(n, glintDir), 0.0), 96.0);
          float softFlare = pow(max(dot(n, glintDir), 0.0), 14.0);

          vec3 col = mix(vec3(0.62, 0.96, 1.0), vec3(1.0), clamp(clouds * 0.85 + sharpGlassRim * 0.9 + coreGlint + domeArc * 0.75, 0.0, 1.0));
          float alpha = clamp(
            0.64 * haloRim +
            0.55 * sharpGlassRim +
            0.40 * clouds +
            0.28 * domeArc +
            0.24 * softFlare +
            0.95 * coreGlint,
            0.0,
            0.96
          ) * uOpacity;
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }`,
    })
  );
  globe.add(atmosphere);

  const shellGeometry = new T.IcosahedronGeometry(1.068, 2);
  const shellMat = new T.LineBasicMaterial({ color: 0xe8ffff, transparent: true, opacity: 0.045 });
  const shell = new T.LineSegments(new T.WireframeGeometry(shellGeometry), shellMat);
  shellGeometry.dispose();
  globe.add(shell);

  // Orbiting glossy soap bubbles
  const positions: number[] = [];
  function surface(i: number, count: number) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const radius = Math.sqrt(1 - y * y);
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    return new T.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle));
  }
  for (let i = 0; i < 160; i++) {
    positions.push(...surface(i, 160).multiplyScalar(1.15 + 0.24 * Math.sin(i * 19) ** 2).toArray());
  }
  const bubbleTexture = createBubbleTexture();
  const dust = new T.Points(
    new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(positions, 3)),
    new T.PointsMaterial({
      color: 0xffffff,
      map: bubbleTexture ?? undefined,
      size: bubbleTexture ? 0.055 : 0.016,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      alphaTest: 0.02,
    })
  );
  globe.add(dust);

  const points = nodes.map((_, i) => surface(i, nodes.length).multiplyScalar(1.013));
  const landmarks = buildLandmarks(nodes, points);
  globe.add(...landmarks.meshes);

  const haloMat = new T.MeshBasicMaterial({ color: 0xfff59d, transparent: true, opacity: 1 });
  const halo = new T.Mesh(new T.TorusGeometry(1, 0.065, 8, 56), haloMat);
  halo.visible = false;
  globe.add(halo);
  const connMat = new T.LineBasicMaterial({ color: 0xfff7b2, transparent: true, opacity: 0.92 });
  const connections = new T.LineSegments(new T.BufferGeometry(), connMat);
  globe.add(connections);

  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const front = new T.Vector3(0, 0, 1);
  const worldUp = new T.Vector3(0, 1, 0);
  const worldFront = new T.Vector3(0, 0, 1);
  const origin = new T.Vector3(0, 0, 0);

  // Orbit & First-Person state machine
  let orbitZ = 4.1;
  const orbitTargetQuat = new T.Quaternion();
  let orbitEasing = false;

  // First-person camera dive & look-around state
  let mode: "orbit" | "diving" | "visit" | "leaving" = "orbit";
  let visitedIndex: number | null = null;
  let hero: HeroLandmark | null = null;
  let fpYaw = 0;
  let fpPitch = 0;
  let fpBaseEye = new T.Vector3(0, 1.02, 0.16);
  let fpBaseLook = new T.Vector3(0, 1.12, -0.02);

  // Transition interpolation state
  let transT = 1;
  let transDur = 0.9;
  const fromQuat = new T.Quaternion();
  const toQuat = new T.Quaternion();
  const fromCam = new T.Vector3();
  const toCam = new T.Vector3();
  const fromLook = new T.Vector3();
  const toLook = new T.Vector3();
  const currentLook = new T.Vector3(0, 0, 0);
  let fromFov = 38;
  let toFov = 38;
  let fromNear = 0.04;
  let toNear = 0.04;

  let animate = false;
  let hold = false;
  let visible = true;
  let frame = 0;
  let last = 0;

  function computeVisitPose(idx: number) {
    const node = nodes[idx];
    const rank =
      node.difficulty.toLowerCase() === "advanced"
        ? 2
        : node.difficulty.toLowerCase() === "intermediate"
        ? 1
        : 0;
    const size = Math.min(0.078, 0.98 / Math.sqrt(nodes.length)) * (1 + 0.23 * rank);
    const normal = points[idx].clone().normalize();
    const visitQuat = new T.Quaternion().setFromUnitVectors(normal, worldUp);
    // Align hero landmark local +Y to surface normal and local +Z toward world +Z after visitQuat
    const invVisit = visitQuat.clone().invert();
    const localForward = worldFront.clone().applyQuaternion(invVisit).normalize();
    const localRight = new T.Vector3().crossVectors(normal, localForward).normalize();
    const orthoForward = new T.Vector3().crossVectors(localRight, normal).normalize();
    const basis = new T.Matrix4().makeBasis(localRight, normal, orthoForward);
    const heroQuat = new T.Quaternion().setFromRotationMatrix(basis);
    return { size, normal, visitQuat, heroQuat };
  }

  function clearHero() {
    if (hero) {
      globe.remove(hero.group);
      hero.dispose();
      hero = null;
    }
    landmarks.setHidden(null);
  }

  function applyFirstPersonLook() {
    camera.position.copy(fpBaseEye);
    const baseDir = fpBaseLook.clone().sub(fpBaseEye);
    const dist = baseDir.length();
    const basePitch = Math.asin(T.MathUtils.clamp(baseDir.y / dist, -0.95, 0.95));
    const yaw = T.MathUtils.clamp(fpYaw, -0.95, 0.95);
    const pitch = T.MathUtils.clamp(basePitch + fpPitch, -0.18, 1.08);
    const lookDir = new T.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    );
    currentLook.copy(fpBaseEye).addScaledVector(lookDir, dist);
    camera.lookAt(currentLook);
  }

  function setGroundAtmosphereBlend(groundFactor: number) {
    // GroundFactor: 0 = full orbit crystal shell, 1 = standing on ground in first-person
    const orbitVis = 1 - T.MathUtils.smoothstep(groundFactor, 0.35, 0.85);
    atmosphereUniforms.uOpacity.value = orbitVis;
    atmosphere.visible = orbitVis > 0.01;
    shellMat.opacity = 0.045 * orbitVis;
    shell.visible = orbitVis > 0.01;
    haloMat.opacity = orbitVis;
    connMat.opacity = 0.92 * orbitVis;
    connections.visible = orbitVis > 0.01;
    dust.visible = groundFactor < 0.7;
  }

  function draw(time: number) {
    frame = 0;
    if (!visible || document.hidden) return;
    const dt = last ? Math.min(0.05, Math.max(0, (time - last) / 1000)) : 0.016;
    last = time;

    if (mode === "diving" || mode === "leaving") {
      transT = Math.min(1, transT + dt / transDur);
      const k = easeInOutCubic(transT);
      globe.quaternion.slerpQuaternions(fromQuat, toQuat, k);
      camera.position.lerpVectors(fromCam, toCam, k);
      // Graceful slight upward arc during dive/ascend so camera clears the horizon cleanly
      if (mode === "diving" || mode === "leaving") {
        camera.position.y += Math.sin(k * Math.PI) * 0.24;
      }
      currentLook.lerpVectors(fromLook, toLook, k);
      camera.lookAt(currentLook);

      const fov = T.MathUtils.lerp(fromFov, toFov, k);
      const near = T.MathUtils.lerp(fromNear, toNear, k);
      if (Math.abs(camera.fov - fov) > 0.01 || Math.abs(camera.near - near) > 0.0005) {
        camera.fov = fov;
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      setGroundAtmosphereBlend(mode === "diving" ? k : 1 - k);
      if (hero && animate) hero.update(dt);

      if (transT >= 1) {
        if (mode === "diving") {
          mode = "visit";
          fpYaw = 0;
          fpPitch = 0;
          applyFirstPersonLook();
          setGroundAtmosphereBlend(1);
        } else {
          mode = "orbit";
          visitedIndex = null;
          clearHero();
          camera.position.set(0, 0, orbitZ);
          currentLook.copy(origin);
          camera.lookAt(origin);
          camera.fov = 38;
          camera.near = 0.04;
          camera.updateProjectionMatrix();
          setGroundAtmosphereBlend(0);
        }
      }
    } else if (mode === "visit") {
      if (hero && animate) hero.update(dt);
      applyFirstPersonLook();
    } else {
      // Orbit mode
      if (orbitEasing) {
        globe.quaternion.rotateTowards(orbitTargetQuat, dt * 5);
        orbitEasing = globe.quaternion.angleTo(orbitTargetQuat) > 0.002;
      } else if (animate && !hold) {
        globe.rotateOnWorldAxis(worldUp, dt * 0.065);
      }
      if (animate && !hold) {
        atmosphereUniforms.uTime.value += dt;
        shell.rotation.y += dt * 0.058;
        dust.rotation.y -= dt * 0.11;
      }
      camera.position.set(0, 0, orbitZ);
      currentLook.copy(origin);
      camera.lookAt(origin);
    }

    renderer.render(scene, camera);
    const keepRunning =
      mode === "diving" ||
      mode === "leaving" ||
      (mode === "visit" && animate) ||
      (mode === "orbit" && ((animate && !hold) || orbitEasing));
    if (keepRunning) schedule();
  }

  function schedule() {
    if (!frame && visible && !document.hidden) {
      last = performance.now();
      frame = requestAnimationFrame(draw);
    }
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    orbitZ = 4.1 / Math.min(1, camera.aspect);
    if (mode === "orbit") {
      camera.position.set(0, 0, orbitZ);
      camera.lookAt(origin);
    }
    if (mode === "leaving") {
      toCam.set(0, 0, orbitZ);
    }
    camera.updateProjectionMatrix();
    schedule();
  }

  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  });
  visibility.observe(canvas);
  document.addEventListener("visibilitychange", schedule);

  const ray = new T.Raycaster();
  const horizontal = new T.Vector3(1, 0, 0);
  let gesture: { id: number; x: number; y: number; dragged: boolean } | null = null;

  function landmarkAt(event: PointerEvent) {
    if (mode !== "orbit") return null;
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new T.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2
      ),
      camera
    );
    const hit = ray.intersectObjects([...landmarks.meshes, core], false)[0];
    return hit?.instanceId === undefined ? null : nodes[hit.object.userData.owners[hit.instanceId]];
  }

  function clearPreview() {
    onPreview(null);
  }

  function down(event: PointerEvent) {
    if (event.button !== 0 || gesture) return;
    if (mode === "diving" || mode === "leaving") return;
    clearPreview();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
    canvas.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    if (!gesture) {
      if (event.pointerType === "mouse" && mode === "orbit") onPreview(landmarkAt(event));
      return;
    }
    if (gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.dragged) {
      if (Math.hypot(dx, dy) < 4) return;
      gesture.dragged = true;
      if (mode === "orbit") {
        orbitEasing = false;
        onDrag();
      }
    }
    if (mode === "visit") {
      // Natural first-person look-around on the sunlit plaza
      const lookSens = 2.1 / Math.max(240, Math.min(canvas.clientWidth, canvas.clientHeight));
      fpYaw = T.MathUtils.clamp(fpYaw - dx * lookSens, -0.95, 0.95);
      fpPitch = T.MathUtils.clamp(fpPitch + dy * lookSens * 0.85, -0.35, 0.65);
      applyFirstPersonLook();
      schedule();
    } else if (mode === "orbit") {
      const sensitivity = Math.PI / Math.max(150, Math.min(canvas.clientWidth, canvas.clientHeight) * 0.7);
      globe.rotateOnWorldAxis(worldUp, dx * sensitivity);
      globe.rotateOnWorldAxis(horizontal, dy * sensitivity);
      schedule();
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
  }

  function up(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    const click = !gesture.dragged;
    gesture = null;
    if (!click || mode !== "orbit") return;
    const node = landmarkAt(event);
    if (node) onVisit(node.id);
  }

  function cancel(event: PointerEvent) {
    if (gesture?.id === event.pointerId) gesture = null;
  }

  canvas.addEventListener("pointerleave", clearPreview);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("lostpointercapture", cancel);
  canvas.addEventListener("pointercancel", cancel);
  resize();

  return {
    motion(enabled: boolean, holdPosition: boolean) {
      hold = holdPosition;
      animate = enabled;
      if (!enabled && orbitEasing) {
        orbitEasing = false;
        globe.quaternion.copy(orbitTargetQuat);
      }
      if (!enabled && (mode === "diving" || mode === "leaving")) {
        transT = 1;
      }
      schedule();
    },

    focus(id: string | null, initial = false) {
      clearPreview();
      if (!id) {
        halo.visible = false;
        connections.geometry.dispose();
        connections.geometry = new T.BufferGeometry();
        schedule();
        return;
      }
      const i = index.get(id);
      if (i === undefined) return;
      const normal = points[i].clone().normalize();
      halo.visible = true;
      halo.position.copy(normal).multiplyScalar(1.028);
      halo.scale.setScalar(landmarks.footprints[i]);
      halo.quaternion.setFromUnitVectors(front, normal);
      orbitTargetQuat.setFromUnitVectors(normal, new T.Vector3(0, 0.45, 0.893).normalize());
      if (mode === "orbit") {
        orbitEasing = animate && !initial;
        if (!orbitEasing) globe.quaternion.copy(orbitTargetQuat);
      }
      const arcs: number[] = [];
      nodes.forEach((other, k) => {
        if (other.id !== nodes[i].prereq_module_id && other.prereq_module_id !== id) return;
        const axis = new T.Vector3().crossVectors(normal, points[k]).normalize();
        const angle = normal.angleTo(points[k]);
        for (let j = 0; j < 24; j++) {
          for (const t of [j / 24, (j + 1) / 24]) {
            arcs.push(...normal.clone().applyAxisAngle(axis, angle * t).multiplyScalar(1.078).toArray());
          }
        }
      });
      connections.geometry.dispose();
      connections.geometry = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(arcs, 3));
      schedule();
    },

    visit(id: string, immediate = false) {
      clearPreview();
      const i = index.get(id);
      if (i === undefined) return;
      if (visitedIndex === i && (mode === "visit" || mode === "diving")) return;

      visitedIndex = i;
      orbitEasing = false;
      clearHero();

      const { size, visitQuat, heroQuat } = computeVisitPose(i);
      const nextHero = createHeroLandmark(nodes[i], size, bubbleTexture);
      nextHero.group.position.copy(points[i]);
      nextHero.group.quaternion.copy(heroQuat);
      globe.add(nextHero.group);
      hero = nextHero;
      landmarks.setHidden(i);

      const surfaceY = 1.013;
      fpBaseEye = new T.Vector3(0, surfaceY + size * nextHero.eyeHeight, size * nextHero.eyeDistance);
      fpBaseLook = new T.Vector3(0, surfaceY + size * nextHero.lookHeight, -size * 0.14);
      fpYaw = 0;
      fpPitch = 0;

      if (!animate || immediate) {
        mode = "visit";
        globe.quaternion.copy(visitQuat);
        camera.fov = 60;
        camera.near = 0.002;
        camera.updateProjectionMatrix();
        applyFirstPersonLook();
        setGroundAtmosphereBlend(1);
        schedule();
        return;
      }

      fromQuat.copy(globe.quaternion);
      toQuat.copy(visitQuat);
      fromCam.copy(camera.position);
      toCam.copy(fpBaseEye);
      fromLook.copy(currentLook);
      toLook.copy(fpBaseLook);
      fromFov = camera.fov;
      toFov = 60;
      fromNear = camera.near;
      toNear = 0.002;
      transT = 0;
      transDur = 0.92;
      mode = "diving";
      schedule();
    },

    leave(immediate = false) {
      if (mode === "orbit") return;
      clearPreview();
      if (!animate || immediate) {
        mode = "orbit";
        visitedIndex = null;
        clearHero();
        camera.position.set(0, 0, orbitZ);
        currentLook.copy(origin);
        camera.lookAt(origin);
        camera.fov = 38;
        camera.near = 0.04;
        camera.updateProjectionMatrix();
        setGroundAtmosphereBlend(0);
        schedule();
        return;
      }

      fromQuat.copy(globe.quaternion);
      toQuat.copy(orbitTargetQuat.lengthSq() > 0 ? orbitTargetQuat : globe.quaternion);
      fromCam.copy(camera.position);
      toCam.set(0, 0, orbitZ);
      fromLook.copy(currentLook);
      toLook.copy(origin);
      fromFov = camera.fov;
      toFov = 38;
      fromNear = camera.near;
      toNear = 0.04;
      transT = 0;
      transDur = 0.72;
      mode = "leaving";
      schedule();
    },

    dispose() {
      disposed = true;
      clearHero();
      map.dispose();
      bubbleTexture?.dispose();
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", schedule);
      canvas.removeEventListener("pointerleave", clearPreview);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("lostpointercapture", cancel);
      canvas.removeEventListener("pointercancel", cancel);
      landmarks.dispose();
      for (const object of [core, atmosphere, shell, dust, halo, connections]) {
        object.geometry.dispose();
        object.material.dispose();
      }
      renderer.dispose();
    },
  };
}
