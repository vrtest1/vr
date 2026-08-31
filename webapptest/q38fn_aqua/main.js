import * as THREE from 'three';

// ---------------------------------------------------------------
// 水槽パラメータ  (x: 幅250m / z: 奥行120m / y: 水深50m)
// ---------------------------------------------------------------
const HALF_W = 125, HALF_D = 60, SURF = 25, FLOOR = -25;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const waterColor = new THREE.Color(0x0b3552);
scene.background = waterColor.clone();
scene.fog = new THREE.FogExp2(waterColor.getHex(), 0.0075);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 800);
camera.position.set(0, 0, 52);
camera.rotation.order = 'YXZ';

// 共有時間uniform
const uTime = { value: 0 };

// ---------------------------------------------------------------
// ライティング
// ---------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0x9fd4ff, 0x0a2436, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xbfe6ff, 1.6);
sun.position.set(50, 90, 25);
sun.target.position.set(0, FLOOR, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 250;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

// ---------------------------------------------------------------
// 海面 (上から見た水面 / 下から見た水面)
// ---------------------------------------------------------------
{
  const g = new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2, 64, 32);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 0.15) * Math.cos(pos.getY(i) * 0.2) * 0.6);
  const m = new THREE.MeshStandardMaterial({ color: 0x3f9fd6, roughness: 0.15, metalness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const surf = new THREE.Mesh(g, m);
  surf.rotation.x = -Math.PI / 2;
  surf.position.y = SURF;
  scene.add(surf);
}

// ---------------------------------------------------------------
// 砂地 (プロシージャルテクスチャ + コースティクス)
// ---------------------------------------------------------------
function sandTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#b3a17a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const l = 150 + Math.random() * 70;
    g.fillStyle = `hsl(${38 + Math.random() * 8}, ${28 + Math.random() * 14}%, ${l * 0.33}%)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  // 波状の砂紋
  g.globalAlpha = 0.12;
  for (let y = 0; y < 512; y += 26) {
    g.strokeStyle = Math.random() < 0.5 ? '#8a7a55' : '#d8c9a0';
    g.lineWidth = 3 + Math.random() * 5;
    g.beginPath();
    for (let x = 0; x <= 512; x += 8) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const floorMat = new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 0.95, metalness: 0 });
floorMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = uTime;
  sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uTime; varying vec3 vWPos;
float caustFn(vec2 p, float t){
  vec2 i = p; vec2 c = i; float a = 0.5;
  for(int k=0;k<4;k++){
    c = vec2(1.4*sin(c.y*1.7+t)+cos(c.x*1.3-t*1.2)+i.x,
             1.4*sin(c.x*1.5-t*0.8)+cos(c.y*1.8+t)+i.y);
    a *= 0.62;
  }
  return pow(max(sin(c.x)+sin(c.y),0.0)*0.5,3.0)*a*6.0;
}`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  float _caust = caustFn(vWPos.xz*0.10, uTime*0.25);
  gl_FragColor.rgb += vec3(0.16,0.30,0.34)*_caust;`);
};
{
  const g = new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2, 120, 60);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++)
    pos.setY(i, Math.sin(pos.getX(i) * 0.05) * Math.cos(pos.getZ(i) * 0.06) * 1.2 + Math.sin(pos.getX(i) * 0.3) * 0.2);
  g.computeVertexNormals();
  const floor = new THREE.Mesh(g, floorMat);
  floor.position.y = FLOOR;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ---------------------------------------------------------------
// 岩礁・巨大岩
// ---------------------------------------------------------------
function rockGeometry(seed) {
  const g = weldGeometry(new THREE.IcosahedronGeometry(1, 3));
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 0.62 + 0.38 * Math.abs(Math.sin(v.x * 3.1 + seed) * Math.cos(v.y * 2.3 + seed) * Math.sin(v.z * 2.7 + seed * 1.3));
    const lerp = 0.75 + 0.25 * hash3(v.x + seed, v.y - seed, v.z + seed * 1.3);
    v.multiplyScalar((n * 0.6 + lerp * 0.4));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
{
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4c5a5f, roughness: 0.95, metalness: 0, flatShading: true });
  const geos = [];
  for (let i = 0; i < 6; i++) geos.push(rockGeometry(i * 977 + 13));
  const rng = mulberry(7);
  // 大きな岩
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(geos[i % geos.length], rockMat);
    const s = 5 + rng() * 7;
    m.scale.set(s, s * (0.55 + rng() * 0.35), s * (0.8 + rng() * 0.4));
    m.position.set((rng() * 2 - 1) * (HALF_W - 20), FLOOR + m.scale.y * 0.28, (rng() * 2 - 1) * (HALF_D - 12));
    m.rotation.y = rng() * 6.28;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  // 岩礁の群れ
  for (let i = 0; i < 46; i++) {
    const m = new THREE.Mesh(geos[i % geos.length], rockMat);
    const s = 1.2 + rng() * 3.2;
    m.scale.set(s, s * (0.5 + rng() * 0.4), s);
    m.position.set((rng() * 2 - 1) * (HALF_W - 8), FLOOR + s * 0.22, (rng() * 2 - 1) * (HALF_D - 6));
    m.rotation.set(rng(), rng() * 6.28, rng());
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
}
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------
// 光のShaft (水中の光芒)
// ---------------------------------------------------------------
{
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){
        float side = 1.0-abs(vUv.x-0.5)*2.0;
        side = pow(side, 2.2);
        float fall = pow(vUv.y, 1.5);
        float shimmer = 0.72+0.28*sin(uTime*0.45+vUv.x*9.0+sin(uTime*0.2)*2.0);
        float fogF = exp(-pow(0.0075*30.0,2.0));
        float a = side*fall*shimmer*0.16;
        gl_FragColor = vec4(vec3(0.55,0.8,0.95)*a, a);
      }`
  });
  const rng = mulberry(31);
  for (let i = 0; i < 14; i++) {
    const grp = new THREE.Group();
    const w = 10 + rng() * 14, h = 55;
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p2.rotation.y = Math.PI / 2;
    grp.add(p1, p2);
    grp.position.set((rng() * 2 - 1) * 100, SURF - h / 2 + 3, (rng() * 2 - 1) * 45);
    grp.rotation.z = (rng() - 0.5) * 0.18;
    grp.rotation.y = rng() * 6.28;
    scene.add(grp);
  }
}

