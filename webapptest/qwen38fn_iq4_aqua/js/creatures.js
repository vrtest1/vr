import * as THREE from 'three';
import { applyCaustics } from './environment.js';

// ============================================================
// ジオメトリ生成ユーティリティ（すべてコードから生成）
// ============================================================

// 断面上昇: z軸沿いのロフト。stations: [{z,w,h,cy}]（尾→鼻 の昇順）
function loftZ(stations, n = 16) {
  const pos = [], uv = [], idx = [];
  const ringCount = stations.length;
  for (let i = 0; i < ringCount; i++) {
    const s = stations[i];
    const u = i / (ringCount - 1);
    for (let j = 0; j < n; j++) {
      const th = (j / n) * Math.PI * 2;
      pos.push(s.w * Math.cos(th), s.cy + s.h * Math.sin(th), s.z);
      uv.push(u, j / n);
    }
  }
  for (let i = 0; i < ringCount - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + (j + 1) % n;
      const c = (i + 1) * n + j, d = (i + 1) * n + (j + 1) % n;
      idx.push(a, b, d, a, d, c);
    }
  }
  return { pos, uv, idx, ringCount, n,
    capStart() { addCap(this, 0, 0.02, -1); },
    capEnd()   { addCap(this, ringCount - 1, 0.98, 1); } };
}
function addCap(p, ring, u, dir) {
  const c = p.pos.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let j = 0; j < p.n; j++) {
    cx += p.pos[(ring * p.n + j) * 3];
    cy += p.pos[(ring * p.n + j) * 3 + 1];
    cz += p.pos[(ring * p.n + j) * 3 + 2];
  }
  p.pos.push(cx / p.n, cy / p.n, cz / p.n);
  p.uv.push(u, 0.5);
  for (let j = 0; j < p.n; j++) {
    const a = ring * p.n + j, b = ring * p.n + (j + 1) % p.n;
    if (dir > 0) p.idx.push(c, a, b); else p.idx.push(c, b, a);
  }
}

// 翼ロフト: x軸沿い。stations: [{x, cz, chord, th}]、side=±1
function loftWing(stations, side, n = 10) {
  const pos = [], uv = [], idx = [];
  const ringCount = stations.length;
  for (let i = 0; i < ringCount; i++) {
    const s = stations[i];
    for (let j = 0; j < n; j++) {
      const th = (j / n) * Math.PI * 2;
      const z = s.cz + (s.chord / 2) * Math.cos(th);
      const y = (s.th / 2) * Math.sin(th);
      pos.push(side * s.x, y, z);
      uv.push(i / (ringCount - 1), j / n);
    }
  }
  const flip = side < 0;
  for (let i = 0; i < ringCount - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + (j + 1) % n;
      const c = (i + 1) * n + j, d = (i + 1) * n + (j + 1) % n;
      if (!flip) idx.push(a, b, d, a, d, c);
      else idx.push(a, d, b, a, c, d);
    }
  }
  // 先端キャップ
  const last = ringCount - 1;
  const c = pos.length / 3;
  let cx = 0, cz = 0, cy = 0;
  for (let j = 0; j < n; j++) {
    cx += pos[(last * n + j) * 3]; cy += pos[(last * n + j) * 3 + 1]; cz += pos[(last * n + j) * 3 + 2];
  }
  pos.push(cx / n, cy / n, cz / n); uv.push(1, 0.5);
  for (let j = 0; j < n; j++) {
    const a = last * n + j, b = last * n + (j + 1) % n;
    if (!flip) idx.push(c, b, a); else idx.push(c, a, b);
  }
  return { pos, uv, idx };
}

