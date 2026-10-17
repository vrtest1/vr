// Builds the S65C SELECT PLAN2 model from plan.json (mm) into a THREE.Group (m).
// Shared by the browser viewer (inlined into index.html) and tools/build.mjs (GLB export).
// World axes: X = west->east, Y = up, Z = north->south. Origin = west wall CL x north wall CL.

// Material textures (src/tex/, made by tools/make_textures.py from IMG_9137.JPG "Bayside White").
// s = real size of one texture tile in metres [u, v]; UVs are generated in world units so the
// grain keeps its real scale on every wall, floor and door.
export const TEXTURES = {
  wood: { file: 'floor.jpg', s: [1.5, 1.5] },
  door: { file: 'door.jpg', s: [0.9, 2.2] },
  doorWhite: { file: 'door.jpg', s: [0.9, 2.2] },
  store: { file: 'door.jpg', s: [0.9, 2.2] },
  wall: { file: 'wall.jpg', s: [0.6, 0.6] },
  ext: { file: 'wall.jpg', s: [0.6, 0.6] },
  counter: { file: 'stone.jpg', s: [0.8, 0.8] },
  kitchen: { file: 'panel.jpg', s: [0.6, 0.6] },
  shelf: { file: 'panel.jpg', s: [0.6, 0.6] },
  tile: { file: 'tile.jpg', s: [1.2, 1.2] },
};

