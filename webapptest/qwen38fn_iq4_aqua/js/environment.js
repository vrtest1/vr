import * as THREE from 'three';

export const TANK = {
  W: 250, D: 120, H: 50,          // 幅(X) 奥行(Z) 高さ(Y)
  hw: 125, hd: 60,                 // half extents
  margin: 9,                       // 生物の壁マージン
  floorPad: 1.6, ceilPad: 2.2,
};
TANK.xMin = -TANK.hw + TANK.margin;
TANK.xMax =  TANK.hw - TANK.margin;
TANK.zMin = -TANK.hd + TANK.margin;
TANK.zMax =  TANK.hd - TANK.margin;
TANK.yMin = TANK.floorPad;
TANK.yMax = TANK.H - TANK.ceilPad;

// ---- fog helpers shared with custom shaders ----
export function fogGlsl() {
  return `
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    float fogAmount(float dist){
      float f = uFogDensity * dist;
      return 1.0 - exp(-f * f);
    }`;
}
export function fogUniforms(scene) {
  return {
    uFogColor:   { value: scene.fog.color.clone() },
    uFogDensity: { value: scene.fog.density },
  };
}

// 乱数（再現性のあるLCG）
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ============================================================
// 共有：時刻uniform（コースティクス等を1ソースで駆動）
// ============================================================
export const uTimeShared = { value: 0 };

// 共有：太陽（単一 DirectionalLight）のシャドウマップ。床/柱の
// MeshStandard/Basic マテリアルは onBeforeCompile でこれを直接サンプルする
// （raw シェーダでも NUM_DIR_LIGHT_SHADOWS 等の define 不要で堅牢）。
export const SHADOW = {
  map:     { value: null },   // 実マップ束結済みなら light.shadow.map.texture、それまで 1x1 白
  matrix:  { value: new THREE.Matrix4() }, // light.shadow.matrix を毎フレームコピー
  mapSize: { value: new THREE.Vector2(1, 1) },
  bias:    { value: 0.0009 },
  on:      { value: 0 },      // 実マップ束結後 1
};
let _shadowLight = null;

// 1x1 白 = 常に「光が当たる」。実シャドウマップが用意できるまでの仮バインド用
function _whiteShadowTexture() {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

// 波動網状コースティクス（床・岩・生物で共有する単一ソース）
const CAUSTIC_GLSL = `
float _causticLayer(vec2 p, float t){
  float w = 0.0;
  for (int i = 0; i < 3; i++){
    float fi = float(i);
    vec2 q = p * (1.0 + fi * 0.55);
    float v = sin(q.x + sin(q.y * 1.35 + t * (0.55 + 0.18 * fi)) + t * 0.35)
            * cos(q.y * 1.15 - cos(q.x * 0.85 - t * (0.42 + 0.11 * fi)));
    w += 0.8 - abs(v);
  }
  return clamp(w / 2.4, 0.0, 1.0);
}
// 床と同一の二層コースティクス値（0..~1.85）
float _causticValue(vec2 xz, float t){
  float c1 = _causticLayer(xz * 0.14, t * 1.15);
  float c2 = _causticLayer(xz * 0.06 + 37.0, t * 0.72 + 11.0);
  return pow(c1, 4.0) * 1.15 + pow(c2, 3.5) * 0.7;
}`;

const SHADOW_GLSL = `
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec2 uShadowMapSize;
uniform float uShadowOn;
uniform float uShadowBias;
// three.js の packing.unpackRGBAToDepth と同一係数（<packing> の include 順序に依存しないよう自前定義）
const vec4 AQ_UNPACK = vec4( 0.99609375 / 16777216.0, 0.99609375 / 65536.0, 0.99609375 / 256.0, 0.99609375 );
float aqUnpack( const in vec4 v ){ return dot( v, AQ_UNPACK ); }
float aqShadow(vec3 wpos){
  if (uShadowOn < 0.5) return 1.0;
  vec4 c = uShadowMatrix * vec4(wpos, 1.0);
  // three の shadow.matrix はバイアス(*0.5+0.5)を織り済み → パースペクティブ除算のみで [0,1]
  vec3 uvz = c.xyz / max(c.w, 1e-4);
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) return 1.0;
  vec2 ts = 1.0 / uShadowMapSize;
  float sum = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 off = vec2(float(x), float(y)) * ts;
      sum += step(uvz.z - uShadowBias, aqUnpack(texture2D(uShadowMap, uvz.xy + off)));
    }
  return mix(0.30, 1.0, (sum / 9.0) * 0.7 + 0.3);
}`;

// MeshBasic（床）用：影受け + コースティクス + 距離フォグ（内蔵fog_fragmentに委譲）
function patchFloorBasic(m) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTimeShared;
    shader.uniforms.uShadowMap = SHADOW.map;
    shader.uniforms.uShadowMatrix = SHADOW.matrix;
    shader.uniforms.uShadowMapSize = SHADOW.mapSize;
    shader.uniforms.uShadowOn = SHADOW.on;
    shader.uniforms.uShadowBias = SHADOW.bias;
    shader.uniforms.uTank = { value: new THREE.Vector2(TANK.W, TANK.D) };
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );
    shader.fragmentShader =
      `uniform float uTime;\nuniform vec2 uTank;\nvarying vec3 vWPos;\n${SHADOW_GLSL}\n${CAUSTIC_GLSL}\n` +
      shader.fragmentShader.replace('#include <opaque_fragment>',
        `#include <opaque_fragment>
        float _sh = aqShadow(vWPos);
        float _edge = 1.0 - smoothstep(40.0, 135.0, length(vec2(vWPos.x * 0.55, vWPos.z)));
        float _c = _causticValue(vWPos.xz, uTime) * (0.35 + 0.65 * _edge);
        gl_FragColor.rgb *= _sh;
        gl_FragColor.rgb += vec3(0.45, 0.72, 0.78) * _c * _sh;`);
  };
  m.customProgramCacheKey = () => 'aqFloorBasic';
  return m;
}

