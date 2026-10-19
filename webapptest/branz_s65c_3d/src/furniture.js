// 形のある家具（テレビ・スピーカー）の組み立て。ビューワー(index.html)と tools/export_furniture.mjs で共通。
// 寸法はmm、three.js の座標（Y=上、正面=+Z）。RoundedBoxGeometry は three/addons から渡す。
// 部品・材質の名前は GLB/FBX にそのまま残る（Blenderでの手直し用）。

// 単位箱に正規化した部品(inner)を、ビューワーの家具として包む（外側のscaleでf.w/h/d、選択時だけ外枠を表示）
function wrapDetailed(THREE, f, inner, body, extra = {}) {
  const g = new THREE.Group();
  g.name = f.name;
  g.add(inner);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0 }));
  edges.userData.fid = f.id;
  g.add(edges);
  g.userData = { body, edges, inner, idleEdgeOpacity: 0, ...extra };
  return g;
}

// 外部モデル（実寸m・正面+Z・床y=0 のGLBシーン）を形のある家具にする。dims はモデルの実寸(mm)。
// 色はモデルの材質のまま使う（家具の色 f.col では塗らない）
export function modelBuilder(THREE, root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => { if (o.isMesh) parts.push({ name: o.name, mat: o.material, geo: o.geometry.clone().applyMatrix4(o.matrixWorld) }); });
  const bb = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); }
  const size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  const norm = new THREE.Matrix4().makeScale(1 / size.x, 1 / size.y, 1 / size.z).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  for (const p of parts) p.geo.applyMatrix4(norm);
  const dims = { W: Math.round(size.x * 1000), H: Math.round(size.y * 1000), D: Math.round(size.z * 1000) };
  const build = (f) => {
    const inner = new THREE.Group();
    const mats = [];
    let body = null;
    for (const p of parts) {
      const mat = p.mat.clone();
      const m = new THREE.Mesh(p.geo, mat);
      m.name = p.name;
      m.castShadow = m.receiveShadow = true;
      m.userData.fid = f.id;
      inner.add(m);
      mats.push(mat);
      if (!body || p.geo.attributes.position.count > body.geometry.attributes.position.count) body = m;
    }
    return wrapDetailed(THREE, f, inner, body, { hlMats: mats, ownColors: true });
  };
  return { dims, build };
}

