import { BufferAttribute, BufferGeometry, Color, DoubleSide, MeshLambertMaterial } from 'three';
import { LEAF_CELLS, leafCellUV, rng } from './leafAtlas.js';

/**
 * Procedural trees: a trunk that branches recursively, with cards of foliage
 * (textured from the leaf atlas) on the outer twigs.
 *
 * A tree is grown once as a skeleton (branch paths and leaf cards) and then
 * turned into triangles at two levels of detail, so the near and the middle
 * distance version are the same tree.
 *
 * Vertex attributes: position, normal, color, uv and `aVTree`
 * (x: 1 on foliage, 0 on bark / y: how much the part bends in the wind /
 * z: bark pattern, 1 = birch).
 */

const TAU = Math.PI * 2;
const GOLDEN = 2.39996323;
const DEG = Math.PI / 180;
const UP = [0, 1, 0];
const C = LEAF_CELLS;

const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** A unit vector at right angles to d. */
function perp(d) {
  return norm(cross(d, Math.abs(d[1]) < 0.95 ? UP : [1, 0, 0]));
}

/** A unit vector at right angles to d, turned by `angle` around it. */
function around(d, angle) {
  const u = perp(d), v = cross(d, u);
  const c = Math.cos(angle), s = Math.sin(angle);
  return [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
}

/** d tilted by `angle` toward the azimuth `az`. */
function deflect(d, angle, az) {
  const r = around(d, az);
  const c = Math.cos(angle), s = Math.sin(angle);
  return norm([d[0] * c + r[0] * s, d[1] * c + r[1] * s, d[2] * c + r[2] * s]);
}

function randomUnit(rnd) {
  const y = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

/** Point on a branch path, t = 0..1. */
function sample(pts, t) {
  const f = clamp01(t) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const a = pts[i], b = pts[i + 1];
  return { p: mix3(a.p, b.p, k), d: norm(mix3(a.d, b.d, k)), r: a.r + (b.r - a.r) * k, flex: a.flex + (b.flex - a.flex) * k };
}

// --- foliage ----------------------------------------------------------------
// A leaf card: starts at `p`, runs `len` along `axis`, `wid` wide, facing `normal`.
// `mid` marks the cards that are kept in the middle-distance version.

function spruceLeaves(T, b) {
  const rnd = T.rnd;
  const from = sample(b.pts, 0.04), end = b.pts[b.pts.length - 1];
  const axis = norm(add(end.p, from.p, -1));
  const side = norm(cross(axis, UP));
  const up = cross(side, axis);
  const len = b.len * 1.12, wid = Math.max(0.9, len * 0.75);
  // The bough: two long sprays crossed along the branch, so it shows from every side.
  for (const tilt of [-0.6, 0.6]) {
    const c = Math.cos(tilt), sn = Math.sin(tilt);
    T.leaves.push({
      p: from.p, axis, normal: [up[0] * c + side[0] * sn, up[1] * c + side[1] * sn, up[2] * c + side[2] * sn],
      len, wid, cell: C.spruce, flex: end.flex, mid: true,
    });
  }
  // Twigs hanging below the longer boughs.
  if (b.len > 1) {
    const at = sample(b.pts, 0.5);
    T.leaves.push({
      p: at.p, axis: norm([axis[0] * 0.25, -1, axis[2] * 0.25]), normal: side,
      len: b.len * 0.4 * (0.8 + 0.4 * rnd()), wid: b.len * 0.8, cell: C.spruce, flex: at.flex, mid: false,
    });
  }
}

function spruceTop(T) {
  const trunk = T.branches[0].pts;
  const top = trunk[trunk.length - 1];
  for (const normal of [[1, 0, 0], [0, 0, 1]]) {
    T.leaves.push({ p: add(top.p, UP, -1.4), axis: UP, normal, len: 2.1, wid: 1.4, cell: C.spruce, flex: 0.5, mid: true });
  }
}

function tuft(T, at, size, mid) {
  const rnd = T.rnd;
  const base = add(at.p, at.d, -size * 0.25);
  const k0 = rnd() * Math.PI;
  for (let k = 0; k < 3; k++) {
    T.leaves.push({
      p: base, axis: at.d, normal: around(at.d, k0 + (k * Math.PI) / 3),
      len: size, wid: size * 0.95, cell: C.pine, flex: at.flex, mid: mid && k < 2,
    });
  }
}

function pineLeaves(T, b) {
  const rnd = T.rnd;
  if (b.level === 2) tuft(T, sample(b.pts, 0.5), 1.25 + 0.3 * rnd(), false);
  tuft(T, sample(b.pts, 1), 1.6 + 0.4 * rnd(), true);
}

/** Clusters of leaves scattered along a twig. */
function clusters(cell, { at: places, size, spread, hang = 0, midEvery = 3 }) {
  return (T, b) => {
    const rnd = T.rnd;
    places.forEach((t, i) => {
      const at = sample(b.pts, t);
      const out = norm([at.p[0], at.p[1] - T.height * 0.6, at.p[2]]);
      const r = randomUnit(rnd);
      const axis = norm([
        at.d[0] * 0.6 + r[0] * spread + out[0] * 0.35,
        at.d[1] * 0.6 + r[1] * spread + out[1] * 0.35 - hang,
        at.d[2] * 0.6 + r[2] * spread + out[2] * 0.35,
      ]);
      const s = size * (0.8 + 0.4 * rnd());
      T.leaves.push({
        p: add(at.p, axis, -0.15 * s), axis, normal: around(axis, rnd() * TAU),
        len: s, wid: s * 0.92, cell, flex: at.flex, mid: (T.leaves.length + i) % midEvery === 0,
      });
    });
  };
}

function snagTwigs(T, b) {
  const at = sample(b.pts, 1);
  const k0 = T.rnd() * Math.PI;
  for (let k = 0; k < 2; k++) {
    T.leaves.push({
      p: add(at.p, at.d, -0.2), axis: at.d, normal: around(at.d, k0 + (k * Math.PI) / 2),
      len: 1.3, wid: 1.2, cell: C.twig, flex: at.flex, mid: k === 0,
    });
  }
}

// --- species ----------------------------------------------------------------
// height     metres            trunk   length of the trunk as a fraction of the height
// radius     trunk radius (m)  flare   how much the trunk widens at the ground
// puff       foliage normals point away from the trunk axis (0) or the crown centre (1)
// levels[]   one entry per branching level:
//   segments / sides   resolution of the tube
//   taper              radius at the end as a fraction of the start
//   wander             random change of direction per segment
//   tropism            pull upward (+) or downward (-) over the whole branch
//   children           { count, whorl, t0, t1, angle(t) deg, angleVar, length(t), radius, leader }
//                      length is a fraction of the tree height (level 0) or of the parent branch
//   leaves             function that adds leaf cards to a finished branch
// mid        the middle-distance version: tubes up to this level, leaf cards scaled by `scale`

const SPECIES = {
  spruce: {
    height: 17, trunk: 1, radius: 0.3, flare: 0.5, minRadius: 0.02, puff: 0.15, barkStyle: 0,
    bark: [0x4a3c30, 0x3b312a], leaf: [0x2a4d32, 0x55854a],
    mid: { levels: 0, scale: 1.15 },
    levels: [
      {
        segments: 10, sides: 8, taper: 0.06, wander: 0.012, tropism: 0,
        children: {
          count: 64, whorl: 4, t0: 0.14, t1: 0.96, angle: (t) => 108 - 55 * t, angleVar: 8,
          length: (t) => 0.03 + 0.18 * Math.pow(1 - t, 0.8), radius: 0.28,
        },
      },
      { segments: 3, sides: 3, taper: 0.2, wander: 0.03, tropism: 0.18, leaves: spruceLeaves },
    ],
    finish: spruceTop,
  },
  pine: {
    height: 16, trunk: 1, radius: 0.27, flare: 0.35, minRadius: 0.025, puff: 0.8, barkStyle: 0,
    bark: [0x4d3a2c, 0x8a5230], twig: 0x5a3f2c, leaf: [0x31563a, 0x6a924e],
    mid: { levels: 1, scale: 1.45 },
    levels: [
      {
        segments: 10, sides: 8, taper: 0.25, wander: 0.035, tropism: 0.05,
        children: {
          count: 11, t0: 0.5, t1: 0.97, angle: (t) => 82 - 38 * (t - 0.5) * 2, angleVar: 12,
          length: (t) => 0.3 - 0.5 * Math.abs(t - 0.65), radius: 0.45, leader: 0.1,
        },
      },
      {
        segments: 5, sides: 5, taper: 0.3, wander: 0.08, tropism: 0.35, leaves: pineLeaves,
        children: { count: 4, t0: 0.35, t1: 1, angle: () => 45, angleVar: 15, length: () => 0.42, radius: 0.6 },
      },
      { segments: 3, sides: 3, taper: 0.4, wander: 0.08, tropism: 0.3, leaves: pineLeaves },
    ],
  },
  oak: {
    height: 13, trunk: 0.36, radius: 0.42, flare: 0.5, minRadius: 0.03, puff: 1, barkStyle: 0,
    bark: [0x4f4032, 0x453a30], leaf: [0x3b632e, 0x86b052],
    mid: { levels: 1, scale: 1.75 },
    levels: [
      {
        segments: 5, sides: 9, taper: 0.7, wander: 0.04, tropism: 0,
        children: {
          count: 6, t0: 0.6, t1: 1, angle: (t) => 62 - 25 * ((t - 0.6) / 0.4), angleVar: 10,
          length: () => 0.5, radius: 0.55, leader: 0.5,
        },
      },
      {
        segments: 6, sides: 6, taper: 0.3, wander: 0.1, tropism: 0.12,
        children: { count: 5, t0: 0.3, t1: 1, angle: () => 55, angleVar: 15, length: (t) => 0.55 - 0.2 * t, radius: 0.55 },
      },
      {
        segments: 3, sides: 4, taper: 0.4, wander: 0.12, tropism: 0.05,
        leaves: clusters(C.oak, { at: [0.7, 1], size: 1.85, spread: 0.8 }),
        children: { count: 3, t0: 0.35, t1: 1, angle: () => 50, angleVar: 20, length: () => 0.55, radius: 0.6 },
      },
      { segments: 1, sides: 3, taper: 0.5, wander: 0.1, tropism: 0, leaves: clusters(C.oak, { at: [0.2, 0.5, 0.8, 1], size: 1.85, spread: 0.8 }) },
    ],
  },
  birch: {
    height: 14, trunk: 1, radius: 0.16, flare: 0.3, minRadius: 0.015, puff: 0.7, barkStyle: 1,
    bark: [0xd9d6cc, 0xb9b5a8], twig: 0x3a2f2a, leaf: [0x4c7a34, 0xa0c45a],
    mid: { levels: 1, scale: 1.7 },
    levels: [
      {
        segments: 10, sides: 7, taper: 0.1, wander: 0.03, tropism: 0.02,
        children: {
          count: 18, t0: 0.28, t1: 0.96, angle: (t) => 52 - 15 * t, angleVar: 10,
          length: (t) => 0.3 - 0.2 * t, radius: 0.4,
        },
      },
      {
        segments: 4, sides: 4, taper: 0.25, wander: 0.07, tropism: -0.05,
        leaves: clusters(C.birch, { at: [1, 1], size: 1.15, spread: 0.35, hang: 0.9 }),
        children: { count: 3, t0: 0.4, t1: 1, angle: () => 40, angleVar: 15, length: () => 0.5, radius: 0.6 },
      },
      { segments: 3, sides: 3, taper: 0.4, wander: 0.08, tropism: -0.6, leaves: clusters(C.birch, { at: [0.3, 0.65, 1], size: 1.15, spread: 0.35, hang: 0.9 }) },
    ],
  },
  bush: {
    height: 1.9, trunk: 0.12, radius: 0.05, flare: 0, minRadius: 0.012, puff: 1, barkStyle: 0,
    bark: [0x4a3d30, 0x4a3d30], leaf: [0x44692a, 0x8cab50],
    mid: { levels: 1, scale: 1.5 },
    levels: [
      {
        segments: 1, sides: 4, taper: 0.9, wander: 0, tropism: 0,
        children: { count: 8, t0: 0.3, t1: 1, angle: () => 42, angleVar: 28, length: () => 0.85, radius: 0.7 },
      },
      {
        segments: 3, sides: 3, taper: 0.4, wander: 0.12, tropism: 0.15,
        leaves: clusters(C.bush, { at: [0.45, 0.75, 1], size: 0.85, spread: 0.9, midEvery: 2 }),
        children: { count: 3, t0: 0.3, t1: 0.9, angle: () => 50, angleVar: 20, length: () => 0.5, radius: 0.7 },
      },
      { segments: 2, sides: 3, taper: 0.5, wander: 0.1, tropism: 0, leaves: clusters(C.bush, { at: [0.5, 1], size: 0.85, spread: 0.9, midEvery: 2 }) },
    ],
  },
  snag: {
    height: 11, trunk: 1, radius: 0.3, flare: 0.5, minRadius: 0.02, puff: 1, barkStyle: 0,
    bark: [0x6b655c, 0x8a857b], leaf: [0x5a544c, 0x7a746a],
    mid: { levels: 1, scale: 1.2 },
    levels: [
      {
        segments: 8, sides: 7, taper: 0.4, wander: 0.05, tropism: 0,
        children: {
          count: 8, t0: 0.35, t1: 0.95, angle: (t) => 75 - 20 * t, angleVar: 15,
          length: (t) => 0.26 - 0.12 * t, radius: 0.45,
        },
      },
      {
        segments: 4, sides: 4, taper: 0.25, wander: 0.15, tropism: 0.05, leaves: snagTwigs,
        children: { count: 2, t0: 0.4, t1: 0.9, angle: () => 50, angleVar: 20, length: () => 0.5, radius: 0.6 },
      },
      { segments: 2, sides: 3, taper: 0.3, wander: 0.15, tropism: 0, leaves: snagTwigs },
    ],
  },
};

/** Names of the available species. */
export const TREE_SPECIES = Object.keys(SPECIES);

// --- skeleton ---------------------------------------------------------------

function grow(T, level, p0, d0, len, r0, flex0) {
  const { cfg, rnd } = T;
  const L = cfg.levels[level];
  const n = L.segments;
  const pts = [];
  let p = p0, d = norm(d0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r = r0 * (1 - (1 - L.taper) * t);
    if (level === 0 && cfg.flare) r *= 1 + cfg.flare * Math.pow(1 - t, 8);
    pts.push({ p, d, r, t, flex: level === 0 ? 0 : flex0 + (1 - flex0) * 0.45 * t });
    if (i < n) {
      const w = L.wander * 2;
      d = norm([d[0] + (rnd() - 0.5) * w, d[1] + (rnd() - 0.5) * w + L.tropism / n, d[2] + (rnd() - 0.5) * w]);
      p = add(p, d, len / n);
    }
  }
  const branch = { level, pts, len };
  T.branches.push(branch);

  const ch = L.children;
  if (ch && level + 1 < cfg.levels.length) {
    const base = level === 0 ? T.height : len;
    const count = ch.count;
    const whorls = ch.whorl ? Math.ceil(count / ch.whorl) : 0;
    let az = rnd() * TAU;
    for (let k = 0; k < count; k++) {
      let f;
      if (ch.whorl) {
        f = (Math.floor(k / ch.whorl) + 0.5) / whorls;
        az += k % ch.whorl === 0 ? 0.7 + rnd() : TAU / ch.whorl + (rnd() - 0.5) * 0.35;
      } else {
        f = (k + rnd() * 0.9) / count;
        az += GOLDEN + (rnd() - 0.5) * 0.8;
      }
      const t = ch.t0 + (ch.t1 - ch.t0) * f;
      const at = sample(pts, t);
      const angle = (ch.angle(t) + (rnd() - 0.5) * 2 * ch.angleVar) * DEG;
      const length = base * ch.length(t) * (0.8 + 0.4 * rnd());
      grow(T, level + 1, at.p, deflect(at.d, angle, az), length, Math.max(cfg.minRadius, at.r * ch.radius), at.flex);
    }
    if (ch.leader) {
      const end = pts[n];
      grow(T, level + 1, end.p, deflect(end.d, 0.2 + 0.2 * rnd(), rnd() * TAU), base * ch.leader, Math.max(cfg.minRadius, end.r * 0.85), end.flex);
    }
  }
  L.leaves?.(T, branch);
}

/** How deep inside the crown each leaf card sits, for shading: 0 at the trunk, 1 on the outside. */
function measureCrown(T) {
  const leaves = T.leaves;
  if (!leaves.length) {
    T.crownY = T.height * 0.6;
    return;
  }
  let y0 = Infinity, y1 = -Infinity, sum = 0;
  for (const leaf of leaves) {
    leaf.c = add(leaf.p, leaf.axis, leaf.len * 0.5);
    y0 = Math.min(y0, leaf.c[1]);
    y1 = Math.max(y1, leaf.c[1]);
    sum += leaf.c[1];
  }
  T.crownY = sum / leaves.length;
  const BINS = 10;
  const reach = new Array(BINS).fill(0);
  const bin = (y) => Math.min(BINS - 1, Math.floor(((y - y0) / (y1 - y0 + 1e-6)) * BINS));
  for (const leaf of leaves) reach[bin(leaf.c[1])] = Math.max(reach[bin(leaf.c[1])], Math.hypot(leaf.c[0], leaf.c[2]));
  const smooth = reach.map((r, i) => Math.max(r, 0.85 * (reach[i - 1] ?? 0), 0.85 * (reach[i + 1] ?? 0), 0.5));
  for (const leaf of leaves) {
    leaf.outer = clamp01(Math.hypot(leaf.c[0], leaf.c[2]) / smooth[bin(leaf.c[1])]);
    leaf.high = (leaf.c[1] - y0) / (y1 - y0 + 1e-6);
  }
}

// --- triangles --------------------------------------------------------------

function emit(T, detail) {
  const { cfg } = T;
  const near = detail >= 2;
  const position = [], normal = [], color = [], uv = [], tree = [], index = [];
  const rnd = rng(T.seed * 7919 + 31);
  const solid = leafCellUV(C.solid);
  const su = (solid.u0 + solid.u1) / 2, sv = (solid.v0 + solid.v1) / 2;
  const bark0 = new Color(cfg.bark[0]), bark1 = new Color(cfg.bark[1]);
  const twig = new Color(cfg.twig ?? cfg.bark[1]);
  const c = new Color();
  const vertex = (p, n, col, u, v, leaf, flex, style) => {
    position.push(p[0], p[1], p[2]);
    normal.push(n[0], n[1], n[2]);
    color.push(col.r, col.g, col.b);
    uv.push(u, v);
    tree.push(leaf, flex, style);
    return position.length / 3 - 1;
  };

  // Branches: tubes along the paths.
  for (const b of T.branches) {
    if (!near && b.level > cfg.mid.levels) continue;
    const L = cfg.levels[b.level];
    const sides = near ? L.sides : Math.max(3, Math.round(L.sides * 0.55));
    let pts = b.pts;
    if (!near && pts.length > 3) pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
    const style = b.level === 0 ? cfg.barkStyle : 0;
    const start = position.length / 3;
    let u = perp(pts[0].d);
    for (const q of pts) {
      u = norm(add(u, q.d, -dot(u, q.d)));
      const v = cross(q.d, u);
      if (b.level === 0) c.copy(bark0).lerp(bark1, q.t);
      else c.copy(twig);
      c.multiplyScalar(0.9 + 0.2 * rnd());
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const n = [u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa];
        vertex(add(q.p, n, q.r), n, c, su, sv, 0, q.flex, style);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = start + i * sides + k, a2 = start + i * sides + ((k + 1) % sides);
        index.push(a, a + sides, a2, a2, a + sides, a2 + sides);
      }
    }
    // Close the end of anything thick enough to see into.
    const last = pts[pts.length - 1];
    if (last.r > 0.04) {
      const ring = start + (pts.length - 1) * sides;
      const centre = vertex(add(last.p, last.d, last.r * 0.3), last.d, c, su, sv, 0, last.flex, style);
      for (let k = 0; k < sides; k++) index.push(ring + k, centre, ring + ((k + 1) % sides));
    }
  }

  // Foliage: slightly bowed cards.
  const dark = new Color(cfg.leaf[0]), light = new Color(cfg.leaf[1]);
  const scale = near ? 1 : cfg.mid.scale;
  const rows = near ? 3 : 2;
  const mean = [0, 0, 0];
  let cards = 0;
  // Its own random sequence, drawn for every card, so that a card looks the
  // same in both levels of detail.
  const rndLeaf = rng(T.seed * 104729 + 5);
  for (const leaf of T.leaves) {
    const shade = 0.58 + 0.42 * Math.pow(leaf.outer, 1.3);
    const tone = clamp01(0.15 + 0.45 * leaf.high + 0.25 * leaf.outer + 0.35 * (rndLeaf() - 0.5));
    const mirror = rndLeaf() < 0.5;
    const bow = (rndLeaf() < 0.5 ? 1 : -1) * 0.14;
    if (!near && !leaf.mid) continue;
    const len = leaf.len * scale, wid = leaf.wid * scale;
    const side = norm(cross(leaf.axis, leaf.normal));
    const face = norm(cross(side, leaf.axis));
    const base = add(leaf.p, leaf.axis, -0.5 * (len - leaf.len));
    const cell = leafCellUV(leaf.cell);
    const start = position.length / 3;
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      const centre = add(add(base, leaf.axis, len * t), face, len * bow * 4 * t * (1 - t));
      c.copy(dark).lerp(light, tone).multiplyScalar(shade * (0.85 + 0.15 * leaf.high) * (0.88 + 0.17 * t));
      for (const s of [-0.5, 0.5]) {
        const p = add(centre, side, s * wid);
        // Light the crown as one rounded mass rather than as flat cards.
        const o = [p[0], p[1] - (p[1] + (T.crownY - p[1]) * cfg.puff), p[2]];
        o[1] += 0.3 * Math.hypot(o[0], o[1], o[2]);
        const puff = norm(o);
        const f = dot(face, puff) < 0 ? -1 : 1;
        const n = norm([puff[0] * 0.8 + face[0] * 0.2 * f, puff[1] * 0.8 + face[1] * 0.2 * f, puff[2] * 0.8 + face[2] * 0.2 * f]);
        const uu = (s < 0) !== mirror ? cell.u0 : cell.u1;
        vertex(p, n, c, uu, cell.v1 + (cell.v0 - cell.v1) * t, 1, leaf.flex, 0);
      }
      if (r === 0) { mean[0] += c.r; mean[1] += c.g; mean[2] += c.b; cards++; }
      if (r > 0) {
        const a = start + (r - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  if (!cards) { mean[0] = bark1.r; mean[1] = bark1.g; mean[2] = bark1.b; cards = 1; }

  const count = position.length / 3;
  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    color: new Float32Array(color),
    uv: new Float32Array(uv),
    tree: new Float32Array(tree),
    index: count > 65535 ? new Uint32Array(index) : new Uint16Array(index),
    color0: mean.map((v) => v / cards),
  };
}

/**
 * Grow one tree.
 * @param {string} species one of TREE_SPECIES
 * @returns {{ species, seed, height, radius, crownY, color, near, mid }} `near` and
 *   `mid` are raw vertex data for createTreeGeometry(); `height` and `radius`
 *   (metres) bound the tree; `color` is the average colour of the foliage.
 */
export function buildTreeModel(species, seed = 1) {
  const cfg = SPECIES[species];
  if (!cfg) throw new Error(`treeGeometry: unknown species "${species}" (known: ${TREE_SPECIES.join(', ')})`);
  const rnd = rng(seed * 9973 + 17);
  const T = { cfg, seed, rnd, branches: [], leaves: [], height: cfg.height * (0.92 + 0.16 * rnd()) };
  const lean = [(rnd() - 0.5) * 0.06, 1, (rnd() - 0.5) * 0.06];
  // The trunk starts below the ground so it still meets it on a slope.
  grow(T, 0, [0, -0.4, 0], lean, T.height * cfg.trunk + 0.4, cfg.radius, 0);
  cfg.finish?.(T);
  measureCrown(T);
  const near = emit(T, 2);
  const mid = emit(T, 1);
  let radius = 0, height = 0;
  for (let i = 0; i < near.position.length; i += 3) {
    radius = Math.max(radius, Math.hypot(near.position[i], near.position[i + 2]));
    height = Math.max(height, near.position[i + 1]);
  }
  return { species, seed, height, radius, crownY: T.crownY, color: near.color0, near, mid };
}

/** Vertex data from buildTreeModel() as a geometry. */
export function createTreeGeometry(data, GeometryClass = BufferGeometry) {
  const g = new GeometryClass();
  g.setAttribute('position', new BufferAttribute(data.position, 3));
  g.setAttribute('normal', new BufferAttribute(data.normal, 3));
  g.setAttribute('color', new BufferAttribute(data.color, 3));
  g.setAttribute('uv', new BufferAttribute(data.uv, 2));
  g.setAttribute('aVTree', new BufferAttribute(data.tree, 3));
  g.setIndex(new BufferAttribute(data.index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * A tree as a plain geometry, for use outside VegetationEngine. Draw it with
 * createTreeMaterial().
 * @param {number} [options.detail] 2 = full, 1 = the middle-distance version
 */
export function createTree(species, { detail = 2, seed = 1 } = {}) {
  const model = buildTreeModel(species, seed);
  return createTreeGeometry(detail >= 2 ? model.near : model.mid);
}

/**
 * Material for createTree() geometry outside VegetationEngine: the leaf atlas
 * cut out by its alpha and tinted by the vertex colours.
 * @param {Texture} leafAtlas from createLeafAtlas()
 */
export function createTreeMaterial(leafAtlas) {
  const material = new MeshLambertMaterial({ map: leafAtlas, vertexColors: true, alphaTest: 0.45, side: DoubleSide, alphaToCoverage: true });
  material.name = 'pwe.tree';
  // The normals of the foliage describe the rounded crown, not the cards, so
  // they must not be turned around for the back of a card.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
  };
  material.customProgramCacheKey = () => 'pwe-tree-plain';
  return material;
}
