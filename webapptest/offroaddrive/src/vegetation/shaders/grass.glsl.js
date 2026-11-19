/**
 * VegetationEngine grass: instanced blades placed, shaped and animated in the
 * vertex shader. PWV_GROUND_GLSL is replaced by the ground functions
 * (pwvGroundHeight / pwvGroundInfo) or by a flat-ground default.
 */

export const FLAT_GROUND_GLSL = /* glsl */ `
uniform float uVGroundY;
vec3 pwvGroundHeight(vec2 xz) { return vec3(uVGroundY, 0.0, 0.0); }
vec2 pwvGroundInfo(vec3 pos, vec3 normal) { return vec2(1.0, 0.25); }
`;

/**
 * For TerrainEngine.setCover(): the colour of vegetated ground. It has to
 * agree with what the grass and the trees look like, so it lives next to them.
 */
export const COVER_GLSL = /* glsl */ `
uniform vec3 uVCam;
uniform vec3 uVColor;
uniform vec3 uVDryColor;
uniform float uVDensity;
uniform vec2 uVRange;   // the trees thin out between these distances
uniform vec4 uVCover;   // grass on, trees on times their density, seed of the forest patches
uniform vec3 uVCanopy;

// The same patches of forest as VegetationEngine's tree placement (#buildChunk).
float pwvForestPatch(vec2 xz) {
  vec2 p = xz / 140.0;
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  uint s = uint(uVCover.z);
  float a = float(pwHash(i, s)), b = float(pwHash(i + ivec2(1, 0), s));
  float c = float(pwHash(i + ivec2(0, 1), s)), d = float(pwHash(i + ivec2(1, 1), s));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) / 4294967296.0;
}

vec3 pweCover(vec3 albedo, vec3 pos, vec4 ground, vec2 climate) {
  // Meadow: the ground has the colour of the foot of the blades, so the grass
  // has no visible lower edge, and no visible end where the blades stop.
  vec3 grass = mix(uVColor, uVDryColor, clamp(ground.y - 0.125, 0.0, 1.0)) * PWV_ROOT_SHADE;
  albedo = mix(albedo, grass, 0.9 * smoothstep(0.0, 0.5, ground.x * uVDensity) * uVCover.x);

  // Forest: under the trees the ground is darker, and where the trees are
  // too far away to be drawn the ground takes the colour of their crowns.
  float chance = ground.w * smoothstep(1.0, 6.0, climate.x) * (1.0 - smoothstep(27.0, 33.0, climate.x))
    * (1.0 - smoothstep(0.07, 0.2, ground.z))
    * (0.1 + 0.9 * smoothstep(0.3, 0.65, climate.y))
    * smoothstep(0.3, 0.6, pwvForestPatch(pos.xz)) * uVCover.y;
  float forest = smoothstep(0.0, 0.5, chance);
  float far = smoothstep(uVRange.x * 0.8, uVRange.y, distance(pos.xz, uVCam.xz));
  albedo = mix(albedo, albedo * vec3(0.6, 0.6, 0.5), 0.6 * forest * (1.0 - far));
  return mix(albedo, uVCanopy, forest * far);
}
`.replace('PWV_ROOT_SHADE', '0.5');

export const GRASS_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
PWV_LOGDEPTH_PARS
PWV_NOISE_GLSL
PWV_GROUND_GLSL

in vec2 aCell;

uniform vec3 uVCam;
uniform float uVSpacing;
uniform float uVCount;     // cells per side
uniform vec2 uVFade;       // blades thin out between these distances
uniform float uVInner;     // blades closer than this are left to the denser patch (0 = none)
uniform float uVHeight;
uniform float uVWidth;
uniform float uVTime;
uniform vec2 uVWind;       // direction the wind blows toward, scaled by strength
uniform float uVWaterLevel;
uniform float uVDensity;

out float vT;
out vec3 vVNormal;
out vec3 vVWorld;
out vec2 vVInfo;   // dryness, random shade

// Two independent random numbers per lattice point.
vec2 pwvRand(ivec2 id, uint seed) {
  uint h = pwHash(id, seed);
  return vec2(float(h & 0xffffu), float(h >> 16u)) / 65535.0;
}

