/**
 * VolumetricEngine GLSL: a layer of fog that thins out with height, lit by
 * the sky and the sun, with wisps that drift on the wind and shafts of light
 * where something stands between the fog and the sun.
 *
 * The fog near the camera is worked out once per frame on a coarse grid that
 * fills the view (FROXEL_FRAG): each cell holds the light the fog adds, and
 * how much it lets through, between the camera and that cell. Materials read
 * the grid at their own position, which costs two texture reads however much
 * they overlap. Past the end of the grid, and when there is no grid, the fog
 * is integrated in closed form, so every quality preset has the same amount
 * of fog and they only differ in wisps and shafts.
 */

const COMMON_GLSL = /* glsl */ `
uniform float uFStrength;      // 0 turns the fog off
uniform vec3 uFFog;            // x: extinction per metre at the base, y: base Y, z: scale height
uniform vec3 uFAmbient;        // radiance of fog lit by the sky
uniform vec3 uFSun;            // radiance of fog lit by the sun, before the phase function
uniform vec3 uFSunDir;
uniform float uFG;             // how strongly the fog scatters forward
uniform vec4 uFFroxel;         // x: columns of tiles, y: rows of tiles, z: slices (0 = no grid), w: range in metres
uniform vec2 uFFroxelTile;     // cells across and down one tile

float pwfRelDensity(float y) {
  return exp(-max(y - uFFog.y, -uFFog.z) / uFFog.z);
}

// Optical depth of a straight piece of the ray between two heights.
float pwfTau(float y0, float y1, float len) {
  float e0 = pwfRelDensity(y0), e1 = pwfRelDensity(y1);
  float dy = y1 - y0;
  float mean = 0.5 * (e0 + e1);
  if (abs(dy) > 0.02 * uFFog.z) mean = clamp(uFFog.z * (e0 - e1) / dy, min(e0, e1), max(e0, e1));
  return uFFog.x * mean * len * uFStrength;
}

// Brightness toward the sun relative to scattering evenly in all directions.
float pwfPhase(float c) {
  float g = uFG;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
  return mix(1.0, hg, 0.5);
}

// Light scattered toward the eye by fog of relative density rel, for sun
// visibility vis. Dense fog shades itself: less light gets down into it.
vec3 pwfLight(float rel, float vis, float phase) {
  float up = uFFog.x * rel * uFFog.z * uFStrength; // optical depth straight up
  float sunY = max(uFSunDir.y, 0.12);
  return uFAmbient * exp(-0.25 * up) + uFSun * (phase * vis * exp(-0.6 * up / sunY));
}

void pwfPiece(inout vec3 S, inout float T, float y0, float y1, float len, float phase) {
  if (len <= 0.0) return;
  float tau = pwfTau(y0, y1, len);
  float rel = tau / max(uFFog.x * len * uFStrength, 1e-9);
  S += T * (1.0 - exp(-tau)) * pwfLight(rel, 1.0, phase);
  T *= exp(-tau);
}
`;

/** What materials, the backdrop and the smoke use: read the grid, then the closed form. */
export const VOLUMETRIC_GLSL = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D uFFroxelTex;
uniform mat4 uFFroxelViewProj; // world to clip space of the camera the grid was made for

vec4 pwfSlice(vec2 uv, float k) {
  vec2 tile = vec2(mod(k, uFFroxel.x), floor(k / uFFroxel.x));
  return texture(uFFroxelTex, (tile + uv) / uFFroxel.xy);
}

// rgb: light the fog adds along the ray, a: how much of the surface behind it is left.
vec4 pwfFog(vec3 worldPos, vec3 camPos) {
  if (uFStrength <= 0.0 || uFFog.x <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  vec3 v = worldPos - camPos;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-4);
  if (pwfTau(camPos.y, worldPos.y, dist) < 2e-3) return vec4(0.0, 0.0, 0.0, 1.0);

  vec3 S = vec3(0.0);
  float T = 1.0;
  float t1 = 0.0;
  #ifndef PWF_NO_GRID
  if (uFFroxel.z > 0.5) {
    t1 = min(dist, uFFroxel.w);
    vec4 clip = uFFroxelViewProj * vec4(camPos + dir * t1, 1.0);
    if (clip.w > 0.0) {
      // Stay half a cell inside the tile, or the neighbouring tile bleeds in.
      vec2 uv = clamp(clip.xy / clip.w * 0.5 + 0.5, 0.5 / uFFroxelTile, 1.0 - 0.5 / uFFroxelTile);
      // Slice k holds the fog between the camera and range * ((k + 1) / slices)^2.
      float s = sqrt(t1 / uFFroxel.w) * uFFroxel.z - 1.0;
      float k0 = floor(s);
      vec4 a = k0 < 0.0 ? vec4(0.0, 0.0, 0.0, 1.0) : pwfSlice(uv, k0);
      vec4 b = pwfSlice(uv, min(k0 + 1.0, uFFroxel.z - 1.0));
      vec4 f = mix(a, b, s - k0);
      S = f.rgb;
      T = f.a;
    } else {
      t1 = 0.0;
    }
  }
  #endif
  pwfPiece(S, T, camPos.y + dir.y * t1, worldPos.y, dist - t1, pwfPhase(dot(dir, uFSunDir)));
  return vec4(S, T);
}

