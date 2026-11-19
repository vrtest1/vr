/**
 * PostProcessEngine GLSL. Every pass is one full-screen triangle.
 *
 *   scene (linear, HDR) -> bloom chain -> COMPOSITE (water lens, bloom,
 *   exposure, tone mapping, grading, vignette; writes display-encoded colour)
 *   -> EASU (upscale) -> RCAS (sharpen) -> screen, dithered in the last pass.
 */

export const POST_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DITHER_GLSL = /* glsl */ `
uniform float uPDither;
// Noise of about one display step, so a smooth gradient breaks up into grain
// instead of bands. Two samples make it triangular: no change in brightness.
vec3 pwpDither(vec3 c) {
  if (uPDither <= 0.0) return c;
  vec2 p = gl_FragCoord.xy;
  float a = fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  float b = fract(52.9829189 * fract(dot(p + 31.7, vec2(0.00583715, 0.06711056))));
  return c + (a + b - 1.0) * uPDither / 255.0;
}
`;

// ---------------------------------------------------------------------------
// Bloom: what is brighter than the screen can show spills over its
// surroundings. The bright parts are halved in size again and again, then
// added back together on the way up, which is a wide blur for little work.
// ---------------------------------------------------------------------------

/** Scene -> half size, keeping only what is brighter than the threshold. */
export const BLOOM_PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uPTexel;      // one texel of the input
uniform vec3 uPBloom;      // x: threshold, y: knee, z: exposure
in vec2 vUv;

vec3 pwpBright(vec2 uv, out float w) {
  // Clamped: one pixel of the sun's disc must not flood the whole chain.
  vec3 c = min(texture(tInput, uv).rgb * uPBloom.z, vec3(24.0));
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - uPBloom.x + uPBloom.y, 0.0, 2.0 * uPBloom.y);
  soft = soft * soft / (4.0 * uPBloom.y + 1e-4);
  c *= max(soft, b - uPBloom.x) / max(b, 1e-4);
  // Weighted toward the darker samples, which keeps single hot pixels from flickering.
  w = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
  return c * w;
}