// ---------------------------------------------------------------
// 微粒子
// ---------------------------------------------------------------
{
  const N = 5000;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  const rng = mulberry(99);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rng() * 2 - 1) * HALF_W;
    pos[i * 3 + 1] = FLOOR + rng() * (SURF - FLOOR);
    pos[i * 3 + 2] = (rng() * 2 - 1) * HALF_D;
    seed[i] = rng() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.PointsMaterial({ color: 0xaad0ea, size: 0.16, transparent: true, opacity: 0.4, depthWrite: false, sizeAttenuation: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime; attribute float aSeed;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       transformed.y += sin(uTime*0.15+aSeed)*1.5 + mod(uTime*0.25+aSeed,1.0)*0.5;
       transformed.x += sin(uTime*0.1+aSeed*2.0)*1.0;`);
  };
  scene.add(new THREE.Points(g, m));
}

// ---------------------------------------------------------------
// 魚用ユーティリティ
// ---------------------------------------------------------------
// 同一位置の頂点を溶接し indexed geometry にする (watertight 化)
function weldGeometry(g, tol = 1e-5) {
  const p = g.attributes.position;
  const uv = g.attributes.uv, col = g.attributes.color;
  const src = g.index ? g.index.array : null;
  const inv = 1 / tol;
  const n = src ? src.length : p.count;
  const map = new Map(), np = [], nuv = [], ncol = [];
  const remap = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const i = src ? src[k] : k;
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = Math.round(x * inv) + ',' + Math.round(y * inv) + ',' + Math.round(z * inv);
    let j = map.get(key);
    if (j === undefined) {
      j = np.length / 3; map.set(key, j);
      np.push(x, y, z);
      if (uv) nuv.push(uv.getX(i), uv.getY(i));
      if (col) ncol.push(col.getX(i), col.getY(i), col.getZ(i));
    }
    remap[k] = j;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(nuv, 2));
  if (col) out.setAttribute('color', new THREE.Float32BufferAttribute(ncol, 3));
  out.setIndex(Array.from(remap));
  out.computeVertexNormals();
  return out;
}
// 位置から決定的な疑似乱数 (共有頂点で必ず同じ値になる)
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + 1.7) * 43758.5453;
  return s - Math.floor(s);
}
function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
function interp(keys, t) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a0, b0] = keys[i - 1], [t1, a1, b1] = keys[i];
      const u = THREE.MathUtils.smoothstep(t, t0, t1);
      return [a0 + (a1 - a0) * u, b0 + (b1 - b0) * u];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2]];
}
// 断面が楕円の紡錘形ボディ (前方=+z)
function bodyGeometry(keys, L, radial = 22, along = 56) {
  const g = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= along; i++) {
    const t = i / along, z = (0.5 - t) * L;
    const [w, h] = interp(keys, t);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      pos.push(Math.sin(a) * w, Math.cos(a) * h, z);
      uv.push(j / radial, t);
    }
  }
  const R = radial + 1;
  for (let i = 0; i < along; i++) for (let j = 0; j < radial; j++) {
    const a = i * R + j, b = a + R;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // 鼻先・尾の付け根のキャップ
  const nose = pos.length / 3; pos.push(0, keys[0][1] * 0.3, (0.5 + 0.06) * L); uv.push(.5, 0);
  for (let j = 0; j < radial; j++) idx.push(nose, j + 1, j);
  const tail = pos.length / 3; const last = along * R; pos.push(0, 0, -0.52 * L); uv.push(.5, 1);
  for (let j = 0; j < radial; j++) idx.push(last + j, last + j + 1, tail);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return weldGeometry(g);
}
// 平びれを閉じた薄いソリッドとして生成 (z=後方=-z)
function finGeometry(points, rot, th = 0.05) { // points: Shape の [x,y]、y>0 が後方
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: false, curveSegments: 2 });
  g.translate(0, 0, -th / 2);
  if (rot === 'vert') g.rotateY(-Math.PI / 2);       // 垂直尾びれ: (x,y)->(0,y,x)
  else g.rotateX(-Math.PI / 2);                       // 水平びれ : (x,y)->(x,0,-y)
  return weldGeometry(g);
}
function mirrorX(g) {
  g.scale(-1, 1, 1);
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}
function swimMaterial(opts) {
  const m = new THREE.MeshStandardMaterial({
    color: opts.color, vertexColors: !!opts.vertexColors, map: opts.map || null,
    roughness: opts.rough ?? 0.62, metalness: opts.metal ?? 0.05, side: opts.side || THREE.FrontSide
  });
  const uniforms = {
    uLen: { value: opts.len }, uAmp: { value: opts.sway ?? 0 }, uFreq: { value: opts.freq ?? 1 },
    uK: { value: opts.k ?? 4 }, uPhase: { value: Math.random() * 10 },
    uSpan: { value: opts.span ?? 1 }, uFlap: { value: opts.flap ?? 0 }, uFreqF: { value: opts.freqF ?? 1 }
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `uniform float uTime,uLen,uAmp,uFreq,uK,uPhase,uSpan,uFlap,uFreqF;\n` + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float _s = clamp((uLen*0.5 - position.z)/uLen, 0.0, 1.0);
       transformed.x += sin(uTime*uFreq + uPhase - position.z*uK) * uAmp * pow(_s,1.7);
       float _w = clamp(abs(position.x)/uSpan, 0.0, 1.0);
       transformed.y += sin(uTime*uFreqF + uPhase + _w*2.4) * uFlap * pow(_w,1.5);`);
  };
  return m;
}
function gradientColors(geo, top, bottom) {
  const p = geo.attributes.position, c = [];
  let maxH = 1e-6; for (let i = 0; i < p.count; i++) maxH = Math.max(maxH, Math.abs(p.getY(i)));
  const a = new THREE.Color(top), b = new THREE.Color(bottom), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp(p.getY(i) / maxH * 0.5 + 0.5, 0, 1);
    tmp.copy(b).lerp(a, t); c.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
}
function addMesh(grp, geo, mat, label) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; if (label) m.userData.label = label; grp.add(m); return m; }

