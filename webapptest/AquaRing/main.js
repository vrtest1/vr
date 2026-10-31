import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// ===== 寸法（タンク内側の中心が原点。1単位 ≒ 10cm） =====
const W = 1.0, H = 1.3, D = 0.17;
const HX = W / 2, HY = H / 2, HZ = D / 2;
const AIR_FRAC = 0.10;          // 水は90%
const G = 4.0;                  // 遊びやすさ優先の重力スケール
const BUOY = 0.62;              // 水の密度 / 輪の密度
const RING_R = 0.055, TUBE = 0.012, R_IN = RING_R - TUBE;
const INV_I = 1 / (0.5 * RING_R * RING_R);
const PEG_R = 0.008, TIP_R = 0.015, COLLAR_R = 0.05;
const PEGS = [
  { x: -0.2, base: -0.13, tip: 0.17 },
  { x: 0.2, base: -0.13, tip: 0.17 },
];
const NOZZLES = [{ x: -0.33, y: -0.6 }, { x: 0.33, y: -0.6 }];
const FLOOR = [[-HX, -0.47], [-0.33, -0.6], [0, -0.45], [0.33, -0.6], [HX, -0.47]];
const JET_V = 2.6;
const RING_COLORS = [0xff3b3b, 0x2f7bff, 0x22c24a, 0xffcf1a];
const RING_COUNT = 12;
const WAVE_N = 64;
const WAVE_L = Math.hypot(W, H) / 2;
const SUBSTEPS = 4;
const DEG = Math.PI / 180;

// ===== レンダラ / シーン =====
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 2, 3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
const tank = new THREE.Group();
scene.add(tank);

// ===== 本体（丸みのある樹脂の筐体・台座・床・棒） =====
const red = new THREE.MeshPhysicalMaterial({
  color: 0xd8281a, roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.1,
});
const darkRed = new THREE.MeshPhysicalMaterial({
  color: 0x9e1c12, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2,
});
const white = new THREE.MeshPhysicalMaterial({
  color: 0xf4f2ec, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.15,
});
const metal = new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.1, metalness: 1 });

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// 角も縁も丸い直方体（w×h×d、中心原点）
function roundedSlab(w, h, d, r, b) {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w - 2 * b, h - 2 * b, Math.max(0.002, r - b)), {
    depth: d - 2 * b, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 8, curveSegments: 12,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  return toCreasedNormals(g, 0.7);
}

const cap = new THREE.Mesh(roundedSlab(W + 0.1, 0.1, D + 0.09, 0.05, 0.035), red);
cap.position.y = HY + 0.035;
tank.add(cap);

const baseH = 0.32, baseD = D + 0.22, baseFront = 0.03 + baseD / 2;
const base = new THREE.Mesh(roundedSlab(W + 0.16, baseH, baseD, 0.09, 0.045), red);
base.position.set(0, -HY - baseH / 2, 0.03);
tank.add(base);
// 台座と水槽のつなぎ目の段
const collarBand = new THREE.Mesh(roundedSlab(W + 0.07, 0.04, D + 0.07, 0.035, 0.015), darkRed);
collarBand.position.y = -HY + 0.005;
tank.add(collarBand);

const labelCanvas = document.createElement('canvas');
labelCanvas.width = 512; labelCanvas.height = 128;
{
  const c = labelCanvas.getContext('2d');
  c.fillStyle = '#fbfbf6';
  c.beginPath(); c.roundRect(4, 4, 504, 120, 26); c.fill();
  c.strokeStyle = '#2a2a2a'; c.lineWidth = 7;
  c.beginPath(); c.roundRect(14, 14, 484, 100, 20); c.stroke();
  c.fillStyle = '#c62f20'; c.font = 'bold 64px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('AQUA RING', 256, 68);
}
const labelTex = new THREE.CanvasTexture(labelCanvas);
labelTex.colorSpace = THREE.SRGBColorSpace;
labelTex.anisotropy = 4;
const label = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105),
  new THREE.MeshPhysicalMaterial({ map: labelTex, transparent: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }));
label.position.set(0, -HY - 0.15, baseFront + 0.001);
tank.add(label);

// ドーム型の押しボタン + 縁取り
const domeGeo = new THREE.LatheGeometry([
  [0, 0.05], [0.025, 0.049], [0.045, 0.044], [0.058, 0.035], [0.066, 0.022], [0.07, 0.008], [0.07, -0.03],
].map(([r, y]) => new THREE.Vector2(r, y)), 40);
const BTN_Z_UP = baseFront + 0.004, BTN_Z_DOWN = baseFront - 0.018;
const pushButtons = [-0.4, 0.4].map(x => {
  const b = new THREE.Mesh(domeGeo, white);
  b.rotation.x = Math.PI / 2;
  b.position.set(x, -HY - 0.15, BTN_Z_UP);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.079, 0.011, 16, 48), darkRed);
  bezel.position.set(x, -HY - 0.15, baseFront);
  tank.add(b, bezel);
  return b;
});

// 床（ノズルへ向かう傾斜）
{
  const s = new THREE.Shape();
  s.moveTo(-HX, -HY);
  for (const [x, y] of FLOOR) s.lineTo(x, y);
  s.lineTo(HX, -HY);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: D - 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.006, bevelSegments: 3,
  });
  g.translate(0, 0, -HZ + 0.006);
  tank.add(new THREE.Mesh(toCreasedNormals(g, 0.6), white));
}
for (const n of NOZZLES) {
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 24),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 }));
  hole.position.set(n.x, n.y + 0.004, 0);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 12, 32), white);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(n.x, n.y + 0.009, 0);
  tank.add(hole, rim);
}

for (const p of PEGS) {
  const len = p.tip - p.base;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(PEG_R, PEG_R, len, 16), metal);
  shaft.position.set(p.x, p.base + len / 2, 0);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(TIP_R, 24, 16), metal);
  tip.position.set(p.x, p.tip, 0);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(COLLAR_R, COLLAR_R * 0.85, 0.01, 32), metal);
  collar.position.set(p.x, p.base, 0);
  const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, HZ, 12), metal);
  bracket.rotation.x = Math.PI / 2;
  bracket.position.set(p.x, p.base - 0.02, -HZ / 2);
  tank.add(shaft, tip, collar, bracket);
}

