import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  WebGLRenderer,
} from "three";
import type { ThemeId } from "../types";

interface ThemePalette {
  skyTop: [number, number, number];
  skyMid: [number, number, number];
  horizon: [number, number, number];
  meadow: [number, number, number];
  sun: [number, number, number];
  accent: [number, number, number];
  bubbleRim: [number, number, number];
  bubbleIridescence: [number, number, number];
  moteColor: [number, number, number];
  isLight: number;
  bubbleOpacity: number;
  moteOpacity: number;
  rayStrength: number;
  hillStrength: number;
}

const PALETTES: Record<ThemeId, ThemePalette> = {
  "frutiger-aero": {
    skyTop: [0.06, 0.56, 0.94],       // Cerulean zenith (#0f8ff0)
    skyMid: [0.42, 0.85, 0.99],       // Luminous aero sky (#6bd9fc)
    horizon: [0.76, 0.97, 0.98],      // Sunlit aqua mist (#c2f7fa)
    meadow: [0.22, 0.84, 0.45],       // Fresh spring emerald meadow (#38d673)
    sun: [1.0, 0.99, 0.94],           // Crisp sunlit flare
    accent: [0.05, 0.72, 0.91],       // Aqua water caustics
    bubbleRim: [0.97, 1.0, 1.0],      // Pearl glass rim
    bubbleIridescence: [0.46, 0.98, 0.90],
    moteColor: [1.0, 1.0, 0.97],
    isLight: 1.0,
    bubbleOpacity: 0.90,
    moteOpacity: 0.78,
    rayStrength: 0.44,
    hillStrength: 0.48,
  },
  "emerald-3d": {
    skyTop: [0.015, 0.08, 0.075],
    skyMid: [0.03, 0.17, 0.145],
    horizon: [0.05, 0.30, 0.24],
    meadow: [0.08, 0.65, 0.48],
    sun: [0.45, 0.98, 0.82],
    accent: [0.16, 0.83, 0.74],
    bubbleRim: [0.44, 0.96, 0.78],
    bubbleIridescence: [0.24, 0.88, 0.82],
    moteColor: [0.52, 0.98, 0.82],
    isLight: 0.0,
    bubbleOpacity: 0.62,
    moteOpacity: 0.65,
    rayStrength: 0.26,
    hillStrength: 0.34,
  },
  "tokyo-night": {
    skyTop: [0.04, 0.055, 0.095],
    skyMid: [0.08, 0.11, 0.19],
    horizon: [0.12, 0.16, 0.28],
    meadow: [0.35, 0.45, 0.82],
    sun: [0.58, 0.72, 0.99],
    accent: [0.68, 0.56, 0.95],
    bubbleRim: [0.56, 0.72, 0.98],
    bubbleIridescence: [0.74, 0.62, 0.96],
    moteColor: [0.62, 0.84, 1.0],
    isLight: 0.0,
    bubbleOpacity: 0.34,
    moteOpacity: 0.45,
    rayStrength: 0.14,
    hillStrength: 0.18,
  },
  catppuccin: {
    skyTop: [0.065, 0.065, 0.105],
    skyMid: [0.11, 0.105, 0.18],
    horizon: [0.16, 0.15, 0.26],
    meadow: [0.56, 0.45, 0.78],
    sun: [0.80, 0.65, 0.97],
    accent: [0.54, 0.71, 0.98],
    bubbleRim: [0.82, 0.70, 0.98],
    bubbleIridescence: [0.54, 0.86, 0.92],
    moteColor: [0.86, 0.78, 0.98],
    isLight: 0.0,
    bubbleOpacity: 0.34,
    moteOpacity: 0.45,
    rayStrength: 0.14,
    hillStrength: 0.18,
  },
  gruvbox: {
    skyTop: [0.10, 0.11, 0.11],
    skyMid: [0.16, 0.15, 0.135],
    horizon: [0.24, 0.21, 0.16],
    meadow: [0.60, 0.54, 0.20],
    sun: [0.98, 0.76, 0.24],
    accent: [0.98, 0.52, 0.16],
    bubbleRim: [0.96, 0.80, 0.36],
    bubbleIridescence: [0.72, 0.78, 0.30],
    moteColor: [0.98, 0.82, 0.42],
    isLight: 0.0,
    bubbleOpacity: 0.32,
    moteOpacity: 0.42,
    rayStrength: 0.15,
    hillStrength: 0.18,
  },
  kanagawa: {
    skyTop: [0.075, 0.078, 0.11],
    skyMid: [0.12, 0.13, 0.19],
    horizon: [0.17, 0.20, 0.28],
    meadow: [0.36, 0.56, 0.58],
    sun: [0.58, 0.74, 0.90],
    accent: [0.58, 0.50, 0.72],
    bubbleRim: [0.56, 0.74, 0.88],
    bubbleIridescence: [0.60, 0.74, 0.48],
    moteColor: [0.78, 0.84, 0.92],
    isLight: 0.0,
    bubbleOpacity: 0.34,
    moteOpacity: 0.44,
    rayStrength: 0.14,
    hillStrength: 0.18,
  },
};

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.999, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uPointer;
  uniform float uPulse;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyMid;
  uniform vec3 uHorizon;
  uniform vec3 uMeadow;
  uniform vec3 uSun;
  uniform vec3 uAccent;
  uniform float uIsLight;
  uniform float uRayStrength;
  uniform float uHillStrength;

  void main() {
    vec2 uv = vUv;
    vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5);
    float t = uTime * 0.22;

    // 1. Sky vertical atmospheric gradient
    float skyBlend = smoothstep(0.08, 0.96, uv.y);
    vec3 col = mix(uHorizon, uSkyMid, smoothstep(0.18, 0.62, uv.y));
    col = mix(col, uSkyTop, smoothstep(0.55, 1.02, uv.y));

    // 2. Soft drifting sunlit wisps / aero clouds (ultra-cheap analytical waves)
    float wisp1 = sin(uv.x * 5.2 + t * 0.65 + sin(uv.y * 4.0 - t * 0.3) * 0.7);
    float wisp2 = sin(uv.x * 9.5 - t * 0.45 + uv.y * 5.4);
    float cloudBand = smoothstep(0.38, 0.82, uv.y) * (1.0 - smoothstep(0.84, 1.0, uv.y));
    float clouds = smoothstep(0.15, 0.92, (wisp1 * 0.55 + wisp2 * 0.45) * 0.5 + 0.5) * cloudBand;
    col = mix(col, mix(uHorizon, uSun, 0.58), clouds * mix(0.08, 0.24, uIsLight));

    // 3. Radiant upper-right sunburst flare + soft diagonal Aero light beams
    vec2 sunPos = vec2(0.46 * uAspect, 0.44) + uPointer * vec2(0.04, 0.03);
    vec2 dSun = p - sunPos;
    float sunDist = length(dSun);
    float sunCore = exp(-sunDist * 3.1) * (0.48 + uPulse * 0.22);
    float sunHalo = exp(-sunDist * 1.15) * (0.34 + uPulse * 0.14);

    float angle = atan(dSun.y, dSun.x);
    float rays = pow(0.5 + 0.5 * sin(angle * 7.0 + t * 0.35), 3.0) * 0.55
               + pow(0.5 + 0.5 * sin(angle * 11.0 - t * 0.22 + 1.4), 4.0) * 0.45;
    float rayMask = exp(-sunDist * 1.1) * rays * uRayStrength;
    col += uSun * (sunCore * mix(0.24, 0.52, uIsLight) + sunHalo * mix(0.16, 0.32, uIsLight) + rayMask);

    // 4. Secondary soft left-sky bokeh bloom
    vec2 leftOrb = vec2(-0.42 * uAspect, 0.28) - uPointer * vec2(0.03, 0.02);
    float leftGlow = exp(-length(p - leftOrb) * 1.6);
    col += mix(uAccent, uSun, 0.5) * leftGlow * mix(0.14, 0.24, uIsLight);

    // 5. Rolling translucent Frutiger Aero emerald meadow & aurora horizon ribbons
    float px = uv.x + uPointer.x * 0.015;
    float ridgeBack = 0.22 + 0.055 * sin(px * 3.6 + t * 0.55) + 0.025 * cos(px * 7.2 - t * 0.35);
    float ridgeFront = 0.14 + 0.048 * sin(px * 4.4 - t * 0.72 + 1.6) + 0.018 * sin(px * 9.0 + t * 0.5);

    float backMask = 1.0 - smoothstep(ridgeBack - 0.08, ridgeBack + 0.06, uv.y);
    float frontMask = 1.0 - smoothstep(ridgeFront - 0.05, ridgeFront + 0.035, uv.y);

    // Soft glossy crest sheen along the meadow wave
    float backCrest = exp(-abs(uv.y - ridgeBack) * 34.0);
    float frontCrest = exp(-abs(uv.y - ridgeFront) * 42.0);

    vec3 backRibbon = mix(uAccent, uMeadow, 0.62);
    vec3 frontRibbon = mix(uMeadow, uAccent, 0.25 + 0.25 * sin(px * 3.0 + t));

    col = mix(col, backRibbon, backMask * uHillStrength * 0.72);
    col = mix(col, frontRibbon, frontMask * uHillStrength * 0.92);
    col += mix(uHorizon, uSun, 0.65) * (backCrest * 0.16 + frontCrest * 0.24) * uHillStrength;

    // 6. Subtle aqua water caustic shimmer near bottom edge
    float causticWave = sin(uv.x * 16.0 + t * 1.4 + sin(uv.y * 18.0 - t * 0.9))
                      * cos(uv.x * 11.0 - t * 1.1 + uv.y * 12.0);
    float causticBand = (1.0 - smoothstep(0.0, 0.22, uv.y)) * smoothstep(0.25, 0.95, causticWave * 0.5 + 0.5);
    col += mix(uAccent, uSun, 0.55) * causticBand * mix(0.09, 0.18, uIsLight);

    // 7. Gentle center airiness lift in light theme so cards sit over clean luminous sky
    float centerSoft = exp(-length(p * vec2(0.85, 1.25)) * 1.25);
    col = mix(col, mix(col, uHorizon, 0.22), centerSoft * uIsLight * (1.0 - skyBlend * 0.35));

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