// ---------------------------------------------------------------
// ジンベエザメ
// ---------------------------------------------------------------
function whaleSharkSpotsTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3a4b57'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 200; i++) {
    const y = Math.random() * 150;
    g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.4})`;
    g.beginPath(); g.ellipse(Math.random() * 512, y, 2 + Math.random() * 3.5, 1.5 + Math.random() * 2.5, 0, 0, 6.29); g.fill();
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.15})`;
    g.fillRect(Math.random() * 512, Math.random() * 140, 30 + Math.random() * 80, 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
class WhaleShark {
  constructor() {
    const L = 11;
    const keys = [[0, .30, .22], [.03, .85, .58], [.09, 1.35, .95], [.2, 1.6, 1.15], [.35, 1.42, 1.0], [.5, 1.1, .86], [.65, .78, .66], [.8, .42, .44], [.92, .24, .26], [1, .15, .16]];
    const mat = swimMaterial({ color: 0xffffff, map: whaleSharkSpotsTexture(), len: L, sway: 0.55, freq: 1.6, k: 0.9, rough: 0.7 });
    const matF = swimMaterial({ color: 0x33434f, len: L, sway: 0.55, freq: 1.6, k: 0.9, side: THREE.DoubleSide });
    const grp = new THREE.Group();
    addMesh(grp, bodyGeometry(keys, L), mat, 'whale.body');
    // 尾びれ (上葉が大きい異形尾)
    let fg = finGeometry([[.2, .35], [-.7, 1.9], [-1.5, 1.35], [-1.6, 1.05], [-.45, 0], [-1.0, -1.0], [-1.15, -1.35], [.05, -.3]], 'vert');
    fg.translate(0, 0.15, -L / 2 - 0.1);
    addMesh(grp, fg, matF, 'whale.tail');
    // 第一背びれ
    fg = finGeometry([[.5, .1], [-.7, .05], [-1.35, 1.05], [-.1, .18]], 'vert');
    fg.translate(0, 0.9, L * 0.06);
    addMesh(grp, fg, matF, 'whale.dorsal1');
    // 第二背びれ
    fg = finGeometry([[.35, .05], [-.35, .0], [-.6, .5], [0, .1]], 'vert');
    fg.translate(0, 0.62, -L * 0.16);
    addMesh(grp, fg, matF, 'whale.dorsal2');
    // 胸びれ
    for (const s of [1, -1]) {
      fg = finGeometry([[0, .5], [.15, 1.6], [1.9, 2.3], [2.4, 1.6], [.6, .3]], 'horiz');
      if (s < 0) mirrorX(fg);
      fg.translate(s * 1.25, -0.55, L * 0.3);
      addMesh(grp, fg, matF, 'whale.pectoral' + s);
    }
    // 腹びれ
    for (const s of [1, -1]) {
      fg = finGeometry([[0, .3], [.1, 1.0], [1.0, 1.3], [1.15, .8], [.4, .2]], 'horiz');
      if (s < 0) mirrorX(fg);
      fg.translate(s * .6, -0.8, -L * 0.08);
      addMesh(grp, fg, matF, 'whale.pelvic' + s);
    }
    scene.add(grp);
    this.grp = grp; this.L = L;
    this.pos = new THREE.Vector3((Math.random() * 2 - 1) * 80, -8 + Math.random() * 12, (Math.random() * 2 - 1) * 35);
    this.heading = Math.random() * 6.28;
    this.speed = 1.9 + Math.random() * 0.5;
    this.turnMax = 0.085;
    this.target = this.newTarget();
  }
  newTarget() {
    return new THREE.Vector3((Math.random() * 2 - 1) * 80, -16 + Math.random() * 22, (Math.random() * 2 - 1) * 28);
  }
  update(dt, others) {
    if (this.pos.distanceTo(this.target) < 25) this.target = this.newTarget();
    const desired = new THREE.Vector3().subVectors(this.target, this.pos);
    // 水槽境界接近時に内側へ誘導(マグロと同じ趣旨の境界反発)。壁に擦り付いて止まるのを防ぐ
    const margin = 30, push = 3;
    let nearWall = false;
    if (this.pos.x > HALF_W - margin) { desired.x -= (this.pos.x - (HALF_W - margin)) * push; nearWall = true; }
    if (this.pos.x < -HALF_W + margin) { desired.x += ((-HALF_W + margin) - this.pos.x) * push; nearWall = true; }
    if (this.pos.z > HALF_D - margin) { desired.z -= (this.pos.z - (HALF_D - margin)) * push; nearWall = true; }
    if (this.pos.z < -HALF_D + margin) { desired.z += ((-HALF_D + margin) - this.pos.z) * push; nearWall = true; }
    let cur = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const flat = new THREE.Vector3(desired.x, 0, desired.z).normalize();
    let ang = Math.atan2(cur.x * flat.z - cur.z * flat.x, cur.x * flat.x + cur.z * flat.z);
    const turn = nearWall ? this.turnMax * 3 : this.turnMax;
    ang = THREE.MathUtils.clamp(ang, -turn * dt, turn * dt);
    this.heading += ang;
    // 他個体と接近したら回避
    for (const o of others) {
      const d = this.pos.distanceTo(o.pos);
      if (d < 26 && d > 1e-3) this.heading -= Math.sign(ang || 1) * dt * 0.35;
    }
    cur = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.pos.addScaledVector(cur, this.speed * dt);
    this.pos.y += THREE.MathUtils.clamp(this.target.y - this.pos.y, -0.6 * dt, 0.6 * dt) * 2;
    this.clamp();
    const pitch = THREE.MathUtils.clamp((this.target.y - this.pos.y) * 0.05, -0.3, 0.3);
    this.grp.position.copy(this.pos);
    this.grp.rotation.set(-pitch, this.heading, 0);
  }
  clamp() {
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + 12, HALF_W - 12);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -HALF_D + 12, HALF_D - 12);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, FLOOR + 4, SURF - 3);
  }
}

