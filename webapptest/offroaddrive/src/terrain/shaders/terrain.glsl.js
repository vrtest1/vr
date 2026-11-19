/**
 * TerrainEngine GLSL. These chunks are spliced into three's
 * MeshStandardMaterial / MeshDepthMaterial by TerrainEngine.js.
 *
 * HEIGHT_GLSL and BIOME_GLSL are mirrored on the CPU in TerrainHeightField.js.
 * Change both sides together.
 */

// ---------------------------------------------------------------------------
// Height function: (height, dHeight/dx, dHeight/dz) in world metres.
// ---------------------------------------------------------------------------
export const HEIGHT_GLSL = /* glsl */ `
#define PWE_MAX_OCTAVES 16

uniform int uTSeed;
uniform float uTFeatureScale;
uniform float uTHeightScale;
uniform float uTBaseHeight;
uniform float uTLacunarity;
uniform float uTGain;
uniform float uTErosion;
uniform float uTRidge;
uniform float uTRidgeDetail;
uniform float uTWarp;
uniform float uTContinent;

// oct may be fractional: the last octave is faded in by its fraction.
vec3 terrainHeight(vec2 xz, float oct) {
  uint seed = uint(uTSeed);
  vec2 p = xz / uTFeatureScale;

  // Continents: very low frequency, decides sea vs land and where mountains go.
  vec3 c = pwNoised(p * 0.23, seed + 101u);
  float cont = c.x;
  vec2 dCont = c.yz * 0.23;
  float t = clamp((cont + 0.25) / 0.65, 0.0, 1.0);
  float mask = t * t * (3.0 - 2.0 * t);
  vec2 dMask = (6.0 * t * (1.0 - t) / 0.65) * dCont;
  float mAmp = 0.15 + 0.85 * mask;
  vec2 dMAmp = 0.85 * dMask;

  // Domain warp, with its Jacobian so the derivatives stay exact.
  vec3 w1 = pwNoised(p * 0.5, seed + 202u);
  vec3 w2 = pwNoised(p * 0.5 + vec2(5.2, 1.3), seed + 303u);
  vec2 q = p + uTWarp * vec2(w1.x, w2.x);
  float wk = uTWarp * 0.5;

  // fBm over q. m holds ds/dq as two rows (m.xy, m.zw).
  // slope / hSlope are the gradient and Hessian (xx, xy, yy) of the smooth sum.
  float a = 0.0;
  float b = 1.0;
  vec2 dA = vec2(0.0);
  vec2 slope = vec2(0.0);
  vec3 hSlope = vec3(0.0);
  vec2 s = q;
  vec4 m = vec4(1.0, 0.0, 0.0, 1.0);
  // Ridges belong to the large shapes. Each octave is less ridged than the
  // one before, otherwise the fine octaves cover every slope in wrinkles.
  float ridgeK = uTRidge;
  for (int i = 0; i < PWE_MAX_OCTAVES; i++) {
    float fi = float(i);
    if (fi >= oct) break;
    float wgt = min(oct - fi, 1.0);
    float n;
    vec2 gn;
    vec3 hn;
    pwNoiseH(s, seed + uint(i) * 1013u, n, gn, hn);

    // Blend smooth noise with a ridged version of itself.
    // The crest is |n| rounded off near zero: a hard crease would show up as
    // a fold line across gentle terrain.
    float an = sqrt(n * n + 0.0016);
    float r1 = 1.0 - 1.41 * an;
    float ridge = r1 * r1 - 0.45;
    float dr = -2.82 * r1 * n / an;
    float o = mix(n, ridge, ridgeK);
    vec2 dOs = gn * mix(1.0, dr, ridgeK);
    ridgeK *= uTRidgeDetail;

    // From octave space s to q: gradient is M^T g, Hessian is M^T H M.
    // dO is the gradient of this octave; dN / hN are those of the smooth
    // noise, which is what drives the erosion term (it has no creases, so the
    // damping stays continuous).
    vec2 dO = dOs.x * m.xy + dOs.y * m.zw;
    vec2 dN = gn.x * m.xy + gn.y * m.zw;
    vec3 hN = hn.x * vec3(m.x * m.x, m.x * m.y, m.y * m.y)
            + hn.y * vec3(2.0 * m.x * m.z, m.x * m.w + m.y * m.z, 2.0 * m.y * m.w)
            + hn.z * vec3(m.z * m.z, m.z * m.w, m.w * m.w);

    // "Erosion": octaves contribute less where the terrain so far is steep.
    // The damping varies in space, so its gradient is part of the derivative.
    float damp = 1.0 / (1.0 + uTErosion * dot(slope, slope));
    vec2 dDamp = (-2.0 * uTErosion * damp * damp)
               * vec2(hSlope.x * slope.x + hSlope.y * slope.y, hSlope.y * slope.x + hSlope.z * slope.y);
    a += wgt * b * o * damp;
    dA += wgt * b * (damp * dO + o * dDamp);
    slope += wgt * b * dN;
    hSlope += wgt * b * hN;

    b *= uTGain;
    s = uTLacunarity * vec2(0.8 * s.x - 0.6 * s.y, 0.6 * s.x + 0.8 * s.y) + vec2(1.7, 9.2);
    m = uTLacunarity * vec4(0.8 * m.xy - 0.6 * m.zw, 0.6 * m.xy + 0.8 * m.zw);
  }

  // Back through the warp: dA/dp = J^T * dA/dq.
  vec2 dAp = dA.x * vec2(1.0 + wk * w1.y, wk * w1.z) + dA.y * vec2(wk * w2.y, 1.0 + wk * w2.z);

  float h = uTContinent * cont + mAmp * a;
  vec2 dH = uTContinent * dCont + dMAmp * a + mAmp * dAp;
  return vec3(uTBaseHeight + uTHeightScale * h, dH * (uTHeightScale / uTFeatureScale));
}
`;

