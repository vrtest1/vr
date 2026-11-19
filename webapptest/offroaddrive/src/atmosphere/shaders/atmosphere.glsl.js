/**
 * AtmosphereEngine GLSL.
 *
 * The sky model follows Hillaire, "A Scalable and Production Ready Sky and
 * Atmosphere Rendering Technique" (2020): a transmittance LUT, a
 * multiple-scattering LUT and a small sky-view LUT that is refreshed every
 * frame. Distances inside the model are kilometres.
 *
 * ATMOSPHERE_GLSL is mirrored (single scattering only) in AtmosphereModel.js.
 */

// ---------------------------------------------------------------------------
// Medium description and LUT lookups, shared by every pass.
// ---------------------------------------------------------------------------
export const ATMOSPHERE_GLSL = /* glsl */ `
#define PWA_PI 3.14159265358979
#define PWA_RG 6360.0
#define PWA_RT 6460.0

uniform float uARayleighScale;
uniform float uAMieScale;
uniform float uAOzoneScale;
uniform float uAMieG;

const vec3 PWA_RAYLEIGH = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float PWA_MIE_SCATTER = 3.996e-3;
const float PWA_MIE_ABSORB = 4.4e-3;
const vec3 PWA_OZONE = vec3(0.650e-3, 1.881e-3, 0.085e-3);

float pwaSafeAcos(float x) { return acos(clamp(x, -1.0, 1.0)); }

// Distance to a sphere centred on the planet, or -1.
float pwaRaySphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  if (c > 0.0 && b > 0.0) return -1.0;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  if (disc > b * b) return -b + sqrt(disc);
  return -b - sqrt(disc);
}

void pwaMedium(vec3 pos, out vec3 rayleigh, out float mie, out vec3 extinction) {
  float alt = max(length(pos) - PWA_RG, 0.0);
  float dR = exp(-alt / 8.0) * uARayleighScale;
  float dM = exp(-alt / 1.2) * uAMieScale;
  rayleigh = PWA_RAYLEIGH * dR;
  mie = PWA_MIE_SCATTER * dM;
  vec3 ozone = PWA_OZONE * max(0.0, 1.0 - abs(alt - 25.0) / 15.0) * uAOzoneScale;
  extinction = rayleigh + mie + PWA_MIE_ABSORB * dM + ozone;
}

float pwaMiePhase(float c) {
  float g = uAMieG;
  float k = 3.0 / (8.0 * PWA_PI);
  return k * (1.0 - g * g) * (1.0 + c * c) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5));
}

float pwaRayleighPhase(float c) {
  return 3.0 / (16.0 * PWA_PI) * (1.0 + c * c);
}

vec2 pwaLutUv(vec3 pos, vec3 sunDir) {
  float h = length(pos);
  return vec2(clamp(0.5 + 0.5 * dot(sunDir, pos / h), 0.0, 1.0),
              clamp((h - PWA_RG) / (PWA_RT - PWA_RG), 0.0, 1.0));
}
`;

