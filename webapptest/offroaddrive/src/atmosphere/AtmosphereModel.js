import { hash2 } from '../core/noise.js';

const RG = 6360;
const RT = 6460;
const RAYLEIGH = [5.802e-3, 13.558e-3, 33.1e-3];
const MIE_SCATTER = 3.996e-3;
const MIE_ABSORB = 4.4e-3;
const OZONE = [0.65e-3, 1.881e-3, 0.085e-3];
/** Stand-in for multiple scattering in the CPU estimate (the GPU sky uses a real LUT). */
const MULTI_SCATTER_GAIN = 1.25;

/**
 * CPU copy of the atmosphere medium, single scattering only. It exists so the
 * engine can colour its lights and clouds without reading textures back from
 * the GPU. No three.js or WebGL dependency. Distances are kilometres.
 */
export class AtmosphereModel {
  rayleighScale = 1;
  mieScale = 1;
  ozoneScale = 1;
  mieG = 0.8;

  #ext = [0, 0, 0];
  #sca = [0, 0, 0, 0]; // rayleigh rgb, mie

  #medium(alt) {
    const a = Math.max(alt, 0);
    const dR = Math.exp(-a / 8) * this.rayleighScale;
    const dM = Math.exp(-a / 1.2) * this.mieScale;
    const oz = Math.max(0, 1 - Math.abs(a - 25) / 15) * this.ozoneScale;
    const s = this.#sca;
    const e = this.#ext;
    for (let c = 0; c < 3; c++) {
      s[c] = RAYLEIGH[c] * dR;
      e[c] = s[c] + (MIE_SCATTER + MIE_ABSORB) * dM + OZONE[c] * oz;
    }
    s[3] = MIE_SCATTER * dM;
  }

  /**
   * Transmittance from a point at `altitude` km toward a direction with the
   * given cosine of the zenith angle, out to the top of the atmosphere.
   * Returns [0,0,0] when the planet is in the way.
   */
  transmittance(altitude, cosZenith, out = [0, 0, 0], steps = 24) {
    const r = RG + Math.max(altitude, 0.001);
    const b = r * cosZenith;
    const discG = b * b - (r * r - RG * RG);
    if (cosZenith < 0 && discG >= 0) {
      out[0] = out[1] = out[2] = 0;
      return out;
    }
    const tMax = -b + Math.sqrt(Math.max(b * b - (r * r - RT * RT), 0));
    let o0 = 0, o1 = 0, o2 = 0, t = 0;
    for (let i = 0; i < steps; i++) {
      const nt = ((i + 0.3) / steps) * tMax;
      const dt = nt - t;
      t = nt;
      const h = Math.sqrt(r * r + t * t + 2 * r * t * cosZenith) - RG;
      this.#medium(h);
      o0 += this.#ext[0] * dt;
      o1 += this.#ext[1] * dt;
      o2 += this.#ext[2] * dt;
    }
    out[0] = Math.exp(-o0);
    out[1] = Math.exp(-o1);
    out[2] = Math.exp(-o2);
    return out;
  }

  /**
   * Sky radiance per unit sun irradiance for a direction given by its zenith
   * cosine and its azimuth from the sun (radians).
   */
  skyRadiance(altitude, sunCos, viewCos, azimuth, out = [0, 0, 0], steps = 10) {
    const r = RG + Math.max(altitude, 0.001);
    const sunSin = Math.sqrt(Math.max(0, 1 - sunCos * sunCos));
    const viewSin = Math.sqrt(Math.max(0, 1 - viewCos * viewCos));
    // View direction in a frame where the sun is in the y/z plane.
    const dx = viewSin * Math.sin(azimuth), dy = viewCos, dz = viewSin * Math.cos(azimuth);
    const mu = dy * sunCos + dz * sunSin; // cos of the angle between view and sun
    const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
    const g = this.mieG;
    const phaseM =
      ((3 / (8 * Math.PI)) * (1 - g * g) * (1 + mu * mu)) /
      ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5));

    const b = r * viewCos;
    const discG = b * b - (r * r - RG * RG);
    let tMax = -b + Math.sqrt(Math.max(b * b - (r * r - RT * RT), 0));
    if (viewCos < 0 && discG >= 0) tMax = -b - Math.sqrt(discG);

    const sunT = [0, 0, 0];
    let t = 0, T0 = 1, T1 = 1, T2 = 1;
    out[0] = out[1] = out[2] = 0;
    for (let i = 0; i < steps; i++) {
      const nt = ((i + 0.3) / steps) * tMax;
      const dt = nt - t;
      t = nt;
      const px = dx * t, py = r + dy * t, pz = dz * t;
      const pr = Math.sqrt(px * px + py * py + pz * pz);
      const localSunCos = (py * sunCos + pz * sunSin) / pr;
      this.transmittance(pr - RG, localSunCos, sunT, 8);
      this.#medium(pr - RG);
      const s = this.#sca, e = this.#ext;
      const st0 = Math.exp(-e[0] * dt), st1 = Math.exp(-e[1] * dt), st2 = Math.exp(-e[2] * dt);
      out[0] += (T0 * (s[0] * phaseR + s[3] * phaseM) * sunT[0] * (1 - st0)) / e[0];
      out[1] += (T1 * (s[1] * phaseR + s[3] * phaseM) * sunT[1] * (1 - st1)) / e[1];
      out[2] += (T2 * (s[2] * phaseR + s[3] * phaseM) * sunT[2] * (1 - st2)) / e[2];
      T0 *= st0; T1 *= st1; T2 *= st2;
    }
    out[0] *= MULTI_SCATTER_GAIN;
    out[1] *= MULTI_SCATTER_GAIN;
    out[2] *= MULTI_SCATTER_GAIN;
    return out;
  }

  /**
   * Cosine-weighted mean sky radiance over the upper hemisphere, per unit sun
   * irradiance. Multiply by PI for the irradiance on a horizontal surface.
   */
  meanSkyRadiance(altitude, sunCos, out = [0, 0, 0]) {
    const zen = [0.966, 0.707, 0.259]; // 15, 45, 75 degrees
    const tmp = [0, 0, 0];
    let wSum = 0;
    out[0] = out[1] = out[2] = 0;
    for (const c of zen) {
      const w = c * Math.sqrt(1 - c * c);
      for (let k = 0; k < 4; k++) {
        this.skyRadiance(altitude, sunCos, c, (k * Math.PI) / 2 + 0.4, tmp);
        out[0] += tmp[0] * w;
        out[1] += tmp[1] * w;
        out[2] += tmp[2] * w;
        wSum += w;
      }
    }
    out[0] /= wSum;
    out[1] /= wSum;
    out[2] /= wSum;
    return out;
  }
}