vec3 pwfApply(vec3 color, vec3 worldPos, vec3 camPos) {
  vec4 f = pwfFog(worldPos, camPos);
  return color * f.a + f.rgb;
}
`;

/** The grid pass: one full-screen triangle over the atlas of slices. */
export const FROXEL_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const FROXEL_FRAG = /* glsl */ `
precision highp sampler3D;
${COMMON_GLSL}
uniform mat4 uFProjInv;        // clip to view space of the camera
uniform mat4 uFCamWorld;       // the camera's world matrix
uniform vec4 uFNoise;          // x: amount, y: 1 / size, z: octaves
uniform vec3 uFNoiseOffset;    // drift, in noise space
uniform sampler3D uFNoiseTex;
uniform sampler2D uFShadowMap;
uniform mat4 uFShadowMatrix;
uniform float uFShafts;        // 0 = never look at the shadow map

// 1 where the sun reaches p, 0 in shadow. Points outside the shadow map are lit.
float pwfSunVisible(vec3 p) {
  vec4 sc = uFShadowMatrix * vec4(p, 1.0);
  vec3 c = sc.xyz / sc.w;
  vec2 e = abs(c.xy - 0.5) * 2.0;
  float edge = max(e.x, e.y);
  if (edge >= 1.0 || c.z >= 1.0 || c.z <= 0.0) return 1.0;
  // three packs the shadow depth into rgba, most significant byte in r.
  float d = dot(texture(uFShadowMap, c.xy), vec4(0.99609375, 0.0038909912, 0.000015199184, 0.000000059604645));
  return mix(step(c.z - 0.0015, d), 1.0, smoothstep(0.75, 1.0, edge));
}