// ---------------------------------------------------------------
// マンタ (オニイトマキエイ)
// ---------------------------------------------------------------
class Manta {
  constructor() {
    const span = 3.8, chord = 4.6;
    let g = new THREE.SphereGeometry(1, 48, 28);
    const p = g.attributes.position;
    const col = [];
    const top = new THREE.Color(0x232d35), bot = new THREE.Color(0xdfe6e9), tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i); // 単位球
      z *= chord / 2;
      const q = THREE.MathUtils.clamp(z / (chord / 2), -1, 1);
      const f = Math.max(0.04, Math.pow(Math.max(0, 1 - Math.pow(Math.abs(q - 0.12), 1.55)), 0.72)); // 前寄りのひし形 (後端は完全潰さない)
      x *= span * f;
      y = y * (0.5 + 0.6 * (1 - Math.min(1, Math.abs(x) / (span * 0.9)))) * (0.55 + 0.45 * (1 - q * q)) * 0.5 + y * 0.05;
      p.setXYZ(i, x, y, z);
      const k = THREE.MathUtils.smoothstep(y, -0.06, 0.06);
      const shade = tmp.copy(bot).lerp(top, k);
      col.push(shade.r, shade.g, shade.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g = weldGeometry(g);
    const mat = swimMaterial({ color: 0xffffff, vertexColors: true, len: chord, span, flap: 1.0, freqF: 1.7, sway: 0.1, freq: 1.1, k: 1.2, rough: 0.55 });
    const matF = swimMaterial({ color: 0x2a343c, len: chord, span, flap: 1.0, freqF: 1.7, side: THREE.DoubleSide, rough: 0.6 });
    const grp = new THREE.Group();
    addMesh(grp, g, mat, 'manta.body');
    // 頭鰭 (cephalic horns)
    for (const s of [1, -1]) {
      const horn = weldGeometry(new THREE.CylinderGeometry(0.05, 0.22, 1.1, 10));
      horn.rotateX(Math.PI / 2.4);
      horn.translate(s * 1.05, -0.12, chord * 0.42);
      addMesh(grp, horn, matF, 'manta.horn' + s);
    }
    // 尾
    const tail = weldGeometry(new THREE.CylinderGeometry(0.02, 0.09, 5.5, 8));
    tail.rotateX(Math.PI / 2);
    tail.translate(0, 0.05, -chord / 2 - 2.6);
    addMesh(grp, tail, matF, 'manta.tail');
    scene.add(grp);
    this.grp = grp;
    this.pos = new THREE.Vector3((Math.random() * 2 - 1) * 90, -2 + Math.random() * 10, (Math.random() * 2 - 1) * 40);
    this.heading = wrapAngle(Math.random() * 6.28);
    this.speed = 2.6 + Math.random() * 0.9;
    this.turnMax = 0.3;
    this.bobPhase = Math.random() * 6.28;
    this.target = this.newTarget();
    // 表示用の滑らかな姿勢(目標姿勢へ時間ベースで指数追従。FPS非依存)
    this.yawVis = this.heading;
    this.pitchVis = 0;
    this.rollVis = 0;
    this.grp.position.copy(this.pos);
    this.grp.rotation.set(this.pitchVis, this.yawVis, this.rollVis);
  }
  newTarget() {
    // 現在位置から遠い点のみ採用(22m以内再選択による毎フレームの目標切替=震えの原因を排除)
    let v = null;
    for (let i = 0; i < 12; i++) {
      v = new THREE.Vector3((Math.random() * 2 - 1) * 100, -12 + Math.random() * 16, (Math.random() * 2 - 1) * 45);
      if (v.distanceTo(this.pos) > 40) return v;
    }
    return v;
  }
  update(dt, t) {
    const dtE = Math.max(dt, 1e-3);
    if (this.pos.distanceTo(this.target) < 22) this.target = this.newTarget();
    const desired = new THREE.Vector3().subVectors(this.target, this.pos);
    let headingErr = 0;
    if (Math.abs(desired.x) > 1e-9 || Math.abs(desired.z) > 1e-9) {
      headingErr = wrapAngle(Math.atan2(desired.x, desired.z) - this.heading);
    }
    // 比例旋回: 目標方位角誤差に応じた旋回率(rad/s)。bang-bang制御の往復を避ける
    const omega = THREE.MathUtils.clamp(headingErr * 2.2, -this.turnMax, this.turnMax);
    const ang = THREE.MathUtils.clamp(omega * dt, -this.turnMax * dt, this.turnMax * dt);
    this.heading = wrapAngle(this.heading + ang);
    const h = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.pos.addScaledVector(h, this.speed * dt);
    // 昇降速度 m/s + ゆっくりな上下動(速度として加算なので dt 積分で FPS 非依存)
    const climb = THREE.MathUtils.clamp((this.target.y - this.pos.y) / dtE, -3, 3) + Math.sin(t * 0.5 + this.bobPhase) * 0.5;
    this.pos.y += THREE.MathUtils.clamp(climb, -3.5, 3.5) * dt;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + 10, HALF_W - 10);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -HALF_D + 10, HALF_D - 10);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, FLOOR + 3, SURF - 2);
    // 目標姿勢: pitch=昇降角, roll=旋回へのバンク(内側へ傾く)
    const pitchT = THREE.MathUtils.clamp(-Math.atan2(climb, this.speed), -0.4, 0.4);
    const rollT = THREE.MathUtils.clamp(-omega * 1.2, -0.45, 0.45);
    // 時間ベースの指数補間(時定数: yaw≈0.17s, pitch/roll≈0.45s)。dt変動あっても挙動一定
    const kY = 1 - Math.exp(-6 * dt), kS = 1 - Math.exp(-2.2 * dt);
    this.yawVis += wrapAngle(this.heading - this.yawVis) * kY;
    this.pitchVis += (pitchT - this.pitchVis) * kS;
    this.rollVis += (rollT - this.rollVis) * kS;
    this.grp.position.copy(this.pos);
    this.grp.rotation.set(this.pitchVis, this.yawVis, this.rollVis);
  }
}

