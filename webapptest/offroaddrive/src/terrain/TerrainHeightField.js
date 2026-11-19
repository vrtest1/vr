import { noised, noiseH } from '../core/noise.js';

const MAX_OCTAVES = 16;
const tmpC = new Float64Array(3);
const tmpW1 = new Float64Array(3);
const tmpW2 = new Float64Array(3);
const tmpN = new Float64Array(3);
const tmpH = new Float64Array(6);
const tmpS = new Float64Array(3);

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * CPU mirror of HEIGHT_GLSL / BIOME_GLSL in shaders/terrain.glsl.js.
 *
 * It has no dependency on three or on a WebGL context, so it also runs in a
 * worker or in Node (physics, AI, object placement, tests).
 */
export class TerrainHeightField {
  seed = 1337;
  featureScale = 3200;
  heightScale = 1300;
  baseHeight = 80;
  octaves = 11;
  lacunarity = 2.0;
  gain = 0.5;
  erosion = 0.5;
  ridge = 0.8;
  ridgeDetail = 0.7;
  warp = 0.5;
  continent = 0.7;

  // Biome inputs (TerrainEngine copies these from its params and the environment).
  waterLevel = 0;
  temperature = 18;
  humidity = 55;
  lapseRate = 6.5;
  rockSlope = 1 - Math.cos((36 * Math.PI) / 180);
  snowTemperature = 0;
  beachHeight = 3;
  snowfall = 0;

  constructor(params) {
    if (params) Object.assign(this, params);
  }

  /**
   * Height and its gradient.
   * @param {number} x world X
   * @param {number} z world Z
   * @param {Float64Array|number[]} out receives [height, dHeight/dx, dHeight/dz]
   * @param {number} [oct] octave count, may be fractional; defaults to `octaves`
   */
  sample(x, z, out, oct = this.octaves) {
    const seed = this.seed | 0;
    const px = x / this.featureScale;
    const pz = z / this.featureScale;

    const c = noised(px * 0.23, pz * 0.23, seed + 101, tmpC);
    const cont = c[0];
    const dContX = c[1] * 0.23;
    const dContZ = c[2] * 0.23;
    const t = Math.min(1, Math.max(0, (cont + 0.25) / 0.65));
    const mask = t * t * (3 - 2 * t);
    const dMaskK = (6 * t * (1 - t)) / 0.65;
    const mAmp = 0.15 + 0.85 * mask;
    const dMAmpX = 0.85 * dMaskK * dContX;
    const dMAmpZ = 0.85 * dMaskK * dContZ;

    const w1 = noised(px * 0.5, pz * 0.5, seed + 202, tmpW1);
    const w2 = noised(px * 0.5 + 5.2, pz * 0.5 + 1.3, seed + 303, tmpW2);
    const wk = this.warp * 0.5;

    // slope / hSlope: gradient and Hessian (xx, xy, yy) of the smooth sum.
    let a = 0;
    let b = 1;
    let dAx = 0, dAy = 0;
    let slX = 0, slY = 0;
    let hXX = 0, hXY = 0, hYY = 0;
    let sx = px + this.warp * w1[0];
    let sy = pz + this.warp * w2[0];
    let m0 = 1, m1 = 0, m2 = 0, m3 = 1;
    const lac = this.lacunarity;
    let ridgeK = this.ridge;
    const ero = this.erosion;
    const count = Math.min(MAX_OCTAVES, Math.ceil(oct));
    for (let i = 0; i < count; i++) {
      const wgt = Math.min(oct - i, 1);
      const nh = noiseH(sx, sy, seed + i * 1013, tmpH);
      const n = nh[0], gx = nh[1], gy = nh[2];

      const an = Math.sqrt(n * n + 0.0016);
      const r1 = 1 - 1.41 * an;
      const ridge = r1 * r1 - 0.45;
      const dr = (-2.82 * r1 * n) / an;
      const o = n + (ridge - n) * ridgeK;
      const gk = 1 + (dr - 1) * ridgeK;
      const dOsX = gx * gk;
      const dOsY = gy * gk;

      // dO: gradient of this octave. dN / hN: gradient and Hessian of the
      // smooth noise, which drives the erosion term.
      const dOx = dOsX * m0 + dOsY * m2;
      const dOy = dOsX * m1 + dOsY * m3;
      const dNx = gx * m0 + gy * m2;
      const dNy = gx * m1 + gy * m3;
      ridgeK *= this.ridgeDetail;
      const hNXX = nh[3] * m0 * m0 + nh[4] * 2 * m0 * m2 + nh[5] * m2 * m2;
      const hNXY = nh[3] * m0 * m1 + nh[4] * (m0 * m3 + m1 * m2) + nh[5] * m2 * m3;
      const hNYY = nh[3] * m1 * m1 + nh[4] * 2 * m1 * m3 + nh[5] * m3 * m3;

      const damp = 1 / (1 + ero * (slX * slX + slY * slY));
      const dk = -2 * ero * damp * damp;
      const dDampX = dk * (hXX * slX + hXY * slY);
      const dDampY = dk * (hXY * slX + hYY * slY);
      a += wgt * b * o * damp;
      dAx += wgt * b * (damp * dOx + o * dDampX);
      dAy += wgt * b * (damp * dOy + o * dDampY);
      slX += wgt * b * dNx;
      slY += wgt * b * dNy;
      hXX += wgt * b * hNXX;
      hXY += wgt * b * hNXY;
      hYY += wgt * b * hNYY;

      b *= this.gain;
      const nsx = lac * (0.8 * sx - 0.6 * sy) + 1.7;
      const nsy = lac * (0.6 * sx + 0.8 * sy) + 9.2;
      sx = nsx;
      sy = nsy;
      const n0 = lac * (0.8 * m0 - 0.6 * m2);
      const n1 = lac * (0.8 * m1 - 0.6 * m3);
      const n2 = lac * (0.6 * m0 + 0.8 * m2);
      const n3 = lac * (0.6 * m1 + 0.8 * m3);
      m0 = n0; m1 = n1; m2 = n2; m3 = n3;
    }

    const dApX = dAx * (1 + wk * w1[1]) + dAy * (wk * w2[1]);
    const dApZ = dAx * (wk * w1[2]) + dAy * (1 + wk * w2[2]);

    const h = this.continent * cont + mAmp * a;
    const k = this.heightScale / this.featureScale;
    out[0] = this.baseHeight + this.heightScale * h;
    out[1] = (this.continent * dContX + dMAmpX * a + mAmp * dApX) * k;
    out[2] = (this.continent * dContZ + dMAmpZ * a + mAmp * dApZ) * k;
    return out;
  }

