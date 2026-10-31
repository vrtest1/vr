import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// ===== 寸法（タンク内側の中心が原点。1単位 ≒ 10cm） =====
const W = 1.0, H = 1.3, D = 0.17;
const HX = W / 2, HY = H / 2, HZ = D / 2;
// 上から見るとトラック型：正面・背面は平ら、左右の側面は半径 HZ の半円
const XS = HX - HZ;   // まっすぐな部分の半分の長さ
// 位置 x での内側の奥行きの半分
function zHalf(x) {
  const dx = Math.abs(x) - XS;
  return dx <= 0 ? HZ : Math.sqrt(Math.max(0, HZ * HZ - dx * dx));
}
const AIR_FRAC = 0.10;          // 水は90%
const G = 4.0;                  // 遊びやすさ優先の重力スケール
const BUOY = 0.62;              // 水の密度 / 輪の密度
const RING_R = 0.055, TUBE = 0.012, R_IN = RING_R - TUBE;
const INV_I = 1 / (0.5 * RING_R * RING_R);
const PEG_R = 0.008, TIP_R = 0.015, COLLAR_R = 0.05;
// 棒の根元の皿：後ろの壁から手前へ伸び、前側が半円の棚（幅 2*COLLAR_R は輪の穴 0.086 より広い）
const SHELF_HT = 0.006, SHELF_BACK = -HZ - 0.004;
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
// トラック型（w×d、左右が半円）の輪郭
function stadiumShape(w, d) {
  const r = d / 2, xs = w / 2 - r;
  const s = new THREE.Shape();
  s.moveTo(-xs, -r);
  s.lineTo(xs, -r);
  s.absarc(xs, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-xs, r);
  s.absarc(-xs, 0, r, Math.PI / 2, Math.PI * 1.5, false);
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

// 床（ノズルへ向かう傾斜）：実物と同じ透明プラスチックの薄い板。下は空気で、台座とパイプが透けて見える
const FLOOR_T = 0.007;
const clearPlastic = new THREE.MeshPhysicalMaterial({
  color: 0xf4fbff, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0,
  clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2, side: THREE.DoubleSide, depthWrite: false,
});
function floorTopY(x) {
  for (let i = 0; i < FLOOR.length - 1; i++) {
    const [ax, ay] = FLOOR[i], [bx, by] = FLOOR[i + 1];
    if (x <= bx) return ay + (x - ax) * (by - ay) / (bx - ax);
  }
  return FLOOR[FLOOR.length - 1][1];
}
{
  // x 方向に刻んで、各 x で奥行き ±zHalf(x) の板を張る（トラック型の壁にぴったり沿う）
  const xs = new Set();
  for (let i = 0; i <= 160; i++) xs.add(-HX + W * i / 160);
  for (const [x] of FLOOR) xs.add(x);
  for (const x of [-XS, XS]) xs.add(x);
  const X = [...xs].sort((a, b) => a - b);
  const top = [], side = [];
  const quad = (arr, a, b, c, d) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < X.length - 1; i++) {
    const x0 = X[i], x1 = X[i + 1];
    const y0 = floorTopY(x0), y1 = floorTopY(x1);
    const z0 = zHalf(x0) - 0.001, z1 = zHalf(x1) - 0.001;
    quad(top, [x0, y0, z0], [x1, y1, z1], [x1, y1, -z1], [x0, y0, -z0]);                         // 上面
    quad(top, [x0, y0 - FLOOR_T, -z0], [x1, y1 - FLOOR_T, -z1], [x1, y1 - FLOOR_T, z1], [x0, y0 - FLOOR_T, z0]);   // 下面
    quad(side, [x0, y0 - FLOOR_T, z0], [x1, y1 - FLOOR_T, z1], [x1, y1, z1], [x0, y0, z0]);       // 正面の縁
    quad(side, [x1, y1 - FLOOR_T, -z1], [x0, y0 - FLOOR_T, -z0], [x0, y0, -z0], [x1, y1, -z1]);   // 背面の縁
  }
  const mk = arr => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  };
  const floorMesh = new THREE.Mesh(mk(top), clearPlastic);
  floorMesh.renderOrder = 4;
  // 板の縁（断面）は少しだけ白っぽく
  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide,
  });
  const edge = new THREE.Mesh(mk(side), edgeMat);
  edge.renderOrder = 4;
  tank.add(floorMesh, edge);
}
// ノズルとポンプのパイプ（台座のボタン側から床の下を通ってノズルへ上がる）
{
  const pipeMat = new THREE.MeshPhysicalMaterial({
    color: 0xd6ecf8, transparent: true, opacity: 0.65, roughness: 0.08, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.0, depthWrite: false,
  });
  const fittingMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2f6f8, transparent: true, opacity: 0.7, roughness: 0.15, clearcoat: 1, depthWrite: false,
  });
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x333a40, roughness: 0.6 });
  for (const n of NOZZLES) {
    const sx = Math.sign(n.x);
    // ノズル口（床を貫く短い筒）
    const fit = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 24), fittingMat);
    fit.position.set(n.x, n.y - 0.006, 0);
    fit.renderOrder = 4;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.012, 20), holeMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(n.x, n.y + 0.0095, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.004, 10, 28), fittingMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(n.x, n.y + 0.009, 0);
    rim.renderOrder = 4;
    // パイプ：台座（ボタン側の外寄り）から立ち上がり、床の斜面の下に沿ってノズルの根元へ
    const P = (x, y, z) => new THREE.Vector3(sx * x, y, z);
    const curve = new THREE.CatmullRomCurve3([
      P(0.47, -0.645, 0.03),
      P(0.466, -0.6, 0.03),
      P(0.45, -0.538, 0.026),
      P(0.40, -0.573, 0.018),
      P(0.36, -0.601, 0.008),
      P(Math.abs(n.x) + 0.01, -0.613, 0),
    ], false, 'catmullrom', 0.4);
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.007, 12, false), pipeMat);
    pipe.renderOrder = 4;
    tank.add(fit, hole, rim, pipe);
  }
}

for (const p of PEGS) {
  const len = p.tip - p.base;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(PEG_R, PEG_R, len, 16), metal);
  shaft.position.set(p.x, p.base + len / 2, 0);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(TIP_R, 24, 16), metal);
  tip.position.set(p.x, p.tip, 0);
  // 皿（棚）：形状は (x, z) 平面。後ろの壁から棒の位置まで四角、前側は半円
  const bev = 0.002;
  const ss = new THREE.Shape();
  const R = COLLAR_R - bev;
  ss.moveTo(-R, SHELF_BACK);
  ss.lineTo(-R, 0);
  ss.absarc(0, 0, R, Math.PI, 0, true);
  ss.lineTo(R, SHELF_BACK);
  ss.closePath();
  const shelfGeo = new THREE.ExtrudeGeometry(ss, {
    depth: SHELF_HT * 2 - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 24,
  });
  shelfGeo.translate(0, 0, -(SHELF_HT - bev));
  const shelf = new THREE.Mesh(shelfGeo, metal);
  shelf.rotation.x = Math.PI / 2;   // 形状の y → ワールド z、押し出し方向 → ワールド -y
  shelf.position.set(p.x, p.base, 0);
  tank.add(shaft, tip, shelf);
}