// ---------------------------------------------------------------
// クロマグロ (群泳: boids)
// ---------------------------------------------------------------
class Tuna {
  constructor(rng) {
    const L = 2.1;
    const keys = [[0, .04, .05], [.07, .17, .27], [.16, .25, .42], [.28, .27, .48], [.42, .22, .40], [.58, .15, .27], [.72, .09, .15], [.86, .055, .075], [1, .04, .05]];
    const body = bodyGeometry(keys, L, 20, 34);
    gradientColors(body, 0x2e5f8a, 0xdfeef5);
    const mat = swimMaterial({ color: 0xffffff, vertexColors: true, len: L, sway: 0.14, freq: 11, k: 5.5, rough: 0.35, metal: 0.35 });
    const matF = swimMaterial({ color: 0x38608a, len: L, sway: 0.14, freq: 11, k: 5.5, side: THREE.DoubleSide, rough: 0.4, metal: 0.3 });
    const grp = new THREE.Group();
    addMesh(grp, body, mat, 'tuna.body');
    let fg = finGeometry([[.18, .32], [-.35, .95], [-.68, .8], [-.28, .32], [-.12, 0], [-.6, -.5], [-.5, -.85], [.18, -.28]], 'vert', 0.06);
    fg.translate(0, 0, -L / 2 - 0.02);
    addMesh(grp, fg, matF, 'tuna.tail');
    fg = finGeometry([[.45, .02], [-.25, -.02], [-.6, .42], [.15, .08]], 'vert', 0.04);
    fg.translate(0, .46, -L * 0.1);
    addMesh(grp, fg, matF, 'tuna.dorsal');
    fg = finGeometry([[.3, .0], [-.2, -.02], [-.4, .25], [.05, .05]], 'vert', 0.04);
    fg.translate(0, -.42, -L * 0.05);
    addMesh(grp, fg, matF, 'tuna.anal');
    for (const s of [1, -1]) {
      fg = finGeometry([[0, .28], [.05, .95], [.62, 1.15], [.55, .45], [.2, .2]], 'horiz', 0.05);
      if (s < 0) mirrorX(fg);
      fg.translate(s * .22, -.12, L * 0.16);
      addMesh(grp, fg, matF, 'tuna.pectoral' + s);
    }
    scene.add(grp);
    this.grp = grp;
    this.pos = new THREE.Vector3((rng() * 2 - 1) * 60, -14 + rng() * 10, (rng() * 2 - 1) * 30);
    this.vel = new THREE.Vector3(rng() * 2 - 1, (rng() - 0.5) * 0.3, rng() * 2 - 1).normalize().multiplyScalar(7);
    this.min = 5.2; this.max = 9.5;
  }
}
class TunaSchool {
  constructor(n) {
    const rng = mulberry(2024);
    this.list = []; for (let i = 0; i < n; i++) this.list.push(new Tuna(rng));
    this._f = new THREE.Vector3();
  }
  update(dt, avoiders) {
    const list = this.list, f = this._f;
    for (const b of list) {
      f.set(0, 0, 0);
      let nA = 0; const align = new THREE.Vector3(), coh = new THREE.Vector3(), sep = new THREE.Vector3();
      for (const o of list) {
        if (o === b) continue;
        const d = b.pos.distanceTo(o.pos);
        if (d < 30) { align.add(o.vel); coh.add(o.pos); nA++; }
        if (d < 5.5) sep.addScaledVector(f.copy(b.pos).sub(o.pos).normalize(), (5.5 - d) * 2.2);
      }
      if (nA) {
        f.copy(align).divideScalar(nA).normalize().multiplyScalar(b.max).sub(b.vel).clampLength(0, 9);
        b.vel.addScaledVector(f.clone(), dt * 0.9);
        f.copy(coh).divideScalar(nA).sub(b.pos).clampLength(0, 20).multiplyScalar(0.12);
        b.vel.addScaledVector(f, dt);
      }
      b.vel.addScaledVector(sep.clampLength(0, 30), dt * 1.4);
      // 巨大生物からの回避
      for (const a of avoiders) {
        const d = b.pos.distanceTo(a.pos);
        const r = a.L ? a.L * 2.2 : 14;
        if (d < r && d > 1e-3) {
          b.vel.addScaledVector(f.copy(b.pos).sub(a.pos).normalize(), (r - d) * dt * 4.5);
        }
      }
      // 水槽境界
      const m = 18, push = 55;
      if (b.pos.x > HALF_W - m) b.vel.x -= (b.pos.x - (HALF_W - m)) * dt * push * 0.1;
      if (b.pos.x < -HALF_W + m) b.vel.x += ((-HALF_W + m) - b.pos.x) * dt * push * 0.1;
      if (b.pos.z > HALF_D - m * 0.6) b.vel.z -= (b.pos.z - (HALF_D - m * 0.6)) * dt * push * 0.1;
      if (b.pos.z < -HALF_D + m * 0.6) b.vel.z += ((-HALF_D + m * 0.6) - b.pos.z) * dt * push * 0.1;
      if (b.pos.y > 16) b.vel.y -= (b.pos.y - 16) * dt * 3;
      if (b.pos.y < FLOOR + 5) b.vel.y += (FLOOR + 5 - b.pos.y) * dt * 3;
      // 速度クランプ
      const sp = b.vel.length();
      if (sp > b.max) b.vel.multiplyScalar(b.max / sp);
      if (sp < b.min) b.vel.multiplyScalar(b.min / (sp + 1e-6));
      // 旋回速度の制限 (急旋回抑制)
      b.pos.addScaledVector(b.vel, dt);
      b.pos.x = THREE.MathUtils.clamp(b.pos.x, -HALF_W + 3, HALF_W - 3);
      b.pos.z = THREE.MathUtils.clamp(b.pos.z, -HALF_D + 3, HALF_D - 3);
      b.pos.y = THREE.MathUtils.clamp(b.pos.y, FLOOR + 1.5, SURF - 1.5);
      b.grp.position.copy(b.pos);
      const v = b.vel;
      const yaw = Math.atan2(v.x, v.z);
      b.grp.rotation.set(-Math.asin(THREE.MathUtils.clamp(v.y / v.length(), -1, 1)), yaw, 0);
    }
  }
}