export function buildModel(THREE, plan, opts = {}) {
  const S = 0.001;
  const WH = plan.wallHeight;
  const root = new THREE.Group();
  root.name = 'S65C_SELECT_PLAN2';

  const groups = {};
  for (const g of ['floors', 'walls', 'windows', 'doors', 'cabinets', 'ceilings', 'exterior']) {
    groups[g] = new THREE.Group();
    groups[g].name = g;
    root.add(groups[g]);
  }

  const PAL = {
    wall: 0xece7e1, ext: 0xe2ddd6, col: 0xc4bfb8,
    wood: 0xd8cfc6, tile: 0xb8b3ac, wet: 0xe9e6e1, bath: 0xdde2e5, out: 0x9d9993,
    door: 0x8b7d71, doorWhite: 0xeeebe6, doorDark: 0x4a4643, doorGlass: 0xcfdde4,
    store: 0xe4dfd8, kitchen: 0x9b8d80, counter: 0xf1efeb, stove: 0x2b2b2d, sink: 0xa3a9ae,
    white: 0xf7f7f5, pipe: 0xb8b9bb, mirror: 0xb9c8d0, panel: 0xc9ccd0, shelf: 0xd2c6b9, sash: 0x3a3836,
    glass: 0xa9d2ea, ceiling: 0xf6f5f2,
  };
  const mats = {};
  function mat(key, extra = {}) {
    const k = key + JSON.stringify(extra);
    if (!mats[k]) {
      const tex = opts.textures && opts.textures[key];
      mats[k] = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : PAL[key], map: tex || null, roughness: 0.85, metalness: 0, ...extra });
      mats[k].name = key;
      mats[k].userData.role = key;
      mats[k].userData.plain = PAL[key];
      mats[k].userData.tex = tex || null;
    }
    return mats[k];
  }
  const glassMat = () => mat('glass', { transparent: true, opacity: 0.3, roughness: 0.1, depthWrite: false });

  // box-projected UVs in real-world units (metres / tile size), using parent-local coordinates
  function worldUV(geo, ox, oy, oz, role) {
    const t = TEXTURES[role];
    const [su, sv] = t ? t.s : [1, 1];
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
      const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
      if (ay >= ax && ay >= az) uv.setXY(i, x / su, -z / sv);
      else if (ax >= az) uv.setXY(i, z / su, y / sv);
      else uv.setXY(i, x / su, y / sv);
    }
    uv.needsUpdate = true;
  }

  function box(x1, y1, z1, x2, y2, z2, material, name, parent, ud = {}) {
    const w = Math.abs(x2 - x1) * S, h = Math.abs(y2 - y1) * S, d = Math.abs(z2 - z1) * S;
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set((x1 + x2) / 2 * S, (y1 + y2) / 2 * S, (z1 + z2) / 2 * S);
    worldUV(m.geometry, m.position.x, m.position.y, m.position.z, material.userData.role);
    m.name = name;
    m.userData = { ...ud };
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // ---------- floors ----------
  const roomOf = {};
  for (const r of plan.rooms) {
    roomOf[r.id] = r;
    const fm = mat(r.col === 'wood' ? 'wood' : r.col);
    const lv = r.level;
    if (r.poly) {
      const shape = new THREE.Shape(r.poly.map(([x, z]) => new THREE.Vector2(x * S, -z * S)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, fm);
      m.position.y = lv * S - 0.03;
      worldUV(g, 0, m.position.y, 0, fm.userData.role);
      m.name = 'floor_' + r.id;
      m.userData = { floor: true, room: r.id };
      m.receiveShadow = true;
      groups.floors.add(m);
    } else {
      r.rects.forEach((q, i) =>
        box(q[0], lv - 30, q[1], q[2], lv, q[3], fm, `floor_${r.id}_${i}`, groups.floors, { floor: true, room: r.id }));
    }
    if (r.ch) {
      const cm = mat('ceiling');
      r.rects.forEach((q, i) =>
        box(q[0], r.ch, q[1], q[2], r.ch + 20, q[3], cm, `ceiling_${r.id}_${i}`, groups.ceilings, { ceiling: true }));
    }
  }
  // soffits (下り天井): from soffit height up to the ceiling of the room it sits in
  function roomAt(x, z) {
    for (const r of plan.rooms) {
      if (!r.ch) continue;
      for (const q of r.rects) if (x >= q[0] && x <= q[2] && z >= q[1] && z <= q[3]) return r;
    }
    return null;
  }
  plan.soffits.forEach((s, i) => {
    const [x1, z1, x2, z2] = s.r;
    const rm = roomAt((x1 + x2) / 2, (z1 + z2) / 2);
    const top = rm ? rm.ch : WH;
    if (top > s.y) box(x1, s.y, z1, x2, top, z2, mat('ceiling'), `soffit_${i}`, groups.ceilings, { ceiling: true, soffit: true });
  });

  // ---------- walls & columns ----------
  for (const w of plan.walls) {
    const [x1, z1, x2, z2] = w.r;
    const [y1, y2] = w.y || [0, WH];
    const m = w.k === 'col' ? mat('col') : w.k === 'ext' ? mat('ext') : mat('wall');
    box(x1, y1, z1, x2, y2, z2, m, w.id, groups.walls, { wall: true, kind: w.k, toggles: w.toggles });
  }

  // ---------- windows ----------
  for (const w of plan.windows) {
    const [x1, x2] = w.x, [z1, z2] = w.z, gz = w.glassZ;
    const g = new THREE.Group();
    g.name = w.id;
    groups.windows.add(g);
    if (w.sill > 0) {
      box(x1, 0, z1, x2, w.sill - 30, z2, mat('ext'), w.id + '_under', g, { wall: true });
      box(x1, w.sill - 30, z1 - 15, x2, w.sill, gz - 20, mat('shelf'), w.id + '_shelf', g, { shelf: true });
      box(x1, w.sill - 30, gz - 20, x2, w.sill, z2, mat('ext'), w.id + '_sill_out', g, { wall: true });
    }
    box(x1, w.head, z1, x2, WH, z2, mat('ext'), w.id + '_head', g, { wall: true });
    box(x1 + 40, w.sill + 40, gz - 6, x2 - 40, w.head - 40, gz + 6, glassMat(), w.id + '_glass', g, { glass: true }).castShadow = false;
    const fr = 40, sm = mat('sash');
    box(x1, w.sill, gz - 25, x2, w.sill + fr, gz + 25, sm, w.id + '_frameB', g);
    box(x1, w.head - fr, gz - 25, x2, w.head, gz + 25, sm, w.id + '_frameT', g);
    box(x1, w.sill, gz - 25, x1 + fr, w.head, gz + 25, sm, w.id + '_frameL', g);
    box(x2 - fr, w.sill, gz - 25, x2, w.head, gz + 25, sm, w.id + '_frameR', g);
    const xm = (x1 + x2) / 2;
    box(xm - 25, w.sill, gz - 30, xm + 25, w.head, gz + 30, sm, w.id + '_meeting', g);
  }

  // ---------- doors ----------
  const doorPivots = [];
  for (const d of plan.doors) {
    const [hx, hz] = d.hinge;
    const ang = (p) => Math.atan2(p[1] - hz, p[0] - hx);
    const L = Math.hypot(d.closed[0] - hx, d.closed[1] - hz);
    const pivot = new THREE.Group();
    pivot.name = d.id;
    pivot.position.set(hx * S, 0, hz * S);
    const col = d.col === 'white' ? 'doorWhite' : d.col === 'dark' ? 'doorDark' : d.col === 'glass' ? 'doorGlass' : 'door';
    const leaf = box(0, 0, -20, L, d.h, 20, mat(col), d.id + '_leaf', pivot, { door: true });
    // simple handle
    box(L - 90, 950, -45, L - 60, 1010, 45, mat('sash'), d.id + '_handle', pivot, { door: true });
    const cr = -ang(d.closed);
    let dr = -ang(d.open) - cr;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr)); // swing the short way (all swings are < 180 deg)
    pivot.userData = { door: true, name: d.name, closedRot: cr, swing: dr, t: 1, store: !!d.store };
    setDoorT(pivot, opts.doorsOpen === false || d.store ? 0 : 1);
    groups.doors.add(pivot);
    doorPivots.push(pivot);
    void leaf;
  }
  const sliders = [];
  for (const s of plan.sliders) {
    const states = s.states || [s.closed, s.open];
    const st = states[0];
    const m = box(st[0], 0, st[1], st[2], s.h, st[3], mat('door'), s.id, groups.doors, { door: true, slider: true });
    m.userData.states = states;
    m.userData.group = s.group || s.id;
    m.userData.stages = states.length - 1;
    m.userData.h = s.h;
    m.userData.name = s.name;
    m.userData.isWallDoor = s.id.startsWith('s_wd');
    sliders.push(m);
    setSliderT(m, opts.doorsOpen === false ? 0 : 1);
  }

  // ---------- cabinets & fixtures ----------
  // walk-in style storage: hollow carcass open at the front (doors are separate), with
  // a top shelf + hanger pipe (closet) or adjustable shelves (storage)
  function closet(c) {
    const [x1, z1, x2, z2] = c.r;
    const H = c.y[1], T = 20, g = new THREE.Group();
    g.name = c.id;
    groups.cabinets.add(g);
    const pm = mat('store'), sm = mat('shelf');
    // local frame: "w" runs along the front, "d" from front (0) to back
    const f = c.front;
    const along = f === 'N' || f === 'S' ? [x1, x2] : [z1, z2];
    const depth = f === 'N' || f === 'S' ? z2 - z1 : x2 - x1;
    function slab(w1, w2, d1, d2, y1, y2, m, name) {
      // convert (along, depth-from-front) to world rect
      let r;
      if (f === 'S') r = [w1, z2 - d2, w2, z2 - d1];
      else if (f === 'N') r = [w1, z1 + d1, w2, z1 + d2];
      else if (f === 'E') r = [x2 - d2, w1, x2 - d1, w2];
      else r = [x1 + d1, w1, x1 + d2, w2];
      return box(r[0], y1, r[1], r[2], y2, r[3], m, c.id + '_' + name, g, { cabinet: true, name: c.name });
    }
    const [a1, a2] = along;
    box(x1, -30, z1, x2, 0, z2, mat('wood'), c.id + '_floor', g, { floor: true });
    slab(a1, a2, depth - T, depth, 0, H, pm, 'back');
    slab(a1, a1 + T, 0, depth, 0, H, pm, 'sideA');
    slab(a2 - T, a2, 0, depth, 0, H, pm, 'sideB');
    slab(a1, a2, 0, depth, H - T, H, pm, 'top');
    slab(a1, a2, 0, T, 2000, H - T, pm, 'header');
    if (c.closet === 'hanger') {
      slab(a1 + T, a2 - T, depth - 320, depth - T, 1800, 1818, sm, 'shelf');
      slab(a1 + T, a2 - T, depth / 2 - 12, depth / 2 + 13, 1690, 1715, mat('pipe'), 'pipe');
    } else {
      for (let y = 350; y < 1900; y += 380) slab(a1 + T, a2 - T, 20, depth - T, y, y + 18, sm, 'shelf' + y);
    }
  }

  for (const c of plan.cabinets) {
    if (c.closet) { closet(c); continue; }
    const [x1, z1, x2, z2] = c.r;
    const m = box(x1, c.y[0], z1, x2, c.y[1], z2, mat(c.col), c.id, groups.cabinets, { cabinet: true, name: c.name });
    if (m && c.col === 'mirror') m.castShadow = false;
  }

  // ---------- balcony railing ----------
  if (plan.railing) {
    const [x1, z1, x2, z2] = plan.railing.r;
    const base = roomOf.balcony ? roomOf.balcony.level : 0;
    box(x1, base, z1, x2, base + 120, z2, mat('ext'), 'railing_curb', groups.exterior);
    box(x1, base + 120, z1 + 20, x2, base + plan.railing.h - 40, z2 - 20, glassMat(), 'railing_glass', groups.exterior, { glass: true }).castShadow = false;
    box(x1, base + plan.railing.h - 40, z1, x2, base + plan.railing.h, z2, mat('sash'), 'railing_top', groups.exterior);
    box(x1, base - 200, z1, x2, base, z2 + 120, mat('ext'), 'balcony_edge', groups.exterior);
  }

  // t: 0 = closed, 1 = fully open
  function setDoorT(pivot, t) {
    pivot.userData.t = t;
    pivot.rotation.y = pivot.userData.closedRot + pivot.userData.swing * t;
  }
  function setSliderT(m, t) {
    m.userData.t = t;
    // piecewise between the states (closed -> ... -> open), t in [0, 1]
    const sts = m.userData.states, n = sts.length - 1;
    const k = Math.min(n - 1, Math.floor(t * n)), f = t * n - k;
    const a = sts[k], b = sts[k + 1];
    const r = a.map((v, i) => v + (b[i] - v) * f);
    // wall-door panels fold to the north: thin in the middle of the motion so they don't sweep the room
    m.geometry.dispose();
    m.geometry = new THREE.BoxGeometry(Math.max(1, Math.abs(r[2] - r[0])) * S, m.userData.h * S, Math.max(1, Math.abs(r[3] - r[1])) * S);
    m.position.set((r[0] + r[2]) / 2 * S, m.userData.h / 2 * S, (r[1] + r[3]) / 2 * S);
    worldUV(m.geometry, m.position.x, m.position.y, m.position.z, 'door');
  }
  function setDoors(open, which = 'all') {
    for (const p of doorPivots) if (which === 'all' || (which === 'store') === p.userData.store && which !== 'wall') setDoorT(p, open ? 1 : 0);
    for (const m of sliders) {
      if (which === 'all' || (which === 'wall' && m.userData.isWallDoor) || (which === 'doors' && !m.userData.isWallDoor)) setSliderT(m, open ? 1 : 0);
    }
  }
  function setWallDoor(open) { setDoors(open, 'wall'); }

  return { root, groups, materials: mats, doorPivots, sliders, setDoors, setWallDoor, setDoorT, setSliderT, roomAt };
}