// ---------------------------------------------------------------------------
// Biome weights from height, slope and climate.
// ---------------------------------------------------------------------------
export const BIOME_GLSL = /* glsl */ `
uniform float uTWaterLevel;
uniform float uTTemperature;
uniform float uTHumidity;
uniform float uTLapseRate;
uniform float uTRockSlope;
uniform float uTSnowTemperature;
uniform float uTBeachHeight;
uniform float uTSnowfall;

struct TerrainBiome {
  float sand;
  float vegetation;
  float rock;
  float snow;
  float moisture;     // 0..1
  float temperature;  // deg C
};

// jitter is small-scale noise in [-1, 1] that breaks up the borders.
TerrainBiome terrainBiome(vec3 pos, vec3 nrm, float jitter) {
  uint seed = uint(uTSeed);
  vec2 cp = pos.xz / uTFeatureScale;
  TerrainBiome bi;
  bi.moisture = clamp(0.5 + 0.8 * pwNoise(cp * 0.6, seed + 404u) + (uTHumidity - 50.0) * 0.008, 0.0, 1.0);
  bi.temperature = uTTemperature - uTLapseRate * 0.001 * (pos.y - uTWaterLevel)
                 + 4.0 * pwNoise(cp * 0.43, seed + 505u);

  float slope = 1.0 - nrm.y;
  float rock = smoothstep(uTRockSlope - 0.07, uTRockSlope + 0.07, slope + 0.05 * jitter);
  float cold = 1.0 - smoothstep(-2.0, 2.0, bi.temperature - uTSnowTemperature + 1.5 * jitter);
  float holds = 1.0 - smoothstep(uTRockSlope + 0.05, uTRockSlope + 0.30, slope);
  float snow = clamp(cold + uTSnowfall, 0.0, 1.0) * holds;
  float beach = 1.0 - smoothstep(uTWaterLevel + 0.4 * uTBeachHeight, uTWaterLevel + uTBeachHeight, pos.y + 0.6 * jitter);

  bi.snow = snow;
  bi.rock = rock * (1.0 - snow);
  bi.sand = beach * (1.0 - rock) * (1.0 - snow);
  bi.vegetation = max(0.0, 1.0 - bi.snow - bi.rock - bi.sand);
  return bi;
}
`;