// ---------------------------------------------------------------
// 配置
// ---------------------------------------------------------------
const sharks = [new WhaleShark(), new WhaleShark()];
const mantas = [new Manta(), new Manta(), new Manta(), new Manta()];
const school = new TunaSchool(30);

// メッシュ健全性チェック: 境界エッジ(=1回のみ使用)が0 = 閉じたwatertight mesh
function geomCheck(label, geo, log) {
  const idx = geo.index.array, p = geo.attributes.position;
  const cnt = new Map();
  for (let i = 0; i < idx.length; i += 3) {
    const t = [idx[i], idx[i + 1], idx[i + 2]];
    for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
      const k = a < b ? a * 1e7 + b : b * 1e7 + a;
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const c of cnt.values()) { if (c === 1) boundary++; else if (c > 2) nonManifold++; }
  log.push(`${label}: v${p.count} f${idx.length / 3} boundary=${boundary} nonManifold=${nonManifold}`);
  return boundary === 0 && nonManifold === 0;
}
function runGeomCheck() {
  const log = []; let fail = 0;
  for (const s of sharks) for (const c of s.grp.children) if (!geomCheck('whale.' + (c.userData.label || '?'), c.geometry, log)) fail++;
  for (const m of mantas) for (const c of m.grp.children) if (!geomCheck('manta.' + (c.userData.label || '?'), c.geometry, log)) fail++;
  for (const b of school.list) for (const c of b.grp.children) if (!geomCheck('tuna.' + (c.userData.label || '?'), c.geometry, log)) fail++;
  console.log('GEOMCHECK\n' + log.join('\n') + '\nRESULT ' + (fail === 0 ? 'ALL_WATERTIGHT' : fail + ' NOT_WATERTIGHT'));
}
if (new URLSearchParams(location.search).has('geomcheck')) { renderer.render(scene, camera); runGeomCheck(); }

