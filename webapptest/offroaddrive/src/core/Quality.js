/**
 * Quality presets shared by every engine.
 *
 * Each engine declares `static qualityPresets = { ultra, high, medium, low }`
 * and reads its own table; this file only owns the names, device detection and
 * the renderer-level settings (pixel ratio, shadow map, XR framebuffer).
 */

export const QualityPreset = Object.freeze({
  ULTRA: 'ultra',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

/** Lowest to highest. */
export const QUALITY_ORDER = Object.freeze(['low', 'medium', 'high', 'ultra']);

export function normalizeQuality(preset) {
  const q = String(preset).toLowerCase();
  if (!QUALITY_ORDER.includes(q)) {
    throw new Error(`Unknown quality preset "${preset}" (expected ${QUALITY_ORDER.join(' / ')})`);
  }
  return q;
}

/** Renderer-level settings per preset. Engines do not touch the renderer themselves. */
export const RENDER_PRESETS = Object.freeze({
  ultra: { pixelRatioMax: 2.0, shadows: true, shadowMapSize: 4096, xrFramebufferScale: 1.2, xrFoveation: 0.0 },
  high: { pixelRatioMax: 1.5, shadows: true, shadowMapSize: 2048, xrFramebufferScale: 1.0, xrFoveation: 0.5 },
  medium: { pixelRatioMax: 1.25, shadows: true, shadowMapSize: 1024, xrFramebufferScale: 0.9, xrFoveation: 1.0 },
  low: { pixelRatioMax: 1.0, shadows: false, shadowMapSize: 512, xrFramebufferScale: 0.75, xrFoveation: 1.0 },
});

/**
 * Classify the device. Pure UA / capability sniffing, no benchmarking.
 * @returns {{ kind: 'quest'|'ios'|'android'|'desktop', integratedGpu: boolean, gpu: string }}
 */
export function detectDevice(renderer) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const touchMac = /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  let kind = 'desktop';
  if (/OculusBrowser|Quest/i.test(ua)) kind = 'quest';
  else if (/iPhone|iPad|iPod/i.test(ua) || touchMac) kind = 'ios';
  else if (/Android/i.test(ua)) kind = 'android';

  let gpu = '';
  try {
    const gl = renderer?.getContext?.();
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    // Blocked by the browser: leave gpu empty.
  }
  const integratedGpu = /Intel|UHD|Iris|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpu) && !/Arc/i.test(gpu);
  return { kind, integratedGpu, gpu };
}

/**
 * Pick a starting preset for this device. Never returns 'ultra': that is an
 * explicit choice.
 */
export function detectQuality(renderer) {
  const { kind, integratedGpu } = detectDevice(renderer);
  if (kind === 'quest') return 'medium';
  if (kind === 'ios') return 'medium';
  if (kind === 'android') return 'low';
  return integratedGpu ? 'medium' : 'high';
}

/**
 * Apply the renderer-level part of a preset. Call it again after the preset
 * changes. XR settings only take effect before the session starts.
 */
export function applyRendererQuality(renderer, preset) {
  const p = RENDER_PRESETS[normalizeQuality(preset)];
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  renderer.setPixelRatio(Math.min(dpr, p.pixelRatioMax));
  renderer.shadowMap.enabled = p.shadows;
  if (renderer.xr && !renderer.xr.isPresenting) {
    renderer.xr.setFramebufferScaleFactor(p.xrFramebufferScale);
    renderer.xr.setFoveation?.(p.xrFoveation);
  }
  return p;
}
