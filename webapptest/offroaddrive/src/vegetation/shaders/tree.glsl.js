/**
 * VegetationEngine trees.
 *
 * Near and middle-distance trees are real meshes drawn with a patched
 * MeshLambertMaterial; far trees are billboards drawn from an atlas that is
 * baked from the same meshes. All three place their instances from the same
 * two attributes and hand over to each other with a dither pattern:
 *
 *   aVA   x, y, z of the base, then yaw (meshes) or model index (billboards)
 *   aVB   scale across, scale up, time of birth, a random number 0..1
 *
 * A pixel with dither value n is drawn by
 *   the near mesh    while n <  1 - s0
 *   the middle mesh  while 1 - s0 <= n < 1 - s1
 *   the billboard    while n >= 1 - s1
 * where s0 and s1 rise from 0 to 1 over the two hand-over distances, so
 * exactly one of them covers each pixel.
 */

const SHARED = /* glsl */ `
float pwvDither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
// A second pattern, unrelated to the first. (Stretching the first one with
// fract(n * k) does not give that: it comes out as stripes.)
float pwvDither2(vec2 p) {
  return fract(52.9829189 * fract(dot(p.yx + vec2(47.0, 113.0), vec2(0.06711056, 0.00583715))));
}
// Every tree has a slightly different colour.
vec3 pwvTint(float r) {
  float a = fract(r * 7.31), b = fract(r * 23.7);
  return vec3(0.86 + 0.26 * a, 0.9 + 0.16 * b, 0.82 + 0.2 * a) * (0.88 + 0.24 * b);
}
// How far the trunk is pushed over by the wind at height h, like a bending rod.
float pwvSway(float h, float phase, float time) {
  return h * h * 0.0016 * (0.6 + 0.4 * sin(time * 1.1 + phase) + 0.25 * sin(time * 2.7 + phase * 1.7));
}
`;

/**
 * With a logarithmic depth buffer three.js writes the depth of every pixel
 * from the fragment shader, which stops the GPU from skipping hidden pixels
 * early. A forest is layer upon layer of leaves, so that is costly. Trees are
 * made of small triangles, for which the same depth can be set per vertex
 * instead (it is only inexact across triangles that are large on screen).
 */
export const TREE_LOGDEPTH_PARS = /* glsl */ `
#ifdef USE_LOGDEPTHBUF
  uniform float logDepthBufFC;
#endif
`;
export const TREE_LOGDEPTH = /* glsl */ `
#ifdef USE_LOGDEPTHBUF
  if (isPerspectiveMatrix(projectionMatrix)) {
    gl_Position.z = (log2(max(1e-6, 1.0 + gl_Position.w)) * logDepthBufFC - 1.0) * gl_Position.w;
  }
#endif
`;

// --- meshes -----------------------------------------------------------------

export const TREE_VERT_PARS = /* glsl */ `
in vec4 aVA;
in vec4 aVB;
in vec3 aVTree;
uniform vec3 uVCam;
uniform float uVTime;
uniform float uVNow;
uniform vec2 uVWind;
uniform vec4 uVLod;
out vec4 vVFade;   // dither window (from, to), fade-in after birth, distance
out vec3 vVObj;
out vec3 vVTree;
bool pwvCast;   // does this tree cast a shadow at this level of detail
${SHARED}
${TREE_LOGDEPTH_PARS}
`;

export const TREE_NORMAL = /* glsl */ `
{
  float pwvC = cos(aVA.w), pwvS = sin(aVA.w);
  vec3 pwvN = objectNormal / vec3(aVB.x, aVB.y, aVB.x);
  objectNormal = normalize(vec3(pwvC * pwvN.x + pwvS * pwvN.z, pwvN.y, pwvC * pwvN.z - pwvS * pwvN.x));
}
`;

export const TREE_COLOR = /* glsl */ `
#ifdef USE_COLOR
  vColor.rgb *= pwvTint(aVB.w);
#endif
`;