// MeshStandard 用の統合パッチ（影受け / コースティクス投影 を1回の onBeforeCompile で）
function patchStandard(m, opts = {}) {
  const shadow = !!opts.shadow, caustic = !!opts.caustic;
  if (!shadow && !caustic) return m;
  const tag = 'aq_' + (shadow ? 's' : '') + (caustic ? 'c' : '');
  if (m.userData && m.userData[tag]) return m;
  const strength = opts.strength != null ? opts.strength : 0.85;
  const depthFade = !!opts.depthFade;
  m.userData = m.userData || {}; m.userData[tag] = true;
  m.onBeforeCompile = (shader) => {
    // 頂点：ワールド位置（＋必要ならワールド法線）を渡す
    shader.vertexShader = (caustic ? 'varying vec3 vWPos; varying vec3 vWNormal;\n' : 'varying vec3 vWPos;\n') +
      shader.vertexShader
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        .replace('#include <beginnormal_vertex>',
          caustic ? '#include <beginnormal_vertex>\n vWNormal = mat3(modelMatrix) * objectNormal;' : '#include <beginnormal_vertex>');
    if (shadow) {
      shader.uniforms.uShadowMap = SHADOW.map;
      shader.uniforms.uShadowMatrix = SHADOW.matrix;
      shader.uniforms.uShadowMapSize = SHADOW.mapSize;
      shader.uniforms.uShadowOn = SHADOW.on;
      shader.uniforms.uShadowBias = SHADOW.bias;
    }
    if (caustic) { shader.uniforms.uTime = uTimeShared; shader.uniforms.uCausticStrength = { value: strength }; }
    let pre = 'varying vec3 vWPos;\n';
    if (caustic) pre += `uniform float uTime; uniform float uCausticStrength;\nvarying vec3 vWNormal;\n${CAUSTIC_GLSL}\n`;
    if (shadow) pre += `${SHADOW_GLSL}\n`;
    const opaque = caustic ? `
        // DoubleSide 法線の裏返し（マンタ胸びれ等）を前面補正し、上向きで最も強く、
        // 側面/垂直ヒレにも乗せ、下面（腹側）は暗いまま維持
        vec3 _nw = normalize(vWNormal);
        _nw *= gl_FrontFacing ? 1.0 : -1.0;
        float _ny = _nw.y;
        float _up = _ny >= 0.0 ? (0.5 + 0.5 * _ny) : max(0.0, 0.5 * (1.0 + _ny / 0.28));
        float _h = ${depthFade ? 'mix(0.55, 1.0, smoothstep(1.0, 18.0, vWPos.y))' : '1.0'};
        float _cv = _causticValue(vWPos.xz, uTime) * _up * _h * uCausticStrength;
        gl_FragColor.rgb += vec3(0.45, 0.72, 0.78) * _cv${shadow ? ' * aqShadow(vWPos)' : ''};` : '';
    const shadowLine = shadow ? `\n        gl_FragColor.rgb *= aqShadow(vWPos);` : '';
    shader.fragmentShader = pre +
      shader.fragmentShader.replace('#include <opaque_fragment>',
        `#include <opaque_fragment>${shadowLine}${opaque}`);
  };
  m.customProgramCacheKey = () => tag;
  return m;
}