const BUBBLE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aOffset;
  attribute float aScale;
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aTint;

  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uAspect;
  uniform float uPulse;

  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vFade;
  varying float vTint;
  varying float vPhase;

  void main() {
    float spanY = 14.5;
    float yRaw = mod(aOffset.y + uTime * aSpeed + spanY * 0.5, spanY) - spanY * 0.5;
    float swayX = sin(uTime * (0.42 + aSpeed * 0.35) + aPhase) * 0.55;
    float swayZ = cos(uTime * 0.32 + aPhase * 1.3) * 0.25;

    float spreadX = max(1.0, uAspect * 0.86);
    vec3 center = vec3(
      aOffset.x * spreadX + swayX + uPointer.x * (0.45 + aOffset.z * 0.14),
      yRaw + uPointer.y * (0.30 + aOffset.z * 0.08),
      aOffset.z + swayZ
    );

    // Gentle organic bubble breath
    float breath = 1.0 + 0.035 * sin(uTime * 1.4 + aPhase) + uPulse * 0.05;
    vec3 transformed = position * (aScale * breath) + center;

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);

    // Seamless vertical wrap fade
    float normY = (yRaw + spanY * 0.5) / spanY;
    vFade = smoothstep(0.0, 0.14, normY) * (1.0 - smoothstep(0.84, 1.0, normY));
    vTint = aTint;
    vPhase = aPhase;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const BUBBLE_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vFade;
  varying float vTint;
  varying float vPhase;

  uniform float uTime;
  uniform float uPulse;
  uniform vec3 uRimColor;
  uniform vec3 uIridescence;
  uniform vec3 uAccent;
  uniform vec3 uMeadow;
  uniform float uIsLight;
  uniform float uOpacity;

  void main() {
    vec3 N = normalize(vNormalView);
    vec3 V = normalize(vViewDir);
    float ndotv = clamp(dot(N, V), 0.0, 1.0);

    // Crisp Fresnel glass rim
    float fresnel = pow(1.0 - ndotv, 2.55);
    float innerRim = pow(1.0 - ndotv, 1.35);

    // Soap-bubble thin-film rainbow tint modulated smoothly by grazing angle
    float filmAngle = (1.0 - ndotv) * 4.5 + vPhase + uTime * 0.25;
    vec3 rainbow = vec3(
      0.55 + 0.45 * sin(filmAngle),
      0.62 + 0.38 * sin(filmAngle + 2.09),
      0.68 + 0.32 * sin(filmAngle + 4.18)
    );
    vec3 tintMix = mix(uIridescence, rainbow, mix(0.22, 0.38, uIsLight));

    // Upper-right & upper-left sunlit glossy specular crescents
    vec3 L1 = normalize(vec3(0.55, 0.72, 0.65));
    vec3 H1 = normalize(L1 + V);
    float spec1 = pow(max(dot(N, H1), 0.0), 34.0);

    vec3 L2 = normalize(vec3(-0.62, 0.48, 0.55));
    vec3 H2 = normalize(L2 + V);
    float spec2 = pow(max(dot(N, H2), 0.0), 18.0) * 0.45;

    // Lower meadow/aqua caustic bounce reflection inside bottom arc of sphere
    float bounce = smoothstep(-0.15, -0.82, N.y) * innerRim * 0.55;
    vec3 bounceCol = mix(uAccent, uMeadow, vTint);

    // Combine translucent glass body, iridescent rim, bounce, and bright specular glints
    vec3 col = mix(uAccent * 0.85, tintMix, fresnel);
    col = mix(col, uRimColor, fresnel * 0.62);
    col += bounceCol * bounce * mix(0.55, 0.85, uIsLight);
    col += vec3(1.0) * (spec1 * 1.15 + spec2 * 0.65);

    // Keep sphere interior airy and crystal clear while edges gleam
    float alpha = (0.045 + innerRim * 0.14 + fresnel * 0.68 + spec1 * 0.85 + spec2 * 0.32) * uOpacity * vFade;
    alpha *= (1.0 + uPulse * 0.22);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(alpha, 0.0, 0.92));
  }
