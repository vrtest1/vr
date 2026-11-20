// The world as the vehicle sees it (see vehicle.js for the interface).
// Works in the browser with the engines and in Node with just the height field.

const SURFACE = { dirt: 0, rock: 1, sand: 2, snow: 3 };

/**
 * @param {object} o
 * @param {object} o.heightField   TerrainHeightField (terrain.heightField in the browser)
 * @param {function} [o.water]     (x, z) => water surface height; default: a flat sea at 0
 * @param {function} [o.trees]     (x, z, range, visit) => void
 * @param {function} [o.wetness]   () => 0..1, rain makes everything slippery
 */
export function makeGround({ heightField, water, trees, wetness }) {
  const s = new Float64Array(3);
  let lx = NaN, lz = NaN, lseed = NaN;
  const sample = (x, z) => {
    // The seed is part of the key: a new world must not hand back the old ground.
    if (x !== lx || z !== lz || heightField.seed !== lseed) {
      heightField.sample(x, z, s);
      lx = x; lz = z; lseed = heightField.seed;
    }
    return s;
  };
  const biome = {};
  const grip = { mu: 0.9, surface: 0 };
  return {
    height: (x, z) => sample(x, z)[0],
    normal(x, z, out) {
      const g = sample(x, z);
      return out.set(-g[1], 1, -g[2]).normalize();
    },
    grip(x, z) {
      heightField.biomeAt(x, z, biome);
      const wet = wetness ? wetness() : 0;
      // Weighted by how much of each cover there is.
      const mu = biome.rock * 0.95 + biome.sand * 0.62 + biome.snow * 0.38 + biome.vegetation * 0.82;
      let surface = SURFACE.dirt, most = biome.vegetation;
      if (biome.rock > most) { most = biome.rock; surface = SURFACE.rock; }
      if (biome.sand > most) { most = biome.sand; surface = SURFACE.sand; }
      if (biome.snow > most) { surface = SURFACE.snow; }
      grip.mu = Math.max(0.25, mu * (1 - 0.3 * wet));
      grip.surface = surface;
      return grip;
    },
    water: water ?? (() => 0),
    trees: trees ?? (() => {}),
  };
}
