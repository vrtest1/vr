# AtmosphereEngine

空、太陽、雲、光源、空気遠近をまとめて担当します。

![夕焼け（high プリセット、地形は TerrainEngine）](../../docs/images/atmosphere-sunset.png)

- デモ: `examples/atmosphere/`（地形 + 大気）　最小サンプル: `examples/atmosphere/minimal.html`（普通の three.js シーンに追加する例）
- 依存: three.js（r170 で確認）、`src/core/`

## 仕組み

- **空** — Hillaire (2020) の方式による物理ベースの大気散乱。透過率 LUT（256×64）と多重散乱 LUT（32×32）は大気の状態が変わったときだけ、sky-view LUT は太陽高度かカメラ高度が変わったフレームだけ描き直します。時刻が止まっていれば LUT の描画は 0 回です。
- **太陽と夜空** — 周辺減光つきの太陽円盤、星、夜の大気光。朝焼け・夕焼けの色は散乱の計算から自然に出ます。
- **雲** — 1 層の雲をレイマーチ。画面より小さいバッファに毎フレーム違うサンプル位置で描き、前のフレームまでの結果をカメラの回転・移動に合わせて再投影して混ぜます（フレーム間の蓄積）。少ないステップ数でも粒状感が出ず、細かい凹凸まで出せます。雲量は `WorldEnvironment.cloudCover`、流れる向きと速さは風に従います。ノイズは起動時に CPU で生成するタイル可能なテクスチャ 1 枚（256×256、約 90 ms）。
- **光源** — 太陽光（DirectionalLight）と天空光（HemisphereLight）の色と強さを同じ大気モデルから求めるので、地面の明るさと空の明るさが時刻・天候を通じて一致します。太陽の影はカメラに追従します。
- **空気遠近** — `applyTo(material)` したマテリアルは、距離に応じてその方向の空の色へ溶け込みます（青から先に霞む）。視程 `visibility` が霞の濃さになります。

## API

```js
const atmosphere = new AtmosphereEngine({
  environment,           // WorldEnvironment（省略時は内部で既定値を持つ）
  quality: 'high',
  params: { cloudBase: 2000 },
  lights: true,          // false にすると光源を作らない（自前のライトを使う場合）
});
await atmosphere.init(renderer);   // 必須。LUT を作る
atmosphere.addTo(scene);
atmosphere.applyTo(terrain.mesh.material);   // 空気遠近を付けたいマテリアルに
atmosphere.update(deltaTime, camera);        // 毎フレーム
```

`World` を使う場合は `await world.add(new AtmosphereEngine())` だけで `init` まで済みます。
共通メソッドは [docs/API.md](../../docs/API.md) を参照。

### AtmosphereEngine 固有

| メンバー | 意味 |
|---|---|
| `await init(renderer)` | LUT とノイズを作る。`update` の前に必須 |
| `applyTo(material)` | マテリアルに空気遠近を付ける。three の標準マテリアルと TerrainEngine のマテリアルに対応。そのマテリアルでは `scene.fog` の代わりになる |
| `applyToObject(object3d)` | 配下の Standard / Lambert / Phong / Basic マテリアルすべてに `applyTo` |
| `removeFrom(material)` | `applyTo` を取り消す（`dispose()` 時は自動） |
| `sunLight` / `skyLight` | エンジンが持つ DirectionalLight / HemisphereLight（`lights: false` なら null） |
| `model` | CPU 版の大気モデル（`AtmosphereModel`）。`transmittance()` / `skyRadiance()` / `meanSkyRadiance()` |

明るさの基準は `sunIrradiance`（大気圏外での太陽の放射照度、既定 20）です。デモは ACES トーンマッピング + 露出 0.42 で合わせてあります。

### パラメータ

| 名前 | 既定値 | 範囲 | 意味 |
|---|---|---|---|
| `sunIrradiance` | 20 | 1–100 | 全体の明るさの基準 |
| `rayleighScale` | 1 | 0–4 | 空気分子による散乱（空の青さ） |
| `hazeScale` | 1 | 0–4 | 視程から求めた霞の量への倍率 |
| `mieAnisotropy` | 0.8 | 0–0.95 | 霞の前方散乱の強さ（太陽のまわりの輝き） |
| `ozoneScale` | 1 | 0–4 | オゾン吸収（夕暮れの空の深い青） |
| `groundAlbedo` | `#8f8a7c` | 色 | 多重散乱で使う地表の反射率 |
| `sunDiskScale` | 1 | 0.2–10 | 太陽円盤の大きさ（1 = 実寸） |
| `sunDiskBrightness` | 0.02 | 0–1 | 太陽円盤の輝度（1 = 物理値。トーンマッピング前提なら小さくてよい） |
| `stars` | 1 | 0–4 | 星の明るさ |
| `clouds` | true | — | 雲の有無 |
| `coverageBias` | 0 | -1–1 | `cloudCover` に足す補正 |
| `cloudBase` | 1600 | 200–8000 | 雲底の高さ（水位からの m） |
| `cloudThickness` | 1500 | 200–5000 | 雲の厚さ（m） |
| `cloudScale` | 18000 | 2000–80000 | 雲の模様 1 タイルの大きさ（m） |
| `cloudDensity` | 1 | 0–4 | 雲の濃さ |
| `temporalClouds` | true | — | 雲をフレーム間で蓄積する。false にすると空のパス内で 1 フレームごとに描く（粗くなる） |
| `cloudSpeed` | 1 | 0–30 | 風速に対する雲の流れの倍率 |
| `sunLightScale` / `skyLightScale` | 1 | 0–4 | 光源の強さへの倍率 |
| `castShadow` | true | — | 太陽の影 |
| `shadowRange` | 700 | 50–5000 | カメラの周囲で影を描く範囲（m） |
| `aerialPerspective` | 1 | 0–4 | 空気遠近の強さ（0 で無効） |