export function createDetailed(THREE, { RoundedBoxGeometry }) {
  const mat = (name, opts) => Object.assign(new THREE.MeshStandardMaterial(opts), { name });
  // 形のある家具（kind付き）。mmで作って単位箱内に正規化し、外側のscaleでf.w/h/dに合わせる。
  // 基準姿勢 = 幅がX、正面が+Z向き。syncFurnでf.rot（90°単位）だけ回す
  function buildDetailedMesh(f, dims, build) {
    const inner = new THREE.Group();
    // geo: mm単位・原点中心のジオメトリ、(x,y,z): 中心位置（yは床から）
    const add = (geo, mat, x, y, z, name) => {
      geo.scale(1 / dims.W, 1 / dims.H, 1 / dims.D);
      const m = new THREE.Mesh(geo, mat);
      if (name) m.name = name;
      m.position.set(x / dims.W, y / dims.H - 0.5, z / dims.D);
      m.castShadow = m.receiveShadow = true;
      m.userData.fid = f.id;
      inner.add(m);
      return m;
    };
    const box = (w, h, d, x, y, z, mat, name) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, name);
    // 正面(+Z)向きの円盤・円すい
    const disc = (r1, r2, t, x, y, z, mat, name) => add(new THREE.CylinderGeometry(r1, r2, t, 48).rotateX(Math.PI / 2), mat, x, y, z, name);
    return wrapDetailed(THREE, f, inner, build({ add, box, disc }));
  }
  const DETAILED = {
    // 東芝 REGZA 42Z1（仕様表: スタンド込み W1020×H704×D338、本体 H640×D48、画面 930×523）
    tv: (f) => buildDetailedMesh(f, { W: 1020, H: 704, D: 338 }, ({ add, box }) => {
      const bodyMat = mat('TV_Body', { color: f.col, roughness: 0.35, metalness: 0.2 });
      const screenMat = mat('TV_Screen', { color: 0x07090c, roughness: 0.08, metalness: 0.1 });
      const trimMat = mat('TV_Trim', { color: 0x9a9da3, roughness: 0.3, metalness: 0.8 });
      // パネル本体（床から64〜704mm、厚さ48mm）
      const body = box(1020, 640, 48, 0, 64 + 320, 0, bodyMat, 'Panel');
      // 画面（上ベゼル約35mm、下はスピーカー部で約82mm）
      box(930, 523, 2, 0, 146 + 523 / 2, 24.5, screenMat, 'Screen');
      // 下端のシルバーライン
      box(1020, 6, 2, 0, 70, 24.5, trimMat, 'Trim_Bottom');
      // スタンド（寸法図: 幅646×奥行338）：黒い光沢のX字4本脚＋中央の台＋パネル裏の支柱、前面に銀のアクセント
      const baseMat = mat('TV_Stand', { color: 0x0f1012, roughness: 0.22, metalness: 0.35 });
      const chromeMat = mat('TV_Chrome', { color: 0xd2d5da, roughness: 0.15, metalness: 1 });
      // 上から見た輪郭（Shapeのy = -z）。脚先の中心、根元は中心から40mm・幅100、先端は幅48で丸める
      const tips = [[296, -142], [185, 142], [-185, 142], [-296, -142]]; // 前右・後右・後左・前左（反時計回り）
      const legs = new THREE.Shape();
      tips.forEach(([tx, ty], i) => {
        const a = Math.atan2(ty, tx), dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
        const rx = dx * 40, ry = dy * 40;
        if (i === 0) legs.moveTo(rx - nx * 50, ry - ny * 50); else legs.lineTo(rx - nx * 50, ry - ny * 50);
        legs.lineTo(tx - nx * 24, ty - ny * 24);
        legs.absarc(tx, ty, 24, a - Math.PI / 2, a + Math.PI / 2, false);
        legs.lineTo(rx + nx * 50, ry + ny * 50);
      });
      legs.closePath();
      const legGeo = new THREE.ExtrudeGeometry(legs, { depth: 12, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 3, curveSegments: 16 });
      add(legGeo.rotateX(-Math.PI / 2).translate(0, 3, 0), baseMat, 0, 0, 0, 'Stand_Legs');
      // 中央の台と前面の銀アクセント
      add(new RoundedBoxGeometry(160, 16, 110, 3, 5), baseMat, 0, 18 + 8 - 4, 0, 'Stand_Hub');
      add(new RoundedBoxGeometry(150, 3, 14, 2, 1.2), chromeMat, 0, 30.5, 46, 'Stand_Accent');
      // 支柱：パネル裏（z -24 より後ろ）から台へ
      add(new RoundedBoxGeometry(120, 110, 28, 3, 6), baseMat, 0, 30 + 55, -38, 'Stand_Neck');
      return body;
    }),
    // Genelec 8341A（W237×H370(Iso-Pod込み、本体351)×D243、同軸 90mmコーン＋19mmドーム、ウーファーは上下スロットから放射）
    // 形は公式写真を参考：前面ウェーブガイド板（上下の角にスロット）、同軸ドライバーへ落ち込む浅い皿、緑LED、ロゴ、X脚のIso-Pod
    spk: (f) => buildDetailedMesh(f, { W: 237, H: 370, D: 243 }, ({ add }) => {
      const bodyMat = mat('SPK_Body', { color: f.col, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide });
      const slotMat = mat('SPK_Slot', { color: 0x0b0b0c, roughness: 0.9, side: THREE.DoubleSide });
      const coneMat = mat('SPK_Cone', { color: 0x2a2e35, roughness: 0.75, side: THREE.DoubleSide });
      const surroundMat = mat('SPK_Surround', { color: 0x17181b, roughness: 0.85 });
      const meshMat = mat('SPK_TweeterMesh', { color: 0x6d7178, roughness: 0.85, metalness: 0.4 });
      const podMat = mat('SPK_IsoPod', { color: 0x1e1f21, roughness: 0.85 });
      const ledMat = mat('SPK_LED', { color: 0x20c040, emissive: 0x20d040, emissiveIntensity: 1.2 });
      ledMat.userData.keepEmissive = true;
      const PY = 19 + 351 / 2;   // 筐体・前面板の中心高さ
      const HY = 10.5;           // ドライバー中心（前面板の中心より少し上）
      const ZB = 118.5, ZP = 121.5; // 筐体前面 / 前面板の表面
      // Iso-Pod：X字の脚＋上の座面
      [Math.PI / 4, -Math.PI / 4].forEach((a, i) => add(new RoundedBoxGeometry(26, 15, 200, 3, 7).rotateY(a), podMat, 0, 7.5, 0, `IsoPod_Leg${i + 1}`));
      add(new RoundedBoxGeometry(110, 8, 130, 2, 3), podMat, 0, 15, 0, 'IsoPod_Top');
      // 筐体：角R25の箱から平らな前面を抜き、ドライバー部に穴のある面を張り直す（皿が奥まで見えるように）
      const shell = new RoundedBoxGeometry(237, 351, 240, 5, 25);
      const keep = [];
      const p = shell.attributes.position;
      for (let i = 0; i < p.count; i += 3) if (!(p.getZ(i) > 119.99 && p.getZ(i + 1) > 119.99 && p.getZ(i + 2) > 119.99)) keep.push(i, i + 1, i + 2);
      const trimmed = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) {
        const src = shell.attributes[k], arr = new Float32Array(keep.length * src.itemSize);
        keep.forEach((v, j) => { for (let c = 0; c < src.itemSize; c++) arr[j * src.itemSize + c] = src.array[v * src.itemSize + c]; });
        trimmed.setAttribute(k, new THREE.BufferAttribute(arr, src.itemSize));
      }
      const body = add(trimmed, bodyMat, 0, PY, -1.5, 'Enclosure');
      const rr = (s, w, h, r) => {
        s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0);
        s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2);
        s.lineTo(-w / 2 + r, h / 2); s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI);
        s.lineTo(-w / 2, -h / 2 + r); s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5);
        return s;
      };
      const withHole = (s) => { s.holes.push(new THREE.Path().absarc(0, HY, 80, 0, Math.PI * 2, true)); return s; };
      const face = new THREE.Shape(); face.moveTo(-93.5, -150.5); face.lineTo(93.5, -150.5); face.lineTo(93.5, 150.5); face.lineTo(-93.5, 150.5); face.lineTo(-93.5, -150.5);
      add(new THREE.ShapeGeometry(withHole(face)), bodyMat, 0, PY, ZB, 'Enclosure_Front');
      // 上下のスロット（前面板の外周に沿って角を回り込む黒い隙間）
      const slot = new THREE.Shape(), sw = 187, st = 150.5, sr = 26, sc = st - 58;
      slot.moveTo(-sw / 2, sc); slot.lineTo(-sw / 2, st - sr); slot.absarc(-sw / 2 + sr, st - sr, sr, Math.PI, Math.PI / 2, true);
      slot.lineTo(sw / 2 - sr, st); slot.absarc(sw / 2 - sr, st - sr, sr, Math.PI / 2, 0, true); slot.lineTo(sw / 2, sc); slot.lineTo(-sw / 2, sc);
      add(new THREE.ShapeGeometry(slot), slotMat, 0, PY, ZB + 1, 'Slot_Top');
      add(new THREE.ShapeGeometry(slot).rotateZ(Math.PI), slotMat, 0, PY, ZB + 1, 'Slot_Bottom');
      // 前面板（ウェーブガイド）厚さ3mm
      const plate = new THREE.ExtrudeGeometry(withHole(rr(new THREE.Shape(), 179, 285, 22)), { depth: 2, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.8, bevelSegments: 2, curveSegments: 24 });
      add(plate.translate(0, 0, -2.5), bodyMat, 0, PY, ZP, 'Waveguide_Plate');
      // 浅い皿（ウェーブガイド）：前面板の穴の縁から奥のドライバーへ滑らかに落ち込む
      const dish = [];
      for (let i = 0; i <= 16; i++) { const t = i / 16; dish.push(new THREE.Vector2(47 + 33 * t, -15.5 * (1 - t) ** 2)); }
      add(new THREE.LatheGeometry(dish, 64).rotateX(Math.PI / 2), bodyMat, 0, PY + HY, ZP, 'Waveguide_Dish');
      // 同軸ドライバー：ミッドのコーン（Φ90）とエッジ、中央のメッシュ付きツイーター
      const cone = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; cone.push(new THREE.Vector2(15 + 32 * t, -6 * (1 - t))); }
      add(new THREE.LatheGeometry(cone, 64).rotateX(Math.PI / 2), coneMat, 0, PY + HY, ZP - 15.5, 'Mid_Cone');
      add(new THREE.TorusGeometry(46, 2.2, 8, 64), surroundMat, 0, PY + HY, ZP - 15.5, 'Mid_Surround');
      add(new THREE.TorusGeometry(15, 1.5, 8, 40), surroundMat, 0, PY + HY, ZP - 21, 'Tweeter_Ring');
      add(new THREE.SphereGeometry(14, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.45), meshMat, 0, PY + HY, ZP - 21, 'Tweeter');
      // 左の緑LED
      add(new THREE.CylinderGeometry(2.2, 2.2, 1, 16).rotateX(Math.PI / 2), ledMat, -72, PY + HY, ZP - 0.45, 'LED');
      // 下部の GENELEC ロゴ（canvasが無い環境＝書き出し時は、Blender側で文字に置き換える目印の板）
      const tex = genelecLogo();
      const logoMat = tex ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }) : mat('SPK_Logo', { color: 0xd4d6da, roughness: 0.5 });
      const logo = add(new THREE.PlaneGeometry(56, 10.5), logoMat, 0, PY - 142.5 + 22, ZP + 0.05, 'Logo_GENELEC');
      logo.castShadow = false;
      return body;
    }),
  };
  let genelecTex = null;
  function genelecLogo() {
    if (typeof document === 'undefined') return null;
    if (genelecTex) return genelecTex;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#d4d6da';
    x.font = '500 76px "Helvetica Neue", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('GENELEC', 256, 52);
    genelecTex = new THREE.CanvasTexture(c);
    genelecTex.colorSpace = THREE.SRGBColorSpace;
    genelecTex.anisotropy = 4;
    return genelecTex;
  }

  return DETAILED;
}