/**
 * Tileable RGBA noise for the cloud layer, generated on the CPU once.
 *   R  billowy fBm (cloud shapes)      G  smooth fBm (large-scale variation)
 *   B  inverted cellular noise (edge erosion)
 * @returns {Uint8Array} size * size * 4 bytes
 */
export function generateCloudNoise(size = 256, seed = 9001) {
  const data = new Uint8Array(size * size * 4);
  const TAU24 = 6.283185307179586 / 16777216;

  const perlin = (x, y, period, s) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const dot = (ix, iy, ox, oy) => {
      const a = (hash2(((ix % period) + period) % period, ((iy % period) + period) % period, s) >>> 8) * TAU24;
      return Math.cos(a) * ox + Math.sin(a) * oy;
    };
    const a = dot(x0, y0, fx, fy), b = dot(x0 + 1, y0, fx - 1, fy);
    const c = dot(x0, y0 + 1, fx, fy - 1), d = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
    return a + ux * (b - a) + uy * (c - a) + ux * uy * (a - b - c + d);
  };

  const fbm = (u, v, period, octaves, s, billow) => {
    let sum = 0, amp = 0.5, norm = 0, p = period;
    for (let o = 0; o < octaves; o++) {
      let n = perlin(u * p, v * p, p, s + o * 17) * 1.41;
      if (billow) n = 1 - 2 * Math.abs(n);
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      p *= 2;
    }
    return sum / norm;
  };

  const cellular = (u, v, period, s) => {
    const x = u * period, y = v * period;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let best = 9;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = x0 + i, cy = y0 + j;
        const h = hash2(((cx % period) + period) % period, ((cy % period) + period) % period, s);
        const px = cx + (h & 0xffff) / 65536, py = cy + (h >>> 16) / 65536;
        best = Math.min(best, (px - x) * (px - x) + (py - y) * (py - y));
      }
    }
    return Math.sqrt(best);
  };

  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  let k = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size, v = j / size;
      data[k++] = byte(0.5 + 0.55 * fbm(u, v, 4, 6, seed, true) + 0.25 * fbm(u, v, 2, 3, seed + 400, false));
      data[k++] = byte(0.5 + 0.6 * fbm(u, v, 3, 5, seed + 100, false));
      data[k++] = byte(0.6 * (1 - cellular(u, v, 12, seed + 200)) + 0.4 * (1 - cellular(u, v, 29, seed + 300)));
      data[k++] = 255;
    }
  }
  // Stretch each channel to the full byte range so thresholds behave the same for any seed.
  for (let ch = 0; ch < 3; ch++) {
    let min = 255, max = 0;
    for (let i = ch; i < data.length; i += 4) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    const scale = 255 / Math.max(1, max - min);
    for (let i = ch; i < data.length; i += 4) data[i] = Math.round((data[i] - min) * scale);
  }
  return data;
}