// 単一方向光の影を受ける（岩・柱）
export function receiveShadowPatch(m) { return patchStandard(m, { shadow: true }); }
// 上向き面にコースティクスを投影（生物）
export function applyCaustics(m, opts = {}) { return patchStandard(m, Object.assign({ caustic: true }, opts)); }

// ============================================================
// 砂の床（MeshBasic + 影/コースティクス/フォグを onBeforeCompile で注入）
// ============================================================
function makeSandTexture() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = i / (S - 1), v = j / (S - 1);
      const wx = (u - 0.5) * TANK.W, wz = (v - 0.5) * TANK.D;
      const n = hash(Math.floor(wx * 2), Math.floor(wz * 2)) * 0.5 + hash(Math.floor(wx * 0.5), Math.floor(wz * 0.5)) * 0.5;
      let r = 0.56 + (0.68 - 0.56) * n;
      let gg = 0.48 + (0.60 - 0.48) * n;
      let b = 0.35 + (0.45 - 0.35) * n;
      const rc = Math.hypot(wx * 0.55, wz);
      const centerT = Math.min(1, Math.max(0, (rc - 40) / 95));
      const tint = 0.30 + 0.25 * centerT;
      r += (0.20 - r) * tint; gg += (0.44 - gg) * tint; b += (0.55 - b) * tint;
      const edge = 1 - centerT;
      const dim = 0.55 + 0.45 * edge;
      r *= dim; gg *= dim; b *= dim;
      const k = (j * S + i) * 4;
      d[k] = r * 255; d[k + 1] = gg * 255; d[k + 2] = b * 255; d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; // 従来シェーダの「素のsRGB値」を往復で維持
  return tex;
}