void main() {
  vec2 tile = floor(gl_FragCoord.xy / uFFroxelTile);
  vec2 cell = gl_FragCoord.xy - tile * uFFroxelTile;
  float k = tile.y * uFFroxel.x + tile.x;
  if (k >= uFFroxel.z) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 view = uFProjInv * vec4(cell / uFFroxelTile * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(mat3(uFCamWorld) * (view.xyz / view.w));
  vec3 cam = uFCamWorld[3].xyz;
  float phase = pwfPhase(dot(dir, uFSunDir));
  // Every cell samples the middle of its slice. An offset that differs from
  // cell to cell would hide the slices, but shows up as a pattern of its own
  // once the coarse grid is stretched over the screen.
  const float jitter = 0.5;

  vec3 S = vec3(0.0);
  float T = 1.0;
  for (float i = 0.0; i < 64.0; i += 1.0) {
    if (i > k || T < 0.004) break;
    // Slices crowd toward the camera, where they cover the most pixels.
    float fa = i / uFFroxel.z, fb = (i + 1.0) / uFFroxel.z, fs = (i + jitter) / uFFroxel.z;
    float dt = uFFroxel.w * (fb * fb - fa * fa);
    vec3 p = cam + dir * (uFFroxel.w * fs * fs);
    float rel = pwfRelDensity(p.y);
    float sigma = uFFog.x * rel;
    if (uFNoise.x > 0.0) {
      vec3 q = p * uFNoise.y + uFNoiseOffset;
      float n = texture(uFNoiseTex, q).r;
      if (uFNoise.z > 1.5) n = n * 0.65 + texture(uFNoiseTex, q * 2.7 + 0.37).r * 0.35;
      // The wisps fade out toward the end of the grid, where the closed
      // form (which knows nothing of them) takes over.
      sigma *= max(1.0 + uFNoise.x * (1.0 - smoothstep(0.6, 1.0, fs * fs)) * (n - 0.5) * 3.2, 0.0);
    }
    float a = 1.0 - exp(-sigma * dt * uFStrength);
    if (a < 1e-5) continue;
    float vis = uFShafts > 0.0 ? mix(1.0, pwfSunVisible(p), uFShafts) : 1.0;
    S += T * a * pwfLight(rel, vis, phase);
    T *= 1.0 - a;
  }
  gl_FragColor = vec4(S, T);
}
`;

export const VOLUMETRIC_VERT_PARS = /* glsl */ `
out vec3 vPwfWorld;
`;

export const VOLUMETRIC_VERT = /* glsl */ `
{
  vec4 pwfP = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    pwfP = batchingMatrix * pwfP;
  #endif
  #ifdef USE_INSTANCING
    pwfP = instanceMatrix * pwfP;
  #endif
  vPwfWorld = (modelMatrix * pwfP).xyz;
}
`;

export const VOLUMETRIC_FRAG_PARS = /* glsl */ `
in vec3 vPwfWorld;
${VOLUMETRIC_GLSL}
`;

export const VOLUMETRIC_FRAG = /* glsl */ `
gl_FragColor.rgb = pwfApply(gl_FragColor.rgb, vPwfWorld, cameraPosition);
`;

/** Backdrop: the fog in front of the sky, where no surface was drawn. */
export const BACKDROP_VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vec4 view = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = transpose(mat3(viewMatrix)) * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const BACKDROP_FRAG = /* glsl */ `
${VOLUMETRIC_GLSL}
in vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  vec4 f = pwfFog(cameraPosition + dir * 200000.0, cameraPosition);
  float alpha = 1.0 - f.a;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(f.rgb / alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Number of smoke sources the shader has room for. */
export const MAX_SMOKE = 8;

/**
 * Smoke: puffs that face the camera. A puff has no stored state: where it is
 * follows from its age, which follows from the clock, so the whole plume is
 * computed in the vertex shader.
 */
export const SMOKE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
in vec4 aSeed;
in float aEmitter;
uniform vec4 uFSmokePos[${MAX_SMOKE}];   // xyz, radius of the source
uniform vec4 uFSmokeMove[${MAX_SMOKE}];  // rise (m/s), life (s), turbulence, response to wind
uniform vec4 uFSmokeColor[${MAX_SMOKE}]; // rgb, opacity
uniform float uFTime;
uniform vec3 uFWind;                     // m/s
out vec2 vUv;
out vec4 vColor;
out vec3 vNoiseAt;
out vec3 vPwfWorld;

void main() {
  int e = int(aEmitter + 0.5);
  vec4 P = uFSmokePos[e];
  vec4 M = uFSmokeMove[e];
  float age = fract(uFTime / M.y + aSeed.x);
  float t = age * M.y;

  // Out of the source, upward (slowing as it cools), downwind (faster the
  // higher it gets), and wandering more and more.
  float a0 = aSeed.y * 6.2831853;
  vec3 c = P.xyz;
  c.xz += vec2(cos(a0), sin(a0)) * sqrt(aSeed.z) * P.w * 0.6;
  c.y += M.x * t * (1.0 - 0.35 * age);
  c += uFWind * (M.w * t * (0.35 + 0.65 * age));
  float wander = M.z * P.w * (0.4 + 2.2 * age);
  c += wander * vec3(
    sin(a0 * 3.0 + t * 0.31 + aSeed.w * 9.0),
    0.35 * sin(aSeed.w * 17.0 + t * 0.23),
    cos(a0 * 5.0 + t * 0.27 + aSeed.w * 5.0));

  float size = P.w * (1.6 + (4.0 + 3.0 * M.z) * pow(age, 0.7)) * (0.8 + 0.4 * aSeed.w);
  float rot = aSeed.w * 6.2831853 + (aSeed.y - 0.5) * 1.5 * age;
  vec2 q = vec2(position.x * cos(rot) - position.y * sin(rot), position.x * sin(rot) + position.y * cos(rot));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = c + (right * q.x + up * q.y) * size;

  vUv = q * 2.0;
  vec4 C = uFSmokeColor[e];
  vColor = vec4(C.rgb, C.a * smoothstep(0.0, 0.06, age) * pow(1.0 - age, 1.6));
  vNoiseAt = vec3(position.xy * 0.7 + aSeed.xy * 7.0, aSeed.z * 5.0 + age * 0.6);
  vPwfWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const SMOKE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
precision highp sampler3D;
${VOLUMETRIC_GLSL}
uniform sampler3D uFNoiseTex;
in vec2 vUv;
in vec4 vColor;
in vec3 vNoiseAt;
in vec3 vPwfWorld;

void main() {
  #include <logdepthbuf_fragment>
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || vColor.a < 0.003) discard;

  // A round puff with its edge eaten away by noise.
  float n = texture(uFNoiseTex, vNoiseAt).r * 0.65 + texture(uFNoiseTex, vNoiseAt * 2.3 + 0.5).r * 0.35;
  float density = smoothstep(0.0, 0.85, (1.0 - r2) - (1.0 - n) * 0.8 * (0.3 + 0.7 * r2));
  float alpha = density * vColor.a;
  if (alpha < 0.003) discard;

  // Lit like a ball: bright on the side of the sun, sky colour elsewhere.
  vec3 N = transpose(mat3(viewMatrix)) * vec3(vUv, sqrt(1.0 - r2));
  float wrap = clamp(dot(N, uFSunDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 dir = normalize(vPwfWorld - cameraPosition);
  vec3 light = uFAmbient * (0.75 + 0.25 * N.y)
    + uFSun * (0.2 + 1.3 * wrap * wrap + 0.3 * pwfPhase(dot(dir, uFSunDir)) * (1.0 - density));
  vec3 color = vColor.rgb * light * (0.8 + 0.4 * n);

  // Smoke stands in the fog like everything else.
  color = pwfApply(color, vPwfWorld, cameraPosition);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