// 平面ひれ: pts は [u,v] 組。plane: 'zy'|'xz'。mirror で u 反転（左右対のひれ用）
function plate(pts, plane, mirror = false) {
  const pos = [], uv = [], idx = [];
  let cu = 0, cv = 0;
  for (const [u, v] of pts) { cu += u; cv += v; }
  cu /= pts.length; cv /= pts.length;
  if (mirror) cu = -cu;
  const push = (u, v) => {
    if (plane === 'zy') pos.push(0, v, u);
    else pos.push(u, 0, v);
    uv.push(u * 0.2 + 0.5, v * 0.2 + 0.5);
  };
  push(cu, cv); // 0: 重心
  const seq = mirror
    ? [...pts].reverse().map(([u, v]) => [-u, v])
    : pts;
  for (const [u, v] of seq) push(u, v);
  const base = 1;
  for (let i = 0; i < seq.length; i++) {
    const a = base + i, b = base + (i + 1) % seq.length;
    idx.push(0, a, b);
  }
  return { pos, uv, idx };
}

function mergeRaw(parts, colorFn) {
  let vc = 0, ic = 0;
  for (const p of parts) { vc += p.pos.length / 3; ic += p.idx.length; }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const uvs = new Float32Array(vc * 2);
  const col = new Float32Array(vc * 3);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const p of parts) {
    for (let i = 0; i < p.pos.length; i++) pos[vo * 3 + i] = p.pos[i];
    for (let i = 0; i < p.uv.length; i++) uvs[vo * 2 + i] = p.uv[i];
    const c = colorFn ? colorFn(p) : null;
    for (let i = 0; i < p.pos.length / 3; i++) {
      if (c) { col[vo * 3 + i * 3] = c.r; col[vo * 3 + i * 3 + 1] = c.g; col[vo * 3 + i * 3 + 2] = c.b; }
      else { col[vo * 3 + i * 3] = 1; col[vo * 3 + i * 3 + 1] = 1; col[vo * 3 + i * 3 + 2] = 1; }
    }
    for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
    vo += p.pos.length / 3; io += p.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

// 物体空間ノーマル y に応じてメッシュ色をベイク（反転色）
// skipFrom 以降の頂点（ひれ部など）は skipColor 固定にできる
export function bakeCountershading(geo, stops, skipFrom = -1, skipColorHex = null) {
  const n = geo.attributes.normal, c = geo.attributes.color;
  const cs = stops.map(([t, hex]) => { const col = new THREE.Color(hex); return [t, col]; });
  const finCol = skipColorHex ? new THREE.Color(skipColorHex) : null;
  for (let i = 0; i < n.count; i++) {
    if (skipFrom >= 0 && i >= skipFrom && finCol) {
      c.setXYZ(i, finCol.r, finCol.g, finCol.b);
      continue;
    }
    const t = THREE.MathUtils.clamp((n.getY(i) + 1) / 2, 0, 1);
    let a = cs[0], b = cs[cs.length - 1];
    for (let k = 0; k < cs.length - 1; k++) {
      if (t >= cs[k][0] && t <= cs[k + 1][0]) { a = cs[k]; b = cs[k + 1]; break; }
    }
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    const col = a[1].clone().lerp(b[1], f);
    c.setXYZ(i, col.r, col.g, col.b);
  }
  c.needsUpdate = true;
}

// y座標基準で明暗をベイク（ノーマルが裏返りやすいひれ面用。下=明るい腹、上=暗い背）
export function bakeCountershadingY(geo, stops) {
  const p = geo.attributes.position, c = geo.attributes.color;
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < mn) mn = y; if (y > mx) mx = y; }
  const cs = stops.map(([t, hex]) => { const col = new THREE.Color(hex); return [t, col]; });
  for (let i = 0; i < p.count; i++) {
    const t = mx > mn ? (p.getY(i) - mn) / (mx - mn) : 1;
    let a = cs[0], b = cs[cs.length - 1];
    for (let k = 0; k < cs.length - 1; k++) {
      if (t >= cs[k][0] && t <= cs[k + 1][0]) { a = cs[k]; b = cs[k + 1]; break; }
    }
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    const col = a[1].clone().lerp(b[1], f);
    c.setXYZ(i, col.r, col.g, col.b);
  }
  c.needsUpdate = true;
}

