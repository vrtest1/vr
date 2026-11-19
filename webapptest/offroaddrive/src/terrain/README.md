# TerrainEngine

無限に続くプロシージャル地形。LOD、バイオーム、CPU からの高さ問い合わせつき。

- デモ: `examples/terrain/`　最小サンプル: `examples/terrain/minimal.html`
- 依存: three.js（r170 で確認）、`src/core/`

## 仕組み

- **形状** — 大陸ノイズ（海と陸、山の出る場所）+ ドメインワープ + 尾根つき fBm。急な場所ほど細かい起伏を弱める「侵食」項つき。高さと勾配を解析的に求めるので、法線に差分計算が要りません。
- **LOD** — CDLOD。1 枚の格子パッチを四分木のノードごとにインスタンス描画し、頂点シェーダで LOD 間をモーフして高さを計算します。CPU が行うのはノードの選択だけで、頂点には触れません（デモ全体の CPU 時間は実測で 1 ms 未満）。スカートなしで LOD の継ぎ目が合う設計です。
- **無限** — 四分木のルートをカメラ周囲にタイル状に並べるので、どこまで移動しても同じ密度で描かれます。メッシュの生成待ちやストリーミングはありません。
- **陰影** — `MeshStandardMaterial` を拡張。three のライト・影・フォグがそのまま効きます。high 以上では高さ関数をピクセルごとに再評価して法線を出すため、遠景の稜線までディテールが残ります。
- **バイオーム** — 高さ・傾斜・気温（標高で低下）・湿度から、砂 / 植生 / 岩 / 雪を決めます。`WorldEnvironment` の気温・湿度・水位・降水に追従します。

## API

```js
const terrain = new TerrainEngine({
  environment,          // WorldEnvironment（省略可）
  quality: 'high',      // 'ultra' | 'high' | 'medium' | 'low'
  params: { seed: 42 }, // 下表のパラメータ
});
terrain.addTo(scene);
terrain.update(deltaTime, camera);   // 毎フレーム
```

共通メソッド（`addTo / removeFromScene / update / setQuality / setParameters / getParameters / getStats / dispose / on`）は [docs/API.md](../../docs/API.md) と [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) を参照。

### TerrainEngine 固有

| メンバー | 意味 |
|---|---|
| `getHeightAt(x, z)` | 地形の高さ（m）。全ディテール。約 1 µs / 回 |
| `getRenderedHeightAt(x, z)` | 実際に描かれているメッシュの高さ（遠方はオクターブが少ない）。直近の `update()` のカメラ基準 |
| `getNormalAt(x, z, target?)` | 単位法線（Vector3） |
| `getSlopeAt(x, z)` | 傾斜（度） |
| `getBiomeAt(x, z, target?)` | `{ sand, vegetation, rock, snow, moisture, temperature, height, slope }`。重みの合計は 1 |
| `raycast(origin, direction, maxDistance?, target?)` | レイと地形の交点（Vector3）または null |
| `getHeightShader({ functionName, octaves })` | 高さ関数を GLSL として取り出す（`{ glsl, uniforms }`）。他のシェーダが地面の高さを画素ごとに知るために使う（海の水深など） |
| `setCover({ glsl, uniforms })` | 地面に生えているものの色を受け取る。`glsl` は `vec3 pweCover(vec3 albedo, vec3 worldPos, vec4 ground, vec2 climate)` を定義する（`ground` = 生えやすさ・乾燥度・傾斜・植生の割合、`climate` = 気温・湿り気）。植生の草や森が描かれない遠くの地面にも同じ色が付く。VegetationEngine とは `terrain.setCover(vegetation.getCoverShader())`。`null` で解除 |
| `getGroundShader({ prefix, octaves })` | 高さと「植生の生えやすさ・乾燥度」を GLSL として取り出す。地面に物を置くシェーダ用（植生の草） |
| `viewDistance` | 地形が描かれる最大距離（m）。`camera.far` はこれ以上に |
| `heightRange` | 現在のパラメータでの高さの `[最小, 最大]`（余裕を見た値） |
| `mesh` | 描画に使っている Mesh（layers や renderOrder の設定用） |
| `heightField` | CPU 版の高さ関数（`TerrainHeightField`）。three にも WebGL にも依存せず、Worker や Node でも動く |

`getHeightAt` は GPU と同じ整数ハッシュ・同じ式で計算するので、返る高さは描画された地表と一致します（デモの「scatter 200 markers」で確認できます）。

### パラメータ（`setParameters`）

すべてユニフォームの更新だけで反映され、メッシュの再生成は起きません。