export const TREE_VERT = /* glsl */ `
{
  vVObj = transformed;
  vVTree = aVTree;
  float pwvC = cos(aVA.w), pwvS = sin(aVA.w);
  vec3 pwvP = transformed * vec3(aVB.x, aVB.y, aVB.x);
  pwvP = vec3(pwvC * pwvP.x + pwvS * pwvP.z, pwvP.y, pwvC * pwvP.z - pwvS * pwvP.x);

  // Wind: the whole tree leans, branches bob, leaves flutter.
  float pwvPhase = aVA.x * 0.31 + aVA.z * 0.17;
  float pwvStrength = length(uVWind);
  pwvP.xz += uVWind * pwvSway(max(pwvP.y, 0.0), pwvPhase, uVTime);
  float pwvBob = sin(uVTime * 1.9 + pwvPhase + pwvP.x * 0.7 + pwvP.z * 0.9);
  pwvP.y += aVTree.y * pwvStrength * 0.12 * pwvBob;
  pwvP.xz += uVWind * (aVTree.y * 0.1 * (0.5 + 0.5 * pwvBob));
  pwvP += aVTree.x * min(pwvStrength, 1.0) * 0.035 * vec3(
    sin(uVTime * 5.3 + pwvP.y * 3.1 + pwvPhase),
    sin(uVTime * 4.1 + pwvP.z * 2.7 + pwvPhase) * 0.6,
    sin(uVTime * 4.7 + pwvP.x * 3.3 + pwvPhase));
  transformed = pwvP + aVA.xyz;

  float pwvD = distance(aVA.xyz, uVCam);
  float pwvS0 = smoothstep(uVLod.x, uVLod.y, pwvD);
  float pwvS1 = smoothstep(uVLod.z, uVLod.w, pwvD);
  #if PWV_LOD == 2
    vVFade.xy = vec2(0.0, 1.0 - pwvS0);
    pwvCast = pwvS0 <= 0.5;
  #else
    vVFade.xy = vec2(1.0 - pwvS0, 1.0 - pwvS1);
    pwvCast = pwvS0 > 0.5 && pwvS1 < 1.0;
  #endif
  vVFade.z = clamp((uVNow - aVB.z) / 1.2, 0.0, 1.0);
  vVFade.w = pwvD;
}
`;

/** After project_vertex: drop trees that are entirely another level's job. */
export const TREE_CULL = /* glsl */ `
#ifdef PWV_DEPTH
  if (!pwvCast) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#else
  if (vVFade.y <= vVFade.x || vVFade.z <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif
`;

export const TREE_FRAG_PARS = /* glsl */ `
in vec4 vVFade;
in vec3 vVObj;
in vec3 vVTree;
${SHARED}
float pwvHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
// Value noise that repeats after 'period' cells in x, for wrapping around a trunk.
float pwvBark(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, period), x1 = mod(i.x + 1.0, period);
  return mix(mix(pwvHash(vec2(x0, i.y)), pwvHash(vec2(x1, i.y)), f.x),
             mix(pwvHash(vec2(x0, i.y + 1.0)), pwvHash(vec2(x1, i.y + 1.0)), f.x), f.y);
}
`;

export const TREE_FRAG_DITHER = /* glsl */ `
{
  float pwvN = pwvDither(gl_FragCoord.xy);
  if (pwvN < vVFade.x || pwvN >= vVFade.y) discard;
  if (pwvDither2(gl_FragCoord.xy) >= vVFade.z) discard;
}
`;

/** After map_fragment: keep thin leaves from vanishing in the small mip levels, and paint the bark. */
export const TREE_FRAG_SURFACE = /* glsl */ `
#ifdef USE_MAP
{
  vec2 pwvTx = vMapUv * vec2(textureSize(map, 0));
  float pwvLod = max(0.0, 0.5 * log2(max(dot(dFdx(pwvTx), dFdx(pwvTx)), dot(dFdy(pwvTx), dFdy(pwvTx)))));
  diffuseColor.a *= 1.0 + 0.35 * pwvLod;
}
#endif
if (vVTree.x < 0.5) {
  float pwvAmp = 1.0 - smoothstep(30.0, 110.0, vVFade.w);
  float pwvA = atan(vVObj.z, vVObj.x) / 6.2831853 + 0.5;
  if (vVTree.z < 0.5) {
    // Rough bark: ridges running up the trunk.
    float pwvR = 0.65 * pwvBark(vec2(pwvA * 28.0, vVObj.y * 2.2), 28.0) + 0.35 * pwvBark(vec2(pwvA * 56.0, vVObj.y * 7.0), 56.0);
    diffuseColor.rgb *= mix(1.0, 0.5 + pwvR, pwvAmp);
  } else {
    // Birch: pale bark with dark dashes across it.
    float pwvMarks = smoothstep(0.64, 0.72, pwvBark(vec2(pwvA * 12.0, vVObj.y * 9.0), 12.0));
    float pwvFine = 0.88 + 0.24 * pwvBark(vec2(pwvA * 40.0, vVObj.y * 30.0), 40.0);
    diffuseColor.rgb *= mix(1.0, mix(1.0, 0.16, pwvMarks) * pwvFine, pwvAmp);
  }
}
`;