// ---------------------------------------------------------------------------
// Vertex: CDLOD morph + displacement.
// ---------------------------------------------------------------------------
export const VERTEX_PARS_GLSL = /* glsl */ `
in vec4 aNode; // x, z, size, lod level

uniform vec3 uTCamPos;
uniform vec2 uTHeightRange;
uniform float uTRanges[PWE_MAX_LEVELS];
uniform float uTPatchRes;
uniform float uTLeafSpacing;
uniform float uTMorphStart;
uniform float uTOctaves;

out vec3 vTWorldPos;
out vec3 vTNormalW;
out vec2 vTLod;

// Distance from the camera to the vertical segment that is guaranteed to
// contain this vertex. The CPU node selection uses the same height range, so
// this is never smaller than the distance to the node's bounding box.
float pweSegDist(vec2 xz) {
  vec2 d = xz - uTCamPos.xz;
  float dy = max(0.0, max(uTHeightRange.x - uTCamPos.y, uTCamPos.y - uTHeightRange.y));
  return sqrt(dot(d, d) + dy * dy);
}

// Octaves the mesh can represent at this distance. A function of the final
// world position only, so vertices shared by two LOD levels agree.
float pweGeomOctaves(float dist) {
  float spacing = uTLeafSpacing * max(1.0, 2.0 * dist / uTRanges[0]);
  float o = log2(uTFeatureScale / (2.5 * spacing)) / log2(uTLacunarity) + 1.0;
  return clamp(o, 1.0, uTOctaves);
}

void terrainVertex(out vec3 pos, out vec3 nrm) {
  vec2 grid = position.xz;
  float cell = aNode.z / uTPatchRes;
  vec2 wp = aNode.xy + grid * cell;

  int lvl = int(aNode.w + 0.5);
  float rEnd = uTRanges[lvl];
  float rPrev = lvl > 0 ? uTRanges[lvl - 1] : 0.0;
  float rStart = mix(rPrev, rEnd, uTMorphStart);
  float k = clamp((pweSegDist(wp) - rStart) / (rEnd - rStart), 0.0, 1.0);

  // Slide odd vertices onto their even neighbour: the patch turns into the
  // next coarser grid before the LOD switch happens.
  vec2 odd = mod(grid, 2.0);
  wp = aNode.xy + (grid - odd * k) * cell;

  vec3 hd = terrainHeight(wp, pweGeomOctaves(pweSegDist(wp)));
  pos = vec3(wp.x, hd.x, wp.y);
  nrm = normalize(vec3(-hd.y, 1.0, -hd.z));
  vTLod = vec2(aNode.w, k);
}
`;

/** Replaces <beginnormal_vertex> in the lit material. */
export const VERTEX_NORMAL_GLSL = /* glsl */ `
vec3 pwePos;
vec3 pweNrm;
terrainVertex(pwePos, pweNrm);
vec3 objectNormal = pweNrm;
vTNormalW = pweNrm;
vTWorldPos = pwePos;
`;

/** Replaces <begin_vertex> in the lit material. */
export const VERTEX_BEGIN_GLSL = /* glsl */ `
vec3 transformed = pwePos;
`;

/** Replaces <begin_vertex> in the depth material (no normal chunk runs there). */
export const VERTEX_BEGIN_DEPTH_GLSL = /* glsl */ `
vec3 pwePos;
vec3 pweNrm;
terrainVertex(pwePos, pweNrm);
vec3 transformed = pwePos;
vTWorldPos = pwePos;
vTNormalW = pweNrm;
`;

// ---------------------------------------------------------------------------
// Fragment: per-pixel normal, biome colour, roughness.
// ---------------------------------------------------------------------------
export const FRAGMENT_PARS_GLSL = /* glsl */ `
in vec3 vTWorldPos;
in vec3 vTNormalW;
in vec2 vTLod;

uniform float uTOctaves;
uniform float uTDetailOctaves;
uniform float uTWetness;
uniform int uTDebug;
uniform vec3 uTColSand;
uniform vec3 uTColGrass;
uniform vec3 uTColDryGrass;
uniform vec3 uTColRock;
uniform vec3 uTColSnow;

vec3 pweLodColor(float level) {
  float h = fract(level * 0.381966);
  return 0.55 + 0.45 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67)));
}
`;