function makeFloor(scene) {
  const geo = new THREE.PlaneGeometry(TANK.W, TANK.D, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = patchFloorBasic(new THREE.MeshBasicMaterial({ map: makeSandTexture(), toneMapped: false }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  return { mesh, update: () => {} };
}

// ============================================================
// 水面（波うごき＋フェルネル風の透明層）と外の「ホール」天井
// ============================================================
function makeSurface(scene) {
  const geo = new THREE.PlaneGeometry(TANK.W, TANK.D, 110, 56);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(fogUniforms(scene), {
      uTime: { value: 0 },
    }),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vDist;
      void main(){
        vec3 p = position;
        float h  = sin(p.x*0.05 + uTime*0.9)*0.28 + sin(p.z*0.07 - uTime*0.62)*0.22
                 + sin((p.x+p.z)*0.11 + uTime*1.35)*0.12;
        float dx = 0.28*0.05*cos(p.x*0.05 + uTime*0.9) + 0.12*0.11*cos((p.x+p.z)*0.11 + uTime*1.35);
        float dz = -0.22*0.07*cos(p.z*0.07 - uTime*0.62) + 0.12*0.11*cos((p.x+p.z)*0.11 + uTime*1.35);
        p.y = h;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(vec3(-dx, 1.0, -dz));
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vDist;
      uniform float uTime;
      ${fogGlsl()}

      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      // 領域歪み付き fBm: 単一 sin 波のような周期的な平行縞にならず、
      // 不規則なうねりの明るい斑を作る
      float ripple(vec2 p, float t){
        vec2 q = p + vec2(sin(p.y * 2.1 + t * 0.21), cos(p.x * 1.7 - t * 0.17)) * 0.5;
        float n = 0.60 * vnoise(q)
                + 0.28 * vnoise(q * 2.07 + 31.3)
                + 0.14 * vnoise(q * 4.13 + 71.9);
        return n;
      }
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vNormalW);
        float ndv = abs(dot(N, V));
        float fres = pow(1.0 - ndv, 3.0);
        bool below = V.y < 0.0; // 水中から上を見ている
        // 光の煌めき（波の頂上ほうだけ明るく）
        float spark = pow(max(dot(reflect(V, N), normalize(vec3(0.2, 1.0, 0.1))), 0.0), 40.0);
        // 波面の不規則な明るい斑（従来は単一 sin の平行縞 → ノイズへ置換）
        float rip = ripple(vWorld.xz * 0.075, uTime);
        float wavePat = smoothstep(0.48, 0.82, rip);
        vec3 col = mix(vec3(0.10, 0.34, 0.50), vec3(0.75, 0.92, 1.0), fres * 0.85);
        if (below) {
          col = mix(vec3(0.16, 0.44, 0.62), vec3(0.55, 0.85, 1.0), fres * 0.7 + wavePat * 0.5);
          col += vec3(0.9, 1.0, 1.0) * spark;
        }
        col += vec3(0.9, 1.0, 1.0) * spark * 0.6;
        float alpha = clamp(0.22 + fres * 0.55 + spark * 0.5 + wavePat * 0.06, 0.15, 0.88);
        float fog = fogAmount(vDist);
        col = mix(col, uFogColor, fog * 0.85);
        gl_FragColor = vec4(col, alpha * (1.0 - fog * 0.5));
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = TANK.H;

  // 水上の展示ホール（暗い天井＋照明面）— 上を見上げたときの奥行き
  const hall = new THREE.Group();
  const ceilMat = new THREE.MeshBasicMaterial({ color: 0x030d16, side: THREE.DoubleSide });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(TANK.W + 40, TANK.D + 40), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = TANK.H + 16;
  hall.add(ceil);
  // FrontSide + 上向き法線: 水中（下側）から見ると裏面カリングで完全に消える。
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x9fd4ff, side: THREE.FrontSide });
  const rng = makeRng(4242);
  for (let i = 0; i < 10; i++) {
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(16, 3.2), lampMat);
    lamp.rotation.x = -Math.PI / 2; // 発光面を天井側（上）へ向ける
    lamp.position.set((rng() * 2 - 1) * 100, TANK.H + 15.9, (rng() * 2 - 1) * 46);
    hall.add(lamp);
  }
  return {
    mesh, hall,
    update: (t) => { mat.uniforms.uTime.value = t; },
  };
}

// ============================================================
// 水槽の壁（かすかなガラス）＋スケール感のための縦柱
// ============================================================
function makeWalls(scene) {
  const group = new THREE.Group();
  const glassMat = new THREE.ShaderMaterial({
    uniforms: fogUniforms(scene),
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: `
      varying vec3 vWorld; varying vec3 vN; varying float vDist;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * wp; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorld; varying vec3 vN; varying float vDist;
      ${fogGlsl()}
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.5);
        float yFade = smoothstep(2.0, 12.0, vWorld.y);
        vec3 col = vec3(0.35, 0.65, 0.85);
        float a = fres * 0.14 * yFade;
        float fog = fogAmount(vDist);
        gl_FragColor = vec4(mix(col, uFogColor, fog), a * (1.0 - fog));
      }`,
  });
  const wallDefs = [
    { w: TANK.W, h: TANK.H, pos: [0, TANK.H / 2, -TANK.hd], rotY: 0 },
    { w: TANK.W, h: TANK.H, pos: [0, TANK.H / 2,  TANK.hd], rotY: Math.PI },
    { w: TANK.D, h: TANK.H, pos: [-TANK.hw, TANK.H / 2, 0], rotY: Math.PI / 2 },
    { w: TANK.D, h: TANK.H, pos: [ TANK.hw, TANK.H / 2, 0], rotY: -Math.PI / 2 },
  ];
  for (const d of wallDefs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), glassMat);
    m.position.set(...d.pos); m.rotation.y = d.rotY;
    group.add(m);
  }
  // 柱（水槽建築のスケール感）— 岩に近い色＋影受け＋コースティクス（上層で強く）
  const pillarMat = patchStandard(new THREE.MeshStandardMaterial({ color: 0x586a70, roughness: 0.96, metalness: 0.0 }), { shadow: true, caustic: true, strength: 0.85, depthFade: true });
  const pillarGeo = new THREE.BoxGeometry(1.6, TANK.H + 4, 1.6);
  for (let x = -TANK.hw + 2; x <= TANK.hw - 2; x += 25) {
    for (const z of [-TANK.hd + 1.2, TANK.hd - 1.2]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(x, (TANK.H + 4) / 2 - 2, z);
      p.castShadow = true; p.receiveShadow = true;
      group.add(p);
    }
  }
  for (let z = -TANK.hd + 25; z <= TANK.hd - 25; z += 30) {
    for (const x of [-TANK.hw + 1.2, TANK.hw - 1.2]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(x, (TANK.H + 4) / 2 - 2, z);
      p.castShadow = true; p.receiveShadow = true;
      group.add(p);
    }
  }
  return { mesh: group };
}