// ガラス（角の丸い透明ケース）
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, transparent: true, opacity: 0.14, roughness: 0.02, metalness: 0,
  clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.4, side: THREE.DoubleSide, depthWrite: false,
});
let glass;
{
  const g = new THREE.ExtrudeGeometry(roundedRectShape(W + 0.012, D + 0.012, 0.035), {
    depth: H, bevelEnabled: false, curveSegments: 12,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -HY, 0);
  glass = new THREE.Mesh(toCreasedNormals(g, 0.6), glassMat);
  glass.renderOrder = 5;
  tank.add(glass);
}

// 接地の影
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(60,35,20,0.55)');
  grd.addColorStop(1, 'rgba(60,35,20,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.7, baseD + 0.6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -HY - baseH - 0.002, 0.03);
  tank.add(shadow);
}

// ===== 水（形状はシェーダで水面より上を捨てる。屈折は水を除いた画面を歪めて読む） =====
const IOR_WATER = 1.333;
const canHalf = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
const sceneRT = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType });
const waveData = new Float32Array(WAVE_N);
const waveVel = new Float32Array(WAVE_N);
const waterUniforms = {
  uWave: { value: waveData },
  uN: { value: new THREE.Vector2(0, 1) },
  uS: { value: 0 },        // 前後方向の水面の傾き（z が1進むと水位がどれだけ下がるか）
  uC: { value: 0 },
  uL: { value: WAVE_L },
  uTime: { value: 0 },
  uStir: { value: 0 },
  uRefr: { value: 0 },     // 0 = リアル、1 = 派手
  uScene: { value: sceneRT.texture },
  uViewProj: { value: new THREE.Matrix4() },
};
const glslWave = /* glsl */`
  uniform float uWave[${WAVE_N}];
  uniform vec2 uN;
  uniform float uS;
  uniform float uC;
  uniform float uL;
  uniform float uTime;
  uniform float uStir;
  uniform float uRefr;
  uniform sampler2D uScene;
  uniform mat4 uViewProj;
  float wave(float u) {
    float f = clamp((u + uL) / (2.0 * uL), 0.0, 1.0) * ${WAVE_N - 1}.0;
    int i = int(floor(f));
    int j = min(i + 1, ${WAVE_N - 1});
    return mix(uWave[i], uWave[j], fract(f));
  }
  // 屈折後の点が元の画面のどこに写っていたか
  vec3 sceneAt(vec3 p) {
    vec4 c = uViewProj * vec4(p, 1.0);
    return texture2D(uScene, clamp(c.xy / c.w * 0.5 + 0.5, 0.001, 0.999)).rgb;
  }
  // 色ごとに屈折率を少し変えて虹色のにじみを出す（派手モード）
  vec3 refractScene(vec3 P, vec3 V, vec3 N, vec3 Nf, float dist, float boost) {
    float amp = mix(1.0, boost, uRefr);
    float spread = 0.06 * uRefr;
    vec3 col = vec3(0.0);
    for (int k = 0; k < 3; k++) {
      float n = 1.0 + 0.333 * amp * (1.0 + spread * (float(k) - 1.0));
      vec3 R = refract(V, N, 1.0 / n);
      if (dot(R, R) < 0.5) R = V;
      float t = dist * mix(1.0, 2.2, uRefr) / max(dot(R, -Nf), 0.2);
      vec3 s = sceneAt(P + R * t);
      if (k == 0) col.r = s.r; else if (k == 1) col.g = s.g; else col.b = s.b;
    }
    return col;
  }
  // 水の吸収（奥行きと水深で少しだけ青緑に）
  vec3 absorb(float depth) {
    return mix(vec3(0.94, 0.985, 1.0), vec3(0.66, 0.84, 0.93), depth);
  }
`;

const waterMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: true, blending: THREE.NoBlending, depthWrite: true, side: THREE.FrontSide,
  vertexShader: /* glsl */`
    varying vec3 vP;
    varying vec3 vWorld;
    varying vec3 vNw;
    varying vec3 vSNw;
    varying vec3 vLens;
    uniform vec2 uN;
    uniform float uS;
    void main() {
      vP = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vNw = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vSNw = normalize((modelMatrix * vec4(uN, uS, 0.0)).xyz);
      // 正面がわずかに膨らんだレンズのように見せる向き
      vLens = (modelMatrix * vec4(position.x / ${HX.toFixed(4)}, position.y / ${HY.toFixed(4)} * 0.6, 0.0, 0.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: glslWave + /* glsl */`
    varying vec3 vP;
    varying vec3 vWorld;
    varying vec3 vNw;
    varying vec3 vSNw;
    varying vec3 vLens;
    void main() {
      vec2 T = vec2(-uN.y, uN.x);
      float lvl = dot(uN, vP.xy) + uS * vP.z - (uC + wave(dot(T, vP.xy)));
      if (lvl > 0.0) discard;
      float men = smoothstep(-0.018 * mix(1.0, 1.6, uRefr), 0.0, lvl);
      vec3 V = normalize(vWorld - cameraPosition);
      vec3 Nf = normalize(vNw);
      // 壁際の水面はメニスカスで反り上がり、その帯だけ強く曲がる
      vec3 N = Nf - normalize(vSNw) * men * men * mix(0.8, 1.4, uRefr);
      // 派手モード: レンズの膨らみ + 水流のゆらめき
      N += vLens * 0.22 * uRefr;
      float t = uTime;
      vec2 wob = vec2(sin(vP.y * 42.0 + t * 3.1 + sin(vP.x * 17.0 + t)), cos(vP.x * 37.0 - t * 2.7 + sin(vP.y * 13.0 - t * 1.3)));
      N.xy += wob * uStir * (0.02 + 0.07 * uRefr);
      N = normalize(N);
      vec3 col = refractScene(vWorld, V, N, Nf, ${HZ.toFixed(4)}, 3.0);
      float depth = clamp(-lvl / 1.3, 0.0, 1.0);
      col *= absorb(depth);
      col *= 1.0 + 0.025 * sin(vP.x * 38.0 + t * 1.7) * sin(vP.y * 31.0 - t * 1.3 + vP.x * 9.0);
      col = mix(col, vec3(0.93, 0.97, 1.0), men * men * 0.6);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const water = new THREE.Mesh(new THREE.BoxGeometry(W - 0.002, H - 0.002, D - 0.004), waterMat);
water.renderOrder = 2;
tank.add(water);

const surfaceMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: true, blending: THREE.NoBlending, depthWrite: true, side: THREE.DoubleSide,
  vertexShader: glslWave + /* glsl */`
    varying vec3 vP3;
    varying vec3 vNrm;
    varying vec3 vWorld;
    void main() {
      float u = mix(-uL, uL, uv.x);
      float z = (uv.y - 0.5) * ${(D - 0.006).toFixed(4)};
      vec2 T = vec2(-uN.y, uN.x);
      float du = 2.0 * uL / ${WAVE_N - 1}.0;
      float dh = (wave(u + du) - wave(u - du)) / (2.0 * du);
      vec2 p2 = T * u + uN * (uC + wave(u) - uS * z);
      vP3 = vec3(p2, z);
      vNrm = normalize((modelMatrix * vec4(uN - T * dh, uS, 0.0)).xyz);
      vec4 wp = modelMatrix * vec4(p2, z, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: glslWave + /* glsl */`
    varying vec3 vP3;
    varying vec3 vNrm;
    varying vec3 vWorld;
    void main() {
      if (abs(vP3.x) > ${(HX - 0.002).toFixed(4)} || abs(vP3.y) > ${(HY - 0.002).toFixed(4)}) discard;
      vec3 V = normalize(vWorld - cameraPosition);
      vec3 N = normalize(vNrm);
      bool fromAir = dot(N, V) < 0.0;
      if (!fromAir) N = -N;
      vec3 R = refract(V, N, fromAir ? 1.0 / ${IOR_WATER} : ${IOR_WATER});
      float cosI = clamp(dot(-V, N), 0.0, 1.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
      if (dot(R, R) < 0.5) F = 1.0;   // 全反射
      vec3 refr = (fromAir ? refractScene(vWorld, V, N, N, 0.12, 2.5) : sceneAt(vWorld + R * 0.12)) * absorb(0.3);
      vec3 refl = sceneAt(vWorld + reflect(V, N) * 0.12);
      vec3 L = normalize(vec3(0.3, 1.0, 0.6));
      float spec = pow(max(dot(reflect(-L, N), -V), 0.0), 80.0);
      vec3 col = mix(refr, refl, F) + spec * 0.8;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, WAVE_N - 1, 4), surfaceMat);
surface.frustumCulled = false;
surface.renderOrder = 3;
tank.add(surface);

// ===== 泡 =====
const MAX_BUBBLES = 400;
const bubblePos = new Float32Array(MAX_BUBBLES * 3);
const bubbleVel = new Float32Array(MAX_BUBBLES * 3);
const bubbleLife = new Float32Array(MAX_BUBBLES);
let bubbleCount = 0;
const bubbleGeo = new THREE.BufferGeometry();
bubbleGeo.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3).setUsage(THREE.DynamicDrawUsage));
const bubbleTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(26, 24, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
  return new THREE.CanvasTexture(c);
})();
const bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({
  size: 0.02, map: bubbleTex, transparent: true, depthWrite: false, sizeAttenuation: true,
}));
bubbles.frustumCulled = false;
bubbles.renderOrder = 1;   // 水より先に描き、屈折用の画面にも入れる
tank.add(bubbles);

// ===== 輪 =====
const V3 = THREE.Vector3;
const ringGeo = new THREE.TorusGeometry(RING_R, TUBE, 12, 32);
const rings = [];
for (let i = 0; i < RING_COUNT; i++) {
  const mesh = new THREE.Mesh(ringGeo, new THREE.MeshPhysicalMaterial({
    color: RING_COLORS[i % RING_COLORS.length], roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.1,
  }));
  tank.add(mesh);
  rings.push({
    p: new V3(), v: new V3(), q: new THREE.Quaternion(), w: new V3(),
    n: new V3(), e1: new V3(), e2: new V3(), sub: 1, peg: -1, mesh,
  });
}

// 輪どうしが食い込んだ（鎖のように繋がった）状態で始まらないよう、外接球が重ならない位置に置く
function scatterRings() {
  const minD2 = (2 * (RING_R + TUBE)) ** 2;
  rings.forEach((r, i) => {
    for (let tries = 0; tries < 200; tries++) {
      r.p.set((Math.random() - 0.5) * 0.8, -0.35 + Math.random() * 0.45, (Math.random() - 0.5) * 0.04);
      if (rings.slice(0, i).every(o => o.p.distanceToSquared(r.p) > minD2)) break;
    }
  });
  for (const r of rings) {
    r.v.set(0, 0, 0);
    r.w.set(0, 0, 0);
    r.q.setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
    r.peg = -1;
  }
}

// 棒のあたり判定用サンプル点（点 + 半径）
const pegSamples = PEGS.map(p => {
  const s = [];
  for (let y = p.base; y < p.tip; y += 0.012) s.push({ p: new V3(p.x, y, 0), r: PEG_R });
  s.push({ p: new V3(p.x, p.tip, 0), r: TIP_R });
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2;
    s.push({ p: new V3(p.x + Math.cos(a) * (COLLAR_R - 0.006), p.base, Math.sin(a) * (COLLAR_R - 0.006)), r: 0.006 });
  }
  for (let z = -HZ; z < 0; z += 0.015) s.push({ p: new V3(p.x, p.base - 0.02, z), r: 0.012 });
  return s;
});

const floorPlanes = [];
for (let i = 0; i < FLOOR.length - 1; i++) {
  const [ax, ay] = FLOOR[i], [bx, by] = FLOOR[i + 1];
  const n = new V3(-(by - ay), bx - ax, 0).normalize();
  floorPlanes.push({ n, o: n.x * ax + n.y * ay, x0: ax - 0.03, x1: bx + 0.03 });
}
const wallPlanes = [
  { n: new V3(1, 0, 0), o: -HX }, { n: new V3(-1, 0, 0), o: -HX },
  { n: new V3(0, -1, 0), o: -HY }, { n: new V3(0, 1, 0), o: -HY },
  { n: new V3(0, 0, 1), o: -HZ }, { n: new V3(0, 0, -1), o: -HZ },
];

// ===== 状態 =====
const gEff = new V3(0, -1, 0);       // タンク座標での実効重力（1 = 1G）
const gTarget = new V3(0, -1, 0);
const sN = new THREE.Vector2(0, 1);  // 水面の法線
let slosh = Math.PI / 2, sloshV = 0, cS = 0;
let sloshZ = 0, sloshZV = 0;   // 前後方向の水面の傾き
let time = 0, stir = 0;
const jets = NOZZLES.map(() => ({ pressed: false, held: 0, s: 0 }));
let tilt = 0, tiltTarget = 0, shakeT = 0;
let playing = false, playTime = 0, allHookedT = 0, lastHooked = 0;