void main() {
  float w0, w1, w2, w3;
  vec3 c = pwpBright(vUv + uPTexel * vec2(-1.0, -1.0), w0) + pwpBright(vUv + uPTexel * vec2(1.0, -1.0), w1)
         + pwpBright(vUv + uPTexel * vec2(-1.0, 1.0), w2) + pwpBright(vUv + uPTexel * vec2(1.0, 1.0), w3);
  gl_FragColor = vec4(c / (w0 + w1 + w2 + w3), 1.0);
}
`;

export const BLOOM_DOWN_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uPTexel;
in vec2 vUv;
void main() {
  vec3 c = texture(tInput, vUv).rgb * 4.0;
  c += texture(tInput, vUv + uPTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tInput, vUv + uPTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tInput, vUv + uPTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tInput, vUv + uPTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

/** Blur the smaller level up and add the level of this size to it. */
export const BLOOM_UP_FRAG = /* glsl */ `
uniform sampler2D tInput;  // the smaller level
uniform sampler2D tAdd;    // the level of the size being written
uniform vec2 uPTexel;      // one texel of the smaller level, times the radius
in vec2 vUv;
void main() {
  vec3 c = texture(tInput, vUv + uPTexel * vec2(-2.0, 0.0)).rgb + texture(tInput, vUv + uPTexel * vec2(2.0, 0.0)).rgb
         + texture(tInput, vUv + uPTexel * vec2(0.0, -2.0)).rgb + texture(tInput, vUv + uPTexel * vec2(0.0, 2.0)).rgb;
  c += 2.0 * (texture(tInput, vUv + uPTexel * vec2(-1.0, -1.0)).rgb + texture(tInput, vUv + uPTexel * vec2(1.0, -1.0)).rgb
            + texture(tInput, vUv + uPTexel * vec2(-1.0, 1.0)).rgb + texture(tInput, vUv + uPTexel * vec2(1.0, 1.0)).rgb);
  gl_FragColor = vec4(c / 12.0 + texture(tAdd, vUv).rgb, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Composite: everything that happens to the picture as a whole.
// ---------------------------------------------------------------------------
export const COMPOSITE_FRAG = /* glsl */ `
// three's own tone mapping curves, so the picture matches what the renderer
// would have shown without this engine.
#include <tonemapping_pars_fragment>
${DITHER_GLSL}
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uPBloomMix;     // 0 = no bloom
uniform int uPToneMap;        // 0 linear, 1 reinhard, 2 cineon, 3 aces, 4 agx, 5 neutral
uniform vec3 uPBalance;       // white balance, a gain per channel
uniform vec2 uPGrade;         // x: contrast, y: saturation
uniform vec3 uPVignette;      // x: strength, y: where it starts (0 centre, 1 corner), z: width / height
uniform float uPTime;
// Water on the lens.
uniform vec3 uPHorizon;       // height of a view ray over the horizon = dot(vec3(ndc, 1), this)
uniform float uPWaterLine;    // rays below this height look through water
uniform float uPWaterTint;    // 1 while the camera is still above the surface
uniform vec3 uPWaterColor;    // colour of the water, scene units
uniform float uPDistortion;
in vec2 vUv;

vec3 pwpToneMap(vec3 c) {
  if (uPToneMap == 3) return ACESFilmicToneMapping(c);
  if (uPToneMap == 4) return AgXToneMapping(c);
  if (uPToneMap == 5) return NeutralToneMapping(c);
  if (uPToneMap == 1) return ReinhardToneMapping(c);
  if (uPToneMap == 2) return CineonToneMapping(c);
  return LinearToneMapping(c);
}

vec3 pwpEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;

  // How far under the waterline this pixel is. The line lies along the
  // horizon and ripples a little.
  float wet = 0.0, edge = 0.0;
  if (uPWaterLine > -1e3) {
    float h = dot(vec3(vUv * 2.0 - 1.0, 1.0), uPHorizon);
    h += 0.012 * sin(vUv.x * 23.0 + uPTime * 2.1) + 0.007 * sin(vUv.x * 61.0 - uPTime * 3.4);
    wet = smoothstep(0.012, -0.012, h - uPWaterLine);
    edge = uPWaterTint * exp(-pow((h - uPWaterLine) / 0.03, 2.0));
  }

  // Water bends what is seen through it: the picture sways.
  if (wet > 0.0 && uPDistortion > 0.0) {
    float t = uPTime;
    vec2 sway = vec2(
      sin(uv.y * 17.0 + t * 1.3) + 0.5 * sin(uv.y * 41.0 - t * 2.1 + uv.x * 9.0),
      cos(uv.x * 13.0 + t * 1.1) + 0.5 * sin(uv.x * 37.0 + t * 1.7 + uv.y * 11.0));
    // No sway at the edge of the picture, where there is nothing to pull in.
    vec2 inset = min(uv, 1.0 - uv);
    float keep = smoothstep(0.0, 0.06, min(inset.x, inset.y));
    uv += sway * (0.0035 * uPDistortion * wet * keep);
    uv.y += 0.02 * edge * keep;
  }

  vec3 color = texture(tScene, uv).rgb;
  if (uPBloomMix > 0.0) color += texture(tBloom, uv).rgb * uPBloomMix;

  // The scene is drawn either all above or all below the surface. In the
  // moments before the camera goes under, the part of the picture that is
  // already below the waterline is given the colour of the water here.
  // Once the camera is under, the scene has its own water and this is off.
  if (uPWaterTint > 0.0 && wet > 0.0) {
    vec3 under = mix(color * vec3(0.45, 0.8, 0.9), uPWaterColor, 0.72);
    color = mix(color, under, wet * uPWaterTint);
  }
  color *= 1.0 - 0.3 * edge;

  color *= uPBalance;
  color = pwpEncode(pwpToneMap(color));

  // Contrast and saturation on the encoded picture, where equal steps look equal.
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, uPGrade.y);
  color = (color - 0.5) * uPGrade.x + 0.5;

  if (uPVignette.x > 0.0) {
    vec2 d = (vUv - 0.5) * 2.0 * vec2(min(uPVignette.z, 1.0), min(1.0 / uPVignette.z, 1.0)) ;
    color *= 1.0 - uPVignette.x * smoothstep(uPVignette.y, 1.42, length(d));
  }

  gl_FragColor = vec4(pwpDither(clamp(color, 0.0, 1.0)), 1.0);
}
`;

// ---------------------------------------------------------------------------
// Upscaling, after AMD FidelityFX Super Resolution 1 (MIT licence): EASU
// stretches the picture along its edges instead of across them, RCAS
// sharpens. Written out from the published algorithm for WebGL2.
// ---------------------------------------------------------------------------
export const EASU_FRAG = /* glsl */ `
${DITHER_GLSL}
uniform sampler2D tInput;
uniform vec2 uPInputSize;   // pixels
uniform vec2 uPOutputSize;  // pixels
in vec2 vUv;

vec3 pwpTap(ivec2 p) {
  return texelFetch(tInput, clamp(p, ivec2(0), ivec2(uPInputSize) - 1), 0).rgb;
}
float pwpLuma(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }

// Direction and sharpness of the edge at one of the four middle pixels.
void pwpEdge(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
  float dc = lD - lC, cb = lC - lB;
  float dirX = lD - lB;
  float lenX = clamp(abs(dirX) / max(max(abs(dc), abs(cb)), 1e-5), 0.0, 1.0);
  dir.x += dirX * w;
  len += lenX * lenX * w;
  float ec = lE - lC, ca = lC - lA;
  float dirY = lE - lA;
  float lenY = clamp(abs(dirY) / max(max(abs(ec), abs(ca)), 1e-5), 0.0, 1.0);
  dir.y += dirY * w;
  len += lenY * lenY * w;
}

// One of the twelve samples, weighted by a kernel turned along the edge.
void pwpAdd(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x) * len;
  float d2 = min(dot(v, v), clp);
  float wB = 0.4 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 1.5625 * wB - 0.5625;
  float w = wB * wA;
  aC += c * w;
  aW += w;
}

void main() {
  // Position in the input, in texels, and the texel at its lower left.
  vec2 pp = gl_FragCoord.xy * (uPInputSize / uPOutputSize) - 0.5;
  vec2 fp = floor(pp);
  pp -= fp;
  ivec2 ip = ivec2(fp);
  //    b c
  //  e f g h
  //  i j k l
  //    n o
  vec3 b = pwpTap(ip + ivec2(0, -1)), c = pwpTap(ip + ivec2(1, -1));
  vec3 e = pwpTap(ip + ivec2(-1, 0)), f = pwpTap(ip), g = pwpTap(ip + ivec2(1, 0)), h = pwpTap(ip + ivec2(2, 0));
  vec3 i = pwpTap(ip + ivec2(-1, 1)), j = pwpTap(ip + ivec2(0, 1)), k = pwpTap(ip + ivec2(1, 1)), l = pwpTap(ip + ivec2(2, 1));
  vec3 n = pwpTap(ip + ivec2(0, 2)), o = pwpTap(ip + ivec2(1, 2));
  float bL = pwpLuma(b), cL = pwpLuma(c), eL = pwpLuma(e), fL = pwpLuma(f), gL = pwpLuma(g), hL = pwpLuma(h);
  float iL = pwpLuma(i), jL = pwpLuma(j), kL = pwpLuma(k), lL = pwpLuma(l), nL = pwpLuma(n), oL = pwpLuma(o);

  vec2 dir = vec2(0.0);
  float len = 0.0;
  pwpEdge(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  pwpEdge(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  pwpEdge(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  pwpEdge(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);

  float dirR = dot(dir, dir);
  bool zero = dirR < 1.0 / 32768.0;
  dir = zero ? vec2(1.0, 0.0) : dir * inversesqrt(dirR);
  len = len * 0.5;
  len *= len;
  // Stretch the kernel along the edge, squeeze it across.
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 - 0.29 * len;
  float clp = 1.0 / lob;

  vec3 aC = vec3(0.0);
  float aW = 0.0;
  pwpAdd(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b);
  pwpAdd(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
  pwpAdd(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
  pwpAdd(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
  pwpAdd(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f);
  pwpAdd(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
  pwpAdd(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k);
  pwpAdd(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
  pwpAdd(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h);
  pwpAdd(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
  pwpAdd(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o);
  pwpAdd(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);

  // Never brighter or darker than the four pixels around the position: no ringing.
  vec3 lo = min(min(f, g), min(j, k)), hi = max(max(f, g), max(j, k));
  gl_FragColor = vec4(pwpDither(clamp(aC / aW, lo, hi)), 1.0);
}
`;

export const RCAS_FRAG = /* glsl */ `
${DITHER_GLSL}
uniform sampler2D tInput;
uniform vec2 uPOutputSize;  // pixels
uniform float uPSharpness;  // 0 = pass through, 1 = strongest
in vec2 vUv;

float pwpLuma(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }

void main() {
  vec3 e = texture(tInput, vUv).rgb;
  if (uPSharpness <= 0.0) {
    gl_FragColor = vec4(pwpDither(e), 1.0);
    return;
  }
  vec2 px = 1.0 / uPOutputSize;
  vec3 b = texture(tInput, vUv + vec2(0.0, -px.y)).rgb;
  vec3 d = texture(tInput, vUv + vec2(-px.x, 0.0)).rgb;
  vec3 f = texture(tInput, vUv + vec2(px.x, 0.0)).rgb;
  vec3 h = texture(tInput, vUv + vec2(0.0, px.y)).rgb;

  // As much sharpening as fits without pushing any channel past black or white.
  vec3 mn = min(min(b, d), min(f, h)), mx = max(max(b, d), max(f, h));
  vec3 hitMin = min(mn, e) / max(4.0 * mx, 1e-5);
  vec3 hitMax = (1.0 - max(mx, e)) / min(4.0 * mn - 4.0, -1e-5);
  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uPSharpness;

  // Less of it where the pixel looks like noise rather than an edge.
  float bL = pwpLuma(b), dL = pwpLuma(d), eL = pwpLuma(e), fL = pwpLuma(f), hL = pwpLuma(h);
  float nz = 0.25 * (bL + dL + fL + hL) - eL;
  float range = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
  nz = 1.0 - 0.5 * clamp(abs(nz) / max(range, 1e-5), 0.0, 1.0);
  lobe *= nz;

  vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  gl_FragColor = vec4(pwpDither(clamp(c, 0.0, 1.0)), 1.0);
}
`;
