/**
 * Minimal event emitter used by WorldEnvironment and every engine.
 * `on()` returns an unsubscribe function.
 */
export class Emitter {
  #listeners = new Map();

  on(type, fn) {
    let set = this.#listeners.get(type);
    if (!set) this.#listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.#listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.#listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  clearListeners() {
    this.#listeners.clear();
  }
}
