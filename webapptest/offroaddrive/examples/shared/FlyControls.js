import { Euler, Vector3 } from 'three';

const _forward = new Vector3();
const _right = new Vector3();
const _euler = new Euler(0, 0, 0, 'YXZ');

/**
 * Demo camera controls (not part of the engine).
 *
 *   desktop  drag = look, WASD / arrows = move, Q / E = down / up, Shift = fast, wheel = speed
 *   touch    one finger = look, two fingers = fly forward
 *   XR       left stick = move, right stick = snap turn
 *
 * `rig` is the object that moves (a Group holding the camera, so it also works
 * in XR); `camera` supplies the look direction.
 */
export class FlyControls {
  speed = 60; // m/s
  fastMultiplier = 6;
  yaw = 0;
  pitch = 0;

  #keys = new Set();
  #pointers = new Map();
  #dom;
  #rig;
  #camera;
  #renderer;
  #snapReady = true;
  #abort = new AbortController();

  constructor(rig, camera, renderer) {
    this.#rig = rig;
    this.#camera = camera;
    this.#renderer = renderer;
    this.#dom = renderer.domElement;
    const o = { signal: this.#abort.signal };
    const dom = this.#dom;
    dom.style.touchAction = 'none';

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.#keys.add(e.code);
    }, o);
    window.addEventListener('keyup', (e) => this.#keys.delete(e.code), o);
    window.addEventListener('blur', () => this.#keys.clear(), o);

    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }, o);
    dom.addEventListener('pointermove', (e) => {
      const p = this.#pointers.get(e.pointerId);
      if (!p) return;
      if (this.#pointers.size === 1) {
        const k = 0.0028;
        this.yaw -= (e.clientX - p.x) * k;
        this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - (e.clientY - p.y) * k));
      }
      p.x = e.clientX;
      p.y = e.clientY;
    }, o);
    const release = (e) => this.#pointers.delete(e.pointerId);
    dom.addEventListener('pointerup', release, o);
    dom.addEventListener('pointercancel', release, o);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.speed = Math.max(2, Math.min(4000, this.speed * Math.exp(-e.deltaY * 0.0015)));
    }, { passive: false, signal: this.#abort.signal });
  }

  update(dt) {
    const xr = this.#renderer.xr;
    const presenting = xr?.isPresenting;
    let moveX = 0, moveY = 0, moveZ = 0;

    const k = this.#keys;
    if (k.has('KeyW') || k.has('ArrowUp')) moveZ += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) moveZ -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) moveX += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) moveX -= 1;
    if (k.has('KeyE') || k.has('Space')) moveY += 1;
    if (k.has('KeyQ')) moveY -= 1;
    if (this.#pointers.size >= 2) moveZ += 1;
    let speed = this.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? this.fastMultiplier : 1);

    if (presenting) {
      for (const source of xr.getSession().inputSources) {
        const axes = source.gamepad?.axes;
        if (!axes || axes.length < 4) continue;
        if (source.handedness === 'left') {
          moveX += Math.abs(axes[2]) > 0.15 ? axes[2] : 0;
          moveZ -= Math.abs(axes[3]) > 0.15 ? axes[3] : 0;
        } else if (source.handedness === 'right') {
          if (Math.abs(axes[2]) > 0.6) {
            if (this.#snapReady) this.yaw -= Math.sign(axes[2]) * (Math.PI / 6);
            this.#snapReady = false;
          } else {
            this.#snapReady = true;
          }
          moveY -= Math.abs(axes[3]) > 0.3 ? axes[3] : 0;
        }
      }
      // In XR the headset owns the camera; the rig only carries yaw.
      this.#rig.rotation.set(0, this.yaw, 0);
      this.#camera.rotation.set(0, 0, 0);
    } else {
      this.#rig.rotation.set(0, 0, 0);
      _euler.set(this.pitch, this.yaw, 0);
      this.#camera.quaternion.setFromEuler(_euler);
    }

    if (moveX || moveY || moveZ) {
      const view = presenting ? xr.getCamera() : this.#camera;
      view.getWorldDirection(_forward);
      _right.set(-_forward.z, 0, _forward.x).normalize();
      const step = speed * dt;
      this.#rig.position.addScaledVector(_forward, moveZ * step);
      this.#rig.position.addScaledVector(_right, moveX * step);
      this.#rig.position.y += moveY * step;
    }
  }

  dispose() {
    this.#abort.abort();
  }
}