/** Fullscreen pass vertex shader for the LUTs. */
export const LUT_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const TRANSMITTANCE_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
in vec2 vUv;
out vec4 fragColor;
void main() {
  float sunCos = 2.0 * vUv.x - 1.0;
  float sunTheta = pwaSafeAcos(sunCos);
  vec3 pos = vec3(0.0, mix(PWA_RG, PWA_RT, vUv.y), 0.0);
  vec3 dir = normalize(vec3(0.0, sunCos, -sin(sunTheta)));
  vec3 result = vec3(0.0);
  if (pwaRaySphere(pos, dir, PWA_RG) <= 0.0) {
    float tMax = pwaRaySphere(pos, dir, PWA_RT);
    float t = 0.0;
    vec3 od = vec3(0.0);
    for (float i = 0.0; i < 40.0; i += 1.0) {
      float newT = (i + 0.3) / 40.0 * tMax;
      float dt = newT - t;
      t = newT;
      vec3 r, e; float m;
      pwaMedium(pos + t * dir, r, m, e);
      od += e * dt;
    }
    result = exp(-od);
  }
  fragColor = vec4(result, 1.0);
}
`;

export const MULTISCATTER_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
uniform sampler2D uATransmittance;
uniform vec3 uAGroundAlbedo;
in vec2 vUv;
out vec4 fragColor;

void main() {
  float sunCos = 2.0 * vUv.x - 1.0;
  float sunTheta = pwaSafeAcos(sunCos);
  vec3 pos = vec3(0.0, mix(PWA_RG + 0.001, PWA_RT, vUv.y), 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCos, -sin(sunTheta)));

  vec3 lumTotal = vec3(0.0);
  vec3 fms = vec3(0.0);
  const float SQRT_SAMPLES = 8.0;
  const float STEPS = 20.0;
  float inv = 1.0 / (SQRT_SAMPLES * SQRT_SAMPLES);
  for (float i = 0.0; i < SQRT_SAMPLES; i += 1.0) {
    for (float j = 0.0; j < SQRT_SAMPLES; j += 1.0) {
      float theta = PWA_PI * (i + 0.5) / SQRT_SAMPLES;
      float phi = pwaSafeAcos(1.0 - 2.0 * (j + 0.5) / SQRT_SAMPLES);
      vec3 dir = vec3(sin(phi) * sin(theta), cos(phi), sin(phi) * cos(theta));
      float atmo = pwaRaySphere(pos, dir, PWA_RT);
      float ground = pwaRaySphere(pos, dir, PWA_RG);
      float tMax = ground > 0.0 ? ground : atmo;
      float c = dot(dir, sunDir);
      float pm = pwaMiePhase(c);
      float pr = pwaRayleighPhase(-c);

      vec3 lum = vec3(0.0), factor = vec3(0.0), trans = vec3(1.0);
      float t = 0.0;
      for (float s = 0.0; s < STEPS; s += 1.0) {
        float newT = (s + 0.3) / STEPS * tMax;
        float dt = newT - t;
        t = newT;
        vec3 p = pos + t * dir;
        vec3 r, e; float m;
        pwaMedium(p, r, m, e);
        vec3 st = exp(-dt * e);
        vec3 noPhase = r + m;
        factor += trans * (noPhase - noPhase * st) / e;
        vec3 sunT = texture(uATransmittance, pwaLutUv(p, sunDir)).rgb;
        vec3 ins = (r * pr + m * pm) * sunT;
        lum += trans * (ins - ins * st) / e;
        trans *= st;
      }
      if (ground > 0.0) {
        vec3 hit = normalize(pos + ground * dir) * PWA_RG;
        if (dot(pos, sunDir) > 0.0) {
          lum += trans * uAGroundAlbedo * texture(uATransmittance, pwaLutUv(hit, sunDir)).rgb;
        }
      }
      fms += factor * inv;
      lumTotal += lum * inv;
    }
  }
  fragColor = vec4(lumTotal / (1.0 - fms), 1.0);
}
`;

/** Sky-view LUT helpers: latitude is stretched around the horizon. */
export const SKYVIEW_GLSL = /* glsl */ `
uniform sampler2D uASkyView;
uniform float uACamHeight; // km from the planet centre
uniform vec3 uASunDir;

// Sky radiance per unit sun irradiance for a world-space direction.
vec3 pwaSkyView(vec3 rayDir) {
  float h = uACamHeight;
  float horizon = pwaSafeAcos(sqrt(max(h * h - PWA_RG * PWA_RG, 0.0)) / h);
  float altitude = horizon - acos(clamp(rayDir.y, -1.0, 1.0));
  float azimuth = 0.0;
  if (abs(altitude) < 0.5 * PWA_PI - 1e-4) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 right = cross(uASunDir, up);
    float rl = length(right);
    right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);
    vec3 forward = cross(up, right);
    vec3 flat_ = normalize(rayDir - up * rayDir.y);
    azimuth = atan(dot(flat_, right), dot(flat_, forward)) + PWA_PI;
  }
  float v = 0.5 + 0.5 * sign(altitude) * sqrt(abs(altitude) * 2.0 / PWA_PI);
  return texture(uASkyView, vec2(azimuth / (2.0 * PWA_PI), v)).rgb;
}
`;