  heightAt(x, z, oct) {
    return this.sample(x, z, tmpS, oct)[0];
  }

  /** Conservative [min, max] of the height function for the current parameters. */
  heightBounds() {
    const g = this.gain;
    const n = Math.min(MAX_OCTAVES, Math.ceil(this.octaves));
    const sum = Math.abs(g - 1) < 1e-6 ? n : (1 - Math.pow(g, n)) / (1 - g);
    // |noise| <= 0.71, ridge term is within [-0.45, 0.55].
    const amp = this.heightScale * (0.71 * this.continent + 0.71 * sum);
    return [this.baseHeight - amp, this.baseHeight + amp];
  }

  /**
   * Biome weights at a point (no small-scale jitter, so borders are the smooth
   * centre line of what the shader draws).
   * @returns {{sand:number, vegetation:number, rock:number, snow:number,
   *            moisture:number, temperature:number, height:number, slope:number}}
   */
  biomeAt(x, z, out = {}) {
    const s = this.sample(x, z, tmpS);
    const height = s[0];
    const ny = 1 / Math.sqrt(s[1] * s[1] + 1 + s[2] * s[2]);
    const seed = this.seed | 0;
    const cx = x / this.featureScale;
    const cz = z / this.featureScale;

    const moisture = Math.min(
      1,
      Math.max(0, 0.5 + 0.8 * noised(cx * 0.6, cz * 0.6, seed + 404, tmpN)[0] + (this.humidity - 50) * 0.008),
    );
    const temperature =
      this.temperature -
      this.lapseRate * 0.001 * (height - this.waterLevel) +
      4 * noised(cx * 0.43, cz * 0.43, seed + 505, tmpN)[0];

    const slope = 1 - ny;
    const rock = smoothstep(this.rockSlope - 0.07, this.rockSlope + 0.07, slope);
    const cold = 1 - smoothstep(-2, 2, temperature - this.snowTemperature);
    const holds = 1 - smoothstep(this.rockSlope + 0.05, this.rockSlope + 0.3, slope);
    const snow = Math.min(1, Math.max(0, cold + this.snowfall)) * holds;
    const beach =
      1 - smoothstep(this.waterLevel + 0.4 * this.beachHeight, this.waterLevel + this.beachHeight, height);

    out.snow = snow;
    out.rock = rock * (1 - snow);
    out.sand = beach * (1 - rock) * (1 - snow);
    out.vegetation = Math.max(0, 1 - out.snow - out.rock - out.sand);
    out.moisture = moisture;
    out.temperature = temperature;
    out.height = height;
    out.slope = slope;
    return out;
  }
}