// ===== 入力: センサー =====
const sensor = { raw: new V3(), has: false, orient: new V3(), hasOrient: false, signAcc: -0.05 };
addEventListener('devicemotion', e => {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  sensor.raw.set(a.x, a.y, a.z);
  sensor.has = true;
});
addEventListener('deviceorientation', e => {
  if (e.beta == null) return;
  const b = e.beta * DEG, g = e.gamma * DEG;
  sensor.orient.set(Math.sin(g) * Math.cos(b), -Math.sin(b), -Math.cos(g) * Math.cos(b));
  sensor.hasOrient = true;
});
function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle * DEG;
  return (window.orientation || 0) * DEG;
}

async function requestSensors() {
  try {
    const reqs = [];
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) reqs.push(DeviceMotionEvent.requestPermission());
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) reqs.push(DeviceOrientationEvent.requestPermission());
    await Promise.all(reqs);
  } catch (err) {
    console.warn('sensor permission', err);
  }
}

// ===== 入力: ボタン・キー・ドラッグ =====
const btns = [document.getElementById('btnL'), document.getElementById('btnR')];
btns.forEach((b, i) => {
  const set = v => { jets[i].pressed = v; if (v) jets[i].held = 0; b.classList.toggle('on', v); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); audio.resume(); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
  b.addEventListener('contextmenu', e => e.preventDefault());
});
const keyJet = { f: 0, a: 0, j: 1, l: 1 };
const keys = {};
addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k in keyJet) { const i = keyJet[k]; jets[i].pressed = true; jets[i].held = 0; btns[i].classList.add('on'); }
  if (e.key === ' ') shakeT = 0.5;
  keys[e.key] = true;
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k in keyJet) { const i = keyJet[k]; jets[i].pressed = false; btns[i].classList.remove('on'); }
  keys[e.key] = false;
});
// 台座の3Dボタン（押しやすいよう少し大きめの透明な当たり判定）
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
const hitTargets = pushButtons.map((b, i) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 24), hitMat);
  m.rotation.x = Math.PI / 2;
  m.position.copy(b.position);
  m.userData.jet = i;
  tank.add(m);
  return m;
});
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointerJet = new Map();
function setJet(i, v) {
  jets[i].pressed = v;
  if (v) jets[i].held = 0;
  btns[i].classList.toggle('on', v);
}
function releasePointerJet(e) {
  const i = pointerJet.get(e.pointerId);
  if (i === undefined) return;
  pointerJet.delete(e.pointerId);
  if (![...pointerJet.values()].includes(i)) setJet(i, false);
}
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(hitTargets)[0];
  if (hit) {
    const i = hit.object.userData.jet;
    pointerJet.set(e.pointerId, i);
    setJet(i, true);
    audio.resume();
    return;
  }
  drag = { x: e.clientX, id: e.pointerId };
});
addEventListener('pointerup', releasePointerJet);
addEventListener('pointercancel', releasePointerJet);
addEventListener('pointermove', e => {
  if (drag && e.pointerId === drag.id) tiltTarget = THREE.MathUtils.clamp((e.clientX - drag.x) * -0.004, -1.2, 1.2);
});
addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id) { drag = null; tiltTarget = 0; } });
document.addEventListener('contextmenu', e => e.preventDefault());

// スマホのダブルタップズーム・ピンチズーム・長押しの拡大鏡を抑制（iOS は user-scalable=no を無視するため）
// touchstart を止めると iOS は click を出さないので、ボタンは touchend で自前で click する
const nativeTouch = el => el.closest?.('input, label');   // 色・ファイル選択は標準動作のまま
let touchBtn = null;
document.addEventListener('touchstart', e => {
  if (nativeTouch(e.target)) return;
  e.preventDefault();
  if (e.touches.length === 1) touchBtn = e.target.closest?.('button:not(.jet)') ?? null;
}, { passive: false });
document.addEventListener('touchend', e => {
  if (nativeTouch(e.target)) return;
  e.preventDefault();
  const t = e.changedTouches[0];
  const btn = touchBtn;
  touchBtn = null;
  if (btn && t && btn.contains(document.elementFromPoint(t.clientX, t.clientY))) btn.click();
}, { passive: false });
document.addEventListener('touchcancel', () => { touchBtn = null; });
document.addEventListener('selectstart', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
}

// ===== 音 =====
const audio = (() => {
  let ctx = null, pumpGain, pumpFilter;
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    pumpFilter = ctx.createBiquadFilter();
    pumpFilter.type = 'lowpass'; pumpFilter.frequency.value = 300;
    pumpGain = ctx.createGain(); pumpGain.gain.value = 0;
    src.connect(pumpFilter).connect(pumpGain).connect(ctx.destination);
    src.start();
  }
  return {
    resume() { init(); if (ctx.state === 'suspended') ctx.resume(); },
    pump(s) {
      if (!ctx) return;
      pumpGain.gain.setTargetAtTime(s * 0.18, ctx.currentTime, 0.03);
      pumpFilter.frequency.setTargetAtTime(250 + s * 700, ctx.currentTime, 0.05);
    },
    clink() {
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 1500 + Math.random() * 300;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.4);
    },
  };
})();