// ガラス（角の丸い透明ケース）
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, transparent: true, opacity: 0.14, roughness: 0.02, metalness: 0,
  clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.4, side: THREE.DoubleSide, depthWrite: false,
});
let glass;
{
  const g = new THREE.ExtrudeGeometry(stadiumShape(W + 0.012, D + 0.012), {
    depth: H, bevelEnabled: false, curveSegments: 32,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -HY, 0);
  glass = new THREE.Mesh(toCreasedNormals(g, 0.6), glassMat);
  glass.renderOrder = 5;
  tank.add(glass);
}

// ===== 汚れ（ケース正面に付く指紋・油汚れ。タップで付き、なぞると伸び、拭き上げで消える） =====
const dirt = (() => {
  const GW = W + 0.012, GR = (D + 0.012) / 2 + 0.0008, GHX = GW / 2 + 0.0008;
  const CW = 1024, CH = Math.round(CW * H / GW);
  const PX = CW / GW;   // 1単位あたりの画素数
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.premultiplyAlpha = true;   // 透明な黒が縮小時に混ざって灰色に濁らないように

  // ケース前半分（平らな正面＋左右の丸み）に沿った面。UV は正面から見た位置そのもの
  const NX = 160, pos = [], uv = [], idx = [];
  const zAt = x => { const dx = Math.abs(x) - XS; return dx <= 0 ? GR : Math.sqrt(Math.max(0, GR * GR - dx * dx)); };
  for (let i = 0; i <= NX; i++) {
    // 端の丸みに点を集める
    const t = i / NX * 2 - 1;
    const x = Math.sign(t) * GHX * Math.pow(Math.abs(t), 0.75);
    for (const y of [-HY, HY]) {
      pos.push(x, y, zAt(x));
      uv.push((x + GHX) / (2 * GHX), (y + HY) / H);
    }
  }
  for (let i = 0; i < NX; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  // 汚れがどれだけ重なっても、この濃さで頭打ち（ケースが透けて見えたままになるように）
  const MAX_OPACITY = 0.4;
  // 汚れは光が反射したときだけ浮き上がる：ケースの表面を斜めに横切る「反射の帯」を傾きで動かし、
  // 帯の中と、光を拾いやすい左右の丸い側面だけ汚れを白く見せる。普段はうっすら。
  // テクスチャは透明度（A チャンネル）だけ使う。乗算済みで読み込むので縮小しても黒が混ざらない
  const dirtUniforms = {
    uMap: { value: tex },
    uOpacity: { value: MAX_OPACITY },
    uBand: { value: 0.75 },        // 反射の帯の中心（正面の斜め座標）
    uBandW: { value: 0.16 },       // 帯の太さ
    uBandDir: { value: new THREE.Vector2(0.8, 0.6) },
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: dirtUniforms,
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vP;
      varying vec3 vNw;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vP = position;
        float ex = abs(position.x) - ${XS.toFixed(4)};
        vec3 nl = ex > 0.0 ? normalize(vec3(sign(position.x) * ex, 0.0, position.z)) : vec3(0.0, 0.0, 1.0);
        vNw = normalize((modelMatrix * vec4(nl, 0.0)).xyz);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform float uOpacity;
      uniform float uBand;
      uniform float uBandW;
      uniform vec2 uBandDir;
      varying vec2 vUv;
      varying vec3 vP;
      varying vec3 vNw;
      varying vec3 vWorld;
      void main() {
        float a = texture2D(uMap, vUv).a;
        // 反射の帯（中心ほど強く、ふちは柔らかく）＋ 細いハイライト
        float t = dot(vP.xy, normalize(uBandDir)) - uBand;
        float band = exp(-t * t / (uBandW * uBandW)) + 0.6 * exp(-t * t / (uBandW * uBandW * 0.06));
        // 丸い側面は視線に対して斜めなので光を拾いやすい
        vec3 V = normalize(cameraPosition - vWorld);
        float edge = 1.0 - clamp(dot(normalize(vNw), V), 0.0, 1.0);
        float lit = clamp(band + edge * 0.8, 0.0, 1.0);
        // 光の当たらない所は油っぽくわずかに暗いくすみ、反射の中では白く光る
        float vis = 0.22 + 0.78 * lit;
        vec3 col = mix(vec3(0.45, 0.49, 0.53), vec3(1.0), lit);
        float dA = a * uOpacity * vis;
        // ケース表面そのものの反射の筋（ごく薄い）。汚れがなくても光が当たっている場所が分かる
        float sA = clamp(band, 0.0, 1.0) * 0.07;
        float outA = dA + sA * (1.0 - dA);
        if (outA < 0.002) discard;
        vec3 outC = (col * dA + vec3(1.0) * sA * (1.0 - dA)) / outA;
        gl_FragColor = vec4(outC, outA);
        #include <colorspace_fragment>
      }`,
  }));
  mesh.renderOrder = 6;
  tank.add(mesh);

  // 素材：dusty_atlas.png（上段 指紋8、中段 油汚れ5、下段 こすった跡5。元画像 1774×887 の座標）
  const atlas = new Image();
  let ready = false, k = 1;
  atlas.onload = () => { ready = true; k = atlas.width / 1774; };
  atlas.src = './dusty_atlas.png';
  const PRINTS = [[39, 193], [235, 414], [453, 584], [644, 789], [836, 1028], [1088, 1274], [1325, 1497], [1567, 1739]]
    .map(([x0, x1]) => [x0, 34, x1 - x0, 259]);
  const SMUDGES = [[36, 437], [442, 839], [863, 1118], [1139, 1427], [1443, 1743]]
    .map(([x0, x1]) => [x0, 311, x1 - x0, 299]);
  const SMEARS = [0, 1, 2, 3, 4].map(i => [i * 355, 632, 355, 217]);

  const rnd = (a, b) => a + Math.random() * (b - a);
  function sprite(r, x, y, hPx, rot, alpha) {
    const [sx, sy, sw, sh] = r;
    const w = hPx * sw / sh;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.drawImage(atlas, sx * k, sy * k, sw * k, sh * k, -w / 2, -hPx / 2, w, hPx);
    ctx.restore();
    tex.needsUpdate = true;
  }
  const toPx = uv => [uv.x * CW, (1 - uv.y) * CH];

  // タップ：指紋（ときどき油汚れ）
  function tap(uvp) {
    if (!ready) return;
    const [x, y] = toPx(uvp);
    // 1回目は薄く、同じ所を何度も触ると少しずつ濃くなる（上限は MAX_OPACITY）
    if (Math.random() < 0.18) {
      sprite(SMUDGES[Math.floor(Math.random() * SMUDGES.length)], x, y, 0.2 * PX * rnd(0.8, 1.1), rnd(-Math.PI, Math.PI), rnd(0.25, 0.4));
    } else {
      sprite(PRINTS[Math.floor(Math.random() * PRINTS.length)], x, y, 0.15 * PX * rnd(0.85, 1.1), rnd(-0.7, 0.7), rnd(0.4, 0.6));
    }
  }

  // なぞる：指の下の汚れを引きずって伸ばし、こすった跡も少し残す
  const scratch = document.createElement('canvas');
  const SR = Math.round(0.05 * PX);   // 指の半径（画素）
  scratch.width = scratch.height = SR * 2;
  const sctx = scratch.getContext('2d');
  const soft = (() => {   // 縁がぼやけた丸いマスク
    const c = document.createElement('canvas');
    c.width = c.height = SR * 2;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(SR, SR, SR * 0.2, SR, SR, SR);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, SR * 2, SR * 2);
    return c;
  })();
  let last = null, travel = 0;
  function strokeStart(uvp) { last = toPx(uvp); travel = 0; }
  function strokeMove(uvp) {
    if (!ready) return;
    if (!last) { last = toPx(uvp); return; }   // ケースの外から戻ってきたらそこから再開
    const [x1, y1] = toPx(uvp);
    let [x0, y0] = last;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < 2) return;
    const steps = Math.ceil(dist / 5);
    for (let s = 1; s <= steps; s++) {
      const x = x0 + (x1 - x0) * s / steps, y = y0 + (y1 - y0) * s / steps;
      const px = x0 + (x1 - x0) * (s - 1) / steps, py = y0 + (y1 - y0) * (s - 1) / steps;
      // 直前の位置の汚れを丸く切り取って、今の位置へ少し薄めて置く（＝伸びる）
      sctx.globalCompositeOperation = 'copy';
      sctx.drawImage(canvas, px - SR, py - SR, SR * 2, SR * 2, 0, 0, SR * 2, SR * 2);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(soft, 0, 0);
      ctx.globalAlpha = 0.55;
      ctx.drawImage(scratch, x - SR, y - SR);
      ctx.globalAlpha = 1;
      // 元の場所は指で拭われて少し薄くなる
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 0.06;
      ctx.drawImage(soft, px - SR, py - SR);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    travel += dist;
    if (travel > 0.06 * PX) {
      travel = 0;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      sprite(SMEARS[Math.floor(Math.random() * SMEARS.length)], (x0 + x1) / 2, (y0 + y1) / 2,
        0.09 * PX * rnd(0.8, 1.2), ang + rnd(-0.3, 0.3), rnd(0.12, 0.22));
    }
    last = [x1, y1];
    tex.needsUpdate = true;
  }
  function strokeEnd() { last = null; }

  // 拭き上げ：左から右へ布でぬぐうように消す
  let wipeX = -1;
  function wipe() { wipeX = 0; }
  function update(dt, grav) {
    // 傾けると反射の帯が表面を滑る（静止時は右上の角に少しかかる位置）
    const target = 0.75 + grav.x * 1.5 - grav.z * 1.1;
    dirtUniforms.uBand.value += (target - dirtUniforms.uBand.value) * (1 - Math.exp(-dt * 6));
    if (wipeX < 0) return;
    const nx = Math.min(CW + 200, wipeX + dt * CW * 1.6);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createLinearGradient(nx - 200, 0, nx, 0);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(0, 0, Math.max(0, nx - 200), CH);
    ctx.fillStyle = g;
    ctx.fillRect(nx - 200, 0, 200, CH);
    ctx.restore();
    tex.needsUpdate = true;
    wipeX = nx >= CW + 200 ? -1 : nx;
  }
  return { mesh, tap, strokeStart, strokeMove, strokeEnd, wipe, update };
})();

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
  // 床（透明板）の上面の高さ。これより下は水がない
  float floorY(float x) {
    ${FLOOR.slice(0, -1).map(([ax, ay], i) => {
      const [bx, by] = FLOOR[i + 1];
      return `if (x <= ${bx.toFixed(4)}) return ${ay.toFixed(4)} + (x - ${ax.toFixed(4)}) * ${((by - ay) / (bx - ax)).toFixed(5)};`;
    }).join('\n    ')}
    return ${FLOOR[FLOOR.length - 1][1].toFixed(4)};
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
    varying vec3 vNl;
    varying vec3 vAxX;
    varying vec3 vAxZ;
    uniform vec2 uN;
    uniform float uS;
    void main() {
      vP = position;
      vNl = normal;
      vAxX = (modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
      vAxZ = (modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
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
    varying vec3 vNl;
    varying vec3 vAxX;
    varying vec3 vAxZ;
    void main() {
      vec2 T = vec2(-uN.y, uN.x);
      float lvl = dot(uN, vP.xy) + uS * vP.z - (uC + wave(dot(T, vP.xy)));
      if (lvl > 0.0) discard;
      if (vP.y < floorY(vP.x)) discard;
      float men = smoothstep(-0.018 * mix(1.0, 1.6, uRefr), 0.0, lvl);
      vec3 V = normalize(vWorld - cameraPosition);
      vec3 Nf = normalize(vNw);
      // 側面はトラック型の式から正確な法線を出す（多角形近似の面ごとの段＝縦縞を消す）
      if (abs(vNl.y) < 0.5) {
        float ex = abs(vP.x) - ${XS.toFixed(4)};
        vec2 nl = ex > 0.0 ? normalize(vec2(sign(vP.x) * ex, vP.z)) : vec2(0.0, sign(vP.z));
        Nf = normalize(vAxX * nl.x + vAxZ * nl.y);
      }
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
const waterGeo = new THREE.ExtrudeGeometry(stadiumShape(W - 0.002, D - 0.004), {
  depth: H - 0.002, bevelEnabled: false, curveSegments: 32,
});
waterGeo.rotateX(-Math.PI / 2);
waterGeo.translate(0, -(H - 0.002) / 2, 0);
const water = new THREE.Mesh(toCreasedNormals(waterGeo, 0.6), waterMat);
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
      if (vP3.y < floorY(vP3.x)) discard;
      if (length(vec2(max(abs(vP3.x) - ${XS.toFixed(4)}, 0.0), vP3.z)) > ${(HZ - 0.003).toFixed(4)}) discard;
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

// ===== 水中の細かい浮遊物（水流に乗って漂い、ゆっくり沈む。光を拾ってときどききらっと見える） =====
const motes = (() => {
  const N = 260;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), seed = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.0075, map: tex, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = 1;   // 泡と同じく水の屈折を通して見える
  tank.add(pts);
  // 水の中のランダムな位置（最初は水位の計算前なので、平常時の水面より下に置くだけ）
  function place(i, checkLevel) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 30; k++) {
      x = (Math.random() - 0.5) * 2 * (HX - 0.02);
      y = floorTopY(x) + 0.01 + Math.random() * (HY - 0.15 - floorTopY(x));
      z = (Math.random() - 0.5) * 2 * (zHalf(x) - 0.012);
      if (!checkLevel || levelAt(x, y, z) < -0.02) break;
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  }
  for (let i = 0; i < N; i++) { seed[i] = Math.random(); place(i, false); }
  const p = new THREE.Vector3(), f = new THREE.Vector3();
  function update(dt) {
    for (let i = 0; i < N; i++) {
      p.fromArray(pos, i * 3);
      flowAt(p, f);
      const s = seed[i];
      // 水流に少し遅れて乗る＋ゆっくり沈む＋ゆらゆら
      p.x += (f.x * 0.85 + Math.sin(time * (0.6 + s) + s * 40) * 0.006) * dt;
      p.y += (f.y * 0.85 - 0.004 - s * 0.004 + Math.cos(time * (0.5 + s) + s * 25) * 0.004) * dt;
      p.z += (f.z * 0.85 + Math.sin(time * 0.7 + s * 60) * 0.003) * dt;
      // 水面より上に出たら水の中へ戻す（大きく外れたら別の場所に）
      const lv = levelAt(p.x, p.y, p.z);
      if (lv > 0.05) { place(i, true); continue; }
      if (lv > -0.012) p.y -= (lv + 0.012) * 0.5;
      const fl = floorTopY(p.x) + 0.004;
      if (p.y < fl) p.y = fl;
      p.z = THREE.MathUtils.clamp(p.z, -HZ + 0.006, HZ - 0.006);
      p.x = THREE.MathUtils.clamp(p.x, -HX + 0.006, HX - 0.006);
      clampStadium(p, 0.006);
      p.toArray(pos, i * 3);
      // 光を拾ったときだけ明るく（加算合成なので暗い＝ほぼ見えない）
      const tw = Math.sin(time * (0.8 + s * 1.7) + s * 20);
      const b = (0.12 + 0.5 * tw * tw * tw * tw) * (0.5 + s * 0.6);
      col[i * 3] = b; col[i * 3 + 1] = b * 0.98; col[i * 3 + 2] = b * 0.92;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return { update };
})();

// ===== 結露（水面より上のケース内側に付く水滴。少しずつ育ち、大きい粒は傾いた方へ流れ落ちる） =====
const drops = (() => {
  const N = 70;
  const R_IN_GLASS = HZ + 0.0045;   // ケース内面のすぐ手前
  const zAt = x => { const d = Math.abs(x) - XS; return d <= 0 ? R_IN_GLASS : Math.sqrt(Math.max(0, R_IN_GLASS ** 2 - d * d)); };
  const dx = new Float32Array(N), dy = new Float32Array(N), dr = new Float32Array(N), dmax = new Float32Array(N);
  const alive = new Uint8Array(N);
  const tex = (() => {
    // 水滴：中はほぼ透明、下側のふちが少し暗く、左上に光の点、右下に小さな映り込み
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    let g = x.createRadialGradient(32, 32, 18, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.75, 'rgba(120,135,150,0.28)');
    g.addColorStop(1, 'rgba(90,100,115,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(32, 32, 31, 0, Math.PI * 2); x.fill();
    g = x.createRadialGradient(24, 22, 0, 24, 22, 9);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(24, 22, 9, 0, Math.PI * 2); x.fill();
    g = x.createRadialGradient(40, 43, 0, 40, 43, 8);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(40, 43, 8, 0, Math.PI * 2); x.fill();
    return new THREE.CanvasTexture(c);
  })();
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, toneMapped: false,
  }), N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  tank.add(mesh);
  const m = new THREE.Matrix4();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) mesh.setMatrixAt(i, ZERO);
  const STICK = 0.0075;   // これより大きい粒は流れ始める
  function spawn(i) {
    for (let k = 0; k < 24; k++) {
      const x = (Math.random() - 0.5) * 2 * (HX - 0.012);
      const y = -HY + 0.01 + Math.random() * (H - 0.02);
      if (levelAt(x, y, zAt(x)) > 0.015) {
        dx[i] = x; dy[i] = y; dr[i] = 0.0008;
        dmax[i] = 0.003 + Math.random() * Math.random() * 0.0085;
        alive[i] = 1;
        return;
      }
    }
  }
  let spawnAcc = 0;
  function update(dt) {
    // 空気側の面積に応じて少しずつ現れる
    spawnAcc += dt * 22;
    for (let i = 0; i < N && spawnAcc >= 1; i++) if (!alive[i]) { spawn(i); spawnAcc -= 1; }
    spawnAcc = Math.min(spawnAcc, 3);
    const gx = gEff.x, gy = gEff.y, gl = Math.hypot(gx, gy) || 1;
    for (let i = 0; i < N; i++) {
      if (!alive[i]) continue;
      // 水に触れたら流される
      if (levelAt(dx[i], dy[i], zAt(dx[i])) < 0.004) { alive[i] = 0; mesh.setMatrixAt(i, ZERO); continue; }
      if (dr[i] < dmax[i]) dr[i] = Math.min(dmax[i], dr[i] + dt * 0.004);
      else if (dr[i] < 0.012) dr[i] += dt * 0.00012 * Math.random();   // 結露でゆっくり育つ
      if (dr[i] > STICK) {
        // 大きい粒は傾いた方へ流れ、途中の粒を巻き込んで大きくなる
        const v = (dr[i] - STICK) * 30 * gl;
        dx[i] += (gx / gl * v + Math.sin(time * 9 + i) * v * 0.15) * dt;
        dy[i] += gy / gl * v * dt;
        for (let j = 0; j < N; j++) {
          if (j === i || !alive[j]) continue;
          const d = Math.hypot(dx[j] - dx[i], dy[j] - dy[i]);
          if (d < (dr[i] + dr[j]) * 0.9) {
            dr[i] = Math.min(0.014, Math.cbrt(dr[i] ** 3 + dr[j] ** 3));
            dmax[i] = dr[i];
            alive[j] = 0; mesh.setMatrixAt(j, ZERO);
          }
        }
        // 流れた跡は少し小さくなる（水を残していく）
        dr[i] -= dt * 0.0012 * v / (v + 0.02);
      }
      if (Math.abs(dx[i]) > HX - 0.006 || dy[i] < -HY || dy[i] > HY - 0.004) { alive[i] = 0; mesh.setMatrixAt(i, ZERO); continue; }
      const r = dr[i];
      m.makeScale(r, r * 1.04, 1).setPosition(dx[i], dy[i], zAt(dx[i]));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update };
})();

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
    n: new V3(), e1: new V3(), e2: new V3(), sub: 1, peg: -1, side: PEGS.map(() => 0), vc: new V3(), imp: 0, cool: 0, held: false, mesh,
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
    r.side.fill(0);
  }
}

// 棒のあたり判定用サンプル点（点 + 半径）
const pegSamples = PEGS.map(p => {
  const s = [];
  for (let y = p.base; y < p.tip; y += 0.012) s.push({ p: new V3(p.x, y, 0), r: PEG_R });
  s.push({ p: new V3(p.x, p.tip, 0), r: TIP_R });
  return s;
});

// 皿（棚）の水平断面の符号付き距離：後ろの壁から z=0 までの線分を半径 COLLAR_R で太らせた形
function sdShelf2(pg, px, pz) {
  const dz = pz > 0 ? pz : (pz < SHELF_BACK ? pz - SHELF_BACK : 0);
  return Math.hypot(px - pg.x, dz) - COLLAR_R;
}
// 皿（棚）の符号付き距離（厚み 2*SHELF_HT の板）
function sdShelf(pg, px, py, pz) {
  const wx = sdShelf2(pg, px, pz), wy = Math.abs(py - pg.base) - SHELF_HT;
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0));
}
// 棒が穴を通っている輪は、皿（穴より大きい）より下へ絶対に抜けない一方向の制約
const _cn = new V3(0, 1, 0);
// 下から来た輪（棚の下で軸が穴を通っている）も同様に、棚より上へは抜けない。
// どちら側から来たかは「軸が穴を通り始めた瞬間」の輪の中心の高さで決め、穴から軸が外れるまで覚えておく
const _cd = new V3(0, -1, 0);
function collarBlock(r, pg, i) {
  const side = r.side;
  if (Math.abs(r.n.y) < 0.05) { side[i] = 0; return; }
  // 棒の軸が輪の面と交わる高さ
  const yc = r.p.y - (r.n.x * (pg.x - r.p.x) - r.n.z * r.p.z) / r.n.y;
  if (yc < pg.base - 0.15 || yc > pg.tip || Math.hypot(pg.x - r.p.x, yc - r.p.y, r.p.z) >= R_IN) {
    side[i] = 0;   // 穴を通っていない
    return;
  }
  if (side[i] === 0) side[i] = r.p.y >= pg.base ? 1 : -1;
  const up = side[i] > 0;
  const limY = up ? pg.base + SHELF_HT + TUBE : pg.base - SHELF_HT - TUBE;
  for (let k = 0; k < RING_SAMPLES; k++) {
    const a = k / RING_SAMPLES * Math.PI * 2;
    _fc.copy(r.p).addScaledVector(r.e1, Math.cos(a) * RING_R).addScaledVector(r.e2, Math.sin(a) * RING_R);
    if (sdShelf2(pg, _fc.x, _fc.z) >= TUBE) continue;
    const pen = up ? limY - _fc.y : _fc.y - limY;
    if (pen <= 0) continue;
    const N = up ? _cn : _cd;
    _fp.copy(_fc).addScaledVector(N, -TUBE);
    resolve(r, _fp, N, pen / 0.8, null, 0.1, 0.3);   // resolve は pen*0.8 動かすので全量押し戻す
  }
}
const RING_SAMPLES = 24;
const _fc = new V3(), _fn = new V3(), _fp = new V3();
function shelfContact(r, pg) {
  for (let k = 0; k < RING_SAMPLES; k++) {
    const a = k / RING_SAMPLES * Math.PI * 2;
    _fc.copy(r.p).addScaledVector(r.e1, Math.cos(a) * RING_R).addScaledVector(r.e2, Math.sin(a) * RING_R);
    const d = sdShelf(pg, _fc.x, _fc.y, _fc.z) - TUBE;
    if (d >= 0) continue;
    const e = 1e-4;
    _fn.set(
      sdShelf(pg, _fc.x + e, _fc.y, _fc.z) - sdShelf(pg, _fc.x - e, _fc.y, _fc.z),
      sdShelf(pg, _fc.x, _fc.y + e, _fc.z) - sdShelf(pg, _fc.x, _fc.y - e, _fc.z),
      sdShelf(pg, _fc.x, _fc.y, _fc.z + e) - sdShelf(pg, _fc.x, _fc.y, _fc.z - e),
    );
    if (_fn.lengthSq() < 1e-12) _fn.set(0, Math.sign(_fc.y - pg.base) || 1, 0); else _fn.normalize();
    _fp.copy(_fc).addScaledVector(_fn, -TUBE);
    resolve(r, _fp, _fn, -d * 0.6, null, 0.1, 0.15);
  }
}

const floorPlanes = [];
for (let i = 0; i < FLOOR.length - 1; i++) {
  const [ax, ay] = FLOOR[i], [bx, by] = FLOOR[i + 1];
  const n = new V3(-(by - ay), bx - ax, 0).normalize();
  floorPlanes.push({ n, o: n.x * ax + n.y * ay, x0: ax - 0.03, x1: bx + 0.03 });
}
// 点をトラック型の内側（壁から m 以上内側）へ押し戻す
function clampStadium(p, m) {
  const dx = Math.abs(p.x) - XS;
  if (dx <= 0) return;
  const dist = Math.hypot(dx, p.z), lim = HZ - m;
  if (dist <= lim) return;
  const k = lim / dist;
  p.x = Math.sign(p.x) * (XS + dx * k);
  p.z *= k;
}
// 左右の半円の壁：輪の中心線上の点で判定（正面・背面・天井・底は平面）
const _ew = new V3();
function endWallContact(r, e) {
  if (Math.abs(r.p.x) + RING_R + TUBE < XS) return;
  for (let k = 0; k < RING_SAMPLES; k++) {
    const a = k / RING_SAMPLES * Math.PI * 2;
    _fc.copy(r.p).addScaledVector(r.e1, Math.cos(a) * RING_R).addScaledVector(r.e2, Math.sin(a) * RING_R);
    const dx = Math.abs(_fc.x) - XS;
    if (dx <= 0) continue;
    const dist = Math.hypot(dx, _fc.z);
    const pen = dist + TUBE - HZ;
    if (pen <= 0 || dist < 1e-6) continue;
    _ew.set(-Math.sign(_fc.x) * dx / dist, 0, -_fc.z / dist);   // 内向き
    _fp.copy(_fc).addScaledVector(_ew, -TUBE);
    resolve(r, _fp, _ew, pen, null, e);
  }
}
const wallPlanes = [
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
// burst: 押すたびに送り出される水の勢い（連打で重なる）、taps: 前のフレームから押された回数（素早いタップも取りこぼさない）
const jets = NOZZLES.map(() => ({ pressed: false, held: 0, s: 0, burst: 0, taps: 0 }));
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
  const set = v => { if (v && !jets[i].pressed) jets[i].taps++; jets[i].pressed = v; if (v) jets[i].held = 0; b.classList.toggle('on', v); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); audio.resume(); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
  b.addEventListener('contextmenu', e => e.preventDefault());
});
const keyJet = { f: 0, a: 0, j: 1, l: 1 };
const keys = {};
addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k in keyJet) { const i = keyJet[k]; if (!jets[i].pressed) jets[i].taps++; jets[i].pressed = true; jets[i].held = 0; btns[i].classList.add('on'); }
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
  if (v && !jets[i].pressed) jets[i].taps++;
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
  // ケースの正面を触ったら指紋が付き、なぞると汚れが伸びる。ケースの外をドラッグしたときだけ傾ける（PC など）
  const dh = raycaster.intersectObject(dirt.mesh)[0];
  if (dh) {
    dirt.tap(dh.uv);
    dirt.strokeStart(dh.uv);
    dirtPointer = e.pointerId;
  } else {
    drag = { x: e.clientX, id: e.pointerId };
  }
});
let dirtPointer = null;
function dirtEnd(e) { if (e.pointerId === dirtPointer) { dirtPointer = null; dirt.strokeEnd(); } }
addEventListener('pointerup', releasePointerJet);
addEventListener('pointercancel', releasePointerJet);
addEventListener('pointerup', dirtEnd);
addEventListener('pointercancel', dirtEnd);
addEventListener('pointermove', e => {
  if (drag && e.pointerId === drag.id) tiltTarget = THREE.MathUtils.clamp((e.clientX - drag.x) * -0.004, -1.2, 1.2);
  if (e.pointerId === dirtPointer) {
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const dh = raycaster.intersectObject(dirt.mesh)[0];
    if (dh) dirt.strokeMove(dh.uv); else dirt.strokeEnd();
  }
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
  let ctx = null, pumpGain, pumpFilter, noise, master;
  let lastImpact = 0, lastPop = 0, lastSplash = 0;
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 1;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    pumpFilter = ctx.createBiquadFilter();
    pumpFilter.type = 'lowpass'; pumpFilter.frequency.value = 300;
    pumpGain = ctx.createGain(); pumpGain.gain.value = 0;
    src.connect(pumpFilter).connect(pumpGain).connect(master);
    src.start();
  }
  // 短いノイズを鳴らす（フィルタの種類・周波数・長さ・音量）
  function noiseHit(type, freq, q, dur, vol, sweepTo) {
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }
  return {
    // 輪が壁・棚・棒・他の輪に当たった「コツッ」。水中ではこもった音
    impact(v, underwater) {
      if (!ctx || v <= 0) return;
      const t = ctx.currentTime;
      if (t - lastImpact < 0.025) return;
      lastImpact = t;
      const vol = Math.min(0.35, 0.04 + v * 0.3);
      const fq = (underwater ? 900 : 2200) * (0.8 + Math.random() * 0.5);
      noiseHit('bandpass', fq, underwater ? 2.5 : 4, underwater ? 0.07 : 0.045, vol);
      // 硬いプラスチックの響き（ごく短い音程）
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.frequency.value = (underwater ? 700 : 1700) * (0.85 + Math.random() * 0.4);
      lp.type = 'lowpass'; lp.frequency.value = underwater ? 1100 : 5000;
      g.gain.setValueAtTime(vol * 0.35, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(lp).connect(g).connect(master);
      o.start(t); o.stop(t + 0.08);
    },
    // 泡が水面ではじける「ポコッ」
    pop(n) {
      if (!ctx || n <= 0) return;
      const t = ctx.currentTime;
      if (t - lastPop < 0.035 || Math.random() > Math.min(1, n * 0.25)) return;
      lastPop = t;
      const o = ctx.createOscillator(), g = ctx.createGain();
      const f0 = 350 + Math.random() * 500;
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 2.4, t + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.04, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 0.09);
    },
    // 水が壁に寄って揺れ返す「チャプッ」
    splash(v) {
      if (!ctx || v <= 0) return;
      const t = ctx.currentTime;
      if (t - lastSplash < 0.18) return;
      lastSplash = t;
      noiseHit('lowpass', 1800, 0.8, 0.28, Math.min(0.3, 0.06 + v * 0.25), 260);
      noiseHit('bandpass', 600, 3, 0.12, Math.min(0.15, 0.03 + v * 0.12), 1400);
    },
    resume() { init(); if (ctx.state === 'suspended') ctx.resume(); },
    pump(s) {
      if (!ctx) return;
      pumpGain.gain.setTargetAtTime(s * 0.18, ctx.currentTime, 0.03);
      pumpFilter.frequency.setTargetAtTime(250 + s * 700, ctx.currentTime, 0.05);
    },
    // イルカの「キューキュー」：音程が上下する口笛のような声を細かく震わせて数回
    // happy = true は褒めるときの、高く短く弾む「きゅいきゅい」
    dolphin(n = 3, happy = false) {
      if (!ctx) return;
      const t0 = ctx.currentTime + 0.02;
      for (let k = 0; k < n; k++) {
        const t = t0 + k * (happy ? 0.12 + Math.random() * 0.03 : 0.17 + Math.random() * 0.05);
        const base = happy ? 2500 + Math.random() * 600 : 1900 + Math.random() * 500;
        const o = ctx.createOscillator(), o2 = ctx.createOscillator();
        const g = ctx.createGain(), g2 = ctx.createGain();
        const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
        o.type = 'sine'; o2.type = 'sine';
        o.frequency.setValueAtTime(base, t);
        o.frequency.linearRampToValueAtTime(base * 1.75, t + 0.06);
        o.frequency.linearRampToValueAtTime(base * 1.25, t + 0.13);
        o2.frequency.setValueAtTime(base * 2, t);
        o2.frequency.linearRampToValueAtTime(base * 3.5, t + 0.06);
        o2.frequency.linearRampToValueAtTime(base * 2.5, t + 0.13);
        lfo.frequency.value = 38; lfoG.gain.value = 90;
        lfo.connect(lfoG); lfoG.connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.11, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.025, t + 0.015);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        o.connect(g).connect(master);
        o2.connect(g2).connect(master);
        for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + 0.17); }
      }
    },
    clink() {
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 1500 + Math.random() * 300;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      o.connect(g).connect(master);
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

let sloshPeak = 0, sloshPrev = 0;
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
  sloshPeak = Math.max(sloshPeak, Math.abs(sloshV));
  if (Math.sign(sloshV) !== Math.sign(sloshPrev) && sloshPeak > 0.7) {
    audio.splash(Math.min(1, (sloshPeak - 0.7) / 2.5));
    sloshPeak = 0;
  }
  if (Math.sign(sloshV) !== Math.sign(sloshPrev)) sloshPeak = 0;
  sloshPrev = sloshV;
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
    if (r.held) continue;   // イルカが運んでいる輪は物理で動かさない
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

  for (const r of rings) r.vc.copy(r.v);   // 当たった強さ（接触による速度の変化）を音に使う
  for (const r of rings) {
    if (r.held) continue;
    const contactE = 0.1 + 0.3 * (1 - r.sub);
    for (const pl of wallPlanes) {
      _d.copy(pl.n).negate();
      support(r, _d, _sp);
      const pen = pl.o - pl.n.dot(_sp);
      if (pen > 0) resolve(r, _sp, pl.n, pen, null, contactE);
    }
    endWallContact(r, contactE);
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
      shelfContact(r, pg);
      collarBlock(r, pg, i);
    }
  }

  for (let a = 0; a < rings.length; a++) {
    for (let b = a + 1; b < rings.length; b++) {
      const A = rings[a], B = rings[b];
      if (A.p.distanceToSquared(B.p) > 4 * (RING_R + TUBE) ** 2) continue;
      for (const [P, Q] of [[A, B], [B, A]]) {
        if (Q.held) continue;   // 運ばれている輪は動かない壁として扱う
        for (let k = 0; k < 16; k++) {
          const ang = k / 16 * Math.PI * 2;
          _ci.copy(P.p).addScaledVector(P.e1, Math.cos(ang) * RING_R).addScaledVector(P.e2, Math.sin(ang) * RING_R);
          const pen = torusContact(Q, _ci, TUBE);
          if (pen > 0) resolve(Q, contactP, contactN, pen * 0.5, P.held ? null : P, 0.1, 0.2);
        }
      }
    }
  }

  // 輪どうしの押し合いで皿の下へ押し込まれないよう、最後にもう一度かける
  for (const r of rings) if (!r.held) PEGS.forEach((pg, i) => collarBlock(r, pg, i));

  for (const r of rings) {
    if (r.held) continue;
    r.p.x = THREE.MathUtils.clamp(r.p.x, -HX + TUBE, HX - TUBE);
    r.p.y = THREE.MathUtils.clamp(r.p.y, -HY + TUBE, HY - TUBE);
    r.p.z = THREE.MathUtils.clamp(r.p.z, -HZ + TUBE, HZ - TUBE);
    clampStadium(r.p, TUBE);
    r.imp = Math.max(r.imp, r.v.distanceTo(r.vc));
  }
}

// 輪の穴を棒が貫いているか
function hookedPeg(r) {
  if (Math.abs(r.n.y) < 0.2) return -1;
  for (let i = 0; i < PEGS.length; i++) {
    const pg = PEGS[i];
    const y = r.p.y - (r.n.x * (pg.x - r.p.x) - r.n.z * r.p.z) / r.n.y;
    // 棚より上で、上側から入った輪だけ（下から棚に押し付けられている輪は数えない）
    if (y < pg.base || y > pg.tip || r.side[i] < 0) continue;
    if (Math.hypot(pg.x - r.p.x, y - r.p.y, r.p.z) < R_IN) return i;
  }
  return -1;
}

// ===== 当たった音 =====
function updateImpactSounds(dt) {
  let n = 0;
  for (const r of rings) {
    r.cool -= dt;
    if (r.imp > 0.16 && r.cool <= 0 && n < 2) {
      audio.impact((r.imp - 0.16) * 1.1, r.sub > 0.5);
      r.cool = 0.12;
      n++;
    }
    r.imp = 0;
  }
}

// ===== 泡 =====
const _bp = new V3(), _bf = new V3(), _up = new V3();
function updateBubbles(dt) {
  let pops = 0;
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
    clampStadium(_bp, 0.005);
    const atSurface = levelAt(_bp.x, _bp.y, _bp.z) > -0.005;
    if (atSurface) pops++;
    if (atSurface || bubbleLife[i] > 5) {
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
  audio.pop(pops);
  bubbleGeo.setDrawRange(0, bubbleCount);
  bubbleGeo.attributes.position.needsUpdate = true;
}

// ===== 水平リセット（寝転がったままなど、今の持ち方を水平として登録） =====
const levelCal = { q: new THREE.Quaternion(), on: false };
const gRaw = new V3(0, -1, 0);
try {
  const saved = JSON.parse(localStorage.getItem('aquaRingLevel'));
  if (Array.isArray(saved) && saved.length === 4) { levelCal.q.fromArray(saved); levelCal.on = true; }
} catch { }
const levelBtn = document.getElementById('levelBtn');
const unlevelBtn = document.getElementById('unlevelBtn');
let toastT = 0, toastMsg = '';
function toast(msg) { toastMsg = msg; toastT = 1.8; }
function setLevelCal(on) {
  levelCal.on = on;
  if (on) {
    levelCal.q.setFromUnitVectors(gRaw.clone().normalize(), new V3(0, -1, 0));
    localStorage.setItem('aquaRingLevel', JSON.stringify(levelCal.q.toArray()));
    toast('今の持ち方を水平にしました');
  } else {
    levelCal.q.identity();
    localStorage.removeItem('aquaRingLevel');
    toast('水平を元に戻しました');
  }
  unlevelBtn.classList.toggle('hidden', !on);
}
unlevelBtn.classList.toggle('hidden', !levelCal.on);
levelBtn.addEventListener('click', () => { if (sensor.has) setLevelCal(true); });

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
    // 水平リセット：登録した持ち方を「まっすぐ」とみなす
    gRaw.copy(gTarget);
    if (levelCal.on) gTarget.applyQuaternion(levelCal.q);
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

  // ポンプ：実物のように1回押すごとに一定量の水を送り出す。連打すると重なって強くなり、長押しでは強くならない
  let pump = 0;
  for (const j of jets) {
    j.held += dt;
    if (j.taps) j.burst = Math.min(1.7, j.burst + 0.95 * j.taps);
    j.taps = 0;
    j.burst *= Math.exp(-dt / 0.38);
    const target = j.burst + (j.pressed ? 0.12 : 0);
    j.s += (target - j.s) * (1 - Math.exp(-dt * (target > j.s ? 18 : 6)));
    pump = Math.max(pump, j.s);
  }
  stir = Math.min(1.5, (stir + (jets[0].s + jets[1].s) * dt * 2) * Math.exp(-dt / 1.2));
  audio.pump(pump);
  pushButtons.forEach((b, i) => { b.position.z = jets[i].pressed ? BTN_Z_DOWN : BTN_Z_UP; });
}

// ===== お助けイルカ（輪を1つ拾って棒に入れてくれる。使うと10分休憩） =====
const dolphin = (() => {
  const L = 0.30;          // 体長
  const HALF = L / 2;
  const COOLDOWN = 10 * 60 * 1000;
  const group = new THREE.Group();
  const mats = [];
  const mat = (o) => { const m = new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0, ...o }); mats.push(m); return m; };

  // 胴体：尾→口先の輪郭を回転させ、x 方向（頭が +x）に寝かせる。背中は青灰色、お腹は白っぽく
  const prof = [[0, 0.004], [0.03, 0.010], [0.07, 0.021], [0.12, 0.034], [0.17, 0.043], [0.21, 0.044],
    [0.24, 0.038], [0.258, 0.029], [0.268, 0.016], [0.274, 0.010], [0.296, 0.008], [0.30, 0]]
    .map(([y, r]) => new THREE.Vector2(r, y));
  const bodyGeo = new THREE.LatheGeometry(prof, 28);
  bodyGeo.rotateZ(-Math.PI / 2);
  bodyGeo.translate(-HALF, 0, 0);
  bodyGeo.scale(1, 1, 0.82);
  bodyGeo.computeVertexNormals();
  {
    const n = bodyGeo.attributes.normal, colors = [];
    const back = new THREE.Color(0x587a95), belly = new THREE.Color(0xe4ecf1), c = new THREE.Color();
    for (let i = 0; i < n.count; i++) {
      c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(n.getY(i), -0.35, 0.25));
      colors.push(c.r, c.g, c.b);
    }
    bodyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  const skin = mat({ vertexColors: true, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const finMat = mat({ color: 0x557792, roughness: 0.4, clearcoat: 0.5 });
  group.add(new THREE.Mesh(bodyGeo, skin));
  const extrude = (shape, depth) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  // 背びれ
  {
    const s = new THREE.Shape();
    s.moveTo(0.02, 0);
    s.quadraticCurveTo(0.0, 0.032, -0.04, 0.058);
    s.quadraticCurveTo(-0.032, 0.022, -0.05, 0);
    s.closePath();
    const fin = new THREE.Mesh(extrude(s, 0.006), finMat);
    fin.position.set(-0.005, 0.036, 0);
    fin.scale.set(1, 0.72, 1);
    group.add(fin);
  }
  // 胸びれ（左右）
  for (const side of [1, -1]) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(-0.012, -0.03, -0.042, -0.036);
    s.quadraticCurveTo(-0.022, -0.012, -0.018, 0);
    s.closePath();
    const fin = new THREE.Mesh(extrude(s, 0.004), finMat);
    fin.position.set(0.075, -0.016, side * 0.028);
    fin.rotation.x = side * 0.55;
    group.add(fin);
  }
  // 尾びれ（付け根を軸に上下に振る）
  const tail = new THREE.Group();
  tail.position.set(-HALF + 0.004, 0, 0);
  {
    const s = new THREE.Shape();
    s.moveTo(0.004, 0);
    s.quadraticCurveTo(-0.02, 0.03, -0.05, 0.062);
    s.quadraticCurveTo(-0.034, 0.028, -0.03, 0);
    s.quadraticCurveTo(-0.034, -0.028, -0.05, -0.062);
    s.quadraticCurveTo(-0.02, -0.03, 0.004, 0);
    const g = extrude(s, 0.005);
    g.rotateX(Math.PI / 2);   // 水平な尾びれ
    tail.add(new THREE.Mesh(g, finMat));
  }
  group.add(tail);
  // 目
  const eyeMat = mat({ color: 0x111418, roughness: 0.15, clearcoat: 1 });
  for (const side of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 10), eyeMat);
    eye.position.set(HALF - 0.042, 0.009, side * 0.0225);   // 体の表面に半分埋める
    eye.scale.set(1, 1, 0.7);
    group.add(eye);
  }
  group.visible = false;
  tank.add(group);

  // ---- 動き ----
  const C = new V3(), V = new V3(), T = new V3(), fwd = new V3(), nose = new V3(), tmp = new V3();
  const Zax = new V3(0, 0, 1), Yax = new V3(0, 1, 0);
  const qFrom = new THREE.Quaternion(), qTo = new THREE.Quaternion();
  const pFrom = new V3();
  // heading: 画面と平行な面の中での進行方向（0 = 右向き）。roll: 左向きのときに背中を上に保つひねり。spin: 喜びの一回転
  let phase = 'idle', pt = 0, heading = 0, roll = 0, spin = 0, alpha = 0, swimT = 0;
  // 褒めるとき：up = 立ち姿勢への移り具合（0〜1）、nod = うなずき
  let praiseMode = false, up = 0, nod = 0, chirped = 0;
  const qTilt = new THREE.Quaternion(), Xax = new V3(1, 0, 0);
  let ring = null, peg = 0;
  let until = 0;   // 休憩が終わる時刻（保存しないので、リロードやリセットで元に戻る）
  localStorage.removeItem('aquaRingDolphinUntil');

  function setOpacity(a) { for (const m of mats) m.opacity = a; }
  function waterTop(x) {   // その x での水面の高さ（おおよそ）
    if (Math.abs(sN.y) < 0.2) return HY;
    return (cS - sN.x * x) / sN.y;
  }
  function clampCenter(p) {
    p.x = THREE.MathUtils.clamp(p.x, -HX + HALF + 0.02, HX - HALF - 0.02);
    p.y = THREE.MathUtils.clamp(p.y, floorTopY(p.x) + 0.06, Math.min(HY - 0.06, waterTop(p.x) - 0.06));
    p.z = 0;
  }
  // 口先が目標に来るよう、体の中心の目標を決める
  function aimNose(target, faceSign) {
    T.copy(target);
    T.x -= faceSign * HALF;
    clampCenter(T);
  }
  function computeNose() {
    fwd.set(Math.cos(heading), Math.sin(heading), 0);
    nose.copy(C).addScaledVector(fwd, HALF);
  }
  // 口先と尾の先がケースの内側（床・壁・天井・水面付近）に収まるよう体ごとずらす
  function keepInside() {
    fwd.set(Math.cos(heading), Math.sin(heading), 0);
    for (let it = 0; it < 2; it++) {
      for (const sgn of [1, -1]) {
        const ex = C.x + fwd.x * HALF * sgn, ey = C.y + fwd.y * HALF * sgn;
        // 尾側は横に広い尾びれがあるので、左右の丸い端（狭くなる所）からは余裕をとる。口先側は細いので端の近くまで
        const xl = sgn < 0 ? HX - 0.13 : HX - 0.035;
        if (ex > xl) C.x -= ex - xl;
        if (ex < -xl) C.x += -xl - ex;
        const lo = floorTopY(THREE.MathUtils.clamp(ex, -HX, HX)) + 0.045;
        const hi = Math.min(HY - 0.05, waterTop(ex) + 0.03);
        if (ey < lo) C.y += lo - ey;
        else if (ey > hi) C.y -= ey - hi;
      }
      const lo = floorTopY(C.x) + 0.05;
      if (C.y < lo) C.y = lo;
    }
    C.z = 0;
  }
  function swim(dt, maxSpd) {
    tmp.subVectors(T, C);
    const d = tmp.length();
    const spd = Math.min(maxSpd, d * 2.2);
    if (d > 1e-4) tmp.multiplyScalar(spd / d); else tmp.set(0, 0, 0);
    V.lerp(tmp, 1 - Math.exp(-dt * 3));
    C.addScaledVector(V, dt);
    // 進む方向へ向きを変える（奥行き方向には回らず、画面と平行な面の中で宙返りするように曲がる）
    if (V.length() > 0.04) {
      let dh = Math.atan2(V.y, V.x) - heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      // 真後ろへのUターンは、下に余裕があれば下回り、なければ上回り
      if (Math.abs(dh) > 2.8) dh = (C.y > floorTopY(C.x) + 0.2 ? -1 : 1) * Math.abs(dh);
      heading += THREE.MathUtils.clamp(dh, -3.2 * dt, 3.2 * dt);
    }
    // 左向きのときは体をひねって背中を上に
    const rollT = Math.cos(heading) < 0 ? Math.PI : 0;
    roll += (rollT - roll) * (1 - Math.exp(-dt * 5));
    keepInside();
    return d;
  }
  function pose(dt) {
    swimT += dt * (4 + V.length() * 14);
    tail.rotation.z = Math.sin(swimT) * 0.45;
    group.position.copy(C);
    group.position.y += Math.sin(swimT) * 0.004;
    group.rotation.set(roll + spin, 0, heading + Math.sin(swimT + 1.2) * 0.05, 'ZYX');
    if (up > 0) {
      // 口先をこちらへ少し傾けてうなずく（体は縦なので、傾けても奥行きからはみ出さない）
      qTilt.setFromAxisAngle(Xax, THREE.MathUtils.smoothstep(up, 0, 1) * (0.24 + nod));
      group.quaternion.premultiply(qTilt);
    }
    group.updateMatrix();
    computeNose();
  }
  // 運んでいる輪：口先に通した状態（輪の軸＝体の向き）
  function carryPose(p, q) {
    p.copy(nose).addScaledVector(fwd, -0.03);
    q.setFromUnitVectors(Zax, fwd);
  }
  function release(drop) {
    if (!ring) return;
    ring.held = false;
    ring.v.set(0, drop ? -0.25 : 0, 0);
    ring.w.set(0, 0, 0);
    ring.side.fill(0);
    ring = null;
  }
  function pickRing() {
    let best = null, bd = Infinity;
    for (const r of rings) {
      if (r.peg >= 0 || r.held) continue;
      const d = r.p.distanceTo(C);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  function go(name) { phase = name; pt = 0; }

  function start() {
    if (phase !== 'idle') return false;
    // 入ってくる側：輪の反対側から
    const cand = rings.filter(r => r.peg < 0 && !r.held);
    praiseMode = cand.length === 0;
    if (!praiseMode && Date.now() < until) return false;   // 褒めに来るのは休憩中でもOK
    up = 0; nod = 0; chirped = 0;
    const side = praiseMode ? (Math.random() < 0.5 ? -1 : 1)
      : cand.reduce((s, r) => s + r.p.x, 0) / cand.length > 0 ? -1 : 1;
    C.set(side * (HX - HALF - 0.1), 0, 0);
    clampCenter(C);
    V.set(0, 0, 0);
    heading = side > 0 ? Math.PI : 0;   // 内側を向いて登場
    roll = side > 0 ? Math.PI : 0; spin = 0; alpha = 0;
    group.visible = true;
    ring = null;
    go('in');
    audio.dolphin(3);
    if (!praiseMode) until = Date.now() + COOLDOWN;
    return true;
  }
  function abort() {
    release(false);
    if (phase !== 'idle') go('out');
  }

  function update(dt) {
    if (phase === 'idle') return;
    pt += dt;
    switch (phase) {
      case 'in':
        alpha = Math.min(1, pt / 0.8);
        T.copy(C); swim(dt, 0.3);
        if (pt > 0.9) {
          if (praiseMode) { go('toCenter'); break; }
          ring = pickRing();
          if (!ring) { go('out'); break; }
          go('toRing');
        }
        break;
      case 'toCenter': {
        // 真ん中へ泳いでくる
        alpha = Math.min(1, alpha + dt / 0.6);
        T.set(0, 0.04, 0); clampCenter(T);
        const dC = swim(dt, 0.45);
        if (dC < 0.03 || pt > 2.8) go('praise');
        break;
      }
      case 'praise': {
        // 立ち上がってこっちを向き、うなずきながら「きゅいきゅい」
        V.multiplyScalar(Math.exp(-dt * 4));
        C.addScaledVector(V, dt);
        // ① 画面と平行なまま口先を上へ ② 体の軸まわりにひねってお腹をこちらへ ③ 口先をこちらへ傾ける
        let dh = Math.PI / 2 - heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        heading += dh * (1 - Math.exp(-dt * 5));
        const rT = -Math.PI / 2 + Math.PI * 2 * Math.round((roll + Math.PI / 2) / (Math.PI * 2));
        if (Math.abs(dh) < 0.35) roll += (rT - roll) * (1 - Math.exp(-dt * 5));
        const ready = Math.abs(dh) < 0.15 && Math.abs(rT - roll) < 0.2;
        up = pt < 2.8 ? (ready ? Math.min(1, up + dt / 0.4) : up) : Math.max(0, up - dt / 0.6);
        nod = Math.sin(pt * 7.5) * 0.13 * up;
        C.y += Math.sin(pt * 3.2) * 0.012 * dt * 3;
        if (chirped === 0 && pt > 0.55) { audio.dolphin(4, true); chirped = 1; }
        if (chirped === 1 && pt > 1.7) { audio.dolphin(5, true); chirped = 2; }
        if (pt > 3.4 && up <= 0) { up = 0; nod = 0; go('out'); }
        break;
      }
      case 'toRing': {
        if (ring.peg >= 0 || ring.held) { ring = pickRing(); if (!ring) { go('out'); break; } }
        aimNose(ring.p, Math.sign(ring.p.x - C.x) || 1);
        const dC = swim(dt, 0.6);
        computeNose();
        // 口先が届いたら（体を傾けて泳ぐので、体の中心が目標に着いた時もOK）
        if (nose.distanceTo(ring.p) < 0.07 || dC < 0.03 || pt > 4) {
          ring.held = true;
          pFrom.copy(ring.p); qFrom.copy(ring.q);
          go('grab');
        }
        break;
      }
      case 'grab': {
        T.copy(C); swim(dt, 0.2);
        computeNose();
        const k = THREE.MathUtils.smoothstep(pt / 0.35, 0, 1);
        carryPose(tmp, qTo);
        ring.p.lerpVectors(pFrom, tmp, k);
        ring.q.slerpQuaternions(qFrom, qTo, k);
        if (pt > 0.35) {
          // 近いほうの棒へ
          peg = Math.abs(PEGS[0].x - C.x) < Math.abs(PEGS[1].x - C.x) ? 0 : 1;
          audio.dolphin(2);
          go('toPeg');
        }
        break;
      }
      case 'toPeg': {
        const pg = PEGS[peg];
        const face = Math.sign(pg.x - C.x) || (Math.cos(heading) >= 0 ? 1 : -1);
        aimNose(tmp.set(pg.x, Math.min(pg.tip + 0.09, waterTop(pg.x) - 0.04), 0), face);
        const dC = swim(dt, 0.55);
        computeNose();
        carryPose(ring.p, ring.q);
        if (Math.hypot(nose.x - pg.x, nose.y - (pg.tip + 0.09)) < 0.05 || dC < 0.03 || pt > 3.5) {
          pFrom.copy(ring.p); qFrom.copy(ring.q);
          go('place');
        }
        break;
      }
      case 'place': {
        // 輪を水平にして棒の真上へ → そのまま棒に通して放す
        const pg = PEGS[peg];
        T.copy(C); swim(dt, 0.15);
        qTo.setFromUnitVectors(Zax, Yax);
        const k1 = THREE.MathUtils.smoothstep(pt / 0.55, 0, 1);
        const k2 = THREE.MathUtils.smoothstep((pt - 0.55) / 0.6, 0, 1);
        tmp.set(pg.x, pg.tip + 0.035, 0);
        ring.p.lerpVectors(pFrom, tmp, k1);
        ring.p.y -= k2 * 0.09;
        ring.q.slerpQuaternions(qFrom, qTo, k1);
        if (pt > 1.15) {
          release(true);
          audio.dolphin(3);
          go('yay');
        }
        break;
      }
      case 'yay':
        // くるっと一回転してから帰る
        spin = THREE.MathUtils.smoothstep(pt / 1.1, 0, 1) * Math.PI * 2;
        T.set(C.x, C.y + 0.05, 0); clampCenter(T);
        swim(dt, 0.25);
        if (pt > 1.2) { spin = 0; go('out'); }
        break;
      case 'out':
        alpha = Math.max(0, alpha - dt / 0.8);
        up = Math.max(0, up - dt / 0.5); nod = 0;
        T.set(C.x + (Math.cos(heading) >= 0 ? 0.3 : -0.3), C.y, 0); clampCenter(T);
        swim(dt, 0.4);
        if (alpha <= 0) { group.visible = false; go('idle'); }
        break;
    }
    if (phase === 'idle') return;
    setOpacity(alpha);
    pose(dt);
    if (ring && phase === 'toPeg') carryPose(ring.p, ring.q);
    if (ring) { ring.v.set(0, 0, 0); ring.w.set(0, 0, 0); }
    // 泳ぐ体でほかの輪をやさしく押しのける
    tmp.copy(C).addScaledVector(fwd, -HALF);
    for (const r of rings) {
      if (r === ring || r.peg >= 0) continue;   // 棒に入っている輪は押し出さない
      const ab = fwd, ap = r.p.clone().sub(tmp);
      const t = THREE.MathUtils.clamp(ap.dot(ab), 0, L);
      const q = tmp.clone().addScaledVector(ab, t);
      const d = r.p.distanceTo(q);
      const R = 0.045 + RING_R * 0.5;
      if (d < R && d > 1e-5 && alpha > 0.3) {
        const push = r.p.clone().sub(q).multiplyScalar((R - d) / d);
        r.p.addScaledVector(push, 0.5);
        r.v.addScaledVector(push, 6);
      }
    }
  }
  function praise() {
    if (phase === 'idle') { start(); return; }
    if (ring) return;
    praiseMode = true; spin = 0; chirped = 0;
    go('toCenter');
  }
  function remaining() { return Math.max(0, until - Date.now()); }
  function resetCooldown() { until = 0; }
  return {
    start, abort, update, remaining, resetCooldown, praise,
    get busy() { return phase !== 'idle'; },
    get praising() { return praiseMode && phase !== 'idle' && phase !== 'out'; },
  };
})();

// ===== ゲーム進行 =====
const dolphinBtn = document.getElementById('dolphinBtn');
const fmtMs = ms => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
dolphinBtn.addEventListener('click', () => {
  audio.resume();
  if (!playing || dolphin.busy) return;
  if (!dolphin.start()) {
    const ms = dolphin.remaining();
    if (ms > 0) toast(`イルカは休憩中です（あと ${fmtMs(ms)}）`);
  }
});
let dolphinLabel = '';
function updateDolphinBtn() {
  const ms = dolphin.remaining();
  const label = ms > 0 ? `🐬 ${fmtMs(ms)}` : '🐬';
  if (label !== dolphinLabel) {
    dolphinLabel = label;
    dolphinBtn.textContent = label;
    dolphinBtn.classList.toggle('cool', ms > 0);
  }
}
const scoreEl = document.getElementById('score');
const timeEl = document.getElementById('time');
const sensorEl = document.getElementById('sensor');
const clearEl = document.getElementById('clear');

let clearWait = -1;   // クリア後、イルカが褒め終わるのを待つ時間（-1 = 待っていない）
function updateGame(dt) {
  let hooked = 0;
  for (const r of rings) {
    let p = r.held ? -1 : hookedPeg(r);
    // 保険：一度入った輪は、見た目で皿をすり抜けても棒の真下付近に残っていればカウントし続ける
    if (p < 0 && r.peg >= 0 && !r.held) {
      const pg = PEGS[r.peg];
      if (r.side[r.peg] >= 0 && r.p.y < pg.tip && r.p.y > pg.base - 0.15 && Math.hypot(r.p.x - pg.x, r.p.z) < RING_R + TUBE) p = r.peg;
    }
    r.peg = p;
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
      // 全部入ったらイルカがこっちを向いて褒めに来る。カードは褒め終わってから
      dolphin.praise();
      clearWait = 0;
    }
  } else if (clearWait >= 0) {
    clearWait += dt;
    if ((!dolphin.praising && clearWait > 0.5) || clearWait > 7) {
      clearEl.classList.remove('hidden');
      clearWait = -1;
    }
  }
  updateDolphinBtn();
  if (toastT > 0) toastT -= dt;
  sensorEl.textContent = toastT > 0 ? toastMsg : sensor.has ? `傾きセンサー ON${levelCal.on ? '（水平登録中）' : ''}` : '';
  if (sensor.has === levelBtn.classList.contains('hidden')) levelBtn.classList.toggle('hidden', !sensor.has);
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
  clearWait = -1;
  dolphin.abort();
  dolphin.resetCooldown();
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
  if (kind === 'wipe') dirt.wipe();
  if (kind === 'unlevel') setLevelCal(false);
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
  water.visible = surface.visible = glass.visible = dirt.mesh.visible = drops.mesh.visible = false;
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  water.visible = surface.visible = glass.visible = dirt.mesh.visible = drops.mesh.visible = true;
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
  updateImpactSounds(dt);
  dolphin.update(dt);
  motes.update(dt);
  drops.update(dt);
  updateGame(dt);
  dirt.update(dt, gEff);
  syncVisuals();
  render();
}
requestAnimationFrame(frame);