void main() {
  // Wrap the instance grid around the camera. Each blade belongs to a fixed
  // world lattice point, so nothing slides when the camera moves.
  float size = uVCount * uVSpacing;
  vec2 rel = mod(aCell * uVSpacing - uVCam.xz + 0.5 * size, size) - 0.5 * size;
  vec2 lattice = uVCam.xz + rel;
  ivec2 id = ivec2(floor(lattice / uVSpacing + 0.5));
  vec2 r1 = pwvRand(id, 11u);
  vec2 r2 = pwvRand(id, 23u);
  vec2 r3 = pwvRand(id, 37u);
  vec2 root = (vec2(id) + r1 - 0.5) * uVSpacing;

  float dist = length(root - uVCam.xz);
  float keep = 1.0 - smoothstep(uVFade.x, uVFade.y, dist);
  // Hand over to the denser patch nearer the camera without a visible ring.
  if (uVInner > 0.0) keep *= smoothstep(uVInner * 0.75, uVInner, dist);

  vec3 g = pwvGroundHeight(root);
  vec3 groundN = normalize(vec3(-g.y, 1.0, -g.z));
  vec3 base = vec3(root.x, g.x, root.y);
  vec2 info = pwvGroundInfo(base, groundN);
  // The foot of the blade is a straight edge. Below the surface it cannot be seen.
  base.y -= 0.035;
  float density = info.x * uVDensity * smoothstep(uVWaterLevel + 0.3, uVWaterLevel + 1.5, g.x);

  if (r2.x > keep || r2.y > density) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume
    vT = 0.0; vVNormal = vec3(0.0, 1.0, 0.0); vVWorld = base; vVInfo = vec2(0.0);
    return;
  }

  float t = position.y;
  float height = uVHeight * (0.55 + 0.9 * r3.x) * (0.6 + 0.4 * info.x);
  // Fewer blades far away, so each one gets wider to cover the same ground.
  float width = uVWidth * (1.0 + 2.5 * smoothstep(uVFade.x * 0.4, uVFade.y, dist)) * (0.7 + 0.6 * r3.y);

  float angle = r1.x * 6.2831853;
  vec2 across = vec2(cos(angle), sin(angle));
  // Wind: a steady lean plus gusts that travel across the field.
  float strength = length(uVWind);
  vec2 windDir = strength > 1e-4 ? uVWind / strength : vec2(1.0, 0.0);
  float gust = pwNoise(root * 0.045 - windDir * uVTime * 0.9, 51u) + 0.5 * pwNoise(root * 0.21 - windDir * uVTime * 2.1, 52u);
  float flutter = sin(uVTime * (3.0 + 4.0 * r3.y) + r1.y * 6.2831853) * 0.06 * min(strength * 3.0, 1.0);
  vec2 lean = windDir * strength * (0.35 + 0.9 * gust) + (r2 - 0.5) * 0.5 + across * flutter;
  float bend = min(length(lean), 1.3);
  lean = bend > 1e-4 ? lean / length(lean) * bend : vec2(0.0);

  vec3 transformed = base;
  transformed.xz += across * (position.x * width * (1.0 - 0.85 * t)) + lean * (t * t * height);
  transformed.y += height * t * (1.0 - 0.3 * bend * bend * t);

  vT = t;
  // Mostly the ground's normal: a field of blades is lit like the slope it grows on.
  vVNormal = normalize(groundN + 0.35 * vec3(across.y, 0.0, -across.x) * sign(position.x + 0.001) + vec3(lean.x, 0.0, lean.y) * 0.4 * t);
  vVWorld = transformed;
  vVInfo = vec2(info.y, r3.x);

  vec3 transformedNormal = mat3(viewMatrix) * groundN;
  vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Depth per vertex instead of per pixel: see TREE_LOGDEPTH in tree.glsl.js.
  PWV_LOGDEPTH
  vec4 worldPosition = vec4(transformed, 1.0);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

export const GRASS_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform vec3 uVColor;
uniform vec3 uVDryColor;

in float vT;
in vec3 vVNormal;
in vec3 vVWorld;
in vec2 vVInfo;

void main() {
  vec3 N = normalize(vVNormal);
  vec3 V = normalize(cameraPosition - vVWorld);

  vec3 L = vec3(0.0, 1.0, 0.0);
  vec3 sun = vec3(0.0);
  #if NUM_DIR_LIGHTS > 0
    L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
    sun = directionalLights[0].color;
  #endif
  vec3 skyE = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
    skyE += mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, 0.5 + 0.5 * N.y);
  #endif
  float shadow = getShadowMask();

  vec3 albedo = mix(uVColor, uVDryColor, clamp(vVInfo.x + 0.25 * (vVInfo.y - 0.5), 0.0, 1.0));
  albedo *= 0.8 + 0.4 * vVInfo.y;
  // Darker at the root, where the blades shade each other. The ground under
  // the grass is given the root's colour (COVER_GLSL), so the two meet unseen.
  albedo *= mix(0.5, 0.95, vT);

  float diffuse = max(dot(N, L), 0.0) * 0.75 + 0.25 * max(L.y, 0.0);
  // Blades glow when the sun is behind them.
  float through = pow(max(dot(V, -L), 0.0), 3.0) * 0.4 * vT;
  vec3 color = albedo * RECIPROCAL_PI * (sun * shadow * (diffuse + through) + skyE * mix(0.8, 1.0, vT));

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