/** Replaces normal_fragment_begin: foliage is lit by its rounded normal from both sides. */
export const TREE_FRAG_NORMAL = /* glsl */ `
vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;
`;

/** After lights_fragment_end: leaves let some sunlight through. */
export const TREE_FRAG_LIGHT = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
if (vVTree.x > 0.5) {
  vec3 pwvL = directionalLights[0].direction;
  float pwvThrough = 0.3 * pow(max(dot(normalize(vViewPosition), -pwvL), 0.0), 3.0) + 0.25 * max(-dot(normal, pwvL), 0.0);
  reflectedLight.directDiffuse += directionalLights[0].color * diffuseColor.rgb * (RECIPROCAL_PI * pwvThrough);
}
#endif
`;

// --- billboards -------------------------------------------------------------
// 'position' holds a corner: x across (-1..1), y up (0..1), z = 0 for the
// upright card and 1 for the flat one that shows the tree from above.
// uVModel[i] = half width, bottom, top (m, before scaling) and crown height.

export const BILLBOARD_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
${SHARED}

in vec4 aVA;
in vec4 aVB;

uniform vec3 uVCam;
uniform float uVTime;
uniform float uVNow;
uniform vec2 uVWind;
uniform vec4 uVLod;
uniform vec2 uVRange;
uniform vec4 uVModel[PWV_MODELS];
${TREE_LOGDEPTH_PARS}

out vec2 vVUv;
out vec3 vVFade;   // dither threshold against the meshes, fade at the edge and after birth, view fade
out vec3 vVBx;
out vec3 vVBy;
out vec3 vVBz;
out vec3 vVWorld;
out vec3 vVTint;

void main() {
  int model = int(aVA.w + 0.5);
  vec4 M = uVModel[model];
  vec3 base = aVA.xyz;
  float flipX = aVB.w < 0.5 ? -1.0 : 1.0;
  float flipZ = fract(aVB.w * 2.0) < 0.5 ? -1.0 : 1.0;

  vec3 toCam = uVCam - (base + vec3(0.0, M.w * aVB.y, 0.0));
  float dH = length(toCam.xz);
  vec2 f = dH > 1e-3 ? toCam.xz / dH : vec2(0.0, 1.0);
  float steep = abs(toCam.y) / max(length(toCam), 1e-3);

  float s1 = smoothstep(uVLod.z, uVLod.w, distance(base, uVCam));
  // Small plants stop being worth a card long before the forest does.
  float far = min(uVRange.y, M.z * aVB.y * 260.0);
  float edge = 1.0 - smoothstep(far * 0.85, far, dH);
  float birth = clamp((uVNow - aVB.z) / 1.2, 0.0, 1.0);
  bool top = position.z > 0.5;
  // Seen from above, the upright card thins out and the flat one takes over.
  float view = top ? smoothstep(0.35, 0.6, steep) : 1.0 - smoothstep(0.82, 0.97, steep);
  // At the edge of the forest's range whole trees drop out one by one. A
  // screen pattern there would thin every tree into the same stripes.
  bool gone = fract(aVB.w * 91.7 + 0.13) >= edge;
  vVFade = vec3(1.0 - s1, birth, view);

  vec3 transformed;
  float column = float(model);
  if (!top) {
    vec3 right = vec3(f.y, 0.0, -f.x);
    vVBx = right * flipX;
    vVBy = vec3(0.0, 1.0, 0.0);
    vVBz = vec3(f.x, 0.0, f.y);
    float y = mix(M.y, M.z, position.y) * aVB.y;
    transformed = base + right * (position.x * M.x * aVB.x) + vec3(0.0, y, 0.0);
    transformed.xz += uVWind * pwvSway(max(y, 0.0), base.x * 0.31 + base.z * 0.17, uVTime);
    vVUv = vec2((column + 0.5 + 0.5 * position.x * flipX) / float(PWV_MODELS), 0.5 * position.y);
  } else {
    vVBx = vec3(flipX, 0.0, 0.0);
    vVBy = vec3(0.0, 0.0, -flipZ);
    vVBz = vec3(0.0, 1.0, 0.0);
    float py = position.y * 2.0 - 1.0;
    float y = M.w * aVB.y;
    transformed = base + vec3(position.x, 0.0, -py) * (M.x * aVB.x) + vec3(0.0, y, 0.0);
    transformed.xz += uVWind * pwvSway(max(y, 0.0), base.x * 0.31 + base.z * 0.17, uVTime);
    vVUv = vec2((column + 0.5 + 0.5 * position.x * flipX) / float(PWV_MODELS), 0.75 + 0.25 * py * flipZ);
  }
  vVWorld = transformed;
  vVTint = pwvTint(aVB.w);

  vec3 transformedNormal = mat3(viewMatrix) * vVBz;
  vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  if (s1 <= 0.0 || gone || birth <= 0.0 || view <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  ${TREE_LOGDEPTH}
  vec4 worldPosition = vec4(transformed, 1.0);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

export const BILLBOARD_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${SHARED}

uniform sampler2D uVAlbedo;
uniform sampler2D uVNormal;

in vec2 vVUv;
in vec3 vVFade;
in vec3 vVBx;
in vec3 vVBy;
in vec3 vVBz;
in vec3 vVWorld;
in vec3 vVTint;

void main() {
  float n = pwvDither(gl_FragCoord.xy);
  if (n < vVFade.x) discard;
  if (pwvDither2(gl_FragCoord.xy) >= vVFade.y) discard;
  if (pwvDither2(gl_FragCoord.yx + 29.0) >= vVFade.z) discard;

  vec4 tex = texture2D(uVAlbedo, vVUv);
  vec2 tx = vVUv * vec2(textureSize(uVAlbedo, 0));
  float lod = max(0.0, 0.5 * log2(max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)))));
  if (tex.a * (1.0 + 0.35 * lod) < 0.42) discard;

  // The atlas stores the normals as the bake camera saw them; put them back
  // into the world along the card.
  vec3 nt = texture2D(uVNormal, vVUv).xyz * 2.0 - 1.0;
  vec3 N = normalize(vVBx * nt.x + vVBy * nt.y + vVBz * nt.z);
  vec3 V = normalize(cameraPosition - vVWorld);

  // The same sums as MeshLambertMaterial, so billboards match the meshes.
  vec3 irradiance = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
    irradiance += mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, 0.5 + 0.5 * N.y);
  #endif
  vec3 albedo = tex.rgb * vVTint;
  vec3 color = albedo * RECIPROCAL_PI * irradiance;
  #if NUM_DIR_LIGHTS > 0
    vec3 L = normalize(inverseTransformDirection(directionalLights[0].direction, viewMatrix));
    float through = 0.3 * pow(max(dot(V, -L), 0.0), 3.0) + 0.25 * max(-dot(N, L), 0.0);
    color += albedo * RECIPROCAL_PI * directionalLights[0].color * (max(dot(N, L), 0.0) * getShadowMask() + through);
  #endif

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// --- baking the billboards --------------------------------------------------
// uVMode: 0 = colour, 1 = normal as the viewer sees it, 2 = backdrop (colour with zero alpha)

export const BAKE_VERT = /* glsl */ `
in vec3 color;
uniform int uVMode;
uniform vec4 uVCell;   // column, row, width and height in cells
uniform vec4 uVBox;    // half width, bottom and top of the tree (m)
uniform float uVTop;   // 1 = seen from above
out vec3 vVColor;
out vec3 vVNormal;
out vec2 vVUv;
void main() {
  vVColor = color;
  vVUv = uv;
  vVNormal = normal;
  // No camera: every tree is fitted straight into its cell of the atlas.
  vec3 p = vec3(position.xy, 0.999);
  if (uVMode != 2) {
    float h = (position.y - uVBox.y) / (uVBox.z - uVBox.y);
    if (uVTop > 0.5) {
      p = vec3(position.x / uVBox.x, -position.z / uVBox.x, 0.9 - 1.8 * h);
      vVNormal = vec3(normal.x, -normal.z, normal.y);
    } else {
      p = vec3(position.x / uVBox.x, h * 2.0 - 1.0, -0.5 * position.z / uVBox.x);
    }
  }
  vec2 cell = (uVCell.xy + (p.xy * 0.5 + 0.5) * uVCell.zw) / vec2(float(PWV_MODELS), 2.0);
  gl_Position = vec4(cell * 2.0 - 1.0, p.z, 1.0);
}
`;

export const BAKE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform int uVMode;
uniform vec3 uVColor;
in vec3 vVColor;
in vec3 vVNormal;
in vec2 vVUv;
void main() {
  if (uVMode == 2) {
    gl_FragColor = vec4(uVColor, 0.0);
    return;
  }
  vec4 tex = texture2D(map, vVUv);
  if (tex.a < 0.45) discard;
  gl_FragColor = uVMode == 0 ? vec4(vVColor * tex.rgb, 1.0) : vec4(normalize(vVNormal) * 0.5 + 0.5, 1.0);
}
`;