// ===== 水面 =====
const CORNERS = [[-HX, -HY], [HX, -HY], [HX, HY], [-HX, HY]];
function areaAbove(nx, ny, c) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = CORNERS[i], b = CORNERS[(i + 1) % 4];
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if (da >= 0) pts.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}
function solveC(nx, ny) {
  let lo = -WAVE_L, hi = WAVE_L;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (areaAbove(nx, ny, mid) > AIR_FRAC * W * H) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function waveAt(u) {
  const f = (u + WAVE_L) / (2 * WAVE_L) * (WAVE_N - 1);
  if (f <= 0) return waveData[0];
  if (f >= WAVE_N - 1) return waveData[WAVE_N - 1];
  const i = f | 0, t = f - i;
  return waveData[i] * (1 - t) + waveData[i + 1] * t;
}
// 正なら空気側、負なら水中
function levelAt(x, y, z = 0) {
  return sN.x * x + sN.y * y + sloshZ * z - (cS + waveAt(-sN.y * x + sN.x * y));
}

function updateSlosh(dt) {
  const gx = gEff.x, gy = gEff.y, g2 = Math.hypot(gx, gy);
  if (g2 > 0.03) {
    let diff = Math.atan2(-gy, -gx) - slosh;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const k = 16 * g2;
    sloshV += (k * diff - 2 * 0.07 * Math.sqrt(k) * sloshV) * dt;
  }
  sloshV *= Math.exp(-dt * 0.3);
  slosh += sloshV * dt;
  // 奥行きは薄いので前後の傾きには素早く追従する
  const sT = THREE.MathUtils.clamp(-gEff.z / Math.max(g2, 0.05), -2.5, 2.5);
  sloshZV += (60 * (sT - sloshZ) - 2 * 0.15 * Math.sqrt(60) * sloshZV) * dt;
  sloshZ += sloshZV * dt;
  sN.set(Math.cos(slosh), Math.sin(slosh));
  cS = solveC(sN.x, sN.y);
}

function stepWaves(dt) {
  const g2 = Math.hypot(gEff.x, gEff.y);
  const du = 2 * WAVE_L / (WAVE_N - 1);
  const c2 = 0.25 * g2 + 0.02;
  // 水流が水面を持ち上げる
  for (let j = 0; j < jets.length; j++) {
    const s = jets[j].s;
    if (s < 0.01 || Math.abs(sN.y) < 0.2) continue;
    const nx = NOZZLES[j].x;
    const y = (cS - sN.x * nx) / sN.y;
    const reach = 1 / (1 + Math.max(0, y - NOZZLES[j].y) * 2);
    const uJ = -sN.y * nx + sN.x * y;
    for (let i = 0; i < WAVE_N; i++) {
      const d = (-WAVE_L + i * du - uJ) / 0.07;
      waveVel[i] += s * 2.2 * reach * Math.exp(-d * d) * dt;
    }
  }
  let mean = 0;
  for (let i = 0; i < WAVE_N; i++) {
    const l = waveData[i > 0 ? i - 1 : 1], r = waveData[i < WAVE_N - 1 ? i + 1 : WAVE_N - 2];
    waveVel[i] += (c2 * (l + r - 2 * waveData[i]) / (du * du) - 1.2 * waveVel[i]) * dt;
    mean += waveVel[i];
  }
  mean /= WAVE_N;
  for (let i = 0; i < WAVE_N; i++) {
    waveVel[i] -= mean;
    waveData[i] = THREE.MathUtils.clamp(waveData[i] + waveVel[i] * dt, -0.05, 0.05);
  }
}

// ===== 水流 =====
function flowAt(p, out) {
  out.set(0, 0, 0);
  for (let j = 0; j < jets.length; j++) {
    const s = jets[j].s;
    if (s < 0.01) continue;
    const dy = p.y - NOZZLES[j].y;
    if (dy < -0.05) continue;
    const dyc = Math.max(dy, 0);
    const width = 0.045 + 0.22 * dyc;
    const dx = p.x - NOZZLES[j].x;
    const mag = s * JET_V * Math.exp(-dx * dx / (width * width)) / (1 + dyc * 3);
    out.y += mag;
    out.x += dx / width * mag * 0.3;
  }
  // 撹拌の渦（ボタンを離してもしばらく残る）
  const A = 0.28 * stir;
  if (A > 0.001) {
    const sx = Math.sin(5 * p.x + 0.9 * time), cx = Math.cos(5 * p.x + 0.9 * time);
    const sy = Math.sin(7 * p.y - 1.3 * time), cy = Math.cos(7 * p.y - 1.3 * time);
    out.x += A * sx * cy;
    out.y -= A * (5 / 7) * cx * sy;
    out.z += A * 0.35 * Math.sin(6 * p.x + 4 * p.y + 1.7 * time);
  }
  return out;
}

// ===== 剛体 =====
const _r = new V3(), _ro = new V3(), _vp = new V3(), _t = new V3(), _rn = new V3(), _rno = new V3(), _tmp = new V3();
function resolve(b, P, N, pen, o, e = 0.15, mu = 0.3) {
  _r.subVectors(P, b.p);
  _vp.crossVectors(b.w, _r).add(b.v);
  if (o) {
    _ro.subVectors(P, o.p);
    _tmp.crossVectors(o.w, _ro).add(o.v);
    _vp.sub(_tmp);
    b.p.addScaledVector(N, pen * 0.4);
    o.p.addScaledVector(N, -pen * 0.4);
  } else {
    b.p.addScaledVector(N, pen * 0.8);
  }
  const vn = _vp.dot(N);
  if (vn >= 0) return;
  _rn.crossVectors(_r, N);
  let k = 1 + _rn.lengthSq() * INV_I;
  if (o) { _rno.crossVectors(_ro, N); k += 1 + _rno.lengthSq() * INV_I; }
  const j = -(1 + e) * vn / k;
  b.v.addScaledVector(N, j);
  b.w.addScaledVector(_rn, j * INV_I);
  if (o) { o.v.addScaledVector(N, -j); o.w.addScaledVector(_rno, -j * INV_I); }
  _t.copy(_vp).addScaledVector(N, -vn);
  const vt = _t.length();
  if (vt < 1e-5) return;
  _t.multiplyScalar(1 / vt);
  _rn.crossVectors(_r, _t);
  let kt = 1 + _rn.lengthSq() * INV_I;
  if (o) { _rno.crossVectors(_ro, _t); kt += 1 + _rno.lengthSq() * INV_I; }
  const jt = Math.min(mu * j, vt / kt);
  b.v.addScaledVector(_t, -jt);
  b.w.addScaledVector(_rn, -jt * INV_I);
  if (o) { o.v.addScaledVector(_t, jt); o.w.addScaledVector(_rno, jt * INV_I); }
}

// 方向 d に最も出っ張った輪の表面点
const _u = new V3();
function support(b, d, out) {
  _u.copy(d).addScaledVector(b.n, -d.dot(b.n));
  const l = _u.length();
  if (l < 1e-5) _u.copy(b.e1); else _u.multiplyScalar(1 / l);
  return out.copy(b.p).addScaledVector(_u, RING_R).addScaledVector(d, TUBE);
}

// 点 S（半径 rs）と輪 b の接触。N は b を押し出す向き
const _sv = new V3(), _rad = new V3(), _k = new V3(), _w = new V3();
const contactP = new V3(), contactN = new V3();
function torusContact(b, S, rs) {
  _sv.subVectors(S, b.p);
  const h = _sv.dot(b.n);
  _rad.copy(_sv).addScaledVector(b.n, -h);
  let rl = _rad.length();
  if (rl < 1e-6) { _rad.copy(b.e1); rl = 1; }
  _k.copy(b.p).addScaledVector(_rad, RING_R / rl);
  _w.subVectors(S, _k);
  const wl = _w.length();
  const dist = wl - TUBE - rs;
  if (dist >= 0 || wl < 1e-7) return 0;
  _w.multiplyScalar(1 / wl);
  contactN.copy(_w).negate();
  contactP.copy(_k).addScaledVector(_w, TUBE);
  return -dist;
}

const _flow = new V3(), _acc = new V3(), _vr = new V3(), _tau = new V3(), _sp = new V3(), _d = new V3();
const _dq = new THREE.Quaternion(), _ci = new V3();
const Z = new V3(0, 0, 1), X = new V3(1, 0, 0), Y = new V3(0, 1, 0);

function updateFrames(r) {
  r.n.copy(Z).applyQuaternion(r.q);
  r.e1.copy(X).applyQuaternion(r.q);
  r.e2.copy(Y).applyQuaternion(r.q);
}

function stepRings(dt) {
  for (const r of rings) {
    updateFrames(r);
    const lvl = levelAt(r.p.x, r.p.y, r.p.z);
    const sub = THREE.MathUtils.smoothstep(-lvl, -RING_R, RING_R);
    r.sub = sub;
    flowAt(r.p, _flow).multiplyScalar(sub);
    _acc.copy(gEff).multiplyScalar(G * (1 - BUOY * sub));
    const kd = sub * 3.0 + 0.3;
    r.v.addScaledVector(_acc, dt);
    _vr.subVectors(_flow, r.v);
    r.v.addScaledVector(_vr, Math.min(1, kd * dt));

    // 水中では進行方向に対して面を向けて（平らになって）沈みやすい
    _vr.subVectors(r.v, _flow);
    const sp = _vr.length();
    if (sp > 1e-3 && sub > 0) {
      _vr.multiplyScalar(1 / sp);
      const s = r.n.dot(_vr);
      _tau.crossVectors(r.n, _vr).multiplyScalar(s * sp * sp * 60 * sub);
      r.w.addScaledVector(_tau, dt);
    }
    // 乱流によるくるくる回転
    const turb = (jets[0].s + jets[1].s) * 0.5 + stir * 0.3;
    if (turb > 0.01 && sub > 0) {
      const a = turb * 25 * sub * Math.sqrt(dt);
      r.w.x += (Math.random() - 0.5) * a;
      r.w.y += (Math.random() - 0.5) * a;
      r.w.z += (Math.random() - 0.5) * a;
    }
    r.w.multiplyScalar(Math.exp(-dt * (sub * 2.5 + 0.2)));

    if (r.v.lengthSq() > 9) r.v.setLength(3);
    if (r.w.lengthSq() > 900) r.w.setLength(30);
    r.p.addScaledVector(r.v, dt);
    _dq.set(r.w.x * dt * 0.5, r.w.y * dt * 0.5, r.w.z * dt * 0.5, 0).multiply(r.q);
    r.q.set(r.q.x + _dq.x, r.q.y + _dq.y, r.q.z + _dq.z, r.q.w + _dq.w).normalize();
    updateFrames(r);
  }

  for (const r of rings) {
    const contactE = 0.1 + 0.3 * (1 - r.sub);
    for (const pl of wallPlanes) {
      _d.copy(pl.n).negate();
      support(r, _d, _sp);
      const pen = pl.o - pl.n.dot(_sp);
      if (pen > 0) resolve(r, _sp, pl.n, pen, null, contactE);
    }
    for (const pl of floorPlanes) {
      _d.copy(pl.n).negate();
      support(r, _d, _sp);
      if (_sp.x < pl.x0 || _sp.x > pl.x1) continue;
      const pen = pl.o - pl.n.dot(_sp);
      if (pen > 0) resolve(r, _sp, pl.n, pen, null, contactE);
    }
    for (let i = 0; i < PEGS.length; i++) {
      const pg = PEGS[i];
      if (Math.abs(r.p.x - pg.x) > RING_R + TUBE + COLLAR_R) continue;
      if (r.p.y < pg.base - 0.12 || r.p.y > pg.tip + 0.1) continue;
      for (const s of pegSamples[i]) {
        const pen = torusContact(r, s.p, s.r);
        if (pen > 0) resolve(r, contactP, contactN, pen * 0.6, null, 0.1, 0.15);
      }
    }
  }

  for (let a = 0; a < rings.length; a++) {
    for (let b = a + 1; b < rings.length; b++) {
      const A = rings[a], B = rings[b];
      if (A.p.distanceToSquared(B.p) > 4 * (RING_R + TUBE) ** 2) continue;
      for (const [P, Q] of [[A, B], [B, A]]) {
        for (let k = 0; k < 16; k++) {
          const ang = k / 16 * Math.PI * 2;
          _ci.copy(P.p).addScaledVector(P.e1, Math.cos(ang) * RING_R).addScaledVector(P.e2, Math.sin(ang) * RING_R);
          const pen = torusContact(Q, _ci, TUBE);
          if (pen > 0) resolve(Q, contactP, contactN, pen * 0.5, P, 0.1, 0.2);
        }
      }
    }
  }

  for (const r of rings) {
    r.p.x = THREE.MathUtils.clamp(r.p.x, -HX + TUBE, HX - TUBE);
    r.p.y = THREE.MathUtils.clamp(r.p.y, -HY + TUBE, HY - TUBE);
    r.p.z = THREE.MathUtils.clamp(r.p.z, -HZ + TUBE, HZ - TUBE);
  }
}

// 輪の穴を棒が貫いているか
function hookedPeg(r) {
  if (Math.abs(r.n.y) < 0.2) return -1;
  for (let i = 0; i < PEGS.length; i++) {
    const pg = PEGS[i];
    const y = r.p.y - (r.n.x * (pg.x - r.p.x) - r.n.z * r.p.z) / r.n.y;
    if (y < pg.base - 0.02 || y > pg.tip) continue;
    if (Math.hypot(pg.x - r.p.x, y - r.p.y, r.p.z) < R_IN) return i;
  }
  return -1;
}

// ===== 泡 =====
const _bp = new V3(), _bf = new V3(), _up = new V3();
function updateBubbles(dt) {
  for (let j = 0; j < jets.length; j++) {
    const n = jets[j].s * 140 * dt;
    let count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    while (count-- > 0 && bubbleCount < MAX_BUBBLES) {
      const i = bubbleCount++;
      bubblePos[i * 3] = NOZZLES[j].x + (Math.random() - 0.5) * 0.04;
      bubblePos[i * 3 + 1] = NOZZLES[j].y + 0.02;
      bubblePos[i * 3 + 2] = (Math.random() - 0.5) * (D - 0.03);
      bubbleVel[i * 3] = bubbleVel[i * 3 + 1] = bubbleVel[i * 3 + 2] = 0;
      bubbleLife[i] = 0;
    }
  }
  _up.copy(gEff).negate();
  if (_up.lengthSq() < 0.01) _up.set(0, 1, 0); else _up.normalize();
  for (let i = 0; i < bubbleCount; i++) {
    _bp.fromArray(bubblePos, i * 3);
    flowAt(_bp, _bf).multiplyScalar(0.8).addScaledVector(_up, 0.45);
    const k = Math.min(1, dt * 8);
    for (let c = 0; c < 3; c++) bubbleVel[i * 3 + c] += ((c === 0 ? _bf.x : c === 1 ? _bf.y : _bf.z) - bubbleVel[i * 3 + c]) * k;
    bubbleLife[i] += dt;
    _bp.x += (bubbleVel[i * 3] + Math.sin(bubbleLife[i] * 17 + i) * 0.08) * dt;
    _bp.y += bubbleVel[i * 3 + 1] * dt;
    _bp.z += bubbleVel[i * 3 + 2] * dt;
    _bp.x = THREE.MathUtils.clamp(_bp.x, -HX + 0.005, HX - 0.005);
    _bp.y = THREE.MathUtils.clamp(_bp.y, -HY + 0.005, HY - 0.005);
    _bp.z = THREE.MathUtils.clamp(_bp.z, -HZ + 0.005, HZ - 0.005);
    if (levelAt(_bp.x, _bp.y, _bp.z) > -0.005 || bubbleLife[i] > 5) {
      const last = --bubbleCount;
      for (let c = 0; c < 3; c++) {
        bubblePos[i * 3 + c] = bubblePos[last * 3 + c];
        bubbleVel[i * 3 + c] = bubbleVel[last * 3 + c];
      }
      bubbleLife[i] = bubbleLife[last];
      i--;
      continue;
    }
    _bp.toArray(bubblePos, i * 3);
  }
  bubbleGeo.setDrawRange(0, bubbleCount);
  bubbleGeo.attributes.position.needsUpdate = true;
}

// ===== 入力の反映 =====
function updateInput(dt) {
  if (sensor.has && sensor.raw.lengthSq() > 0.25) {
    const len = sensor.raw.length();
    if (sensor.hasOrient) {
      const d = sensor.raw.dot(sensor.orient) / len;
      sensor.signAcc += (d - sensor.signAcc) * 0.02;
    }
    const s = (sensor.signAcc >= 0 ? 1 : -1) / 9.81;
    const a = screenAngle(), c = Math.cos(a), sn = Math.sin(a);
    const x = sensor.raw.x * s, y = sensor.raw.y * s;
    gTarget.set(x * c - y * sn, x * sn + y * c, sensor.raw.z * s);
    if (gTarget.length() > 2.5) gTarget.setLength(2.5);
    tank.rotation.z = 0;
  } else {
    let t = tiltTarget;
    if (keys.ArrowLeft) t = 0.6;
    if (keys.ArrowRight) t = -0.6;
    tilt += (t - tilt) * (1 - Math.exp(-dt * 6));
    tank.rotation.z = tilt;
    gTarget.set(-Math.sin(tilt), -Math.cos(tilt), 0);
  }
  if (shakeT > 0) {
    gTarget.x += Math.sin(time * 38) * 1.6 * shakeT * 2;
    shakeT -= dt;
  }
  gEff.lerp(gTarget, 1 - Math.exp(-dt * 30));

  let pump = 0;
  for (const j of jets) {
    j.held += dt;
    const target = j.pressed ? 0.3 + 0.9 * Math.exp(-j.held / 0.5) : 0;
    j.s += (target - j.s) * (1 - Math.exp(-dt * (j.pressed ? 14 : 4)));
    pump = Math.max(pump, j.s);
  }
  stir = Math.min(1.5, (stir + (jets[0].s + jets[1].s) * dt * 2) * Math.exp(-dt / 1.2));
  audio.pump(pump);
  pushButtons.forEach((b, i) => { b.position.z = jets[i].pressed ? BTN_Z_DOWN : BTN_Z_UP; });
}

// ===== ゲーム進行 =====
const scoreEl = document.getElementById('score');
const timeEl = document.getElementById('time');
const sensorEl = document.getElementById('sensor');
const clearEl = document.getElementById('clear');

function updateGame(dt) {
  let hooked = 0;
  for (const r of rings) {
    r.peg = hookedPeg(r);
    if (r.peg >= 0) hooked++;
  }
  if (playing && hooked > lastHooked) {
    audio.clink();
    navigator.vibrate?.(20);
  }
  lastHooked = hooked;
  scoreEl.textContent = `輪 ${hooked} / ${RING_COUNT}`;
  if (playing) {
    playTime += dt;
    timeEl.textContent = `${playTime.toFixed(1)} 秒`;
    allHookedT = hooked === RING_COUNT ? allHookedT + dt : 0;
    if (allHookedT > 1.2) {
      playing = false;
      const best = Math.min(Number(localStorage.getItem('aquaRingBest') || Infinity), playTime);
      localStorage.setItem('aquaRingBest', best);
      document.getElementById('clearMsg').textContent = `タイム ${playTime.toFixed(1)} 秒（ベスト ${best.toFixed(1)} 秒）`;
      clearEl.classList.remove('hidden');
    }
  }
  sensorEl.textContent = sensor.has ? '傾きセンサー ON' : '';
}

function syncVisuals() {
  for (const r of rings) {
    r.mesh.position.copy(r.p);
    r.mesh.quaternion.copy(r.q);
  }
  waterUniforms.uN.value.copy(sN);
  waterUniforms.uC.value = cS;
  waterUniforms.uS.value = sloshZ;
  waterUniforms.uStir.value = Math.min(1, stir * 0.6 + jets[0].s + jets[1].s);
  waterUniforms.uTime.value = time;
}

function startGame() {
  scatterRings();
  playTime = 0;
  allHookedT = 0;
  lastHooked = 0;
  playing = true;
  clearEl.classList.add('hidden');
}

document.getElementById('startBtn').addEventListener('click', async () => {
  audio.resume();
  await requestSensors();
  document.getElementById('start').classList.add('hidden');
  startGame();
});
document.getElementById('againBtn').addEventListener('click', startGame);
document.getElementById('reset').addEventListener('click', startGame);

// ===== 背景（3Dの中に描くので水越しに屈折して見える） =====
const bg = { tex: null, w: 1, h: 1, mirror: false, stream: null, video: null, facing: 'environment' };
const bgMsg = document.getElementById('bgMsg');

function fitBackground() {
  const t = bg.tex;
  if (!t) return;
  const a = innerWidth / innerHeight, ia = bg.w / bg.h;
  let rx = 1, ry = 1;
  if (ia > a) rx = a / ia; else ry = ia / a;
  t.repeat.set(bg.mirror ? -rx : rx, ry);
  t.offset.set(bg.mirror ? (1 + rx) / 2 : (1 - rx) / 2, (1 - ry) / 2);
}
function setBgTexture(tex, w, h, mirror = false) {
  if (bg.tex && bg.tex !== tex) bg.tex.dispose();
  tex.colorSpace = THREE.SRGBColorSpace;
  Object.assign(bg, { tex, w, h, mirror });
  scene.background = tex;
  fitBackground();
}
function stopCamera() {
  bg.stream?.getTracks().forEach(t => t.stop());
  bg.stream = null;
}
function saveBg(v) { localStorage.setItem('aquaRingBg', JSON.stringify(v)); }

function bgGradient() {
  stopCamera();
  const c = document.createElement('canvas');
  c.width = 512; c.height = 1024;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(256, 300, 20, 256, 420, 760);
  g.addColorStop(0, '#fdf6ea');
  g.addColorStop(0.6, '#e7dccb');
  g.addColorStop(1, '#cdbfa8');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 1024);
  setBgTexture(new THREE.CanvasTexture(c), 512, 1024);
  saveBg({ type: 'gradient' });
}
function bgColor(hex) {
  stopCamera();
  bg.tex?.dispose();
  bg.tex = null;
  scene.background = new THREE.Color(hex);
  saveBg({ type: 'color', color: hex });
}
function bgPhoto(file) {
  stopCamera();
  const url = URL.createObjectURL(file);
  new THREE.TextureLoader().load(url, tex => {
    setBgTexture(tex, tex.image.width, tex.image.height);
    URL.revokeObjectURL(url);
  });
}
async function bgCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    bgMsg.textContent = 'カメラは https のページで使えます';
    return;
  }
  stopCamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: bg.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    bg.stream = stream;
    if (!bg.video) {
      bg.video = document.createElement('video');
      bg.video.muted = true;
      bg.video.playsInline = true;
      bg.video.setAttribute('playsinline', '');
      bg.video.addEventListener('resize', () => {
        bg.w = bg.video.videoWidth || bg.w;
        bg.h = bg.video.videoHeight || bg.h;
        fitBackground();
      });
    }
    bg.video.srcObject = stream;
    await bg.video.play();
    setBgTexture(new THREE.VideoTexture(bg.video), bg.video.videoWidth || 16, bg.video.videoHeight || 9, bg.facing === 'user');
    bgMsg.textContent = '';
  } catch (err) {
    console.warn('camera', err);
    bgMsg.textContent = 'カメラを使えませんでした';
  }
}

