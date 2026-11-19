/**
 * Shared GLSL noise (GLSL ES 3.00 / WebGL2).
 *
 * The hash uses only 32-bit integer operations, so src/core/noise.js can
 * reproduce it bit for bit on the CPU. Keep the two files in sync.
 */
export const NOISE_GLSL = /* glsl */ `
#ifndef PWE_NOISE
#define PWE_NOISE

uint pwHash(ivec2 c, uint seed) {
  uint h = uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ seed * 0xcb1ab31fu;
  h = h * 747796405u + 2891336453u;
  uint w = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (w >> 22u) ^ w;
}

vec2 pwGrad(ivec2 c, uint seed) {
  float a = float(pwHash(c, seed) >> 8u) * (6.283185307179586 / 16777216.0);
  return vec2(cos(a), sin(a));
}

// Gradient noise with analytic derivatives.
// Returns (value, d/dx, d/dy); value is roughly in [-0.7, 0.7].
vec3 pwNoised(vec2 p, uint seed) {
  vec2 fl = floor(p);
  ivec2 i = ivec2(fl);
  vec2 f = p - fl;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = pwGrad(i, seed);
  vec2 gb = pwGrad(i + ivec2(1, 0), seed);
  vec2 gc = pwGrad(i + ivec2(0, 1), seed);
  vec2 gd = pwGrad(i + ivec2(1, 1), seed);
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 deriv = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
             + du * (u.yx * k + vec2(vb, vc) - va);
  return vec3(value, deriv);
}

// Value only (cheaper to read where derivatives are not needed).
float pwNoise(vec2 p, uint seed) {
  return pwNoised(p, seed).x;
}

// Same noise, also returning the Hessian as (dxx, dxy, dyy).
void pwNoiseH(vec2 p, uint seed, out float value, out vec2 grad, out vec3 hess) {
  vec2 fl = floor(p);
  ivec2 i = ivec2(fl);
  vec2 f = p - fl;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ddu = 60.0 * f * (f - 1.0) * (2.0 * f - 1.0);
  vec2 ga = pwGrad(i, seed);
  vec2 gb = pwGrad(i + ivec2(1, 0), seed);
  vec2 gc = pwGrad(i + ivec2(0, 1), seed);
  vec2 gd = pwGrad(i + ivec2(1, 1), seed);
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  vec2 A = gb - ga;
  vec2 B = gc - ga;
  vec2 C = ga - gb - gc + gd;
  value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  grad = ga + u.x * A + u.y * B + u.x * u.y * C + du * (u.yx * k + vec2(vb, vc) - va);
  hess = vec3(
    2.0 * du.x * (A.x + u.y * C.x) + ddu.x * (u.y * k + vb - va),
    du.y * B.x + u.x * du.y * C.x + du.x * (du.y * k + u.y * C.y + A.y),
    2.0 * du.y * (B.y + u.x * C.y) + ddu.y * (u.x * k + vc - va)
  );
}

#endif
`;