/** Appended after <color_fragment>. Leaves pweNormalW / pweRough for later chunks. */
export const FRAGMENT_COLOR_GLSL = /* glsl */ `
vec3 pweNormalW = normalize(vTNormalW);
vec2 pweXZ = vTWorldPos.xz;
// World metres covered by one pixel.
float pwePix = max(length(dFdx(pweXZ)), length(dFdy(pweXZ)));

#ifdef PWE_FRAGMENT_NORMALS
{
  // Re-evaluate the height function per pixel, with every octave the pixel
  // can resolve (that is the anti-aliasing) plus shading-only detail octaves.
  // An octave is dropped once its wavelength is under ~6 pixels: normals alias
  // much sooner than heights do.
  float fo = log2(uTFeatureScale / (6.0 * pwePix)) / log2(uTLacunarity) + 1.0;
  fo = clamp(fo, 1.0, min(uTOctaves + uTDetailOctaves, float(PWE_MAX_OCTAVES)));
  vec3 hd = terrainHeight(pweXZ, fo);
  pweNormalW = normalize(vec3(-hd.y, 1.0, -hd.z));
}
#endif

// Small-scale noise: border jitter for the biomes and a micro bump.
float pweNear = clamp(2.0 - pwePix * 1.2, 0.0, 1.0);
vec3 pweD1 = pwNoised(pweXZ * 0.31, 77u);
vec3 pweD2 = pwNoised(pweXZ * 0.047, 78u);
float pweJitter = clamp(1.1 * pweD2.x + 0.6 * pweD1.x * pweNear, -1.0, 1.0);

TerrainBiome pweBi = terrainBiome(vTWorldPos, pweNormalW, pweJitter);

// Finer noise still, for what is right in front of the camera.
float pweClose = clamp(1.5 - pwePix * 6.0, 0.0, 1.0);
vec3 pweD3 = pweNear > 0.0 ? pwNoised(pweXZ * 1.9, 79u) : vec3(0.0);
vec3 pweD4 = pweClose > 0.0 ? pwNoised(pweXZ * 9.7, 82u) : vec3(0.0);
float pweSlope = 1.0 - pweNormalW.y;

#ifdef PWE_DETAIL_BUMP
{
  float amp = (0.10 * pweBi.rock + 0.07 * pweBi.vegetation + 0.03 * pweBi.sand) * pweNear;
  vec2 g = pweD1.yz * 0.31 * 1.6 + pweD3.yz * 1.9 * 0.35 + pweD4.yz * 9.7 * 0.05 * pweClose;
  pweNormalW = normalize(pweNormalW + vec3(-g.x, 0.0, -g.y) * amp);
}
#endif

// --- albedo (linear) ---
float pweMacro = 0.5 + 0.7 * pwNoise(pweXZ * 0.0031, 80u);

// Vegetation: lush where wet, dry where arid, brown where cold, bare where hot and dry.
float pweArid = (1.0 - smoothstep(0.18, 0.42, pweBi.moisture)) * smoothstep(16.0, 26.0, pweBi.temperature);
float pweTundra = 1.0 - smoothstep(0.0, 7.0, pweBi.temperature - uTSnowTemperature);
vec3 pweVeg = mix(uTColDryGrass, uTColGrass, smoothstep(0.25, 0.7, pweBi.moisture + 0.25 * (pweMacro - 0.5)));
pweVeg = mix(pweVeg, uTColDryGrass * vec3(0.72, 0.62, 0.55), pweTundra * 0.8);
pweVeg = mix(pweVeg, uTColSand * vec3(1.0, 0.82, 0.66), pweArid);
#ifdef PWE_COVER
{
  // What grows on the ground, as seen from too far away to draw it: see setCover().
  float grows = (1.0 - pweArid) * (1.0 - 0.7 * pweTundra);
  float dry = clamp(1.0 - smoothstep(0.25, 0.7, pweBi.moisture) + 0.6 * pweTundra, 0.0, 1.0);
  pweVeg = pweCover(pweVeg, vTWorldPos, vec4(grows, dry, pweSlope, pweBi.vegetation), vec2(pweBi.temperature, pweBi.moisture));
}
#endif
// Close up the ground is not one colour: worn patches of bare soil, darker
// and lighter tufts, and grain.
float pweSoil = smoothstep(0.12, 0.5, 0.75 * pweD1.x + 0.5 * pweD3.x + 0.3 * pweD2.x) * pweNear;
pweVeg = mix(pweVeg, uTColDryGrass * vec3(0.5, 0.42, 0.33), 0.4 * pweSoil);
// Middle distance: drifts of yellower and bluer green, tens of metres across.
float pweMid = clamp(1.5 - pwePix * 0.1, 0.0, 1.0);
float pweDrift = (pweD2.x + 0.6 * pwNoise(pweXZ * 0.013, 83u)) * pweMid;
pweVeg *= mix(vec3(1.0), vec3(1.16, 1.04, 0.72), clamp(0.5 * pweDrift, -0.5, 0.6));
pweVeg *= 0.8 + 0.4 * pweMacro + 0.14 * pweDrift + (0.2 * pweD1.x + 0.16 * pweD3.x) * pweNear + 0.14 * pweD4.x * pweClose;

// Rock: broad, irregular colour bands that follow height loosely. They fade
// out once a band is only a few pixels tall.
float pweBandFade = clamp(1.5 - pwePix * 0.12, 0.0, 1.0);
float pweStrata = pwNoise(vec2(vTWorldPos.y * 0.035 + 2.0 * pweD2.x, dot(pweXZ, vec2(0.0011, 0.0007))), 81u) * 1.4;
vec3 pweRock = uTColRock * (0.9 + 0.16 * pweStrata * pweBandFade + 0.22 * pweD1.x * pweNear) * mix(vec3(1.0), vec3(1.12, 1.0, 0.86), pweMacro);

vec3 pweSand = uTColSand * (0.92 + 0.16 * pweD1.x * pweNear + 0.07 * pweD3.x * pweNear + 0.06 * pweD4.x * pweClose);
vec3 pweSnow = uTColSnow * (0.96 + 0.04 * pweD1.x);

vec3 pweAlbedo = pweVeg * pweBi.vegetation + pweRock * pweBi.rock + pweSand * pweBi.sand + pweSnow * pweBi.snow;
float pweRough = 0.88 * pweBi.vegetation + 0.80 * pweBi.rock + 0.92 * pweBi.sand + 0.55 * pweBi.snow;

// Wet from rain everywhere, and always wet at and below the waterline.
float pweShore = 1.0 - smoothstep(uTWaterLevel + 0.15, uTWaterLevel + 0.9, vTWorldPos.y + 0.3 * pweJitter);
float pweWet = clamp(max(uTWetness * (1.0 - pweBi.snow), pweShore), 0.0, 1.0);
pweAlbedo *= mix(1.0, 0.55, pweWet);
pweRough *= mix(1.0, 0.45, pweWet);

if (uTDebug == 1) pweAlbedo = pweLodColor(vTLod.x) * (0.55 + 0.45 * vTLod.y);
else if (uTDebug == 2) pweAlbedo = pweNormalW * 0.5 + 0.5;
else if (uTDebug == 3) pweAlbedo = vec3(1.0 - pweNormalW.y) * 2.0;
else if (uTDebug == 4) pweAlbedo = vec3(pweBi.rock + pweBi.snow, pweBi.vegetation + pweBi.snow, pweBi.sand * 0.6 + pweBi.snow);
else if (uTDebug == 5) pweAlbedo = vec3(clamp(pweBi.temperature / 30.0, 0.0, 1.0), pweBi.moisture, clamp(-pweBi.temperature / 20.0, 0.0, 1.0));

diffuseColor.rgb = pweAlbedo;
`;

/** Replaces <roughnessmap_fragment>. */
export const FRAGMENT_ROUGHNESS_GLSL = /* glsl */ `
float roughnessFactor = clamp(pweRough, 0.05, 1.0);
`;

/** Replaces <normal_fragment_begin>. */
export const FRAGMENT_NORMAL_GLSL = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
vec3 normal = normalize(mat3(viewMatrix) * pweNormalW);
vec3 nonPerturbedNormal = normal;
`;