// 姿勢の滑らかさ / FPS非依存チェック (マンタの震え再発防止)
function runPoseTest() {
  const realRandom = Math.random;
  const measure = (dt) => {
    let s = 12345; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    Math.random = rnd;
    const m = new Manta(); scene.remove(m.grp); // テスト専用。シーンには出さない
    const N = Math.round(30 / dt), rot = m.grp.rotation;
    let prev = { x: rot.x, y: rot.y, z: rot.z };
    let dR = 0, dP = 0, dY = 0, rollRate = 0, flips = 0, lastRollSign = 0;
    for (let i = 0; i < N; i++) {
      m.update(dt, i * dt);
      const dy = wrapAngle(rot.y - prev.y), dp = rot.x - prev.x, dr = rot.z - prev.z;
      dY = Math.max(dY, Math.abs(dy)); dP = Math.max(dP, Math.abs(dp)); dR = Math.max(dR, Math.abs(dr));
      rollRate = Math.max(rollRate, Math.abs(dr) / dt);
      const sg = Math.sign(dr); if (sg && lastRollSign && sg !== lastRollSign) flips++; if (sg) lastRollSign = sg;
      prev = { x: rot.x, y: rot.y, z: rot.z };
    }
    return { dR, dP, dY, rollRate, flips, pos: m.pos.clone() };
  };
  const a = measure(1 / 60), b = measure(1 / 120);
  Math.random = realRandom;
  const ratio = a.dR > 1e-6 ? b.dR / a.dR : 0; // FPS倍なら 0.5 前後が期待值
  const noJump = a.dR < 0.1 && a.dP < 0.1 && a.dY < 0.15;
  const timeBased = ratio > 0.3 && ratio < 0.7;
  const noFlipStorm = a.flips < 60;
  const ok = noJump && timeBased && noFlipStorm;
  console.log(`POSETEST
 60fps: maxΔ/yaw=${a.dY.toFixed(4)} pitch=${a.dP.toFixed(4)} roll=${a.dR.toFixed(4)} rad  rollRate=${a.rollRate.toFixed(3)}rad/s flips=${a.flips}
120fps: maxΔ/yaw=${b.dY.toFixed(4)} pitch=${b.dP.toFixed(4)} roll=${b.dR.toFixed(4)} rad  rollRate=${b.rollRate.toFixed(3)}rad/s flips=${b.flips}
120/60 rollΔratio=${ratio.toFixed(3)} (expect~0.5=timeBased)
RESULT ${ok ? 'SMOOTH' : 'JITTER'} ${noJump ? '' : 'BAD_JUMP '}${timeBased ? '' : 'BAD_FPS_DEP '}${noFlipStorm ? '' : 'BAD_FLIPS'}`);
}
if (new URLSearchParams(location.search).has('posetest')) runPoseTest();

// ---------------------------------------------------------------
// タッチ操作判定 (マウス/ペン操作は従来の PC 操作のまま)
// ---------------------------------------------------------------
let isTouch = false;

// ---------------------------------------------------------------
// プレイヤー操作 (一人称)
// ---------------------------------------------------------------
const keys = {};
let yaw = 0, pitch = 0, locked = false;
addEventListener('keydown', e => keys[e.code] = true);
addEventListener('keyup', e => keys[e.code] = false);
renderer.domElement.addEventListener('click', () => { if (!isTouch) renderer.domElement.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => locked = document.pointerLockElement === renderer.domElement);
addEventListener('mousemove', e => {
  if (!locked) return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.5, 1.5);
});

