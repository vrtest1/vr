import { Vector3, Color } from 'three';
import { Emitter } from './Emitter.js';

/** Weather types. Each one sets default cloud cover / precipitation / visibility. */
export const Weather = Object.freeze({
  CLEAR: 'clear',
  PARTLY_CLOUDY: 'partlyCloudy',
  OVERCAST: 'overcast',
  RAIN: 'rain',
  STORM: 'storm',
  SNOW: 'snow',
  FOG: 'fog',
});

/** What a weather type implies when the caller does not override the values. */
const WEATHER_DEFAULTS = Object.freeze({
  clear: { cloudCover: 0.05, precipitation: 0.0, visibility: 80000 },
  partlyCloudy: { cloudCover: 0.4, precipitation: 0.0, visibility: 60000 },
  overcast: { cloudCover: 0.95, precipitation: 0.0, visibility: 20000 },
  rain: { cloudCover: 0.95, precipitation: 0.5, visibility: 6000 },
  storm: { cloudCover: 1.0, precipitation: 1.0, visibility: 2500 },
  snow: { cloudCover: 0.9, precipitation: 0.5, visibility: 3000 },
  fog: { cloudCover: 0.6, precipitation: 0.0, visibility: 300 },
});

const DEFAULTS = Object.freeze({
  timeOfDay: 10.0, // hours, 0..24, local solar time
  dayOfYear: 172, // 1..365 (172 = northern summer solstice)
  latitude: 35.0, // degrees, north positive
  timeScale: 0.0, // simulated seconds per real second (0 = frozen)
  windDirection: 270.0, // degrees, direction the wind blows FROM (0 = north, 90 = east)
  windSpeed: 4.0, // m/s
  weather: Weather.CLEAR,
  cloudCover: 0.05, // 0..1
  precipitation: 0.0, // 0..1
  temperature: 18.0, // deg C at water level
  humidity: 55.0, // percent
  visibility: 80000, // metres (meteorological range)
  waterLevel: 0.0, // metres, world Y of the water surface
});

const LIMITS = Object.freeze({
  dayOfYear: [1, 365],
  latitude: [-90, 90],
  timeScale: [0, 86400],
  windSpeed: [0, 60],
  cloudCover: [0, 1],
  precipitation: [0, 1],
  temperature: [-60, 60],
  humidity: [0, 100],
  visibility: [20, 200000],
  waterLevel: [-10000, 10000],
});

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Shared environment state. Every engine reads from one instance, so changing
 * the time or the weather here changes the whole world.
 *
 * World axes: +Y up, +X east, -Z north.
 *
 * Events: `change` with `{ keys: string[], environment }`.
 */
export class WorldEnvironment extends Emitter {
  /** Bumped on every change; engines can compare it to skip work. */
  version = 0;

  /** Unit vector from the ground toward the sun (below the horizon at night). */
  sunDirection = new Vector3(0, 1, 0);
  /** Radians above the horizon. */
  sunElevation = 0;
  /** Radians clockwise from north. */
  sunAzimuth = 0;
  /** 0..1, direct sunlight relative to a clear-sky zenith sun. */
  sunIntensity = 1;
  /** Linear RGB tint of direct sunlight (max channel = 1). */
  sunColor = new Color(1, 1, 1);
  /** 0..1, diffuse sky light relative to clear noon. Never fully 0 (night sky). */
  skyIntensity = 1;
  /**
   * Sky radiance (linear RGB, same units as rendered colour) straight up, at
   * the horizon away from the sun, and at the horizon toward the sun. Engines
   * that reflect the sky (the ocean) read these. AtmosphereEngine overwrites
   * them with values from its model; otherwise they follow time and weather.
   */
  skyZenith = new Color(0.1, 0.22, 0.55);
  skyHorizon = new Color(0.55, 0.68, 0.85);
  skyHorizonSun = new Color(0.7, 0.75, 0.85);
  /** Unit vector the wind blows TOWARD, on the XZ plane. */
  windVector = new Vector3(1, 0, 0);

  #state = { ...DEFAULTS };
  #sunOverride = null;
  #skyExternal = false;

  constructor(params = {}) {
    super();
    this.set(params, { silent: true });
    this.#derive();
  }

