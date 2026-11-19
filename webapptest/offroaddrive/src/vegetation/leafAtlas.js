import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';

/**
 * The texture behind every leaf card: a few sprays of foliage painted with the
 * 2D canvas, one per cell. The colours are light and nearly grey on purpose,
 * because the tree's vertex colours tint them.
 */

const COLS = 4;
const ROWS = 2;

/** Cell indices. `solid` is plain white and opaque: bark uses it. */
export const LEAF_CELLS = { solid: 0, oak: 1, birch: 2, spruce: 3, pine: 4, bush: 5, twig: 6 };

/** Small seeded random number generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Texture coordinates of a cell. `v0` is the far end of the spray and `v1`
 * the end where its twig starts.
 */
export function leafCellUV(cell, inset = 0.02) {
  const col = cell % COLS, row = Math.floor(cell / COLS);
  return {
    u0: (col + inset) / COLS,
    u1: (col + 1 - inset) / COLS,
    v0: (row + inset) / ROWS,
    v1: (row + 1 - inset) / ROWS,
  };
}

const light = (rnd, hue, sat, lo, hi) => `hsl(${hue + 24 * (rnd() - 0.5)}, ${sat}%, ${lo + (hi - lo) * rnd()}%)`;

function line(ctx, x0, y0, x1, y1, width, style) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/**
 * Leaf outlines. The half-width along the leaf (t = 0 at the stalk, 1 at the
 * tip) is t^a * (1 - t)^b, so the widest point sits at a / (a + b); `lobes`
 * and `depth` cut notches into the edge, and `veins` is the number of side
 * veins on each half. Side veins end on the lobes when the two counts match.
 */
const SHAPES = {
  lens: { a: 0.8, b: 1, lobes: 0, depth: 0, veins: 5 },
  oak: { a: 1.2, b: 0.7, lobes: 5, depth: 0.42, veins: 5 },
  birch: { a: 0.6, b: 1.1, lobes: 13, depth: 0.1, veins: 6 },
};

const VEIN = 'rgba(70, 90, 55, 0.26)';
const VEIN_END = 'rgba(70, 90, 55, 0.03)';
const MIDRIB = 'rgba(70, 90, 55, 0.36)';
const SHADE = 'rgba(40, 60, 30, 0.14)';

