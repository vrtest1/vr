/**
 * CPU mirror of src/core/shaders/noise.glsl.js. Same integer hash, same
 * interpolation, so values agree with the GPU to float precision.
 */

export function hash2(cx, cy, seed) {
  let h = (Math.imul(cx, 0x8da6b343) ^ Math.imul(cy, 0xd8163841) ^ Math.imul(seed, 0xcb1ab31f)) >>> 0;
  h = (Math.imul(h, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((h >>> ((h >>> 28) + 4)) ^ h) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

const TAU_OVER_2_24 = 6.283185307179586 / 16777216;

/**
 * Gradient noise with analytic derivatives.
 * Writes (value, d/dx, d/dy) into `out` and returns it.
 */
export function noised(x, y, seed, out) {
  const fx0 = Math.floor(x);
  const fy0 = Math.floor(y);
  const ix = fx0 | 0;
  const iy = fy0 | 0;
  const fx = x - fx0;
  const fy = y - fy0;

  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
  const duy = 30 * fy * fy * (fy * (fy - 2) + 1);

  let a = (hash2(ix, iy, seed) >>> 8) * TAU_OVER_2_24;
  const gax = Math.cos(a), gay = Math.sin(a);
  a = (hash2(ix + 1, iy, seed) >>> 8) * TAU_OVER_2_24;
  const gbx = Math.cos(a), gby = Math.sin(a);
  a = (hash2(ix, iy + 1, seed) >>> 8) * TAU_OVER_2_24;
  const gcx = Math.cos(a), gcy = Math.sin(a);
  a = (hash2(ix + 1, iy + 1, seed) >>> 8) * TAU_OVER_2_24;
  const gdx = Math.cos(a), gdy = Math.sin(a);

  const va = gax * fx + gay * fy;
  const vb = gbx * (fx - 1) + gby * fy;
  const vc = gcx * fx + gcy * (fy - 1);
  const vd = gdx * (fx - 1) + gdy * (fy - 1);
  const k = va - vb - vc + vd;

  out[0] = va + ux * (vb - va) + uy * (vc - va) + ux * uy * k;
  out[1] = gax + ux * (gbx - gax) + uy * (gcx - gax) + ux * uy * (gax - gbx - gcx + gdx) + dux * (uy * k + vb - va);
  out[2] = gay + ux * (gby - gay) + uy * (gcy - gay) + ux * uy * (gay - gby - gcy + gdy) + duy * (ux * k + vc - va);
  return out;
}

/**
 * Same noise, also with the Hessian.
 * Writes (value, d/dx, d/dy, dxx, dxy, dyy) into `out` and returns it.
 */
export function noiseH(x, y, seed, out) {
  const fx0 = Math.floor(x);
  const fy0 = Math.floor(y);
  const ix = fx0 | 0;
  const iy = fy0 | 0;
  const fx = x - fx0;
  const fy = y - fy0;

  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
  const duy = 30 * fy * fy * (fy * (fy - 2) + 1);
  const ddux = 60 * fx * (fx - 1) * (2 * fx - 1);
  const dduy = 60 * fy * (fy - 1) * (2 * fy - 1);

  let a = (hash2(ix, iy, seed) >>> 8) * TAU_OVER_2_24;
  const gax = Math.cos(a), gay = Math.sin(a);
  a = (hash2(ix + 1, iy, seed) >>> 8) * TAU_OVER_2_24;
  const gbx = Math.cos(a), gby = Math.sin(a);
  a = (hash2(ix, iy + 1, seed) >>> 8) * TAU_OVER_2_24;
  const gcx = Math.cos(a), gcy = Math.sin(a);
  a = (hash2(ix + 1, iy + 1, seed) >>> 8) * TAU_OVER_2_24;
  const gdx = Math.cos(a), gdy = Math.sin(a);

  const va = gax * fx + gay * fy;
  const vb = gbx * (fx - 1) + gby * fy;
  const vc = gcx * fx + gcy * (fy - 1);
  const vd = gdx * (fx - 1) + gdy * (fy - 1);
  const k = va - vb - vc + vd;
  const Ax = gbx - gax, Ay = gby - gay;
  const Bx = gcx - gax, By = gcy - gay;
  const Cx = gax - gbx - gcx + gdx, Cy = gay - gby - gcy + gdy;

  out[0] = va + ux * (vb - va) + uy * (vc - va) + ux * uy * k;
  out[1] = gax + ux * Ax + uy * Bx + ux * uy * Cx + dux * (uy * k + vb - va);
  out[2] = gay + ux * Ay + uy * By + ux * uy * Cy + duy * (ux * k + vc - va);
  out[3] = 2 * dux * (Ax + uy * Cx) + ddux * (uy * k + vb - va);
  out[4] = duy * Bx + ux * duy * Cx + dux * (duy * k + uy * Cy + Ay);
  out[5] = 2 * duy * (By + ux * Cy) + dduy * (ux * k + vc - va);
  return out;
}