| 名前 | 既定値 | 範囲 | 意味 |
|---|---|---|---|
| `seed` | 1337 | 0–99999 | 乱数の種 |
| `featureScale` | 3200 | 300–10000 | 最大の起伏の水平サイズ（m） |
| `heightScale` | 1300 | 0–4000 | 高さの倍率（m） |
| `baseHeight` | 80 | -500–500 | 全体の上下オフセット（m）。水域の割合が変わる |
| `octaves` | 11 | 1–13 | fBm のオクターブ数 |
| `lacunarity` | 2.0 | 1.7–2.4 | オクターブごとの周波数倍率 |
| `gain` | 0.5 | 0.3–0.62 | オクターブごとの振幅倍率（大きいほど荒い） |
| `ridge` | 0.8 | 0–1 | 尾根の鋭さ（0 = 丸い丘、1 = 尖った稜線） |
| `ridgeDetail` | 0.7 | 0–1 | 細かい起伏にどれだけ尾根を残すか。大きいほど斜面に細かいしわが出る（1 で全オクターブが尾根） |
| `erosion` | 0.5 | 0–4 | 急斜面でディテールを弱める強さ |
| `warp` | 0.5 | 0–1 | ドメインワープの強さ（地形のうねり） |
| `continent` | 0.7 | 0–2 | 大陸スケールの高低差 |
| `rockSlope` | 36 | 10–80 | これより急な斜面は岩（度） |
| `snowTemperature` | 0 | -15–15 | これより寒いと雪（℃） |
| `lapseRate` | 6.5 | 0–30 | 標高 1 km あたりの気温低下（℃） |
| `beachHeight` | 3 | 0.2–20 | 水面から砂浜になる高さ（m） |
| `sandColor` `grassColor` `dryGrassColor` `rockColor` `snowColor` | — | 色 | 各素材の基本色 |
| `castShadow` / `receiveShadow` | true | — | 影 |
| `frustumCulling` | true | — | 画面外のノードを描かない |
| `wireframe` | false | — | ワイヤーフレーム |
| `debugView` | `'none'` | `none / lod / normals / slope / biome / climate` | デバッグ表示 |

### 品質プリセット

| | ultra | high | medium | low |
|---|---|---|---|---|
| パッチ分割数 | 64 | 48 | 32 | 16 |
| 最小の頂点間隔 | 0.5 m | 0.67 m | 1 m | 2 m |
| LOD レベル数 | 10 | 10 | 9 | 8 |
| LOD 距離係数 | 4.0 | 3.5 | 3.0 | 3.0 |
| 描画距離 | 65.5 km | 57.3 km | 24.6 km | 12.3 km |
| ピクセル単位の法線 | あり | あり | なし（頂点法線） | なし |
| 陰影専用の追加オクターブ | 3 | 2 | 0 | 0 |
| マイクロバンプ | あり | あり | あり | なし |

`leafSize`（最細パッチの一辺）は全プリセットで 32 m です。

## パフォーマンス実測

Apple M4 Max、Chrome（ヘッドレス、ANGLE Metal）、1280×720、デモの山岳地点、影あり。
三角形数は影パスとの合計（`renderer.info`）。CPU 時間はデモ全体の update + 描画命令の発行。

| プリセット | FPS | GPU 時間 | CPU 時間 | 三角形 | ノード数 |
|---|---|---|---|---|---|
| ultra | 60（上限） | 8.1 ms | 0.3 ms | 583 万 | 356 |
| high | 60（上限） | 6.4 ms | 0.6 ms | 292 万 | 317 |
| medium | 60（上限） | 1.7 ms | 0.6 ms | 99 万 | 241 |
| low | 60（上限） | 0.45 ms | 0.4 ms | 12 万 | 227 |

iPhone 実機では medium で 60fps を確認しています（機種は未記録、GPU 時間は Safari では取得不可）。**Meta Quest 3 ではまだ計測していません。**

## 既知の制限

- **近景の地面は色と陰影のむらだけ。** 近づくと土の見える斑、明暗、細かい凹凸の陰影が出ますが、テクスチャ画像や石・落ち葉などの立体物はありません。

- **原点から遠いと精度が落ちる。** ワールド座標を float32 でそのまま使うため、原点から数十 km を超えると頂点が震え始めます。原点の付け替え（floating origin）は未実装です。
- **遠景の深度精度。** 描画距離が数十 km あるので、通常の深度バッファでは遠くの水際など面が近接する場所がちらつきます。レンダラーを `logarithmicDepthBuffer: true` で作ってください（デモは既定で有効。GPU 時間の増加は実測で 0.15–0.5 ms）。
- **水際は LOD でわずかに動く。** 遠方の地形は粗いメッシュなので、単純な水面を置くとカメラの移動で交線が少し変わります。OceanEngine に `seabed` を渡すと、水際を高さ関数から画素単位で決めるので目立たなくなります。
- **影と視錐台カリング。** 画面外のノードは影マップにも描かれないため、画面外の山が落とす影は出ません。必要なら `frustumCulling: false`（三角形数は約 3–4 倍）。
- **点光源の影は非対応**（`customDistanceMaterial` なし）。平行光源とスポットライトの影は対応。
- **オーバーハングや洞窟は作れない**（高さ場のため）。
- **侵食は近似。** 傾斜でディテールを弱めるだけで、水の流れのシミュレーションではありません。川や谷筋はできません。
- **地表はテクスチャなしの色とノイズだけ。** 至近距離（数十 cm）では単調に見えます。草や木は VegetationEngine が足します。
- **LOD は水平距離が基準。** 高さの範囲を安全側に広く取っているため、高空から見下ろすときは必要以上に細かく描きます。
- **`getRenderedHeightAt` は頂点間の三角形補間を含まない**ので、low では数 cm–数十 cm ずれることがあります。
- **ノード数の上限は 4096。** 超えた分は描かれず、`getStats().overflow` に出ます（既定のプリセットでは約 360 まで）。
- **`lodFactor` は 3 未満にできない**（隣接ノードの LOD 差が 2 になり亀裂が出るため、内部で 3 に切り上げ）。
- **three のバージョン依存。** `onBeforeCompile` でシェーダチャンク名（`begin_vertex`、`normal_fragment_begin` など）を置換しています。r170 で確認済みで、チャンク構成が変わる版では調整が必要です。
- **WebXR は未検証。** デモに VR ボタンとスティック移動を入れてありますが、実機では試していません。
- デモの空（three の Sky）・水面（平面）・フォグは仮のもので、Atmosphere / Ocean の各エンジンが置き換えます。