// ---------------------------------------------------------------
// モバイルタッチ操作 (マルチタッチ)
//  左下半分: 仮想スティック(前後左右)
//  右下半分: ドラッグで視点
//  右側ボタン: 浮上 / 潜水 / 高速
// ---------------------------------------------------------------
const touchMove = { x: 0, y: 0 };   // 移動入力 -1..1
const touchVert = { value: 0 };     // 浮上潜水 -1..1
const touchBoost = { active: false };
let lookId = null, lastLookX = 0, lastLookY = 0;
let stickId = null, stickOrigin = { x: 0, y: 0 };
const STICK_R = 56, STICK_DEAD = 6;

const el = (id) => document.getElementById(id);
const joyEl = el('joy'), joyKnobEl = el('joy-knob'),
      upEl = el('btn-up'), downEl = el('btn-down'), boostEl = el('btn-boost');

function setKnob(dx, dy) {
  joyKnobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}
function resetJoy() {
  stickId = null;
  touchMove.x = 0; touchMove.y = 0;
  joyEl.classList.remove('active');
  setKnob(0, 0);
}
function bindHold(node, onChange) {
  let id = null;
  const on = (e) => {
    if (id !== null) return;
    const t = e.changedTouches[0];
    id = t.identifier;
    onChange(true);
    node.classList.add('active');
    e.preventDefault();
  };
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === id) {
        id = null;
        onChange(false);
        node.classList.remove('active');
        e.preventDefault();
        break;
      }
    }
  };
  node.addEventListener('touchstart', on, { passive: false });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', end);
}
bindHold(upEl, (v) => touchVert.value = v ? 1 : 0);
bindHold(downEl, (v) => touchVert.value = v ? -1 : 0);
bindHold(boostEl, (v) => touchBoost.active = v);

function onTouchStart(e) {
  isTouch = true;
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth * 0.5) {
      if (stickId === null) {
        stickId = t.identifier;
        stickOrigin = { x: t.clientX, y: t.clientY };
        joyEl.style.left = t.clientX + 'px';
        joyEl.style.top = t.clientY + 'px';
        joyEl.classList.add('active');
        setKnob(0, 0);
      }
    } else if (lookId === null) {
      lookId = t.identifier;
      lastLookX = t.clientX;
      lastLookY = t.clientY;
    }
  }
}
function onTouchMove(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) {
      let dx = t.clientX - stickOrigin.x, dy = t.clientY - stickOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      setKnob(dx, dy);
      if (d < STICK_DEAD) { touchMove.x = 0; touchMove.y = 0; }
      else { touchMove.x = dx / STICK_R; touchMove.y = dy / STICK_R; }
    } else if (t.identifier === lookId) {
      yaw -= (t.clientX - lastLookX) * 0.0045;
      pitch = THREE.MathUtils.clamp(pitch - (t.clientY - lastLookY) * 0.0045, -1.5, 1.5);
      lastLookX = t.clientX;
      lastLookY = t.clientY;
    }
  }
  e.preventDefault();
}
function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) resetJoy();
    else if (t.identifier === lookId) lookId = null;
  }
}
renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
renderer.domElement.addEventListener('touchend', onTouchEnd);
renderer.domElement.addEventListener('touchcancel', onTouchEnd);
if (matchMedia('(pointer:coarse)').matches) document.body.classList.add('touch');

const vel = new THREE.Vector3();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tgt = new THREE.Vector3();
function player(dt) {
  camera.rotation.set(pitch, yaw, 0);
  fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  tgt.set(0, 0, 0);
  if (keys.KeyW) tgt.add(fwd);
  if (keys.KeyS) tgt.sub(fwd);
  if (keys.KeyD) tgt.add(right);
  if (keys.KeyA) tgt.sub(right);
  if (keys.KeyE || keys.Space) tgt.add(up);
  if (keys.KeyQ) tgt.sub(up);
  tgt.addScaledVector(right, touchMove.x);
  tgt.addScaledVector(fwd, -touchMove.y);
  tgt.y += touchVert.value;
  if (tgt.lengthSq() > 1) tgt.normalize();
  const speed = (keys.ShiftLeft || keys.ShiftRight || touchBoost.active) ? 30 : 9;
  tgt.multiplyScalar(speed);
  vel.lerp(tgt, 1 - Math.exp(-5 * dt));
  camera.position.addScaledVector(vel, dt);
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -HALF_W + 2, HALF_W - 2);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -HALF_D + 2, HALF_D - 2);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, FLOOR + 1, SURF - 1);
}

// ---------------------------------------------------------------
// メインループ
// ---------------------------------------------------------------
let prev = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - prev) / 1000, 0.05); prev = now;
  uTime.value += dt;
  player(dt);
  for (const s of sharks) s.update(dt, [...sharks.filter(o => o !== s), ...mantas]);
  for (const m of mantas) m.update(dt, uTime.value);
  school.update(dt, [...sharks, ...mantas]);
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
