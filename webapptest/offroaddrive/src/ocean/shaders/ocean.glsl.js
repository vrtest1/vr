/**
 * OceanEngine GLSL (a three.js ShaderMaterial with lights, shadows and fog).
 *
 * Waves are a sum of Gerstner waves. The table is built on the CPU from the
 * wind (OceanEngine.js) and the same table drives the vertex displacement,
 * the per-pixel normal and the CPU height query.
 */

export const OCEAN_WAVES_GLSL = /* glsl */ `
#define PWO_MAX_WAVES 40
uniform vec4 uOWaveA[PWO_MAX_WAVES]; // direction x, direction z, wavenumber k, amplitude
uniform vec4 uOWaveB[PWO_MAX_WAVES]; // steepness Q, angular speed, phase, unused
uniform int uOWaveCount;
uniform float uOTime;
uniform float uOLevel;
uniform float uOShoreDepth; // waves die out over this depth near the shore
`;

export const OCEAN_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
${OCEAN_WAVES_GLSL}
PWO_SEABED_GLSL

uniform vec2 uOCenter;      // grid centre, world xz
uniform float uOGridScale;  // grows with camera height
uniform float uOAngularStep;
uniform float uOMinSpacing;

out vec3 vOWorld;
out vec2 vOFlat;
out float vOCrest;

