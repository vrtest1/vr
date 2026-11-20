// Worlds: the terrain comes from a seed. The usual world is seed 1337 with the
// usual start by the lake; any other seed is a whole new land, and we have to
// find somewhere to put the truck down: dry, level ground out in the open
// (not in a forest: trees are only made near the camera, so we ask the
// vegetation how likely a tree is there), near water if we can (a shore is a
// nicer place to start than the middle of a plain).

export const HOME_SEED = 1337;
export const HOME_START = { x: -5400, z: 7960, heading: 2.2 };

/** The vegetation's own seed for a world (1 for the usual one, as before). */
export const vegetationSeed = (seed) => (seed === HOME_SEED ? 1 : (seed % 9998) + 2);

function rng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * Somewhere to start in this world. Deterministic for a seed (the same world
 * gives the same start on every machine).
 * @param {object} ground  { height(x, z), normal(x, z, out), water(x, z) }
 * @param {number} seed
 * @param {object} Vector3 three's Vector3 class (for normals)
 * @param {function} [treeChance] (x, z) => 0..1, how likely a tree grows there
 */
export function findStart(ground, seed, Vector3, treeChance = null) {
  if (seed === HOME_SEED) return { ...HOME_START };
  const random = rng(seed);
  const n = new Vector3();
  const level = (x, z) => {
    const h = ground.height(x, z);
    if (h < ground.water(x, z) + 2.5 || h > 380) return null;
    if (ground.normal(x, z, n).y < 0.96) return null;
    // Level all round the truck, not just under its middle.
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
      if (Math.abs(ground.height(x + dx, z + dz) - h) > 1.2) return null;
    }
    return h;
  };
  // Open ground: no forest within a truck's length or two.
  const open = (x, z) => !treeChance || [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]].every(([dx, dz]) => treeChance(x + dx, z + dz) < 0.02);
  // Which way the nearest water lies, if any within `reach`.
  const waterward = (x, z, reach) => {
    for (const r of [80, 160, reach]) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const wx = x + Math.sin(a) * r, wz = z - Math.cos(a) * r;
        if (ground.height(wx, wz) < ground.water(wx, wz) - 0.5) return Math.atan2(-(wx - x), -(wz - z));
      }
    }
    return null;
  };
  const phase = random() * Math.PI * 2;
  // Best first: open and by the water; then open anywhere; then anywhere level.
  for (const [wantWater, wantOpen] of [[true, true], [false, true], [false, false]]) {
    // A spiral out from the middle of the world.
    for (let r = 0; r < 9000; r += 120) {
      const steps = Math.max(1, Math.round((2 * Math.PI * r) / 240));
      for (let i = 0; i < steps; i++) {
        const a = phase + (i / steps) * Math.PI * 2;
        const x = Math.round(Math.sin(a) * r), z = Math.round(-Math.cos(a) * r);
        if (level(x, z) === null) continue;
        if (wantOpen && !open(x, z)) continue;
        const toWater = waterward(x, z, 300);
        if (wantWater && toWater === null) continue;
        return { x, z, heading: toWater ?? random() * Math.PI * 2 };
      }
    }
  }
  return { ...HOME_START }; // nowhere level at all: should not happen
}