  // --- plain parameters ---------------------------------------------------
  get timeOfDay() { return this.#state.timeOfDay; }
  get dayOfYear() { return this.#state.dayOfYear; }
  get latitude() { return this.#state.latitude; }
  get timeScale() { return this.#state.timeScale; }
  get windDirection() { return this.#state.windDirection; }
  get windSpeed() { return this.#state.windSpeed; }
  get weather() { return this.#state.weather; }
  get cloudCover() { return this.#state.cloudCover; }
  get precipitation() { return this.#state.precipitation; }
  get temperature() { return this.#state.temperature; }
  get humidity() { return this.#state.humidity; }
  get visibility() { return this.#state.visibility; }
  get waterLevel() { return this.#state.waterLevel; }

  set timeOfDay(v) { this.set({ timeOfDay: v }); }
  set dayOfYear(v) { this.set({ dayOfYear: v }); }
  set latitude(v) { this.set({ latitude: v }); }
  set timeScale(v) { this.set({ timeScale: v }); }
  set windDirection(v) { this.set({ windDirection: v }); }
  set windSpeed(v) { this.set({ windSpeed: v }); }
  set weather(v) { this.set({ weather: v }); }
  set cloudCover(v) { this.set({ cloudCover: v }); }
  set precipitation(v) { this.set({ precipitation: v }); }
  set temperature(v) { this.set({ temperature: v }); }
  set humidity(v) { this.set({ humidity: v }); }
  set visibility(v) { this.set({ visibility: v }); }
  set waterLevel(v) { this.set({ waterLevel: v }); }

  /** 0..1, how wet surfaces are. Rain wets, freezing temperatures do not. */
  get wetness() {
    const s = this.#state;
    return s.temperature > 0.5 ? clamp(s.precipitation * 1.5, 0, 1) : 0;
  }

  /** 0..1, fresh snow on the ground from current weather (not altitude snow). */
  get snowfall() {
    const s = this.#state;
    return s.temperature <= 0.5 ? clamp(s.precipitation * 1.5, 0, 1) : 0;
  }

  /**
   * Change several parameters at once. Unknown keys throw. Setting `weather`
   * also applies that weather's default cloud cover, precipitation and
   * visibility unless the same call gives them explicitly.
   */
  set(params, { silent = false } = {}) {
    const next = { ...params };
    if (next.weather !== undefined) {
      const defaults = WEATHER_DEFAULTS[next.weather];
      if (!defaults) throw new Error(`Unknown weather "${next.weather}"`);
      for (const k in defaults) if (next[k] === undefined) next[k] = defaults[k];
    }

    const changed = [];
    for (const key in next) {
      if (!(key in DEFAULTS)) throw new Error(`WorldEnvironment: unknown parameter "${key}"`);
      let v = next[key];
      if (key === 'weather') {
        // validated above
      } else {
        v = Number(v);
        if (!Number.isFinite(v)) throw new Error(`WorldEnvironment: "${key}" must be a finite number`);
        if (key === 'timeOfDay') v = ((v % 24) + 24) % 24;
        else if (key === 'windDirection') v = ((v % 360) + 360) % 360;
        else v = clamp(v, LIMITS[key][0], LIMITS[key][1]);
      }
      if (this.#state[key] !== v) {
        this.#state[key] = v;
        changed.push(key);
      }
    }
    if (changed.length) this.#commit(changed, silent);
    return this;
  }

  /**
   * Force the sun direction (vector toward the sun) instead of deriving it
   * from time / date / latitude. Pass null to go back to the derived sun.
   */
  setSunDirectionOverride(direction) {
    this.#sunOverride = direction ? new Vector3().copy(direction).normalize() : null;
    this.#commit(['sunDirection'], false);
    return this;
  }

  /**
   * Publish sky colours computed elsewhere (AtmosphereEngine does this every
   * time the light changes). Does not emit `change`: readers copy the colours
   * each frame.
   */
  setSkyColors(zenith, horizon, horizonSun) {
    this.#skyExternal = true;
    this.skyZenith.copy(zenith);
    this.skyHorizon.copy(horizon);
    this.skyHorizonSun.copy(horizonSun);
    return this;
  }

  /** Go back to the built-in sky colour estimate. */
  clearSkyColors() {
    this.#skyExternal = false;
    this.#commit(['skyColors'], false);
    return this;
  }

  /** Advance simulated time. Call once per frame (World does it for you). */
  update(deltaTime) {
    const s = this.#state;
    if (s.timeScale <= 0 || !(deltaTime > 0)) return;
    let t = s.timeOfDay + (deltaTime * s.timeScale) / 3600;
    let day = s.dayOfYear;
    while (t >= 24) {
      t -= 24;
      day = day >= 365 ? 1 : day + 1;
    }
    const changed = ['timeOfDay'];
    if (day !== s.dayOfYear) changed.push('dayOfYear');
    s.timeOfDay = t;
    s.dayOfYear = day;
    this.#commit(changed, false);
  }

  toJSON() {
    return { ...this.#state };
  }

  fromJSON(json) {
    return this.set(json);
  }

  #commit(keys, silent) {
    this.#derive();
    this.version++;
    if (!silent) this.emit('change', { keys, environment: this });
  }

  #derive() {
    const s = this.#state;

    // Sun position (declination + hour angle; accurate to about a degree).
    if (this.#sunOverride) {
      this.sunDirection.copy(this.#sunOverride);
      this.sunElevation = Math.asin(clamp(this.sunDirection.y, -1, 1));
      this.sunAzimuth = Math.atan2(this.sunDirection.x, -this.sunDirection.z);
    } else {
      const decl = -23.44 * DEG * Math.cos(((2 * Math.PI) / 365) * (s.dayOfYear + 10));
      const hourAngle = 15 * DEG * (s.timeOfDay - 12);
      const lat = s.latitude * DEG;
      const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
      const el = Math.asin(clamp(sinEl, -1, 1));
      const az =
        Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
      this.sunElevation = el;
      this.sunAzimuth = az;
      const ce = Math.cos(el);
      this.sunDirection.set(ce * Math.sin(az), Math.sin(el), -ce * Math.cos(az));
    }

    // Direct light: air-mass attenuation, then clouds and haze.
    const elDeg = this.sunElevation / DEG;
    const twilight = clamp((elDeg + 2) / 4, 0, 1); // fades out between +2 and -2 degrees
    const e = Math.max(elDeg, 0);
    const airMass = 1 / (Math.sin(e * DEG) + 0.50572 * Math.pow(e + 6.07995, -1.6364)); // Kasten & Young
    const clearSky = Math.pow(0.7, Math.pow(airMass, 0.678)) / 0.7; // Meinel, 1 at zenith
    const cloud = 1 - 0.8 * Math.pow(s.cloudCover, 2.5);
    const haze = clamp(0.55 + 0.45 * (s.visibility / 10000), 0.2, 1);
    this.sunIntensity = clearSky * cloud * haze * twilight * twilight * (3 - 2 * twilight);

    // Sun tint: blue is scattered out first as the path through the air grows.
    const r = Math.exp(-0.035 * airMass);
    const g = Math.exp(-0.075 * airMass);
    const b = Math.exp(-0.16 * airMass);
    const m = Math.max(r, g, b);
    const grey = s.cloudCover * 0.6; // clouds desaturate direct light
    this.sunColor.setRGB(r / m + (1 - r / m) * grey, g / m + (1 - g / m) * grey, b / m + (1 - b / m) * grey);

    // Diffuse sky light: follows the sun down through civil twilight.
    const day = clamp((elDeg + 6) / 18, 0, 1);
    this.skyIntensity = 0.02 + 0.98 * day * day * (3 - 2 * day) * (1 - 0.55 * Math.pow(s.cloudCover, 2));

    // Rough sky colours for reflections when no atmosphere engine provides them.
    if (!this.#skyExternal) {
      const d = this.skyIntensity;
      const grey = Math.pow(s.cloudCover, 2);
      const mix = (a, b) => a + (b - a) * grey;
      this.skyZenith.setRGB(mix(0.1, 0.42) * d, mix(0.22, 0.45) * d, mix(0.55, 0.5) * d);
      this.skyHorizon.setRGB(mix(0.55, 0.6) * d, mix(0.68, 0.63) * d, mix(0.85, 0.66) * d);
      const glow = 0.45 * this.sunIntensity;
      this.skyHorizonSun.setRGB(
        this.skyHorizon.r + glow * this.sunColor.r,
        this.skyHorizon.g + glow * this.sunColor.g,
        this.skyHorizon.b + glow * this.sunColor.b,
      );
    }

    // Wind: direction is where it comes FROM, the vector is where it goes.
    const wd = s.windDirection * DEG;
    this.windVector.set(-Math.sin(wd), 0, Math.cos(wd));
  }
}