void main() {
  vec2 flatPos = uOCenter + position.xz * uOGridScale;
  float radius = length(position.xz) * uOGridScale;
  float spacing = max(radius * uOAngularStep, uOMinSpacing * uOGridScale);

  float shore = 1.0;
  #ifdef PWO_SEABED
    shore = smoothstep(0.0, uOShoreDepth, uOLevel - pwoSeabedHeight(flatPos));
  #endif

  vec3 disp = vec3(0.0);
  float ampSum = 0.0;
  for (int i = 0; i < PWO_MAX_WAVES; i++) {
    if (i >= uOWaveCount) break;
    vec4 a = uOWaveA[i];
    vec4 b = uOWaveB[i];
    // Only waves the mesh can represent here; shorter ones live in the normal.
    float f = smoothstep(2.0, 5.0, 6.2831853 / (a.z * spacing)) * shore;
    if (f <= 0.0) continue;
    float ph = a.z * dot(a.xy, flatPos) - b.y * uOTime + b.z;
    float amp = a.w * f;
    disp.xz += b.x * amp * cos(ph) * a.xy;
    disp.y += amp * sin(ph);
    ampSum += amp;
  }

  vec3 transformed = vec3(flatPos.x + disp.x, uOLevel + disp.y, flatPos.y + disp.z);
  vOWorld = transformed;
  vOFlat = flatPos;
  vOCrest = ampSum > 0.0 ? disp.y / ampSum : 0.0;

  vec3 transformedNormal = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
  vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  vec4 worldPosition = vec4(transformed, 1.0);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

export const OCEAN_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <logdepthbuf_pars_fragment>
PWO_NOISE_GLSL
${OCEAN_WAVES_GLSL}
PWO_SEABED_GLSL

uniform vec3 uODeepColor;
uniform vec3 uOShallowColor;
uniform vec3 uOScatterColor;
uniform vec3 uOSkyZenith;
uniform vec3 uOSkyHorizon;
uniform vec3 uOSkyHorizonSun;
uniform float uOReflection;
uniform float uOClarity;      // metres of water that hide the bottom
uniform float uOFoam;
uniform float uOFoamThreshold;
uniform float uOShoreFoam;
uniform float uORipples;
uniform float uOMaxRoughness; // cap on the glitter width, from the wind
uniform vec2 uOWind;          // unit vector the wind blows toward

in vec3 vOWorld;
in vec2 vOFlat;
in float vOCrest;

float pwoGGX(float nh, float a2) {
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 toCam = cameraPosition - vOWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // World metres covered by one pixel.
  float pix = max(length(dFdx(vOFlat)), length(dFdy(vOFlat)));

  float depth = 1e4;
  float shore = 1.0;
  #ifdef PWO_SEABED
    depth = uOLevel - pwoSeabedHeight(vOFlat);
    shore = smoothstep(0.0, uOShoreDepth, depth);
  #endif

  // --- surface slope from every wave this pixel can resolve ----------------
  vec2 slope = vec2(0.0);
  float fold = 0.0;      // how much the surface is pinched together (whitecaps)
  float variance = 0.0;  // slope variance of the waves too small to resolve
  for (int i = 0; i < PWO_MAX_WAVES; i++) {
    if (i >= uOWaveCount) break;
    vec4 a = uOWaveA[i];
    vec4 b = uOWaveB[i];
    float ka = a.z * a.w * shore;
    float f = smoothstep(2.0, 6.0, 6.2831853 / (a.z * pix));
    variance += (1.0 - f) * ka * ka * 0.5;
    if (f <= 0.0) continue;
    float ph = a.z * dot(a.xy, vOFlat) - b.y * uOTime + b.z;
    slope += (ka * f * cos(ph)) * a.xy;
    fold += b.x * ka * f * sin(ph);
  }

  // Capillary ripples: two noise layers drifting with the wind.
  float rippleFade = clamp(1.5 - pix * 6.0, 0.0, 1.0);
  float ripple = uORipples * (0.4 + 0.6 * shore);
  if (ripple > 0.0) {
    vec2 drift = uOWind * uOTime;
    vec3 r1 = pwNoised(vOFlat * 1.7 - drift * 0.9, 31u);
    vec3 r2 = pwNoised(vOFlat * 5.3 + vec2(drift.y, -drift.x) * 0.6 - drift * 1.4, 32u);
    slope += (r1.yz * 0.05 + r2.yz * 0.035) * ripple * rippleFade;
    variance += (1.0 - rippleFade) * 0.0012 * ripple * ripple;
  }

  vec3 N = normalize(vec3(-slope.x, 1.0 - fold, -slope.y));
  bool below = V.y < 0.0 && cameraPosition.y < vOWorld.y;
  if (below) N = -N;

  // --- lights from the scene -------------------------------------------------
  vec3 L = vec3(0.0, 1.0, 0.0);
  vec3 sun = vec3(0.0);
  #if NUM_DIR_LIGHTS > 0
    L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
    sun = directionalLights[0].color;
  #endif
  vec3 skyE = vec3(0.0);
  #if NUM_HEMI_LIGHTS > 0
    skyE = hemisphereLights[0].skyColor;
  #endif
  skyE += ambientLightColor;
  float shadow = getShadowMask();
  vec3 sunE = sun * max(L.y, 0.0) * shadow;

  // --- reflection --------------------------------------------------------------
  float nv = max(dot(N, V), 0.0);
  float alpha2 = clamp(0.0009 + variance, 0.0009, uOMaxRoughness);
  // Rough water reflects less at grazing angles than a mirror would.
  float fresnel = 0.02 + 0.98 * pow(1.0 - nv, 5.0) / (1.0 + 22.0 * alpha2);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float up = pow(clamp(R.y, 0.0, 1.0), 0.45);
  vec2 rh = normalize(R.xz + 1e-5);
  vec2 lh = normalize(L.xz + 1e-5);
  float sunSide = 0.5 + 0.5 * dot(rh, lh);
  // The glow around the sun is narrow; most of the horizon has the plain colour.
  vec3 horizon = mix(uOSkyHorizon, uOSkyHorizonSun, pow(sunSide, 10.0));
  vec3 skyRefl = mix(horizon, uOSkyZenith, up) * uOReflection;

  vec3 H = normalize(L + V);
  float spec = pwoGGX(max(dot(N, H), 0.0), alpha2) * 0.25 / max(nv, 0.08);
  float fresnelH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  vec3 glint = sun * min(spec * fresnelH, 24.0) * shadow * step(0.0, L.y);

  // --- water body --------------------------------------------------------------
  vec3 body = uODeepColor * (skyE + sunE) * RECIPROCAL_PI;
  // Light leaking through the crests when looking toward the sun.
  float through = pow(max(dot(V, -L), 0.0), 3.0) * clamp(vOCrest * 0.5 + 0.5, 0.0, 1.0);
  body += uOScatterColor * sun * shadow * through * 0.12 * shore;

  float opacity = 1.0;
  #ifdef PWO_SEABED
    // Shallow water shows the lit bottom tint and lets the real seabed through.
    float seen = exp(-max(depth, 0.0) / uOClarity);
    body = mix(body, uOShallowColor * (skyE + sunE) * RECIPROCAL_PI, seen);
    opacity = clamp(1.0 - seen * (1.0 - fresnel) * 0.9, 0.0, 1.0) * smoothstep(-0.02, 0.12, depth);
  #endif

  // --- foam ------------------------------------------------------------------
  float foam = 0.0;
  if (uOFoam > 0.0 || uOShoreFoam > 0.0) {
    vec2 drift = uOWind * uOTime * 0.35;
    float n1 = pwNoise(vOFlat * 0.9 - drift, 41u);
    float n2 = pwNoise(vOFlat * 3.1 - drift * 1.7, 42u);
    float pattern = clamp(0.55 + n1 * 0.9 + n2 * 0.6, 0.0, 1.0);
    float caps = smoothstep(uOFoamThreshold, uOFoamThreshold + 0.3, fold + 0.25 * vOCrest) * uOFoam;
    foam = caps * smoothstep(0.25, 0.75, pattern) * shore;
    #ifdef PWO_SEABED
      // Bands that run in toward the beach and break up on the way.
      float bands = sin(depth * 4.2 + uOTime * 1.1 + n1 * 3.5) * 0.5 + 0.5;
      float edge = 1.0 - smoothstep(0.0, 1.4, depth);
      float wash = max(edge * edge, smoothstep(0.55, 0.95, bands) * (1.0 - smoothstep(0.2, 2.6, depth)));
      foam = max(foam, wash * smoothstep(0.2, 0.6, pattern + 0.35 * edge) * uOShoreFoam);
    #endif
    foam *= clamp(2.0 - pix * 0.5, 0.25, 1.0);
  }
  vec3 foamColor = vec3(0.92) * (skyE + sunE) * RECIPROCAL_PI;

  vec3 color = mix(body * (1.0 - fresnel) + skyRefl * fresnel, foamColor, foam) + glint * (1.0 - foam);
  if (below) {
    // From underneath: the sky is squeezed into a bright disc overhead
    // (Snell's window); outside it the surface mirrors the dark water.
    vec3 T = refract(-V, N, 1.33);
    vec3 mirror = uODeepColor * (skyE + sunE) * RECIPROCAL_PI * 1.6;
    if (dot(T, T) < 0.5) {
      color = mirror;
    } else {
      vec3 skyT = mix(uOSkyHorizon, uOSkyZenith, pow(clamp(T.y, 0.0, 1.0), 0.45));
      float sunDisc = pow(max(dot(T, L), 0.0), 600.0);
      color = mix(mirror, skyT * 0.9 + sun * sunDisc * 8.0 * shadow, smoothstep(0.0, 0.25, T.y));
    }
    color += foamColor * foam * 0.3;
  }

  gl_FragColor = vec4(color, below ? 1.0 : max(opacity, foam));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