/** One leaf from (x, y) toward `angle`; `width` is its full width at the widest point. */
function leaf(ctx, rnd, x, y, angle, length, width, fill, shape = SHAPES.lens) {
  const { a, b, lobes, depth, veins } = shape;
  const peak = Math.pow(a / (a + b), a) * Math.pow(b / (a + b), b);
  // The two halves of a real leaf are never the same width.
  const skew = 0.85 + 0.3 * rnd();
  const half = (t, side) => (side < 0 ? skew : 2 - skew) * 0.5 * width
    * Math.pow(t, a) * Math.pow(1 - t, b) / peak
    * (1 - depth * (1 - Math.abs(Math.sin(Math.PI * lobes * t))));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const N = 56;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i <= N; i++) ctx.lineTo(length * i / N, -half(i / N, -1));
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(length * i / N, half(i / N, 1));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();

  // A leaf folds a little along its midrib, so one half catches less light.
  ctx.fillStyle = SHADE;
  ctx.globalAlpha = 0.3 + 0.7 * rnd();
  if (rnd() < 0.5) ctx.fillRect(0, 0, length, width);
  else ctx.fillRect(0, -width, length, width);

  // Soft light and dark patches, so that no two leaves have the same tone.
  for (let i = 0; i < 3; i++) {
    const px = length * (0.15 + 0.7 * rnd()), py = width * 0.5 * (rnd() - 0.5);
    const pr = length * (0.18 + 0.22 * rnd());
    const tone = rnd() < 0.5 ? '255, 255, 235' : '40, 60, 30';
    const patch = ctx.createRadialGradient(px, py, 0, px, py, pr);
    patch.addColorStop(0, `rgba(${tone}, 0.16)`);
    patch.addColorStop(1, `rgba(${tone}, 0)`);
    ctx.fillStyle = patch;
    ctx.globalAlpha = 0.4 + 0.6 * rnd();
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }

  // Side veins leave the midrib at an angle and sweep toward the tip. How
  // strongly they show differs from leaf to leaf and from vein to vein, and
  // each one fades toward the edge.
  const strength = 0.25 + 0.75 * rnd();
  ctx.lineWidth = Math.max(0.75, length * 0.012);
  ctx.lineCap = 'round';
  for (let j = 0; j < veins; j++) {
    const te = (j + 0.5) / veins;
    const ts = Math.max(0.02, te - 0.17);
    for (const side of [-1, 1]) {
      const ye = side * half(te, side) * 0.92;
      const fade = ctx.createLinearGradient(length * ts, 0, length * te, ye);
      fade.addColorStop(0, VEIN);
      fade.addColorStop(1, VEIN_END);
      ctx.strokeStyle = fade;
      ctx.globalAlpha = strength * (0.35 + 0.65 * rnd());
      ctx.beginPath();
      ctx.moveTo(length * ts, 0);
      ctx.quadraticCurveTo(length * (ts + (te - ts) * 0.4), ye * 0.6, length * te, ye);
      ctx.stroke();
    }
  }

  // The midrib tapers to nothing just short of the tip.
  const w0 = Math.max(1.2, length * 0.035);
  ctx.globalAlpha = 0.5 + 0.5 * strength;
  ctx.fillStyle = MIDRIB;
  ctx.beginPath();
  ctx.moveTo(0, -w0 / 2);
  ctx.lineTo(length * 0.95, 0);
  ctx.lineTo(0, w0 / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Broad leaves along a twig that runs from the bottom of the cell upward. */
function drawBroadleaf(ctx, S, rnd, { leaves, length, roundness, twigs, droop, shape }) {
  const k = S / 256;
  for (let t = 0; t < twigs; t++) {
    const lean = twigs === 1 ? 0 : (t / (twigs - 1) - 0.5) * 1.1;
    const x0 = S * 0.5, y0 = S * 0.95;
    const x1 = S * (0.5 + 0.3 * lean), y1 = S * (0.3 + 0.2 * Math.abs(lean));
    line(ctx, x0, y0, x1, y1, 3.2 * k, '#6b5847');
    const n = Math.round(leaves / twigs);
    for (let i = 0; i < n; i++) {
      const f = 0.12 + 0.88 * ((i + rnd() * 0.9) / n);
      const side = rnd() < 0.5 ? 1 : -1;
      const len = S * length * (0.7 + 0.6 * rnd());
      const a = -Math.PI / 2 + lean * 0.5 + side * (0.25 + 1.3 * rnd()) + droop * side * f;
      leaf(ctx, rnd, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, a, len, len * roundness,
        light(rnd, 88, 28, 54, 96), shape);
    }
    // A few leaves fanning out of the tip.
    for (let i = 0; i < 3; i++) {
      const len = S * length * (0.8 + 0.4 * rnd());
      leaf(ctx, rnd, x1, y1, -Math.PI / 2 + lean * 0.6 + (i - 1) * 0.7, len, len * roundness,
        light(rnd, 88, 26, 70, 96), shape);
    }
  }
}

/** A flat spray of spruce: a twig with side twigs, all lined with short needles. */
function drawSpruce(ctx, S, rnd) {
  const k = S / 256;
  const needles = (x0, y0, x1, y1, size) => {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.ceil(Math.hypot(dx, dy) / (2.4 * k));
    const along = Math.atan2(dy, dx);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      for (const side of [-1, 1]) {
        const a = along + side * (0.7 + 0.35 * rnd());
        const len = size * (0.7 + 0.5 * rnd());
        const x = x0 + dx * f, y = y0 + dy * f;
        line(ctx, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 2.2 * k, light(rnd, 100, 22, 44, 96));
      }
    }
    line(ctx, x0, y0, x1, y1, 2.4 * k, '#6a5a48');
  };
  const cx = S * 0.5;
  for (let j = 0; j < 9; j++) {
    const y = S * (0.9 - j * 0.085);
    const len = S * 0.4 * (1 - j / 11);
    for (const side of [-1, 1]) {
      const a = (0.52 + 0.12 * rnd()) * side;
      needles(cx, y, cx + Math.sin(a) * len, y - Math.cos(a) * len * 0.75, S * 0.05);
    }
  }
  needles(cx, S * 0.95, cx, S * 0.1, S * 0.055);
}

/** A tuft of long pine needles on the end of a twig. */
function drawPine(ctx, S, rnd) {
  const k = S / 256;
  const cx = S * 0.5, cy = S * 0.6;
  line(ctx, cx, S * 0.96, cx, cy, 5 * k, '#6b5645');
  for (let i = 0; i < 110; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 3.7;
    const len = S * (0.3 + 0.15 * rnd());
    const bend = (rnd() - 0.5) * 0.35;
    ctx.strokeStyle = light(rnd, 96, 24, 46, 96);
    ctx.lineWidth = 2.1 * k;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(a + bend) * len * 0.5, cy + Math.sin(a + bend) * len * 0.5,
      cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();
  }
}