// ============================================================
// 海底：岩・巨岩・砂の盛り上がりの散乱
// ============================================================
function makeSeafloorProps(scene) {
  const group = new THREE.Group();
  const rocks = [];
  const rng = makeRng(1337);

  const rockMat = patchStandard(new THREE.MeshStandardMaterial({ color: 0x54666c, roughness: 0.98, metalness: 0.0 }), { shadow: true, caustic: true, strength: 0.9, depthFade: true });
  const rockMat2 = patchStandard(new THREE.MeshStandardMaterial({ color: 0x46565f, roughness: 0.98 }), { shadow: true, caustic: true, strength: 0.9, depthFade: true });

  function lumpyRock(seed) {
    // 共有頂点（indexed）なので変位が潰れず滑らかな岩になる
    const g = new THREE.SphereGeometry(1, 26, 18);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.30 * Math.sin(x * 2.9 + y * 2.1 + z * 1.7 + seed)
                  + 0.17 * Math.sin(z * 4.3 - y * 3.7 + x * 1.3 + seed * 2.0)
                  + 0.09 * Math.sin(x * 7.1 + z * 5.9 - y * 4.1 + seed * 3.0);
      p.setXYZ(i, x * n, y * n * 0.92, z * n);
    }
    g.computeVertexNormals();
    return g;
  }
  const rockGeos = [lumpyRock(11), lumpyRock(22), lumpyRock(33)];

  // 巨岩（スケール基準になる大きな塊）
  const bigSpecs = [
    [-88, -34, 13], [82, 30, 16], [-58, 40, 10], [64, -42, 11], [8, -50, 9], [-108, 8, 12],
  ];
  bigSpecs.forEach((s, i) => {
    const m = new THREE.Mesh(rockGeos[i % 3], i % 2 ? rockMat : rockMat2);
    m.position.set(s[0], s[2] * 0.42 - 0.6, s[1]);
    m.scale.set(s[2] * (0.9 + rng() * 0.5), s[2] * (0.55 + rng() * 0.3), s[2] * (0.9 + rng() * 0.4));
    m.rotation.set(rng() * 0.4 - 0.2, rng() * Math.PI, rng() * 0.3 - 0.15);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    rocks.push({
      pos: m.position.clone(), rock: true,
      ax: m.scale.x * 1.5, ay: m.scale.y * 1.5, az: m.scale.z * 1.5,
      radius: Math.max(m.scale.x, m.scale.y, m.scale.z) * 1.25,
    });
  });

  // 中〜小の岩礁
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(rockGeos[i % 3], rng() > 0.5 ? rockMat : rockMat2);
    const x = (rng() * 2 - 1) * 115, z = (rng() * 2 - 1) * 54;
    const s = 1.2 + rng() * 4.2;
    m.position.set(x, s * 0.34 - 0.3, z);
    m.scale.set(s * (0.8 + rng() * 0.6), s * (0.5 + rng() * 0.4), s * (0.8 + rng() * 0.6));
    m.rotation.y = rng() * Math.PI * 2;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    rocks.push({
      pos: m.position.clone(), rock: true,
      ax: m.scale.x * 1.5, ay: m.scale.y * 1.5, az: m.scale.z * 1.5,
      radius: Math.max(m.scale.x, m.scale.y, m.scale.z) * 1.25,
    });
  }

  // 砂の盛り上がりは床シェーダの減衰・コースティクスで表現
  return { mesh: group, rocks };
}

