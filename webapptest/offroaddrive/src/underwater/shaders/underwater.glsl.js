/**
 * UnderwaterEngine GLSL: light loss with depth, caustics, distance fog in the
 * colour of the water and light shafts. Spliced into other materials by
 * UnderwaterEngine.applyTo(), and used by the engine's own backdrop.
 */

export const UNDERWATER_GLSL = /* glsl */ `
uniform float uULevel;       // world Y of the water surface
uniform vec3 uUExtinction;   // per metre, rgb (red is lost first)
uniform vec3 uUScatter;      // colour of the water lit from above, at the surface
uniform vec3 uUSunDir;
uniform float uUSun;         // 0..1, how much direct sun there is
uniform float uUTime;
uniform float uUCaustics;
uniform float uUCausticScale;
uniform float uURays;
uniform float uURaySteps;
uniform float uUStrength;    // 0 turns everything off

// Animated caustic pattern (after Dave Hoskins' tileable water caustic).
float pwuPattern(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318530718, 6.28318530718) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c = 1.17 - pow(c / 4.0, 1.4);
  return pow(abs(c), 8.0);
}

// Caustic brightness at a point under water: the pattern lives on the
// surface and is projected down along the sun's rays.
float pwuCaustic(vec3 p) {
  float down = uULevel - p.y;
  vec2 uv = (p.xz + uUSunDir.xz / max(uUSunDir.y, 0.25) * down) / uUCausticScale;
  // Two scales moving against each other; sharp near the surface, soft deeper.
  float a = pwuPattern(uv, uUTime * 0.55);
  float b = pwuPattern(uv * 0.37 + 0.31, uUTime * 0.4 + 1.7);
  return mix(a * 0.75 + b * 0.5, 0.35, clamp(down * 0.02, 0.0, 0.85));
}

// Water between the camera and a surface point, and the surface point's own
// loss of sunlight. Returns the colour as seen through the water.
vec3 pwuApply(vec3 color, vec3 worldPos, vec3 camPos, vec3 geoNormal, float jitter) {
  if (uUStrength <= 0.0) return color;
  float camDepth = uULevel - camPos.y;
  float ptDepth = uULevel - worldPos.y;
  #ifdef PWU_SURFACE
    // The water surface itself: its troughs dip below the mean level, but it
    // is not "under water". It only gets the fog, and only seen from below.
    if (camDepth <= 0.0) return color;
    ptDepth = min(ptDepth, 0.0);
  #endif
  if (camDepth <= 0.0 && ptDepth <= 0.0) return color;

  vec3 v = worldPos - camPos;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-4);

  // Length of the part of the view ray that is under water.
  float wet = dist;
  if (camDepth > 0.0 && ptDepth < 0.0) wet = dist * camDepth / max(camDepth - ptDepth, 1e-3);
  else if (camDepth <= 0.0) wet = dist * ptDepth / max(ptDepth - camDepth, 1e-3);

  if (ptDepth > 0.0) {
    // Sunlight has already travelled down to this point.
    color *= exp(-uUExtinction * ptDepth * 0.5 * uUStrength);
    float facing = clamp(geoNormal.y * 1.4 + 0.2, 0.0, 1.0);
    color *= 1.0 + 1.8 * uUCaustics * uUSun * facing * (pwuCaustic(worldPos) - 0.35) * exp(-ptDepth * 0.05);
  }

  vec3 T = exp(-uUExtinction * wet * uUStrength);

  // Light scattered into the view ray. It dims with depth and brightens
  // toward the surface and toward the sun.
  // It depends on the camera depth and the view direction only, so the water
  // colour is continuous across whatever the ray happens to end on.
  float refDepth = camDepth > 0.0 ? camDepth : 0.5 * ptDepth;
  vec3 scatter = uUScatter * exp(-uUExtinction * refDepth * 0.6) * (0.75 + 0.35 * dir.y);
  scatter *= 1.0 + 0.6 * uUSun * pow(max(dot(dir, uUSunDir), 0.0), 4.0);

  // Light shafts: where the caustic pattern is bright, more light is
  // scattered. Only worth doing when looking from inside the water.
  if (uURays > 0.0 && uURaySteps >= 1.0 && camDepth > 0.0 && uUSun > 0.0) {
    float reach = min(wet, 45.0);
    float acc = 0.0, wsum = 0.0;
    for (float i = 0.0; i < 16.0; i += 1.0) {
      if (i >= uURaySteps) break;
      float t = (i + jitter) / uURaySteps * reach;
      vec3 p = camPos + dir * t;
      float d = uULevel - p.y;
      if (d <= 0.0) break;
      float w = exp(-t * 0.06) * exp(-d * 0.05);
      // Square root: softer shafts, and far less grain from the few samples.
      acc += sqrt(pwuPattern((p.xz + uUSunDir.xz / max(uUSunDir.y, 0.25) * d) / (uUCausticScale * 2.6), uUTime * 0.35)) * w;
      wsum += w;
    }
    // Fades in with the length of water looked through, so short and long
    // rays next to each other do not differ in brightness.
    if (wsum > 0.0) scatter *= 1.0 + uURays * uUSun * (acc / wsum - 0.3) * 1.8 * smoothstep(0.0, 25.0, wet);
  }

  return color * T + max(scatter, 0.0) * (1.0 - T);
}
`;

export const UNDERWATER_VERT_PARS = /* glsl */ `
out vec3 vPwuWorld;
`;

export const UNDERWATER_VERT = /* glsl */ `
{
  vec4 pwuP = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    pwuP = batchingMatrix * pwuP;
  #endif
  #ifdef USE_INSTANCING
    pwuP = instanceMatrix * pwuP;
  #endif
  vPwuWorld = (modelMatrix * pwuP).xyz;
}
`;

export const UNDERWATER_FRAG_PARS = /* glsl */ `
in vec3 vPwuWorld;
${UNDERWATER_GLSL}
`;

export const UNDERWATER_FRAG = /* glsl */ `
{
  vec3 pwuN = normalize(cross(dFdx(vPwuWorld), dFdy(vPwuWorld)));
  if (dot(pwuN, cameraPosition - vPwuWorld) < 0.0) pwuN = -pwuN;
  float pwuJ = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor.rgb = pwuApply(gl_FragColor.rgb, vPwuWorld, cameraPosition, pwuN, pwuJ);
}
`;

/** Backdrop: what you see where there is nothing but water. */
export const BACKDROP_VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vec4 view = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = transpose(mat3(viewMatrix)) * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const BACKDROP_FRAG = /* glsl */ `
${UNDERWATER_GLSL}
in vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  // A point far away along the view ray, clamped below the surface: the fog
  // function then returns pure water colour with the right depth and shafts.
  float camDepth = uULevel - cameraPosition.y;
  float far = 400.0;
  if (dir.y > 1e-3) far = min(far, camDepth / dir.y);
  vec3 p = cameraPosition + dir * far;
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(pwuApply(vec3(0.0), p, cameraPosition, vec3(0.0, 1.0, 0.0), j), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