`;

const MOTE_VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aSpeed;
  attribute float aPhase;

  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uAspect;
  uniform float uPixelRatio;

  varying float vAlpha;
  varying float vSparkle;

  void main() {
    float spanY = 13.0;
    float yRaw = mod(position.y + uTime * aSpeed + spanY * 0.5, spanY) - spanY * 0.5;
    float xDrift = sin(uTime * 0.35 + aPhase) * 0.45;
    float spreadX = max(1.0, uAspect * 0.9);

    vec3 pos = vec3(
      position.x * spreadX + xDrift + uPointer.x * 0.22,
      yRaw + uPointer.y * 0.16,
      position.z
    );

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float normY = (yRaw + spanY * 0.5) / spanY;
    float edgeFade = smoothstep(0.0, 0.16, normY) * (1.0 - smoothstep(0.84, 1.0, normY));
    float twinkle = 0.58 + 0.42 * sin(uTime * 1.8 + aPhase * 2.1);

    vAlpha = edgeFade * twinkle;
    vSparkle = step(0.72, fract(aPhase * 1.37));

    gl_PointSize = aSize * uPixelRatio * (10.0 / max(2.5, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const MOTE_FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  varying float vSparkle;

  uniform vec3 uMoteColor;
  uniform float uOpacity;
  uniform float uPulse;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;

    // Soft radial bokeh orb + delicate 4-point sunlight glint for selected motes
    float disc = smoothstep(0.5, 0.06, r);
    float core = exp(-r * 6.5);
    float crossGlint = exp(-abs(c.x) * 16.0) * exp(-abs(c.y) * 4.5)
                     + exp(-abs(c.y) * 16.0) * exp(-abs(c.x) * 4.5);

    float shape = mix(disc * 0.72 + core * 0.4, disc * 0.45 + crossGlint * 0.75, vSparkle);
    float alpha = shape * vAlpha * uOpacity * (1.0 + uPulse * 0.35);

    gl_FragColor = vec4(uMoteColor, clamp(alpha, 0.0, 0.95));
  }
`;

