import * as T from "three";
import type { EvalSubTab } from "./evalLabConstants";

export function createLabScene(canvas: HTMLCanvasElement) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  const scene = new T.Scene();
  scene.background = new T.Color("#b9ecf7");
  scene.fog = new T.FogExp2("#d6f3ec", 0.025);
  const camera = new T.PerspectiveCamera(35, 1, 0.1, 130);
  scene.add(new T.HemisphereLight(0xffffff, 0x729c95, 2.4));
  const sunlight = new T.DirectionalLight(0xfff0c3, 3);
  sunlight.position.set(-7, 11, 6);
  scene.add(sunlight);

  function shape(geometry: T.BufferGeometry, color: string, x: number, y: number, z: number,
    width: number, height: number, depth: number, opacity = 1) {
    const material = new T.MeshPhysicalMaterial({ color, roughness: 0.24, clearcoat: 0.9,
      transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    scene.add(mesh);
    return mesh;
  }
  const sphere = new T.SphereGeometry(1, 40, 24);
  const box = new T.BoxGeometry();
  const disc = new T.CylinderGeometry(1, 1, 1, 64);
  shape(box, "#47bfc9", 0, -1.5, -10, 120, 1, 100);
  for (let i = 0; i < 12; i++) {
    shape(sphere, i % 2 ? "#8ec669" : "#6db47d", i * 8 - 45, -2, -17 - i % 3 * 5, 9, 4 + i % 4, 5);
  }
  shape(sphere, "#fff6bf", -12, 9, -35, 2, 2, 2);
  for (const x of [-7, 0, 7]) {
    shape(disc, "#659e9a", x, -0.68, 0, 3.35, 0.38, 2.65);
    shape(disc, "#daf6f2", x, -0.46, 0, 3.36, 0.11, 2.66);
    shape(disc, "#85b3b0", x, 0, 0, 0.64, 0.95, 0.48);
    shape(disc, "#87d5dc", x, 0.55, 0, 2.2, 0.16, 1.05, 0.82);
    for (const offset of [-2.65, 2.65]) {
      shape(box, "#e8ffff", x + offset, 2, -1.9, 0.08, 5, 0.08);
    }
    shape(box, "#a4dfe8", x, 2, -1.95, 5.3, 4.9, 0.04, 0.15);
  }
  // Paired evidence trays at reception and angled displays at the review desk.
  for (const x of [-0.9, 0.9]) {
    const accent = x < 0 ? "#287a90" : "#63a047";
    shape(box, accent, -7 + x, 0.72, 0, 1.45, 0.12, 0.95);
    shape(box, "#effffc", -7 + x, 0.8, 0, 1.18, 0.04, 0.76);
    shape(box, accent, x, 1.24, -0.18, 1.65, 1.08, 0.13);
    for (let row = 0; row < 4; row++) {
      shape(box, "#d8faf2", x - 0.15, 1.52 - row * 0.18, -0.10, 1.05 - row * 0.12, 0.05, 0.03);
    }
  }
  for (let i = 0; i < 3; i++) {
    shape(box, ["#408c8e","#83bd65","#ebf4c5"][i], 7 + i * 0.14, 0.74 + i * 0.19, 0, 1.9, 0.18, 1.18);
  }
  let frame = 0;
  let station = -7, detail = 0;
  const target = new T.Vector3();
  camera.position.set(-5, 3.1, 7.8);
  function draw() {
    frame = 0;
    camera.lookAt(camera.position.x - 2, 0.78, 0);
    renderer.render(scene, camera);
  }
  function resize() {
    const {clientWidth: w, clientHeight: h} = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return {
    move(tab: EvalSubTab, step: number, animate: boolean) {
      station = {playbook: -7, practice: 0, dryrun: 7}[tab];
      detail = Math.min(step, 3);
      target.set(station + 2, 3.1 - detail * 0.12, 7.8 - detail * 0.42);
      cancelAnimationFrame(frame);
      const from = camera.position.clone();
      const start = performance.now();
      function tick(now: number) {
        const t = animate ? Math.min(1, (now - start) / 440) : 1;
        camera.position.lerpVectors(from, target, t * t * (3 - 2 * t));
        draw();
        if (t < 1) frame = requestAnimationFrame(tick);
      }
      tick(start);
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse(object => { if (object instanceof T.Mesh) object.material.dispose(); });
      for (const geometry of [box, sphere, disc]) geometry.dispose();
      renderer.dispose();
    }
  };
}