const bgPanel = document.getElementById('bgPanel');
const bgFile = document.getElementById('bgFile');
document.getElementById('bgBtn').addEventListener('click', () => bgPanel.classList.toggle('hidden'));
bgPanel.addEventListener('click', e => {
  const kind = e.target.closest('[data-bg]')?.dataset.bg;
  if (kind === 'gradient') bgGradient();
  if (kind === 'photo') bgFile.click();
  if (kind === 'camera') bgCamera();
  if (kind === 'flip') { bg.facing = bg.facing === 'environment' ? 'user' : 'environment'; bgCamera(); }
  if (kind === 'close') bgPanel.classList.add('hidden');
  if (kind === 'refr') setRefraction((refrMode + 1) % REFR_MODES.length);
});
// 屈折の強さ（uRefr: 0 = リアル、1 = 派手）
const REFR_MODES = [{ name: 'リアル', v: 0 }, { name: 'ほどほど', v: 0.35 }, { name: '派手', v: 1 }];
let refrMode = 0;
function setRefraction(i) {
  refrMode = i;
  waterUniforms.uRefr.value = REFR_MODES[i].v;
  document.getElementById('refrBtn').textContent = `屈折: ${REFR_MODES[i].name}`;
  localStorage.setItem('aquaRingRefrMode', i);
}
setRefraction(Number(localStorage.getItem('aquaRingRefrMode') ?? 0) % REFR_MODES.length || 0);
document.getElementById('bgColor').addEventListener('input', e => bgColor(e.target.value));
bgFile.addEventListener('change', () => { if (bgFile.files[0]) bgPhoto(bgFile.files[0]); bgFile.value = ''; });

