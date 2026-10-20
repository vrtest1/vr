import {surfaceNormals} from './terrain-seams.js';
import * as THREE from 'three';

export const R = 6378137;
export const C = 2 * Math.PI * R;

export function mercator(lat, lon) {
  return {
    x: R * lon * Math.PI / 180,
    y: R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
  };
}

export function geographic(x, y) {
  return {
    lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI,
    lon: x / R * 180 / Math.PI
  };
}

export function decode(r, g, b) {
  let n = r * 65536 + g * 256 + b;
  return n === 8388608
    ? NaN
    : (n < 8388608 ? n : n - 16777216) * 0.01;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Terrain {

  constructor(scene, onStatus, options = {}) {

    this.scene = scene;
    this.onStatus = onStatus;

    this.tiles = new Map();
    this.cache = new Map();

    this.active = 0;
    this.maxConcurrent = 4;
    this.epoch = 0;

    this.layer = 'seamlessphoto';
    this.layerGeneration = 0;

    this.z = options.z ?? 13;
    this.radius = 3;

    /*
      WebGPU安定化:
      Geometryの構造を実行中に差し替えない。
    */
    this.meshResolution = options.meshResolution ?? 48;

    /*
      7x7 = 49 Tile表示。
      16スロットの余裕を加え、最大65 Meshで固定する。
    */
    this.poolSize = options.poolSize ?? 65;
    this.skirtDepth = options.skirtDepth ?? 2;
    this.overlap = options.overlap ?? 1.002;

    /*
      DEM seam stitching

      境界そのものは隣Tileと完全に同じ高さへ揃え、
      1列目 / 2列目を弱く馴染ませる。

      この処理は毎フレームではなく、
      Tileのロード完了・入れ替え時だけ実行する。
    */
    this.stitchBlend1 = 0.50;
    this.stitchBlend2 = 0.25;
    this.stitchScheduled = false;
    this.stitchDirty = false;

    this.last = '';
    this.failed = 0;

    this.abort = new AbortController();

    this.origin = mercator(35.21, 139);
    this.lat = 35.21;
    this.lon = 139;
    this.scale = Math.cos(this.lat * Math.PI / 180);
    this.size = C / (2 ** this.z) * this.scale;

    /*
      固定Mesh / Geometry / Material / CanvasTextureプール。
      実行中にはdisposeしない。
    */
    this.slots = [];

    for (let i = 0; i < this.poolSize; i++) {
      this.slots.push(this.createSlot(i));
    }
  }


  /* ============================================================
     Fixed pool slot
     ============================================================ */

  createSlot(id) {

    const n = this.meshResolution;
    const mainVertexCount = (n + 1) * (n + 1);

    const edge = [];

    for (let i = 0; i <= n; i++) {
      edge.push(i);
    }

    for (let j = 1; j <= n; j++) {
      edge.push(j * (n + 1) + n);
    }

    for (let i = n - 1; i >= 0; i--) {
      edge.push(n * (n + 1) + i);
    }

    for (let j = n - 1; j > 0; j--) {
      edge.push(j * (n + 1));
    }

    const totalVertexCount = mainVertexCount + edge.length;

    const positions = new Float32Array(totalVertexCount * 3);
    const normals = new Float32Array(totalVertexCount * 3);
    const uvs = new Float32Array(totalVertexCount * 2);
    const indices = [];

    /*
      baseHeights:
        DEMそのものの高さ。継ぎ目補正前の原本。

      heights:
        実際に描画・height()へ使用する高さ。
        stitch時はこちらだけを書き換える。
    */
    const baseHeights = new Float32Array(mainVertexCount);
    const heights = new Float32Array(mainVertexCount);

    const inset = 0.5 / 256;

    /*
      UVはTile内容に依存しないため一度だけ作る。
    */
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {

        const vertex = j * (n + 1) + i;

        const u = inset + (i / n) * (1 - 2 * inset);
        const v = inset + (j / n) * (1 - 2 * inset);

        uvs[vertex * 2] = u;
        uvs[vertex * 2 + 1] = 1 - v;
      }
    }

    /* Main terrain indices */
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {

        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;

        indices.push(
          a, c, b,
          b, c, d
        );
      }
    }

    /* Skirt UV + indices */
    for (let e = 0; e < edge.length; e++) {

      const source = edge[e];
      const target = mainVertexCount + e;

      uvs[target * 2] = uvs[source * 2];
      uvs[target * 2 + 1] = uvs[source * 2 + 1];
    }

    for (let e = 0; e < edge.length; e++) {

      const next = (e + 1) % edge.length;

      indices.push(
        edge[e],
        mainVertexCount + e,
        edge[next],

        edge[next],
        mainVertexCount + e,
        mainVertexCount + next
      );
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );

    /*
      normal attributeも最初から存在させる。
      computeVertexNormals()で同じattributeを更新する。
    */
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(normals, 3)
    );

    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(uvs, 2)
    );

    geometry.setIndex(indices);

    geometry.userData = {
      n,
      heights
    };

    /*
      Textureオブジェクトも固定。
      各スロットが自分専用の256x256 CanvasTextureを持つ。
    */
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;

    const ctx = canvas.getContext('2d', { alpha: false });

    ctx.fillStyle = '#475653';
    ctx.fillRect(0, 0, 256, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 0.75,
      metalness: 0.06
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = true;

    /*
      MeshはSceneへ一度だけ追加。
      以後はvisible切替のみ。
    */
    this.scene.add(mesh);

    return {
      id,
      key: null,
      x: 0,
      y: 0,
      token: 0,
      ready: false,
      missing: false,
      data: null,
      baseHeights,
      heights,
      edge,
      mainVertexCount,
      geometry,
      material,
      mesh,
      canvas,
      ctx,
      texture
    };
  }


  isSlotCurrent(slot, key, token, epoch) {

    return (
      epoch === this.epoch &&
      slot.key === key &&
      slot.token === token &&
      this.tiles.get(key) === slot &&
      this.wanted?.has(key)
    );
  }


  getFreeSlot() {

    return this.slots.find(
      slot => slot.key === null
    ) || null;
  }


  assignSlot(slot, x, y, key) {

    slot.token++;

    slot.key = key;
    slot.x = x;
    slot.y = y;

    slot.ready = false;
    slot.elevationMissing = false;
    slot.missing = false;
    slot.data = null;

    slot.mesh.visible = false;

    const p = this.world(x, y);

    slot.mesh.position.set(
      p.x,
      0,
      p.z
    );

    this.tiles.set(key, slot);

    return slot.token;
  }


  releaseSlot(slot) {

    if (!slot || slot.key === null) {
      return;
    }

    const oldKey = slot.key;
    const wasReady = slot.ready;

    if (this.tiles.get(oldKey) === slot) {
      this.tiles.delete(oldKey);
    }

    /*
      進行中async処理をtokenで無効化。
      GPU resource自体は破棄しない。
    */
    slot.token++;

    slot.key = null;
    slot.ready = false;
    slot.elevationMissing = false;
    slot.missing = false;
    slot.data = null;

    slot.mesh.visible = false;

    /*
      隣TileがこのTileとの平均補正を受けていた場合、
      原本DEMへ戻した上で残っている隣同士を再接続する。
    */
    if (wasReady) {
      this.requestStitch();
    }
  }


  /* ============================================================
     Origin
     ============================================================ */

  setOrigin(lat, lon) {

    this.epoch++;

    /*
      旧地点のネットワーク取得だけ中断。
      GPU resourceはPool内に残す。
    */
    this.abort.abort();
    this.abort = new AbortController();

    for (const slot of [...this.tiles.values()]) {
      this.releaseSlot(slot);
    }

    this.tiles.clear();

    /* CPU側DEM cacheは破棄してよい */
    this.cache.clear();

    this.origin = mercator(lat, lon);
    this.lat = lat;
    this.lon = lon;

    this.scale = Math.cos(lat * Math.PI / 180);
    this.size = C / (2 ** this.z) * this.scale;

    this.last = '';
    this.failed = 0;
  }


  /* ============================================================
     Coordinates
     ============================================================ */

  toGeo(x, z) {

    return geographic(
      this.origin.x + x / this.scale,
      this.origin.y - z / this.scale
    );
  }


  world(tx, ty) {

    return {
      x:
        (
          tx / 2 ** this.z * C -
          C / 2 -
          this.origin.x
        ) * this.scale,

      z:
        (
          C / 2 -
          ty / 2 ** this.z * C -
          this.origin.y
        ) * -this.scale
    };
  }


  tileAt(x, z) {

    return {
      x:
        (
          this.origin.x +
          x / this.scale +
          C / 2
        ) / C * 2 ** this.z,

      y:
        (
          C / 2 -
          this.origin.y +
          z / this.scale
        ) / C * 2 ** this.z
    };
  }


  /* ============================================================
     Image loading
     ============================================================ */

  async image(url, signal) {

    const controller = new AbortController();

    const abort = () => controller.abort();

    signal?.addEventListener(
      'abort',
      abort,
      { once: true }
    );

    if (signal?.aborted) {
      controller.abort();
    }

    const timeout = setTimeout(
      abort,
      18000
    );

    try {

      const r = await fetch(
        url,
        {
          signal: controller.signal
        }
      );

      if (!r.ok) {
        throw Error('Tile ' + r.status);
      }

      const blob = await r.blob();

      return await createImageBitmap(blob);

    } finally {

      clearTimeout(timeout);

      signal?.removeEventListener(
        'abort',
        abort
      );
    }
  }


  /* ============================================================
     DEM
     ============================================================ */

  async dem(z, x, y, epoch, source = 'dem_png') {

    const key = `${source}/${z}/${x}/${y}`;

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const promise = (async () => {

      let bitmap;

      try {

        bitmap = await this.image(
          `https://cyberjapandata.gsi.go.jp/xyz/${key}.png`,
          this.abort.signal
        );

      } catch (e) {

        if (epoch !== this.epoch) {
          throw e;
        }

        return null;
      }

      if (epoch !== this.epoch) {
        bitmap?.close();
        return null;
      }

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;

      const ctx = canvas.getContext(
        '2d',
        { willReadFrequently: true }
      );

      ctx.drawImage(
        bitmap,
        0,
        0
      );

      bitmap.close();

      const pixels = ctx.getImageData(
        0,
        0,
        256,
        256
      ).data;

      const h = new Float32Array(65536);

      for (let i = 0; i < h.length; i++) {
        h[i] = decode(
          pixels[i * 4],
          pixels[i * 4 + 1],
          pixels[i * 4 + 2]
        );
      }

      return h;

    })();

    this.cache.set(key, promise);

    /*
      CPU DEM cacheは140個で上限固定。
    */
    if (this.cache.size > 96) {
      this.cache.delete(
        this.cache.keys().next().value
      );
    }

    return promise;
  }


  async data(x, y, epoch) {

    /* z13 -> z12 -> z11 */
    for (let dz = 0; dz <= 2; dz++) {

      const f = 2 ** dz;

      const h = await this.dem(
        this.z - dz,
        Math.floor(x / f),
        Math.floor(y / f),
        epoch
      );

      if (epoch !== this.epoch) {
        return null;
      }

      if (h) {
        return {
          h,
          offX: (x % f) * 256 / f,
          offY: (y % f) * 256 / f,
          f
        };
      }
    }

    return this.globalData(x, y, epoch);
  }

  async globalData(x, y, epoch) {
    const f = 2 ** (this.z - 8);
    const h = await this.dem(8, Math.floor(x/f), Math.floor(y/f), epoch, 'demgm_png');
    return h ? {h, offX:(x%f)*256/f, offY:(y%f)*256/f, f, coarse:true} : null;
  }


  /* ============================================================
     Height sampling
     ============================================================ */

  sample(data, u, v) {

    if (!data) {
      return 0;
    }

    const x = clamp(
      data.offX +
      u * 256 / data.f,
      0,
      255
    );

    const y = clamp(
      data.offY +
      v * 256 / data.f,
      0,
      255
    );

    const ix = Math.floor(x);
    const iy = Math.floor(y);

    const fx = x - ix;
    const fy = y - iy;

    const a = data.h[
      iy * 256 + ix
    ];

    const b = data.h[
      iy * 256 +
      Math.min(ix + 1, 255)
    ];

    const c = data.h[
      Math.min(iy + 1, 255) * 256 +
      ix
    ];

    const d = data.h[
      Math.min(iy + 1, 255) * 256 +
      Math.min(ix + 1, 255)
    ];

    const valid = [a, b, c, d]
      .filter(Number.isFinite);

    if (!valid.length) {
      return 0;
    }

    const fallback =
      valid.reduce(
        (sum, value) => sum + value,
        0
      ) / valid.length;

    return (
      (Number.isFinite(a) ? a : fallback) *
      (1 - fx) *
      (1 - fy)

      +

      (Number.isFinite(b) ? b : fallback) *
      fx *
      (1 - fy)

      +

      (Number.isFinite(c) ? c : fallback) *
      (1 - fx) *
      fy

      +

      (Number.isFinite(d) ? d : fallback) *
      fx *
      fy
    );
  }


  /* ============================================================
     Reuse fixed geometry
     ============================================================ */

  updateGeometry(slot, data) {

    const n = this.meshResolution;
    const baseHeights = slot.baseHeights;
    const heights = slot.heights;

    /*
      DEMを原本配列へ保存。

      stitch処理を何回繰り返しても平均値が累積して
      地形が徐々に変形しないよう、毎回この原本を基準にする。
    */
    for (let j = 0; j <= n; j++) {

      for (let i = 0; i <= n; i++) {

        const vertex =
          j * (n + 1) + i;

        const h =
          this.sample(
            data,
            i / n,
            j / n
          );

        baseHeights[vertex] = h;
        heights[vertex] = h;
      }
    }

    this.applyHeightsToGeometry(slot);
  }


  applyHeightsToGeometry(slot) {

    const n = this.meshResolution;

    /*
      既存の隙間対策を維持。
      X/Z方向はほんの少し重ねる。
    */
    const overlap = this.overlap;
    const skirtDepth = this.skirtDepth;

    const position =
      slot.geometry.getAttribute(
        'position'
      );

    const array =
      position.array;

    const heights =
      slot.heights;


    /*
      Main terrain vertices
    */
    for (let j = 0; j <= n; j++) {

      for (let i = 0; i <= n; i++) {

        const vertex =
          j * (n + 1) + i;

        const p =
          vertex * 3;

        array[p] =
          i / n *
          this.size *
          overlap;

        array[p + 1] =
          heights[vertex];

        array[p + 2] =
          j / n *
          this.size *
          overlap;
      }
    }


    /*
      Skirt positions

      Main edgeの補正後の高さから作り直すため、
      stitchした境界にも自動的に追従する。
    */
    for (
      let e = 0;
      e < slot.edge.length;
      e++
    ) {

      const source =
        slot.edge[e];

      const target =
        slot.mainVertexCount + e;

      const si =
        source * 3;

      const ti =
        target * 3;

      array[ti] =
        array[si];

      array[ti + 1] =
        array[si + 1] -
        skirtDepth;

      array[ti + 2] =
        array[si + 2];
    }


    position.needsUpdate = true;


    /*
      normal attribute自体は固定のまま、
      内容だけ再計算する。
    */
    surfaceNormals(slot);

    const normal =
      slot.geometry.getAttribute(
        'normal'
      );

    if (normal) {
      normal.needsUpdate = true;
    }

    slot.geometry.computeBoundingSphere();

    slot.geometry.userData.n =
      n;

    slot.geometry.userData.heights =
      heights;
  }


  /* ============================================================
     DEM seam stitching
     ============================================================ */

  requestStitch() {

    this.stitchDirty = true;

    if (this.stitchScheduled) {
      return;
    }

    this.stitchScheduled = true;


    /*
      複数Tileが同時に読み終わっても、
      1フレームにつき最大1回だけ処理する。

      毎フレーム実行ではないので負荷は非常に小さい。
    */
    requestAnimationFrame(
      () => {

        this.stitchScheduled = false;

        if (!this.stitchDirty) {
          return;
        }

        this.stitchDirty = false;

        this.stitchReadyTiles();
      }
    );
  }


  stitchReadyTiles() {

    const n =
      this.meshResolution;

    const stride =
      n + 1;


    const readySlots =
      [...this.tiles.values()]
        .filter(
          slot =>
            slot.ready &&
            slot.key !== null &&
            slot.mesh.visible
        );


    if (!readySlots.length) {
      return;
    }


    /*
      1. 必ずDEM原本へ戻す。

      これにより、
      Tileの出入りや再stitchを何度繰り返しても
      平均化誤差が蓄積しない。
    */
    for (const slot of readySlots) {

      slot.heights.set(
        slot.baseHeights
      );
    }


    /*
      2. 東西方向の境界。

      左Tile (x,y) と
      右Tile (x+1,y)
    */
    for (const left of readySlots) {

      const right =
        this.tiles.get(
          `${left.x + 1}/${left.y}`
        );

      if (
        !right?.ready ||
        !right.mesh.visible
      ) {
        continue;
      }


      /*
        境界の1列内側 / 2列内側を
        50% / 25%だけ平均方向へ馴染ませる。

        角付近では南北補正と干渉しないよう、
        j=1 ... n-1のみを対象にする。
      */
      for (
        let j = 1;
        j < n;
        j++
      ) {

        const leftEdge =
          j * stride + n;

        const rightEdge =
          j * stride;

        const lh =
          left.baseHeights[
            leftEdge
          ];

        const rh =
          right.baseHeights[
            rightEdge
          ];

        const average =
          (lh + rh) * 0.5;

        const leftDelta =
          average - lh;

        const rightDelta =
          average - rh;


        left.heights[
          j * stride + (n - 1)
        ] +=
          leftDelta *
          this.stitchBlend1;

        left.heights[
          j * stride + (n - 2)
        ] +=
          leftDelta *
          this.stitchBlend2;


        right.heights[
          j * stride + 1
        ] +=
          rightDelta *
          this.stitchBlend1;

        right.heights[
          j * stride + 2
        ] +=
          rightDelta *
          this.stitchBlend2;
      }
    }


    /*
      3. 南北方向の境界。

      north (x,y) と
      south (x,y+1)
    */
    for (const north of readySlots) {

      const south =
        this.tiles.get(
          `${north.x}/${north.y + 1}`
        );

      if (
        !south?.ready ||
        !south.mesh.visible
      ) {
        continue;
      }


      /*
        i=1 ... n-1のみ。
        東西方向の共有境界そのものは触らない。
      */
      for (
        let i = 1;
        i < n;
        i++
      ) {

        const northEdge =
          n * stride + i;

        const southEdge =
          i;

        const nh =
          north.baseHeights[
            northEdge
          ];

        const sh =
          south.baseHeights[
            southEdge
          ];

        const average =
          (nh + sh) * 0.5;

        const northDelta =
          average - nh;

        const southDelta =
          average - sh;


        north.heights[
          (n - 1) * stride + i
        ] +=
          northDelta *
          this.stitchBlend1;

        north.heights[
          (n - 2) * stride + i
        ] +=
          northDelta *
          this.stitchBlend2;


        south.heights[
          stride + i
        ] +=
          southDelta *
          this.stitchBlend1;

        south.heights[
          2 * stride + i
        ] +=
          southDelta *
          this.stitchBlend2;
      }
    }


    /*
      4. 共有辺そのものを完全一致させる。

      内側ブレンドを先に行い、
      最後に境界を固定することで
      別方向の補正で再び隙間ができるのを防ぐ。
    */

    /* East-West */
    for (const left of readySlots) {

      const right =
        this.tiles.get(
          `${left.x + 1}/${left.y}`
        );

      if (
        !right?.ready ||
        !right.mesh.visible
      ) {
        continue;
      }

      for (
        let j = 0;
        j <= n;
        j++
      ) {

        const li =
          j * stride + n;

        const ri =
          j * stride;

        const average =
          (
            left.baseHeights[li] +
            right.baseHeights[ri]
          ) *
          0.5;

        left.heights[li] =
          average;

        right.heights[ri] =
          average;
      }
    }


    /* North-South */
    for (const north of readySlots) {

      const south =
        this.tiles.get(
          `${north.x}/${north.y + 1}`
        );

      if (
        !south?.ready ||
        !south.mesh.visible
      ) {
        continue;
      }

      for (
        let i = 0;
        i <= n;
        i++
      ) {

        const ni =
          n * stride + i;

        const si =
          i;

        const average =
          (
            north.baseHeights[ni] +
            south.baseHeights[si]
          ) *
          0.5;

        north.heights[ni] =
          average;

        south.heights[si] =
          average;
      }
    }


    /*
      5. 4Tileが交差する角を統一。

      東西→南北の順に辺を処理すると、
      角だけ最後に書いた方向の値になり得る。

      Global cornerごとに2〜4Tileをまとめ、
      原本DEMの平均値へ完全一致させる。
    */
    const corners =
      new Map();


    const addCorner =
      (
        key,
        slot,
        index
      ) => {

        let list =
          corners.get(key);

        if (!list) {

          list = [];

          corners.set(
            key,
            list
          );
        }

        list.push({
          slot,
          index
        });
      };


    for (const slot of readySlots) {

      addCorner(
        `${slot.x}/${slot.y}`,
        slot,
        0
      );

      addCorner(
        `${slot.x + 1}/${slot.y}`,
        slot,
        n
      );

      addCorner(
        `${slot.x}/${slot.y + 1}`,
        slot,
        n * stride
      );

      addCorner(
        `${slot.x + 1}/${slot.y + 1}`,
        slot,
        n * stride + n
      );
    }


    for (
      const list
      of corners.values()
    ) {

      if (
        list.length < 2
      ) {
        continue;
      }


      let sum = 0;

      for (
        const entry
        of list
      ) {

        sum +=
          entry.slot
            .baseHeights[
              entry.index
            ];
      }


      const average =
        sum /
        list.length;


      for (
        const entry
        of list
      ) {

        entry.slot
          .heights[
            entry.index
          ] =
            average;
      }
    }


    /*
      6. Geometryオブジェクトは交換せず、
      position / normalの中身だけ更新。

      最大25Tile・48分割なので、
      stitch発生時だけなら負荷は小さい。
    */
    for (const slot of readySlots) {

      this.applyHeightsToGeometry(
        slot
      );
    }
  }


  /* ============================================================
     Reuse fixed CanvasTexture
     ============================================================ */

  paintFallback(slot) {

    slot.ctx.fillStyle = '#475653';
    slot.ctx.fillRect(
      0,
      0,
      256,
      256
    );

    slot.texture.needsUpdate = true;

    slot.material.color.set(
      0xffffff
    );
  }


  paintBitmap(slot, bitmap) {

    slot.ctx.clearRect(
      0,
      0,
      256,
      256
    );

    slot.ctx.drawImage(
      bitmap,
      0,
      0,
      256,
      256
    );

    bitmap.close();

    /*
      Textureオブジェクトは同一。
      GPUへ画素だけ再アップロードする。
    */
    slot.texture.needsUpdate = true;

    slot.material.color.set(
      0xffffff
    );
  }


  async tileBitmap(x, y, layer, epoch) {

    const layers = [
      layer,
      ...(
        layer === 'seamlessphoto'
          ? ['std']
          : []
      )
    ];

    for (const currentLayer of layers) {

      try {

        const extension =
          currentLayer === 'seamlessphoto'
            ? 'jpg'
            : 'png';

        const bitmap = await this.image(
          `https://cyberjapandata.gsi.go.jp/xyz/${currentLayer}/${this.z}/${x}/${y}.${extension}`,
          this.abort.signal
        );

        if (epoch !== this.epoch) {
          bitmap?.close();
          return null;
        }

        return bitmap;

      } catch (e) {

        if (e.name === 'AbortError') {
          return null;
        }
      }
    }

    return null;
  }


  /* ============================================================
     Tile loading into pool slot
     ============================================================ */

  async loadSlot(slot, x, y, key, token, epoch) {

    this.active++;

    const requestedLayer = this.layer;
    const requestedLayerGeneration = this.layerGeneration;

    try {

      const [data, bitmap] = await Promise.all([
        this.data(x, y, epoch),
        this.tileBitmap(
          x,
          y,
          requestedLayer,
          epoch
        )
      ]);

      if (!this.isSlotCurrent(
        slot,
        key,
        token,
        epoch
      )) {

        bitmap?.close();
        return;
      }

      // Even if both DEM sources fail, keep the map visible on a clearly reported
      // temporary flat base instead of making the destination disappear.
      slot.elevationMissing = !data;

      slot.data = data;

      this.updateGeometry(
        slot,
        data
      );

      /*
        Layerがロード中に切り替わっていなければ
        取得済み画像をそのまま使う。
      */
      if (
        bitmap &&
        requestedLayerGeneration === this.layerGeneration &&
        requestedLayer === this.layer
      ) {

        this.paintBitmap(
          slot,
          bitmap
        );

      } else {

        bitmap?.close();

        this.paintFallback(
          slot
        );
      }

      if (!this.isSlotCurrent(
        slot,
        key,
        token,
        epoch
      )) {
        return;
      }

      slot.ready = true;
      slot.missing = !data || !bitmap;
      slot.mesh.visible = true;

      /*
        新しい隣接関係が成立したので、
        DEM境界を次フレームでまとめて接続する。
      */
      this.requestStitch();

      /*
        初期ロード中にLayerが変わった場合は
        最新Layerへ更新する。
      */
      if (
        requestedLayerGeneration !== this.layerGeneration ||
        requestedLayer !== this.layer
      ) {
        this.refreshSlotTexture(slot);
      }

    } catch (e) {

      if (
        epoch === this.epoch &&
        e.name !== 'AbortError'
      ) {

        this.failed++;

        console.warn(
          'Terrain tile load failed:',
          key,
          e
        );
      }

    } finally {

      this.active = Math.max(
        0,
        this.active - 1
      );
    }
  }


  /* ============================================================
     Layer refresh using the same Texture object
     ============================================================ */

  async refreshSlotTexture(slot) {

    if (
      !slot ||
      slot.key === null ||
      !slot.ready
    ) {
      return;
    }

    const key = slot.key;
    const token = slot.token;
    const epoch = this.epoch;
    const layer = this.layer;
    const generation = this.layerGeneration;

    const bitmap = await this.tileBitmap(
      slot.x,
      slot.y,
      layer,
      epoch
    );

    const valid = (
      epoch === this.epoch &&
      generation === this.layerGeneration &&
      layer === this.layer &&
      slot.key === key &&
      slot.token === token &&
      this.tiles.get(key) === slot &&
      slot.ready
    );

    if (!valid) {
      bitmap?.close();
      return;
    }

    if (bitmap) {
      this.paintBitmap(slot, bitmap);
    } else {
      this.paintFallback(slot);
    }
  }


  /* ============================================================
     Update
     ============================================================ */

  update(camera) {

    const p = this.tileAt(
      camera.x,
      camera.z
    );

    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);

    const needed = [];

    this.wanted = new Set();

    for (
      let j = -this.radius;
      j <= this.radius;
      j++
    ) {

      for (
        let i = -this.radius;
        i <= this.radius;
        i++
      ) {

        const x = cx + i;
        const y = cy + j;
        const key = `${x}/${y}`;

        const d = Math.max(
          Math.abs(i),
          Math.abs(j)
        );

        this.wanted.add(key);

        needed.push({
          x,
          y,
          key,
          d
        });
      }
    }

    /*
      範囲外TileはPoolへ返すだけ。
      GPU resourceは破棄しない。
    */
    for (const [key, slot] of [...this.tiles]) {

      if (!this.wanted.has(key)) {
        this.releaseSlot(slot);
      }
    }

    /* カメラに近い順 */
    needed.sort(
      (a, b) => a.d - b.d
    );

    for (const tile of needed) {

      if (this.tiles.has(tile.key)) {
        continue;
      }

      if (this.active >= this.maxConcurrent) {
        break;
      }

      const slot = this.getFreeSlot();

      if (!slot) {
        console.warn(
          'Terrain pool exhausted. Increase poolSize.'
        );
        break;
      }

      const token = this.assignSlot(
        slot,
        tile.x,
        tile.y,
        tile.key
      );

      this.loadSlot(
        slot,
        tile.x,
        tile.y,
        tile.key,
        token,
        this.epoch
      );
    }

    let loaded = 0;
    let missing = 0;

    for (const tile of needed) {

      const slot = this.tiles.get(
        tile.key
      );

      if (slot?.ready) {
        loaded++;
      }

      if (slot?.missing) {
        missing++;
      }
    }

    this.onStatus?.(
      loaded,
      needed.length,
      missing
    );
  }


  /* ============================================================
     Terrain height
     ============================================================ */

  height(x, z) {

    const p = this.tileAt(x, z);

    const key =
      `${Math.floor(p.x)}/${Math.floor(p.y)}`;

    const slot = this.tiles.get(key);

    if (
      !slot?.ready ||
      !slot.mesh.visible
    ) {
      return null;
    }

    const n = this.meshResolution;
    const heights = slot.heights;

    const u =
      (p.x - Math.floor(p.x)) * n;

    const v =
      (p.y - Math.floor(p.y)) * n;

    const i = Math.min(
      n - 1,
      Math.floor(u)
    );

    const j = Math.min(
      n - 1,
      Math.floor(v)
    );

    const fx = u - i;
    const fy = v - j;

    const a = heights[
      j * (n + 1) + i
    ];

    const b = heights[
      j * (n + 1) + i + 1
    ];

    const c = heights[
      (j + 1) * (n + 1) + i
    ];

    const d = heights[
      (j + 1) * (n + 1) + i + 1
    ];

    return (
      fx + fy <= 1
        ?
        a +
        (b - a) * fx +
        (c - a) * fy
        :
        d +
        (c - d) * (1 - fx) +
        (b - d) * (1 - fy)
    );
  }


  /* ============================================================
     Layer switching
     ============================================================ */

  setLayer(layer) {

    if (layer === this.layer) {
      return;
    }

    this.layer = layer;
    this.layerGeneration++;

    /*
      mapオブジェクトは交換しない。
      各Slotの同じCanvasTextureへ新画像を描くだけ。
    */
    for (const slot of this.tiles.values()) {

      if (
        slot.ready &&
        slot.key !== null
      ) {
        this.refreshSlotTexture(slot);
      }
    }
  }


  /* ============================================================
     Optional final cleanup

     アプリ自体を終了しRendererも止めた後だけ呼ぶ用途。
     通常の移動中には呼ばない。
     ============================================================ */

  destroy() {

    this.abort.abort();

    this.tiles.clear();
    this.cache.clear();

    for (const slot of this.slots) {

      slot.mesh.visible = false;
      this.scene.remove(slot.mesh);

      slot.geometry.dispose();
      slot.material.dispose();
      slot.texture.dispose();
    }

    this.slots.length = 0;
  }
}