export const SKYVIEW_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
uniform sampler2D uATransmittance;
uniform sampler2D uAMultiScatter;
uniform float uACamHeight;
uniform vec3 uASunDir;
uniform float uASteps;
in vec2 vUv;
out vec4 fragColor;

void main() {
  float azimuth = (vUv.x - 0.5) * 2.0 * PWA_PI;
  float coord = abs(2.0 * vUv.y - 1.0);
  float adjV = sign(vUv.y - 0.5) * coord * coord;

  vec3 pos = vec3(0.0, uACamHeight, 0.0);
  float horizon = pwaSafeAcos(sqrt(max(uACamHeight * uACamHeight - PWA_RG * PWA_RG, 0.0)) / uACamHeight) - 0.5 * PWA_PI;
  float altitude = adjV * 0.5 * PWA_PI - horizon;
  float ca = cos(altitude);
  vec3 dir = vec3(ca * sin(azimuth), sin(altitude), -ca * cos(azimuth));

  float sunAlt = 0.5 * PWA_PI - pwaSafeAcos(uASunDir.y);
  vec3 sunDir = vec3(0.0, sin(sunAlt), -cos(sunAlt));

  float atmo = pwaRaySphere(pos, dir, PWA_RT);
  float ground = pwaRaySphere(pos, dir, PWA_RG);
  float tMax = ground < 0.0 ? atmo : ground;

  float c = dot(dir, sunDir);
  float pm = pwaMiePhase(c);
  float pr = pwaRayleighPhase(-c);
  vec3 lum = vec3(0.0), trans = vec3(1.0);
  float t = 0.0;
  for (float i = 0.0; i < 48.0; i += 1.0) {
    if (i >= uASteps) break;
    float newT = (i + 0.3) / uASteps * tMax;
    float dt = newT - t;
    t = newT;
    vec3 p = pos + t * dir;
    vec3 r, e; float m;
    pwaMedium(p, r, m, e);
    vec3 st = exp(-dt * e);
    vec2 uv = pwaLutUv(p, sunDir);
    vec3 sunT = texture(uATransmittance, uv).rgb;
    vec3 psi = texture(uAMultiScatter, uv).rgb;
    vec3 ins = r * (pr * sunT + psi) + m * (pm * sunT + psi);
    lum += trans * (ins - ins * st) / e;
    trans *= st;
  }
  fragColor = vec4(lum, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Cloud layer. Used by the sky pass directly (one march per pixel per frame)
// or by the cloud pass, which accumulates the march over many frames.
// Needs ATMOSPHERE_GLSL and SKYVIEW_GLSL before it.
// ---------------------------------------------------------------------------
export const CLOUDS_GLSL = /* glsl */ `
uniform sampler2D uACloudNoise;
uniform float uASunIrradiance;
uniform vec3 uASunLight;     // sun irradiance reaching the cloud layer
uniform vec3 uAAmbient;      // sky irradiance / PI at the cloud layer
uniform float uACoverage;
uniform float uACloudBase;   // km above sea level
uniform float uACloudTop;
uniform float uACloudScale;  // km per noise tile
uniform float uACloudDensity;
uniform vec2 uACloudOffset;  // wind drift, in tiles
uniform float uACloudSteps;
uniform float uACloudLightSteps;
uniform float uACloudLodBias; // negative = sharper noise (needs temporal accumulation)

// Two slices of the 2D noise blended along the vertical: a cheap 3D noise, so
// the detail changes with height instead of being extruded straight up.
float pwaNoise3(vec2 uv, float z, float lod) {
  float s0 = floor(z);
  float f = z - s0;
  f = f * f * (3.0 - 2.0 * f);
  float a = textureLod(uACloudNoise, uv + s0 * vec2(0.37, 0.61), lod).b;
  float b = textureLod(uACloudNoise, uv + (s0 + 1.0) * vec2(0.37, 0.61), lod).b;
  return mix(a, b, f);
}

// Cloud density (1/km before uACloudDensity) at a point in km, y above sea level.
// detail = false skips the fine erosion (used for the light samples).
float pwaCloudDensity(vec3 p, float lod, bool detail) {
  float t = (p.y - uACloudBase) / (uACloudTop - uACloudBase);
  if (t <= 0.0 || t >= 1.0) return 0.0;
  // The pattern leans and swirls a little with height.
  vec2 uv = p.xz / uACloudScale + uACloudOffset + vec2(0.035, -0.02) * t;
  vec4 n = textureLod(uACloudNoise, uv, lod);
  float n2 = textureLod(uACloudNoise, uv * 0.31 + vec2(0.37, 0.11) + 0.5 * uACloudOffset, lod).g;
  float base = n.r * 0.65 + n2 * 0.35;

  // A cloud is a mound, not a column: the higher up, the more the base noise
  // has to exceed the coverage threshold. Strong cells grow tall, weak ones
  // stay flat, and every cloud narrows toward a rounded top. The underside is
  // cut off flat with only slight rounding.
  float rise = 0.42 * pow(t, 1.25) * (1.25 - 0.5 * n.g);
  float under = 0.5 * (1.0 - smoothstep(0.0, 0.1, t));
  float d = base - (1.0 - uACoverage) - rise - under;
  if (d <= -0.12) return 0.0;

  // Billows: medium-scale 3D noise pushes the surface in and out.
  float billow = pwaNoise3(uv * 2.3, t * 3.0 + 1.7 * n.g, lod + 0.8);
  d += (billow - 0.55) * 0.16;
  if (d <= 0.0) return 0.0;

  if (detail) {
    // Wispy edges: fine 3D noise eats into thin parts only.
    float fine = pwaNoise3(uv * 7.9, t * 9.0, lod + 2.0);
    d -= fine * 0.3 * (1.0 - smoothstep(0.0, 0.3, d));
  }
  // Denser toward the core and slightly toward the top, like real cumulus.
  return max(d, 0.0) * (0.75 + 0.6 * t) / max(uACoverage, 0.2);
}

float pwaHG(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PWA_PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// Returns scattered light in rgb and transmittance in a.
vec4 pwaClouds(vec3 rd, float jitter, float camAlt, out float hitDist) {
  hitDist = 0.0;
  if (uACoverage <= 0.001 || uACloudSteps < 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  vec3 ro = vec3(0.0, PWA_RG + camAlt, 0.0);
  float rb = PWA_RG + uACloudBase;
  float rt = PWA_RG + uACloudTop;
  float h = length(ro);
  float t0, t1;
  if (h < rb) {
    if (pwaRaySphere(ro, rd, PWA_RG) > 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
    t0 = pwaRaySphere(ro, rd, rb);
    t1 = pwaRaySphere(ro, rd, rt);
  } else if (h > rt) {
    t0 = pwaRaySphere(ro, rd, rt);
    if (t0 < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
    float tb = pwaRaySphere(ro, rd, rb);
    // Leaving through the bottom, or through the top again on a grazing ray.
    float b = dot(ro, rd);
    t1 = tb > 0.0 ? tb : -b + sqrt(max(b * b - (dot(ro, ro) - rt * rt), 0.0));
  } else {
    t0 = 0.0;
    float tb = pwaRaySphere(ro, rd, rb);
    t1 = tb > 0.0 ? tb : pwaRaySphere(ro, rd, rt);
  }
  if (t0 < 0.0 || t1 <= t0 || t0 > 220.0) return vec4(0.0, 0.0, 0.0, 1.0);
  // A long grazing path would be badly undersampled; clouds further along it
  // are behind the first ones or lost in haze anyway.
  t1 = min(t1, t0 + 14.0);

  float steps = uACloudSteps;
  float dt = (t1 - t0) / steps;
  float c = dot(rd, uASunDir);
  // Forward peak plus a wide lobe, so clouds glow around the sun but are not black elsewhere.
  float phase = mix(pwaHG(c, 0.75), pwaHG(c, -0.15), 0.45);
  // Read the noise at a mip that matches the step length, otherwise each
  // pixel's jittered samples disagree and the cloud turns into a dither pattern.
  float lod = clamp(log2(dt * 256.0 / uACloudScale) + uACloudLodBias, 0.0, 6.0);
  vec3 sunStep = uASunDir * ((uACloudTop - uACloudBase) * 0.3);

  vec3 light = vec3(0.0);
  float trans = 1.0;
  float tSum = 0.0, wSum = 0.0;
  for (float i = 0.0; i < 48.0; i += 1.0) {
    if (i >= steps || trans < 0.02) break;
    float t = t0 + (i + jitter) * dt;
    vec3 p = ro + rd * t;
    // Curved shell to local "y above sea level" coordinates.
    vec3 q = vec3(p.x, length(p) - PWA_RG, p.z);
    float d = pwaCloudDensity(q, lod, true) * uACloudDensity;
    if (d <= 0.0) continue;

    float od = 0.0;
    for (float j = 0.0; j < 6.0; j += 1.0) {
      if (j >= uACloudLightSteps) break;
      od += pwaCloudDensity(q + sunStep * (j + 0.6), lod + 1.0, false);
    }
    od *= uACloudDensity * (uACloudTop - uACloudBase) * 0.3;
    // Beer's law with a slow second term standing in for multiple scattering.
    float sunVis = max(exp(-od), 0.7 * exp(-0.25 * od));
    float heightT = (q.y - uACloudBase) / (uACloudTop - uACloudBase);
    vec3 s = uASunLight * sunVis * phase + uAAmbient * (0.35 + 0.65 * heightT);

    float stepT = exp(-d * dt);
    light += trans * (1.0 - stepT) * s;
    tSum += trans * (1.0 - stepT) * t;
    wSum += trans * (1.0 - stepT);
    trans *= stepT;
  }
  hitDist = wSum > 0.0 ? tSum / wSum : t0;
  return vec4(light, trans);
}

// Clouds along a view ray, already faded into the haze.
// rgb is light to add, a is how much of the sky behind stays visible.
vec4 pwaCloudLayer(vec3 rd, float jitter, out float dist) {
  vec4 cloud = pwaClouds(rd, jitter, uACamHeight - PWA_RG, dist);
  if (cloud.a >= 1.0) return cloud;
  // Distant clouds sink into the same haze as everything else.
  float fade = 1.0 - exp(-dist * (0.012 + 0.004 * uAMieScale));
  vec3 sky = pwaSkyView(rd) * uASunIrradiance;
  return vec4(mix(cloud.rgb, sky * (1.0 - cloud.a), fade), cloud.a);
}

float pwaIGN(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

/**
 * Cloud pass: marches the clouds at reduced resolution with a different
 * sample offset every frame and blends the result with the previous frames,
 * reprojected for camera rotation and movement.
 */
export const CLOUD_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2D;
${ATMOSPHERE_GLSL}
${SKYVIEW_GLSL}
${CLOUDS_GLSL}
uniform sampler2D uAHistory;
uniform mat4 uAInvViewProj;   // rotation only: clip -> world direction
uniform mat4 uAPrevViewProj;  // rotation only, previous frame
uniform vec3 uACamDelta;      // camera movement since the previous frame, km
uniform float uAFrame;
uniform float uAHistoryWeight;
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec4 h = uAInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(h.xyz / h.w);

  // A new offset along the ray every frame; the history averages them out.
  float jitter = fract(pwaIGN(gl_FragCoord.xy) + uAFrame * 0.61803399);
  float dist;
  vec4 current = pwaCloudLayer(rd, jitter, dist);

  // Where was this piece of cloud on screen one frame ago?
  float weight = uAHistoryWeight;
  vec3 rel = rd * (dist > 0.0 ? dist : 300.0) + uACamDelta;
  vec4 prev = uAPrevViewProj * vec4(rel, 1.0);
  vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
  if (prev.w <= 0.0 || puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) weight = 0.0;
  fragColor = mix(current, texture(uAHistory, puv), weight);
}
`;

// ---------------------------------------------------------------------------
// Sky dome: fullscreen triangle at the far plane.
// ---------------------------------------------------------------------------
export const SKY_VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vec4 view = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = transpose(mat3(viewMatrix)) * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
${ATMOSPHERE_GLSL}
${SKYVIEW_GLSL}
${CLOUDS_GLSL}
uniform sampler2D uATransmittance;
uniform sampler2D uACloudTex;   // accumulated clouds from the cloud pass
uniform float uAUseCloudTex;
uniform vec2 uAResolution;      // drawing buffer size
uniform float uASunAngularRadius;
uniform float uASunDiskGain;
uniform float uAStars;
in vec3 vDir;

float pwaHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float pwaStars(vec3 d) {
  // Three planar projections so cells do not stretch at the poles.
  vec3 a = abs(d);
  vec2 uv = a.y > a.x && a.y > a.z ? d.xz / a.y : (a.x > a.z ? d.yz / a.x : d.xy / a.z);
  uv = uv * 110.0 + (a.y > a.x && a.y > a.z ? 0.0 : (a.x > a.z ? 37.0 : 71.0));
  vec2 cell = floor(uv);
  float h = pwaHash(cell);
  vec2 centre = cell + 0.5 + 0.35 * (vec2(pwaHash(cell + 3.1), pwaHash(cell + 7.7)) - 0.5);
  float dist = length(uv - centre);
  float star = smoothstep(0.09, 0.0, dist) * step(0.86, h);
  return star * (0.3 + 0.7 * pwaHash(cell + 11.3));
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 sky = pwaSkyView(rd) * uASunIrradiance;

  // Sun disk with limb darkening, dimmed by the atmosphere along the view ray.
  float cs = dot(rd, uASunDir);
  float ang = acos(clamp(cs, -1.0, 1.0));
  vec3 direct = vec3(0.0);
  if (ang < uASunAngularRadius * 1.2 && rd.y > -0.03) {
    vec3 sunT = texture(uATransmittance, pwaLutUv(vec3(0.0, uACamHeight, 0.0), rd)).rgb;
    float x = clamp(ang / uASunAngularRadius, 0.0, 1.0);
    float limb = pow(max(1.0 - x * x, 0.0), 0.3);
    float edge = 1.0 - smoothstep(uASunAngularRadius * 0.95, uASunAngularRadius * 1.2, ang);
    float solidAngle = PWA_PI * uASunAngularRadius * uASunAngularRadius;
    direct = sunT * (uASunIrradiance / solidAngle) * limb * edge * uASunDiskGain;
  }

  float night = 1.0 - smoothstep(-0.12, 0.02, uASunDir.y);
  // Airglow: the night sky is dark blue, not black.
  sky += vec3(0.00030, 0.00045, 0.00090) * uASunIrradiance * night * (1.0 - 0.6 * max(rd.y, 0.0));
  if (uAStars > 0.0 && night > 0.0 && rd.y > 0.0) {
    direct += vec3(0.9, 0.95, 1.0) * pwaStars(rd) * night * uAStars * smoothstep(0.0, 0.25, rd.y);
  }

  vec4 cloud;
  if (uAUseCloudTex > 0.5) {
    cloud = texture(uACloudTex, gl_FragCoord.xy / uAResolution);
  } else {
    // No accumulation (XR, or temporal clouds turned off): one march per
    // pixel, with a fixed offset pattern to hide the banding.
    float cloudDist;
    cloud = pwaCloudLayer(rd, pwaIGN(gl_FragCoord.xy), cloudDist);
  }

  gl_FragColor = vec4((sky + direct) * cloud.a + cloud.rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Aerial perspective, spliced into other materials by AtmosphereEngine.applyTo.
// ---------------------------------------------------------------------------
export const AERIAL_VERT_PARS = /* glsl */ `
out vec3 vPwaWorld;
`;

export const AERIAL_VERT = /* glsl */ `
{
  vec4 pwaP = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    pwaP = batchingMatrix * pwaP;
  #endif
  #ifdef USE_INSTANCING
    pwaP = instanceMatrix * pwaP;
  #endif
  vPwaWorld = (modelMatrix * pwaP).xyz;
}
`;

export const AERIAL_FRAG_PARS = /* glsl */ `
${ATMOSPHERE_GLSL}
${SKYVIEW_GLSL}
in vec3 vPwaWorld;
uniform float uASunIrradiance;
uniform float uASeaLevel;      // world Y of altitude 0, metres
uniform float uAFogExtinction; // extra grey extinction per km from visibility
uniform float uAAerial;        // strength, 0 disables
uniform vec3 uAOvercast;       // rgb: horizon colour under cloud, a in uAOvercastMix
uniform float uAOvercastMix;

// Average of exp(-h / H) along a segment from height h0 to h1 (km).
float pwaMeanDensity(float h0, float h1, float H) {
  float dh = h1 - h0;
  float e0 = exp(-max(h0, 0.0) / H);
  if (abs(dh) < 1e-3) return e0;
  return clamp(H * (e0 - exp(-max(h1, 0.0) / H)) / dh, 0.0, 1.0);
}

vec3 pwaAerial(vec3 color) {
  vec3 v = vPwaWorld - cameraPosition;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-4);
  float km = dist * 0.001;
  float h0 = (cameraPosition.y - uASeaLevel) * 0.001;
  float h1 = (vPwaWorld.y - uASeaLevel) * 0.001;
  float mR = pwaMeanDensity(h0, h1, 8.0);
  float mM = pwaMeanDensity(h0, h1, 1.2);
  vec3 tau = PWA_RAYLEIGH * (uARayleighScale * mR * km)
           + vec3((PWA_MIE_SCATTER + PWA_MIE_ABSORB) * uAMieScale + uAFogExtinction) * (mM * km);
  vec3 T = exp(-tau * uAAerial);
  // What an endless path in this direction would look like: the sky just
  // above the horizon. Haze therefore blends exactly into the sky.
  // The sample keeps the view ray's angle to the sun (that is what the haze
  // glow depends on) rather than its compass bearing, or looking down toward
  // a low sun would paint a bright column on the ground.
  vec2 sunH = uASunDir.xz;
  float sunHLen = length(sunH);
  vec2 dirH = dir.xz;
  float dirHLen = length(dirH);
  vec2 flatDir = dirHLen > 1e-4 ? dirH / dirHLen : vec2(1.0, 0.0);
  if (sunHLen > 1e-3 && dirHLen > 1e-4) {
    sunH /= sunHLen;
    float ca = clamp(dot(dir, uASunDir) / sunHLen, -1.0, 1.0);
    float sa = sqrt(1.0 - ca * ca) * (sunH.x * dirH.y - sunH.y * dirH.x < 0.0 ? -1.0 : 1.0);
    flatDir = vec2(sunH.x * ca - sunH.y * sa, sunH.y * ca + sunH.x * sa);
  }
  vec3 skyDir = normalize(vec3(flatDir.x, max(dir.y, 0.0) + 0.015, flatDir.y));
  vec3 inscatter = mix(pwaSkyView(skyDir) * uASunIrradiance, uAOvercast, uAOvercastMix);
  return color * T + inscatter * (1.0 - T);
}
`;

export const AERIAL_FRAG = /* glsl */ `
gl_FragColor.rgb = pwaAerial(gl_FragColor.rgb);
`;