{
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('aquaRingBg')); } catch { }
  if (saved?.type === 'color') {
    bgColor(saved.color);
    document.getElementById('bgColor').value = saved.color;
  } else {
    bgGradient();
  }
}

// ===== 画面 =====
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  const dpr = renderer.getPixelRatio();
  sceneRT.setSize(Math.round(w * dpr), Math.round(h * dpr));
  fitBackground();
  camera.aspect = w / h;
  const portrait = w < h;
  // 下側はボタン用に空ける
  const viewH = 1.75 / (portrait ? 0.78 : 0.92);
  const t = Math.tan(camera.fov * DEG / 2);
  const dist = Math.max(viewH / (2 * t), 1.35 / (2 * t * camera.aspect)) + 0.3;
  const cy = -0.12 - (portrait ? viewH * 0.1 : 0.05);
  camera.position.set(0, cy + 0.35, dist);
  camera.lookAt(0, cy, 0);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 1回目: 水とガラスを除いた画面（屈折の元）、2回目: 全部
function render() {
  camera.updateMatrixWorld();
  waterUniforms.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  water.visible = surface.visible = glass.visible = false;
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  water.visible = surface.visible = glass.visible = true;
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
}

scatterRings();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  time += dt;
  updateInput(dt);
  updateSlosh(dt);
  const h = dt / SUBSTEPS;
  for (let s = 0; s < SUBSTEPS; s++) {
    stepWaves(h);
    stepRings(h);
  }
  updateBubbles(dt);
  updateGame(dt);
  syncVisuals();
  render();
}
requestAnimationFrame(frame);