### WorldEnvironment との対応

| 環境の値 | 効果 |
|---|---|
| `timeOfDay` / `dayOfYear` / `latitude` | 太陽の位置 → 空の色、光源、影 |
| `visibility` | 霞の量（消散係数 = 3.912 / 視程 から空気分を引いた残り）。約 7 km 未満の濃い霧は空気遠近側に灰色の減衰として足す |
| `cloudCover` | 雲量、太陽光の減衰、曇天時の灰色の天空光 |
| `windDirection` / `windSpeed` | 雲の流れ |
| `waterLevel` | 高度 0 の基準 |

### 品質プリセット

| | ultra | high | medium | low |
|---|---|---|---|---|
| sky-view LUT | 256×144 | 192×108 | 160×90 | 128×72 |
| 散乱のサンプル数 | 40 | 32 | 24 | 16 |
| 雲のステップ数 | 40 | 24 | 12 | 6 |
| 雲の光源方向サンプル | 5 | 4 | 2 | 1 |
| 雲バッファの解像度（画面比） | 0.75 | 0.5 | 0.5 | 0.4 |
| 雲の履歴の重み | 0.92 | 0.9 | 0.9 | 0.9 |
| 影マップ | 4096 | 2048 | 1024 | なし |

## パフォーマンス実測

Apple M4 Max、Chrome（ヘッドレス、ANGLE Metal）、1280×720、地形 + 大気のデモ（雲量 0.4、対数深度）。地形も同じプリセットです。

| プリセット | FPS | GPU 時間（地形込み） | CPU 時間 |
|---|---|---|---|
| ultra | 60（上限） | 9.6 ms | 0.1 ms |
| high | 60（上限） | 5.2 ms | 0.6 ms |
| medium | 60（上限） | 1.7 ms | 0.5 ms |
| low | 60（上限） | 0.6 ms | 0.4 ms |

上の表は雲の蓄積を入れる前の計測です。蓄積の追加コストは、同じ実行内でオン / オフを切り替えた比較でおおむね 1 ms 以内でした（計測時の負荷のゆらぎが大きく、これ以上細かい数字は出せていません）。

時刻を進めている間は sky-view LUT を毎フレーム描き直します（0.6 秒で 36 回を確認）。**iPhone と Quest 3 ではこのエンジンをまだ計測していません。**

## 既知の制限

- **雲の蓄積は約 10 フレームかけて収束する。** 起動直後、画面サイズや品質を変えた直後、雲のパラメータを大きく変えた直後は、一瞬だけ粗い雲が見えます。カメラを速く回している間は、再投影の補間で雲がわずかに柔らかくなります。
- **XR 中は蓄積しない。** 両眼それぞれのカメラに対応していないため、XR セッション中は空のパス内で 1 フレームごとに描く方式に戻ります（粒状感が出ます）。
- **雲は 1 種類の積雲だけ。** 上に向かってすぼまる塊にはなりますが、巻雲・層雲・入道雲のような種類の描き分けはありません。
- **雲は 1 層だけで、地面に影を落とさない。** 曇天時は太陽光全体を暗くするだけです。雲の中や上を飛ぶことはできますが、内部の見え方は粗いです。
- **空気遠近は近似。** 「その方向の空の色」へ減衰率に応じて混ぜる方式で、地形による太陽光の遮蔽（山の影の中の霞が暗くなる効果、光芒）は含みません。これは VolumetricEngine の担当です。
- **光源の色は単一散乱 + 定数補正（×1.25）で CPU 計算。** 空そのものは多重散乱 LUT を使うので、天空光の強さが空の見た目と少しずれている可能性があります（ずれの大きさは未計測）。
- **月がない。** 夜は星と弱い大気光だけです。夜間の地表はほぼ真っ暗になります。
- **雨・雪の粒子、雷、虹は未実装。** `precipitation` は地形の濡れと積雪には効きますが、降ってくる表現はありません。
- **地表付近専用。** カメラ高度 80 km までを想定し、宇宙からの眺めには対応しません。地球の大きさと大気の厚さは固定です。
- **`applyTo` は three のシェーダチャンク名に依存**（`fog_vertex`、`tonemapping_fragment`）。r170 で確認。`ShaderMaterial` など独自シェーダには自動では付きません（`AERIAL_*` のチャンクを自分で組み込む必要があります）。
- **HalfFloat のレンダーターゲットが必要**（WebGL2 で `EXT_color_buffer_float` か `EXT_color_buffer_half_float`）。現行の主要ブラウザは対応しています。
- **透明物体の後ろの空。** 空は不透明パスの最後に描くので、透明マテリアルとの合成順は通常どおりですが、`renderOrder` を 10000 以上にした不透明物体は空より後に描かれます。
