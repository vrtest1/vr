/**
 * On-screen performance overlay: FPS, frame time, CPU time of the measured
 * section, GPU time (when the browser exposes timer queries), draw calls,
 * triangles, and any numbers the engines report through getStats().
 *
 *   const perf = new PerformanceMonitor(renderer);
 *   perf.addSource('terrain', () => terrain.getStats());
 *   loop: perf.begin(); world.update(dt); renderer.render(scene, camera); perf.end();
 *
 * It sets renderer.info.autoReset = false so that shadow and main passes are
 * counted together, and resets the counters itself in begin().
 * The overlay is a DOM element, so it is not visible inside an XR session;
 * read `perf.values` there instead.
 */
export class PerformanceMonitor {
  /** Latest smoothed numbers, also usable without the overlay. */
  values = { fps: 0, frameMs: 0, cpuMs: 0, gpuMs: null, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };

  #renderer;
  #gl;
  #ext;
  #queries = [];
  #activeQuery = null;
  #sources = new Map();
  #el = null;
  #lastFrame = 0;
  #cpuStart = 0;
  #frames = 0;
  #accTime = 0;
  #accCpu = 0;
  #accGpu = 0;
  #gpuSamples = 0;
  #lastText = 0;
  #worst = 0;

  constructor(renderer, { overlay = true, parent = document.body, interval = 500 } = {}) {
    this.#renderer = renderer;
    this.interval = interval;
    renderer.info.autoReset = false;
    this.#gl = renderer.getContext();
    this.#ext = this.#gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (overlay) {
      const el = document.createElement('pre');
      el.className = 'pwe-perf';
      el.style.cssText =
        'position:fixed;left:8px;top:8px;margin:0;padding:8px 10px;z-index:1000;pointer-events:none;' +
        'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d8f5d0;' +
        'background:rgba(8,12,10,.72);border-radius:6px;white-space:pre;min-width:168px';
      parent.appendChild(el);
      this.#el = el;
    }
  }

  get gpuTimerAvailable() {
    return !!this.#ext;
  }

  /** Register a function returning `{ label: number|string }` shown under `name`. */
  addSource(name, fn) {
    this.#sources.set(name, fn);
    return this;
  }

  removeSource(name) {
    this.#sources.delete(name);
  }

  setVisible(visible) {
    if (this.#el) this.#el.style.display = visible ? '' : 'none';
  }

  /** Call at the start of the frame, before updates and rendering. */
  begin() {
    this.#renderer.info.reset();
    this.#cpuStart = performance.now();
    const gl = this.#gl;
    // Timer queries cannot nest and are not usable while an XR session owns the frame.
    if (this.#ext && !this.#activeQuery && this.#queries.length < 8 && !this.#renderer.xr?.isPresenting) {
      const q = gl.createQuery();
      gl.beginQuery(this.#ext.TIME_ELAPSED_EXT, q);
      this.#activeQuery = q;
    }
  }

  /** Call at the end of the frame, after rendering. */
  end() {
    const gl = this.#gl;
    const now = performance.now();
    if (this.#activeQuery) {
      gl.endQuery(this.#ext.TIME_ELAPSED_EXT);
      this.#queries.push(this.#activeQuery);
      this.#activeQuery = null;
    }
    this.#pollGpu();

    const frame = this.#lastFrame ? now - this.#lastFrame : 0;
    this.#lastFrame = now;
    this.#frames++;
    this.#accTime += frame;
    this.#accCpu += now - this.#cpuStart;
    this.#worst = Math.max(this.#worst, frame);

    if (now - this.#lastText >= this.interval && this.#accTime > 0) {
      const v = this.values;
      const info = this.#renderer.info;
      v.frameMs = this.#accTime / this.#frames;
      v.fps = 1000 / v.frameMs;
      v.cpuMs = this.#accCpu / this.#frames;
      v.gpuMs = this.#gpuSamples ? this.#accGpu / this.#gpuSamples : null;
      v.worstMs = this.#worst;
      v.drawCalls = info.render.calls;
      v.triangles = info.render.triangles;
      v.geometries = info.memory.geometries;
      v.textures = info.memory.textures;
      this.#frames = 0;
      this.#accTime = this.#accCpu = this.#accGpu = 0;
      this.#gpuSamples = 0;
      this.#worst = 0;
      this.#lastText = now;
      if (this.#el) this.#el.textContent = this.#format();
    }
  }

  dispose() {
    for (const q of this.#queries) this.#gl.deleteQuery(q);
    this.#queries.length = 0;
    this.#el?.remove();
    this.#sources.clear();
  }

  #pollGpu() {
    const gl = this.#gl;
    if (!this.#ext) return;
    const disjoint = gl.getParameter(this.#ext.GPU_DISJOINT_EXT);
    while (this.#queries.length) {
      const q = this.#queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) {
        this.#accGpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.#gpuSamples++;
      }
      gl.deleteQuery(q);
      this.#queries.shift();
    }
  }

  #format() {
    const v = this.values;
    const n = (x) => x.toLocaleString('en-US');
    const lines = [
      `FPS    ${v.fps.toFixed(1).padStart(7)}`,
      `frame  ${v.frameMs.toFixed(2).padStart(7)} ms  (worst ${v.worstMs.toFixed(1)})`,
      `CPU    ${v.cpuMs.toFixed(2).padStart(7)} ms`,
      `GPU    ${v.gpuMs === null ? '    n/a' : v.gpuMs.toFixed(2).padStart(7) + ' ms'}`,
      `calls  ${String(v.drawCalls).padStart(7)}`,
      `tris   ${n(v.triangles).padStart(7)}`,
    ];
    for (const [name, fn] of this.#sources) {
      let stats;
      try {
        stats = fn();
      } catch {
        continue;
      }
      lines.push(`-- ${name}`);
      for (const [k, val] of Object.entries(stats)) {
        const text = typeof val === 'number' ? (Number.isInteger(val) ? n(val) : val.toFixed(2)) : String(val);
        lines.push(`${k.padEnd(11)}${text.padStart(9)}`);
      }
    }
    return lines.join('\n');
  }
}