/** Leaves in all directions, filling the cell: the inside of a bush. */
function drawBush(ctx, S, rnd) {
  const k = S / 256;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
    line(ctx, S * 0.5, S * 0.95, S * 0.5 + Math.cos(a) * S * 0.4, S * 0.95 + Math.sin(a) * S * 0.75, 2.4 * k, '#655443');
  }
  for (let i = 0; i < 64; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * S * 0.36;
    const len = S * (0.13 + 0.09 * rnd());
    leaf(ctx, rnd, S * 0.5 + Math.cos(a) * r, S * 0.5 + Math.sin(a) * r * 1.05, rnd() * Math.PI * 2, len, len * 0.34,
      light(rnd, 86, 26, 58, 94));
  }
}

/** Bare twigs, for dead trees. */
function drawTwigs(ctx, S, rnd) {
  const k = S / 256;
  const grow = (x, y, a, len, width, depth) => {
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    line(ctx, x, y, x1, y1, width, light(rnd, 40, 8, 62, 88));
    if (depth === 0) return;
    const n = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      grow(x + (x1 - x) * (0.45 + 0.55 * (i / (n - 1))), y + (y1 - y) * (0.45 + 0.55 * (i / (n - 1))),
        a + (rnd() - 0.5) * 1.5, len * (0.55 + 0.2 * rnd()), Math.max(1.6 * k, width * 0.62), depth - 1);
    }
  };
  ctx.lineCap = 'round';
  grow(S * 0.5, S * 0.96, -Math.PI / 2, S * 0.3, 5.5 * k, 4);
}

/**
 * Paint the atlas and return it as a mipmapped texture.
 * @param {number} cellSize pixels per cell (the atlas is 4 x 2 cells)
 */
export function createLeafAtlas(cellSize = 256, seed = 7) {
  const S = cellSize;
  const W = S * COLS, H = S * ROWS;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rnd = rng(seed);
  const painters = {
    [LEAF_CELLS.solid]: () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S); },
    [LEAF_CELLS.oak]: () => drawBroadleaf(ctx, S, rnd, { leaves: 20, length: 0.27, roundness: 0.52, twigs: 1, droop: 0, shape: SHAPES.oak }),
    [LEAF_CELLS.birch]: () => drawBroadleaf(ctx, S, rnd, { leaves: 42, length: 0.13, roundness: 0.6, twigs: 3, droop: 0.5, shape: SHAPES.birch }),
    [LEAF_CELLS.spruce]: () => drawSpruce(ctx, S, rnd),
    [LEAF_CELLS.pine]: () => drawPine(ctx, S, rnd),
    [LEAF_CELLS.bush]: () => drawBush(ctx, S, rnd),
    [LEAF_CELLS.twig]: () => drawTwigs(ctx, S, rnd),
  };
  for (const [cell, paint] of Object.entries(painters)) {
    const col = cell % COLS, row = Math.floor(cell / COLS);
    ctx.save();
    ctx.translate(col * S, row * S);
    ctx.beginPath();
    // Keep a clear margin so that neighbouring cells do not bleed into each
    // other in the small mip levels.
    if (Number(cell) === LEAF_CELLS.solid) ctx.rect(0, 0, S, S);
    else ctx.rect(S * 0.03, S * 0.03, S * 0.94, S * 0.94);
    ctx.clip();
    paint();
    ctx.restore();
  }

  // Transparent pixels come out of the canvas black, which would darken the
  // edges of every leaf once the texture is filtered. Give them the average
  // colour of their cell instead.
  const image = ctx.getImageData(0, 0, W, H);
  const d = image.data;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = row * S; y < (row + 1) * S; y++) {
        for (let x = col * S; x < (col + 1) * S; x++) {
          const i = (y * W + x) * 4;
          if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        }
      }
      if (!n) continue;
      r /= n; g /= n; b /= n;
      for (let y = row * S; y < (row + 1) * S; y++) {
        for (let x = col * S; x < (col + 1) * S; x++) {
          const i = (y * W + x) * 4;
          if (d[i + 3] === 0) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
        }
      }
    }
  }

  const texture = new DataTexture(new Uint8Array(d.buffer), W, H, RGBAFormat, UnsignedByteType);
  texture.name = 'VegetationEngine.leaves';
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