// 遊泳用: ベース位置から x を波形変位
function makeWaveAnimator(geo, fn) {
  const base = Float32Array.from(geo.attributes.position.array);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  return (phase) => {
    const a = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3;
      const z = base[i3 + 2];
      a[i3] = base[i3] + fn(z, phase);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    nrm.needsUpdate = true;
  };
}
const smooth01 = (x) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// ============================================================
// ジンベエザメ
// ============================================================
function whaleSkinTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5d6c72';
  g.fillRect(0, 0, 512, 256);
  // まだら
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(40,52,58,${0.12 + Math.random() * 0.18})`;
    const r = 6 + Math.random() * 18;
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 256, r, 0, 7); g.fill();
  }
  // 白い斑紋（格子状に散る）
  for (let y = 6; y < 256; y += 13) {
    for (let x = 6 + (y % 26 === 6 ? 0 : 6.5); x < 512; x += 13) {
      if (Math.random() < 0.62) {
        g.fillStyle = `rgba(235,245,240,${0.55 + Math.random() * 0.4})`;
        const r = 1.3 + Math.random() * 2.1;
        g.beginPath(); g.arc(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, r, 0, 7); g.fill();
      }
    }
  }
  // 淡い条線
  g.strokeStyle = 'rgba(220,235,228,0.20)';
  g.lineWidth = 1.4;
  for (let y = 10; y < 256; y += 26) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(512, y + (Math.random() - 0.5) * 10); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}
let _whaleTex = null;

export function createWhaleShark() {
  if (!_whaleTex) _whaleTex = whaleSkinTexture();
  const parts = [];
  const body = loftZ([
    { z: -6.2, w: 0.09, h: 0.10, cy: 0 },
    { z: -5.2, w: 0.26, h: 0.30, cy: 0 },
    { z: -3.6, w: 0.50, h: 0.55, cy: 0.02 },
    { z: -2.0, w: 0.75, h: 0.75, cy: 0.05 },
    { z: -0.5, w: 0.92, h: 0.85, cy: 0.06 },
    { z:  1.2, w: 1.10, h: 0.88, cy: 0.04 },
    { z:  2.6, w: 1.16, h: 0.80, cy: 0 },
    { z:  4.0, w: 1.00, h: 0.66, cy: -0.03 },
    { z:  5.2, w: 0.80, h: 0.46, cy: -0.05 },
    { z:  6.0, w: 0.52, h: 0.17, cy: -0.05 },
  ], 16);
  body.capStart(); body.capEnd();
  parts.push(body);

  parts.push(plate([ // 背びれ
    [0.5, 0.72], [-0.2, 1.22], [-1.3, 1.24], [-1.9, 0.72], [-1.2, 0.62], [-0.2, 0.66]], 'zy'));
  parts.push(plate([ // 尾びれ上葉（上方向に長い不対称尾）
    [-5.9, 0.15], [-6.5, 1.2], [-7.3, 2.0], [-7.85, 2.15], [-7.5, 1.3], [-6.9, 0.5], [-6.35, 0.1]], 'zy'));
  parts.push(plate([ // 尾びれ下葉
    [-6.1, -0.1], [-6.6, -0.78], [-7.15, -1.02], [-7.35, -0.8], [-6.9, -0.35], [-6.4, -0.05]], 'zy'));
  parts.push(plate([ // 臀びれ
    [-3.6, -0.45], [-4.3, -0.95], [-4.9, -0.8], [-4.4, -0.4]], 'zy'));
  const pec = [[0.55, 4.45], [0.35, 3.6], [1.45, 2.62], [2.55, 2.2], [2.8, 2.7], [1.65, 3.62], [0.85, 4.5]];
  const pR = plate(pec, 'xz');
  for (let i = 1; i < pR.pos.length; i += 3) pR.pos[i] -= 0.34;
  const pL = plate(pec, 'xz', true);
  for (let i = 1; i < pL.pos.length; i += 3) pL.pos[i] -= 0.34;
  parts.push(pR, pL);

  const geo = mergeRaw(parts);
  const bodyVertCount = body.pos.length / 3; // ひれ部はノーマル依存の反転色にせず胴と同色で固定
  bakeCountershading(geo, [[0, '#e2e7e4'], [0.42, '#b3c0c1'], [0.62, '#7c8d92'], [1, '#4e5d63']], bodyVertCount, '#5c6b71');
  const mat = applyCaustics(new THREE.MeshStandardMaterial({
    map: _whaleTex, vertexColors: true, roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide,
  }), { strength: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  const eyeG = new THREE.SphereGeometry(0.11, 8, 8);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x05080a });
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(eyeG, eyeM);
    e.position.set(0.44 * s, -0.12, 5.15);
    mesh.add(e);
  }
  const anim = makeWaveAnimator(geo, (z, ph) => {
    const a = 1.15 * Math.pow(smooth01((2.5 - z) / 9), 1.6);
    return Math.sin(z * 0.55 + ph) * a;
  });
  let phase = Math.random() * 10, spd = 1.1;
  return {
    obj: mesh, radius: 6,
    animate(dt, speed) { spd += (speed - spd) * 0.08; phase += dt * (0.55 + spd * 0.5); anim(phase); },
  };
}

// ============================================================
// オニイトマキエイ（マンタ）
// ============================================================
export function createManta() {
  const group = new THREE.Group();
  // 胴体
  const bodyP = loftZ([
    { z: -1.5, w: 0.05, h: 0.07, cy: 0 },
    { z: -0.9, w: 0.22, h: 0.20, cy: 0.01 },
    { z: -0.2, w: 0.40, h: 0.30, cy: 0.02 },
    { z:  0.5, w: 0.50, h: 0.30, cy: 0 },
    { z:  1.0, w: 0.50, h: 0.20, cy: -0.03 },
    { z:  1.45, w: 0.44, h: 0.09, cy: -0.05 },
  ], 12);
  bodyP.capStart(); bodyP.capEnd();
  // 尾部
  const tail = loftZ([
    { z: -3.6, w: 0.012, h: 0.012, cy: 0 },
    { z: -2.6, w: 0.02, h: 0.02, cy: 0 },
    { z: -1.5, w: 0.05, h: 0.06, cy: 0 },
  ], 6);
  tail.capEnd();
  const bodyGeo = mergeRaw([bodyP, tail]);
  bakeCountershading(bodyGeo, [[0, '#f6f9fa'], [0.48, '#eaeff1'], [0.55, '#2c3842'], [1, '#18222c']]);
  const bodyMat = applyCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), { strength: 0.8 });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  // 頭葉
  const hornG = new THREE.CylinderGeometry(0.02, 0.055, 0.5, 6);
  const hornM = bodyMat;
  for (const s of [1, -1]) {
    const h = new THREE.Mesh(hornG, hornM);
    h.position.set(0.2 * s, -0.02, 1.35);
    h.rotation.x = -Math.PI / 2.4;
    h.rotation.z = s * 0.35;
    group.add(h);
  }
  const eyeG = new THREE.SphereGeometry(0.05, 8, 8);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x060a0d });
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(eyeG, eyeM);
    e.position.set(0.34 * s, 0.05, 1.18);
    group.add(e);
  }

  // 大胸びれ（左右・うねりアニメ対象）
  const ws = [];
  for (const side of [1, -1]) {
    const st = [];
    const xs = [0.05, 0.45, 0.95, 1.45, 1.95, 2.45, 2.85, 3.1];
    for (const x of xs) {
      const f = x / 3.1;
      const chord = 1.95 * Math.pow(1 - f, 0.82) + 0.10;
      const front = 0.72 - 0.95 * Math.pow(f, 1.6);
      st.push({ x, cz: front - chord / 2, chord, th: 0.26 * (1 - 0.8 * f) + 0.02 });
    }
    const g = mergeRaw([loftWing(st, side, 8)]);
    bakeCountershadingY(g, [[0, '#f6f9fa'], [0.45, '#e8edef'], [0.6, '#2c3842'], [1, '#18222c']]);
    const wing = new THREE.Mesh(g, bodyMat);
    group.add(wing);
    const base = Float32Array.from(g.attributes.position.array);
    const posA = g.attributes.position;
    ws.push({
      g, base, posA, side,
      anim(phase) {
        const a = posA.array;
        for (let i = 0; i < posA.count; i++) {
          const i3 = i * 3;
          const x = Math.abs(base[i3]);
          const amp = 0.035 + 0.42 * Math.pow(x / 3.1, 1.65);
          a[i3 + 1] = base[i3 + 1] + Math.sin(x * 1.85 - phase) * amp;
        }
        posA.needsUpdate = true;
        g.computeVertexNormals();
        g.attributes.normal.needsUpdate = true;
      },
    });
  }

  let phase = Math.random() * 10;
  return {
    obj: group, radius: 3.2,
    animate(dt, speed) {
      phase += dt * (1.15 + speed * 0.16);
      for (const w of ws) w.anim(phase);
    },
  };
}

// ============================================================
// クロマグロ
// ============================================================
export function createTuna() {
  const body = loftZ([
    { z: -1.35, w: 0.05, h: 0.075, cy: 0 },
    { z: -1.05, w: 0.09, h: 0.14, cy: 0.005 },
    { z: -0.55, w: 0.24, h: 0.33, cy: 0.02 },
    { z: -0.1, w: 0.28, h: 0.36, cy: 0.02 },
    { z:  0.45, w: 0.24, h: 0.30, cy: 0.01 },
    { z:  0.95, w: 0.15, h: 0.20, cy: 0 },
    { z:  1.3, w: 0.05, h: 0.07, cy: 0 },
  ], 12);
  body.capStart(); body.capEnd();

  const parts = [body];
  parts.push(plate([ // 三日月尾
    [-1.3, 0.16], [-1.44, 0.62], [-1.62, 0.74], [-1.74, 0.56], [-1.66, 0.05],
    [-1.74, -0.56], [-1.62, -0.74], [-1.44, -0.62], [-1.3, -0.16]], 'zy'));
  parts.push(plate([[0.5, 0.2], [0.0, 0.44], [-0.55, 0.32], [-0.85, 0.16], [-0.4, 0.12], [0.35, 0.12]], 'zy'));
  parts.push(plate([[-0.55, -0.2], [-0.95, -0.38], [-1.15, -0.28], [-0.9, -0.12]], 'zy'));
  const pec = [[0.16, 0.52], [0.6, 0.18], [0.26, 0.1], [0.1, 0.3]];
  const fR = plate(pec, 'xz');
  for (let i = 1; i < fR.pos.length; i += 3) fR.pos[i] -= 0.1;
  const fL = plate(pec, 'xz', true);
  for (let i = 1; i < fL.pos.length; i += 3) fL.pos[i] -= 0.1;
  parts.push(fR, fL);

  const geo = mergeRaw(parts);
  bakeCountershading(geo, [
    [0, '#e8eef0'], [0.35, '#a8bcc6'], [0.55, '#7d97a6'], [0.75, '#2c4250'], [1, '#101d28'],
  ]);
  const mat = applyCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }), { strength: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  const anim = makeWaveAnimator(geo, (z, ph) => {
    const a = 0.02 + 0.17 * Math.pow(smooth01((0.6 - z) / 2.3), 1.5);
    return Math.sin(z * 3.4 + ph) * a;
  });
  let phase = Math.random() * 20;
  return {
    obj: mesh, radius: 1.2,
    animate(dt, speed) { phase += dt * (3.0 + speed * 1.15); anim(phase); },
  };
}