export interface AmbientController {
  setTheme: (theme: ThemeId) => void;
  triggerPulse: () => void;
  dispose: () => void;
}

export interface AmbientInitOptions {
  canvas: HTMLCanvasElement;
  theme: ThemeId;
  onSlowPerformance?: () => void;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function toColor(rgb: [number, number, number]): Color {
  return new Color(rgb[0], rgb[1], rgb[2]);
}

function lerpNum(current: number, target: number, alpha: number): number {
  return current + (target - current) * alpha;
}

export function createAmbientEngine(options: AmbientInitOptions): AmbientController | null {
  const { canvas, onSlowPerformance } = options;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false, // Analytical AA in GLSL avoids MSAA overhead
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
  } catch {
    return null;
  }

  const maxDpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(maxDpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(44, 1, 0.1, 40);
  camera.position.set(0, 0, 11.5);

  let targetPalette = PALETTES[options.theme] || PALETTES["frutiger-aero"];

  // 1. Fullscreen living sky / aurora / meadow horizon quad (1 draw call)
  const skyGeo = new PlaneGeometry(2, 2);
  const skyUniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1.5 },
    uPointer: { value: new Vector2(0, 0) },
    uPulse: { value: 0 },
    uSkyTop: { value: toColor(targetPalette.skyTop) },
    uSkyMid: { value: toColor(targetPalette.skyMid) },
    uHorizon: { value: toColor(targetPalette.horizon) },
    uMeadow: { value: toColor(targetPalette.meadow) },
    uSun: { value: toColor(targetPalette.sun) },
    uAccent: { value: toColor(targetPalette.accent) },
    uIsLight: { value: targetPalette.isLight },
    uRayStrength: { value: targetPalette.rayStrength },
    uHillStrength: { value: targetPalette.hillStrength },
  };
  const skyMat = new ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: skyUniforms,
    depthWrite: false,
    depthTest: false,
  });
  const skyMesh = new Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = 0;
  scene.add(skyMesh);

  // 2. Iridescent 3D glass bubbles via InstancedBufferGeometry (1 draw call, GPU-animated)
  const BUBBLE_COUNT = 22;
  const rand = seededRand(20261127);
  const baseSphere = new SphereGeometry(1, 24, 18);
  const bubbleGeo = new InstancedBufferGeometry();
  bubbleGeo.index = baseSphere.index;
  bubbleGeo.attributes.position = baseSphere.attributes.position;
  bubbleGeo.attributes.normal = baseSphere.attributes.normal;
  bubbleGeo.instanceCount = BUBBLE_COUNT;

  const offsets = new Float32Array(BUBBLE_COUNT * 3);
  const scales = new Float32Array(BUBBLE_COUNT);
  const speeds = new Float32Array(BUBBLE_COUNT);
  const phases = new Float32Array(BUBBLE_COUNT);
  const tints = new Float32Array(BUBBLE_COUNT);

  for (let i = 0; i < BUBBLE_COUNT; i++) {
    // Frame the screen edges nicely while leaving a few soft mid-field orbs
    const lane = i % 3;
    const xBase =
      lane === 0
        ? -6.6 + rand() * 3.6
        : lane === 1
        ? 3.0 + rand() * 3.8
        : -3.2 + rand() * 6.4;
    offsets[i * 3] = xBase;
    offsets[i * 3 + 1] = -7.0 + rand() * 14.0;
    offsets[i * 3 + 2] = -3.8 + rand() * 4.4;

    const isHeroBubble = i < 6;
    scales[i] = isHeroBubble ? 0.56 + rand() * 0.52 : 0.18 + rand() * 0.36;
    speeds[i] = isHeroBubble ? 0.18 + rand() * 0.16 : 0.24 + rand() * 0.30;
    phases[i] = rand() * Math.PI * 2;
    tints[i] = rand();
  }

  bubbleGeo.setAttribute("aOffset", new InstancedBufferAttribute(offsets, 3));
  bubbleGeo.setAttribute("aScale", new InstancedBufferAttribute(scales, 1));
  bubbleGeo.setAttribute("aSpeed", new InstancedBufferAttribute(speeds, 1));
  bubbleGeo.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
  bubbleGeo.setAttribute("aTint", new InstancedBufferAttribute(tints, 1));

  const bubbleUniforms = {
    uTime: { value: 0 },
    uPointer: { value: new Vector2(0, 0) },
    uAspect: { value: 1.5 },
    uPulse: { value: 0 },
    uRimColor: { value: toColor(targetPalette.bubbleRim) },
    uIridescence: { value: toColor(targetPalette.bubbleIridescence) },
    uAccent: { value: toColor(targetPalette.accent) },
    uMeadow: { value: toColor(targetPalette.meadow) },
    uIsLight: { value: targetPalette.isLight },
    uOpacity: { value: targetPalette.bubbleOpacity },
  };

  const bubbleMat = new ShaderMaterial({
    vertexShader: BUBBLE_VERTEX_SHADER,
    fragmentShader: BUBBLE_FRAGMENT_SHADER,
    uniforms: bubbleUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: NormalBlending,
  });

  const bubblesMesh = new Mesh(bubbleGeo, bubbleMat);
  bubblesMesh.frustumCulled = false;
  bubblesMesh.renderOrder = 1;
  scene.add(bubblesMesh);

  // 3. Sunlit bokeh droplets & subtle sparkle motes (1 draw call, GPU-animated)
  const MOTE_COUNT = 44;
  const moteGeo = new BufferGeometry();
  const motePositions = new Float32Array(MOTE_COUNT * 3);
  const moteSizes = new Float32Array(MOTE_COUNT);
  const moteSpeeds = new Float32Array(MOTE_COUNT);
  const motePhases = new Float32Array(MOTE_COUNT);

  for (let i = 0; i < MOTE_COUNT; i++) {
    motePositions[i * 3] = -6.8 + rand() * 13.6;
    motePositions[i * 3 + 1] = -6.5 + rand() * 13.0;
    motePositions[i * 3 + 2] = -2.8 + rand() * 4.5;
    moteSizes[i] = 10 + rand() * 24;
    moteSpeeds[i] = 0.14 + rand() * 0.28;
    motePhases[i] = rand() * Math.PI * 2;
  }

  moteGeo.setAttribute("position", new BufferAttribute(motePositions, 3));
  moteGeo.setAttribute("aSize", new BufferAttribute(moteSizes, 1));
  moteGeo.setAttribute("aSpeed", new BufferAttribute(moteSpeeds, 1));
  moteGeo.setAttribute("aPhase", new BufferAttribute(motePhases, 1));

  const moteUniforms = {
    uTime: { value: 0 },
    uPointer: { value: new Vector2(0, 0) },
    uAspect: { value: 1.5 },
    uPixelRatio: { value: maxDpr },
    uMoteColor: { value: toColor(targetPalette.moteColor) },
    uOpacity: { value: targetPalette.moteOpacity },
    uPulse: { value: 0 },
  };

  const moteMat = new ShaderMaterial({
    vertexShader: MOTE_VERTEX_SHADER,
    fragmentShader: MOTE_FRAGMENT_SHADER,
    uniforms: moteUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });

  const motes = new Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 2;
  scene.add(motes);

  // Reusable color targets to avoid per-frame allocations
  const tmpColor = new Color();
  const pointerTarget = new Vector2(0, 0);
  const pointerSmooth = new Vector2(0, 0);

  let pulseLevel = 0;
  let elapsedTime = 0;
  let lastFrameTs = 0;
  let lastRenderTs = 0;
  let rafId = 0;
  let disposed = false;
  let paused = document.hidden;
  let slowFrameStreak = 0;

  // Pace ambient background to ~32 FPS to preserve battery & GPU headroom
  const FRAME_INTERVAL_MS = 1000 / 32;

  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    skyUniforms.uAspect.value = aspect;
    bubbleUniforms.uAspect.value = aspect;
    moteUniforms.uAspect.value = aspect;
    moteUniforms.uPixelRatio.value = dpr;
  };

  const supportsFinePointer =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;

  const onPointerMove = (e: PointerEvent) => {
    const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const ny = -((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
    pointerTarget.set(nx, ny);
  };

  const onVisibilityChange = () => {
    paused = document.hidden;
    if (!paused && !disposed) {
      lastFrameTs = performance.now();
      lastRenderTs = 0;
      scheduleNext();
    } else if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    paused = true;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const onContextRestored = () => {
    if (disposed) return;
    paused = document.hidden;
    resize();
    if (!paused) scheduleNext();
  };

  const lerpColor = (current: Color, targetRgb: [number, number, number], alpha: number) => {
    tmpColor.setRGB(targetRgb[0], targetRgb[1], targetRgb[2]);
    current.lerp(tmpColor, alpha);
  };

  const renderFrame = (now: number) => {
    rafId = 0;
    if (disposed || paused) return;

    if (lastRenderTs > 0 && now - lastRenderTs < FRAME_INTERVAL_MS) {
      scheduleNext();
      return;
    }

    const dt = lastFrameTs > 0 ? Math.min(0.08, (now - lastFrameTs) / 1000) : 0.032;
    lastFrameTs = now;
    lastRenderTs = now;
    elapsedTime += dt;

    // Smooth pointer parallax & celebration pulse decay
    pointerSmooth.lerp(pointerTarget, Math.min(1, dt * 3.2));
    pulseLevel = Math.max(0, pulseLevel - dt * 0.9);

    // Smooth theme color morphing
    const themeLerp = Math.min(1, dt * 4.5);
    lerpColor(skyUniforms.uSkyTop.value, targetPalette.skyTop, themeLerp);
    lerpColor(skyUniforms.uSkyMid.value, targetPalette.skyMid, themeLerp);
    lerpColor(skyUniforms.uHorizon.value, targetPalette.horizon, themeLerp);
    lerpColor(skyUniforms.uMeadow.value, targetPalette.meadow, themeLerp);
    lerpColor(skyUniforms.uSun.value, targetPalette.sun, themeLerp);
    lerpColor(skyUniforms.uAccent.value, targetPalette.accent, themeLerp);
    skyUniforms.uIsLight.value = lerpNum(skyUniforms.uIsLight.value, targetPalette.isLight, themeLerp);
    skyUniforms.uRayStrength.value = lerpNum(skyUniforms.uRayStrength.value, targetPalette.rayStrength, themeLerp);
    skyUniforms.uHillStrength.value = lerpNum(skyUniforms.uHillStrength.value, targetPalette.hillStrength, themeLerp);

    lerpColor(bubbleUniforms.uRimColor.value, targetPalette.bubbleRim, themeLerp);
    lerpColor(bubbleUniforms.uIridescence.value, targetPalette.bubbleIridescence, themeLerp);
    lerpColor(bubbleUniforms.uAccent.value, targetPalette.accent, themeLerp);
    lerpColor(bubbleUniforms.uMeadow.value, targetPalette.meadow, themeLerp);
    bubbleUniforms.uIsLight.value = skyUniforms.uIsLight.value;
    bubbleUniforms.uOpacity.value = lerpNum(bubbleUniforms.uOpacity.value, targetPalette.bubbleOpacity, themeLerp);

    lerpColor(moteUniforms.uMoteColor.value, targetPalette.moteColor, themeLerp);
    moteUniforms.uOpacity.value = lerpNum(moteUniforms.uOpacity.value, targetPalette.moteOpacity, themeLerp);

    skyUniforms.uTime.value = elapsedTime;
    skyUniforms.uPointer.value.copy(pointerSmooth);
    skyUniforms.uPulse.value = pulseLevel;

    bubbleUniforms.uTime.value = elapsedTime;
    bubbleUniforms.uPointer.value.copy(pointerSmooth);
    bubbleUniforms.uPulse.value = pulseLevel;

    moteUniforms.uTime.value = elapsedTime;
    moteUniforms.uPointer.value.copy(pointerSmooth);
    moteUniforms.uPulse.value = pulseLevel;

    const renderStart = performance.now();
    renderer.render(scene, camera);
    const renderMs = performance.now() - renderStart;

    // Self-protecting watchdog: if software/slow rendering repeatedly stalls >55ms, downshift cleanly
    if (renderMs > 55) {
      slowFrameStreak += 1;
      if (slowFrameStreak >= 12) {
        onSlowPerformance?.();
        return;
      }
    } else if (slowFrameStreak > 0) {
      slowFrameStreak = 0;
    }

    scheduleNext();
  };

  const scheduleNext = () => {
    if (disposed || paused || rafId) return;
    rafId = window.requestAnimationFrame(renderFrame);
  };

  resize();
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  if (supportsFinePointer) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
  }

  // Render first frame immediately so fade-in is crisp
  renderFrame(performance.now());

  return {
    setTheme(nextTheme: ThemeId) {
      targetPalette = PALETTES[nextTheme] || PALETTES["frutiger-aero"];
    },
    triggerPulse() {
      pulseLevel = 1.0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (supportsFinePointer) {
        window.removeEventListener("pointermove", onPointerMove);
      }
      skyGeo.dispose();
      skyMat.dispose();
      baseSphere.dispose();
      bubbleGeo.dispose();
      bubbleMat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      renderer.dispose();
    },
  };
}