// ============================================================
// 水中の光芒（ゴッドレイル）
// ============================================================
function makeGodRays(scene) {
  const group = new THREE.Group();
  const rng = makeRng(777);
  const shafts = [];
  const N = 20;
  const matProto = () => new THREE.ShaderMaterial({
    uniforms: Object.assign(fogUniforms(scene), {
      uTime: { value: 0 }, uSeed: { value: rng() * 100 }, uStrength: { value: 0.16 + rng() * 0.12 },
    }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv; varying vec3 vWorld; varying float vDist;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; varying vec3 vWorld; varying float vDist;
      uniform float uTime, uSeed, uStrength;
      ${fogGlsl()}
      void main(){
        float across = sin(vUv.x * 3.14159);
        float down = vUv.y; // 1 top
        float topFade = smoothstep(1.0, 0.86, down) * 0.4 + 0.6;
        float n = 0.65 + 0.35 * sin(vUv.x * 9.0 + uSeed + uTime * 0.25)
                        * sin(vUv.y * 5.0 - uTime * 0.16 + uSeed * 2.0);
        float a = pow(across, 1.8) * pow(down, 1.35) * topFade * n;
        a *= uStrength;
        float fog = fogAmount(vDist);
        a *= (1.0 - fog);
        vec3 col = vec3(0.55, 0.85, 1.0);
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const rayMats = [];
  for (let i = 0; i < N; i++) {
    const w = 6 + rng() * 11;
    const len = TANK.H - 2;
    const g = new THREE.PlaneGeometry(w, len);
    g.translate(0, -len / 2, 0); // pivot top
    const mat = matProto();
    rayMats.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.position.set((rng() * 2 - 1) * 108, TANK.H - 0.5, (rng() * 2 - 1) * 50);
    m.rotation.y = rng() * Math.PI;
    m.rotation.z = (rng() - 0.5) * 0.18;
    m.rotation.x = (rng() - 0.5) * 0.14;
    group.add(m);
    shafts.push({ mesh: m, spin: (rng() - 0.5) * 0.02 });
  }
  return {
    mesh: group,
    update: (t, dt) => {
      for (const s of shafts) s.mesh.rotation.y += s.spin * dt;
      for (const m of rayMats) m.uniforms.uTime.value = t;
    },
  };
}

// ============================================================
// 浮遊パーティクル（プランクトン）
// ============================================================
function makeParticles(scene) {
  const N = 2800;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const rng = makeRng(99);
  const BOX = { x: 236, y: 47, z: 112 };
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rng() * 2 - 1) * BOX.x / 2;
    pos[i * 3 + 1] = 1 + rng() * BOX.y;
    pos[i * 3 + 2] = (rng() * 2 - 1) * BOX.z / 2;
    seed[i] = rng() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(fogUniforms(scene), { uTime: { value: 0 }, uBox: { value: new THREE.Vector3(BOX.x, BOX.y, BOX.z) } }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSeed;
      uniform float uTime; uniform vec3 uBox;
      varying float vFogFade; varying float vTw;
      uniform float uFogDensity;
      void main(){
        vec3 p = position;
        p += vec3(sin(uTime * 0.11 + aSeed * 3.0), sin(uTime * 0.07 + aSeed), cos(uTime * 0.09 + aSeed * 2.0)) * 2.2;
        p.y -= uTime * (0.18 + 0.34 * fract(aSeed * 0.211));
        p.x = mod(p.x + uBox.x * 0.5, uBox.x) - uBox.x * 0.5;
        p.y = mod(p.y, uBox.y) + 0.6;
        p.z = mod(p.z + uBox.z * 0.5, uBox.z) - uBox.z * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        float f = uFogDensity * d;
        vFogFade = exp(-f * f);
        vTw = 0.5 + 0.5 * abs(sin(uTime * 0.6 + aSeed * 17.0));
        float sizeVar = 0.65 + 0.85 * fract(aSeed * 0.137);
        gl_PointSize = clamp(40.0 / max(d, 1.0), 1.5, 7.0) * sizeVar;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      varying float vFogFade; varying float vTw;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float r = length(uv);
        if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.06, r) * 0.85 * vTw * vFogFade;
        gl_FragColor = vec4(vec3(0.82, 0.96, 1.0) * a, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { mesh: pts, update: (t) => { mat.uniforms.uTime.value = t; } };
}

// ============================================================
// 疑似ソフト影（足元に暗いデカール）
// ============================================================
export function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,10,20,0.85)');
  grad.addColorStop(0.55, 'rgba(0,8,16,0.35)');
  grad.addColorStop(1, 'rgba(0,6,12,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
export function makeShadowBlob(tex, size, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, color: 0x9fcfe8 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.07;
  m.userData.baseScale = size;
  m.userData.baseOpacity = opacity;
  m.scale.set(size, size, 1);
  m.renderOrder = 1;
  return m;
}

// ============================================================
// 総合
// ============================================================
export function buildEnvironment(scene) {
  const floor = makeFloor(scene);
  const surface = makeSurface(scene);
  const walls = makeWalls(scene);
  const props = makeSeafloorProps(scene);
  const rays = makeGodRays(scene);
  const particles = makeParticles(scene);

  scene.add(floor.mesh, walls.mesh, props.mesh, rays.mesh, particles.mesh, surface.mesh, surface.hall);

  // ライト
  const hemi = new THREE.HemisphereLight(0x8fd4ee, 0x0c2c44, 1.25);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xbfefff, 1.5);
  dir.position.set(40, 120, 20);
  dir.target.position.set(0, 8, 0);
  scene.add(dir); scene.add(dir.target);
  const dir2 = new THREE.DirectionalLight(0x5d9cc0, 0.5);
  dir2.position.set(-60, 60, -40);
  scene.add(dir2);

  // 影（単一方向光で水槽全体を覆う。床/柱/岩は onBeforeCompile でこの map を直接サンプル）
  _shadowLight = dir;
  dir.castShadow = true;
  dir.shadow.bias = -0.0004;
  dir.shadow.normalBias = 0.7;
  const sc = dir.shadow.camera;
  sc.left = -142; sc.right = 142; sc.top = 92; sc.bottom = -92; sc.near = 1; sc.far = 420;
  sc.updateProjectionMatrix();
  SHADOW.map.value = _whiteShadowTexture();
  SHADOW.on.value = 0;

  const blobTex = makeBlobTexture();

  const env = {
    blobTex,
    rocks: props.rocks,
    quality: 'high',
    shadowsEnabled: true,
    _renderer: null,
    autoQuality() {
      const nav = (typeof navigator !== 'undefined') ? navigator : {};
      const ua = nav.userAgent || '';
      const touch = (nav.maxTouchPoints || 0) > 0;
      const small = (typeof window !== 'undefined') && Math.min(window.innerWidth, window.innerHeight) < 820;
      return (/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) || (touch && small)) ? 'low' : 'high';
    },
    // renderer を渡して影の品質を確定（初回描画前に1回）。q: 'high'|'low'|'off'
    setQuality(q, renderer) {
      if (renderer) this._renderer = renderer;
      this.quality = q || this.quality;
      const r = this._renderer;
      if (!r) return;
      const on = this.quality !== 'off';
      this.shadowsEnabled = on;
      r.shadowMap.enabled = on;
      r.shadowMap.type = (this.quality === 'high') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      if (on) {
        const s = (this.quality === 'high') ? 2048 : 1024;
        if (dir.shadow.map && dir.shadow.mapSize.x !== s) { dir.shadow.map.dispose(); dir.shadow.map = null; }
        dir.shadow.mapSize.set(s, s);
        SHADOW.mapSize.value.set(s, s);
      }
      r.shadowMap.needsUpdate = true;
    },
    setRenderer(renderer) { this.setQuality(this.autoQuality(), renderer); },
    update(t, dt) {
      uTimeShared.value = t;   // 床・岩・生物のコースティクス駆動（単一ソース）
      surface.update(t);
      rays.update(t, dt);
      particles.update(t);
      if (_shadowLight) {
        SHADOW.matrix.value.copy(_shadowLight.shadow.matrix);
        const sm = _shadowLight.shadow.map;
        if (sm && sm.texture && SHADOW.map.value !== sm.texture) {
          SHADOW.map.value = sm.texture;
          SHADOW.on.value = _shadowLight.castShadow && _shadowLight.shadow.map ? 1 : 0;
        }
      }
    },
  };
  return env;
}
