// The minimap: a round map in the corner, always there (the 地図 button turns
// it off). It turns with the truck (where we face is up), shows the land
// around us (water, beaches, grass, rock, snow), other players (at the rim
// when far) and the stars. During a キャノンボール race the race's own map
// takes its place.
//
// The land is painted from the height field into an offscreen picture around
// a centre; when we drive away from that centre a new one is painted, a few
// rows per frame (one height sample costs a couple of microseconds, a whole
// picture would stall a frame), and swapped in when done.
import * as THREE from 'three';

const N = 160;            // pixels per side of the land picture
const RANGE = 350;        // metres from the middle to the rim
const HALF = 560;         // half the width of the land picture, metres
const REPAINT = 150;      // paint a new picture when this far from its centre
const ROWS_PER_FRAME = 8;

/** Colour of the land at (x, z) for maps: [r, g, b] 0..255. */
export function mapColor(ground, x, z, n, waterLevel = 0) {
  const h = ground.height(x, z);
  if (h < waterLevel) {
    const deep = Math.min(1, (waterLevel - h) / 30);
    return [40 - 25 * deep, 120 - 60 * deep, 150 - 40 * deep];
  }
  ground.normal(x, z, n);
  const shade = 0.75 + 0.35 * (n.x * -0.5 + n.y * 0.7 + n.z * -0.5);
  let rgb;
  const above = h - waterLevel;
  if (above < 3) rgb = [200, 186, 140];
  else if (h > 700) rgb = [230, 232, 236];
  else if (n.y < 0.8) rgb = [130, 124, 116];
  else rgb = [92 + h * 0.06, 122 - h * 0.02, 62];
  return rgb.map((v) => v * shade);
}

export class Minimap {
  enabled = true;
  canvas;
  #o;
  #ready = null;   // { canvas, cx, cz } the picture in use
  #paint = null;   // { canvas, g, img, cx, cz, row, water } the one being painted
  #n = new THREE.Vector3();

  /**
   * @param {object} o
   * @param {object} o.ground   height / normal / water
   * @param {object} o.vehicle  our truck (position, heading)
   * @param {function} o.others () => [{ x, z, color, name? }] other players
   * @param {function} o.items  () => star markers (stars.markers())
   */
  constructor(o) {
    this.#o = o;
    const c = (this.canvas = document.createElement('canvas'));
    c.className = 'minimap';
    c.width = c.height = 200;
    c.hidden = true;
    document.body.appendChild(c);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.canvas.hidden = true;
  }

  /** A new world: forget the old land. */
  reset() {
    this.#ready = null;
    this.#paint = null;
  }

  /** @param {boolean} hide  true while something else takes the corner (a race) */
  update(hide = false) {
    const show = this.enabled && !hide;
    this.canvas.hidden = !show;
    if (!show) return;
    const p = this.#o.vehicle.position;
    // Keep a picture centred near us.
    const r = this.#ready;
    if (!this.#paint && (!r || Math.hypot(p.x - r.cx, p.z - r.cz) > REPAINT)) this.#startPaint(p.x, p.z);
    if (this.#paint) this.#paintRows(this.#ready ? ROWS_PER_FRAME : N); // the very first one at once
    this.#draw();
  }

  get visible() { return !this.canvas.hidden; }

  #startPaint(cx, cz) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = N;
    const g = canvas.getContext('2d');
    this.#paint = { canvas, g, img: g.createImageData(N, N), cx: Math.round(cx), cz: Math.round(cz), row: 0, water: this.#o.ground.water(cx, cz) };
  }

  #paintRows(rows) {
    const pt = this.#paint;
    const { ground } = this.#o;
    const end = Math.min(N, pt.row + rows);
    for (let j = pt.row; j < end; j++) {
      const z = pt.cz - HALF + ((j + 0.5) / N) * 2 * HALF;
      for (let i = 0; i < N; i++) {
        const x = pt.cx - HALF + ((i + 0.5) / N) * 2 * HALF;
        const rgb = mapColor(ground, x, z, this.#n, pt.water);
        const o = (j * N + i) * 4;
        pt.img.data[o] = rgb[0]; pt.img.data[o + 1] = rgb[1]; pt.img.data[o + 2] = rgb[2]; pt.img.data[o + 3] = 255;
      }
    }
    pt.row = end;
    if (pt.row >= N) {
      pt.g.putImageData(pt.img, 0, 0);
      this.#ready = { canvas: pt.canvas, cx: pt.cx, cz: pt.cz };
      this.#paint = null;
    }
  }

  #draw() {
    const c = this.canvas, g = c.getContext('2d');
    const S = c.width, R = S / 2 - 3;
    const k = R / RANGE; // pixels per metre
    const v = this.#o.vehicle;
    const p = v.position, h = v.heading;
    g.clearRect(0, 0, S, S);
    g.save();
    g.translate(S / 2, S / 2);
    g.beginPath(); g.arc(0, 0, R, 0, 7); g.clip();
    g.fillStyle = 'rgba(8, 12, 10, .75)';
    g.fillRect(-R, -R, 2 * R, 2 * R);
    // The land, turned so that where we face is up.
    const r = this.#ready;
    if (r) {
      g.save();
      g.rotate(h);
      g.scale(k, k);
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.92;
      g.drawImage(r.canvas, r.cx - HALF - p.x, r.cz - HALF - p.z, 2 * HALF, 2 * HALF);
      g.restore();
    }
    // Rings every 100 m.
    g.strokeStyle = 'rgba(255, 255, 255, .16)'; g.lineWidth = 1;
    for (let m = 100; m < RANGE; m += 100) { g.beginPath(); g.arc(0, 0, m * k, 0, 7); g.stroke(); }
    g.restore();

    // World point -> map, turned like the land; far ones held at the rim.
    const cos = Math.cos(h), sin = Math.sin(h);
    const at = (x, z, edge) => {
      const dx = x - p.x, dz = z - p.z;
      let px = (dx * cos - dz * sin) * k, py = (dx * sin + dz * cos) * k;
      const d = Math.hypot(px, py), lim = R - edge;
      const far = d > lim;
      if (far) { px *= lim / d; py *= lim / d; }
      return [S / 2 + px, S / 2 + py, far];
    };
    for (const m of this.#o.items?.() ?? []) {
      const [x, y, far] = at(m.x, m.z, 6);
      g.fillStyle = m.color; g.strokeStyle = '#fff'; g.lineWidth = 1.3;
      g.globalAlpha = m.landed ? 1 : 0.6;
      g.beginPath(); g.arc(x, y, far ? 3.5 : m.rainbow ? 5.5 : 4.5, 0, 7); g.fill(); g.stroke();
      g.globalAlpha = 1;
    }
    for (const o of this.#o.others?.() ?? []) {
      const [x, y, far] = at(o.x, o.z, 7);
      g.fillStyle = o.color; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.globalAlpha = far ? 0.75 : 1;
      g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.stroke();
      g.globalAlpha = 1;
    }
    // Us, in the middle, pointing up.
    g.save();
    g.translate(S / 2, S / 2);
    g.fillStyle = '#ff5a4a'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(-5.5, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // North on the rim, and the rim itself.
    g.strokeStyle = 'rgba(255, 255, 255, .45)'; g.lineWidth = 2;
    g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.stroke();
    const nx = S / 2 + Math.sin(h) * (R - 11), ny = S / 2 - Math.cos(h) * (R - 11);
    g.fillStyle = 'rgba(8, 12, 10, .8)';
    g.beginPath(); g.arc(nx, ny, 8, 0, 7); g.fill();
    g.fillStyle = '#ffc35a'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
  }
}
