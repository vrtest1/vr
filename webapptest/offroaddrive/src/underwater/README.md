# UnderwaterEngine

水中の光の見え方を、ポストプロセスなしで既存のマテリアルに足します。

![浅瀬の海底とコースティクス（high プリセット）](../../docs/images/underwater.png)

- デモ: `examples/underwater/`（地形 + 大気 + 海 + 水中 + 音）　最小サンプル: `examples/underwater/minimal.html`（海も地形もなしで動く例）
- 依存: three.js（r170 で確認）、`src/core/`

## 仕組み

`applyTo(material)` したマテリアルは、トーンマッピングの直前に次の処理を受けます。

- **深さによる色の変化** — 水面下の点は、深いほど太陽光が届きません。赤から先に失われ、青緑が残ります。
- **コースティクス** — 水面の模様を太陽の向きに沿って水中へ投影した、ゆらめく光の網。水面下にあるものすべてに掛かり、深いほどぼやけます。
- **水の色への溶け込み** — カメラから点までの経路のうち「水中にある区間」の長さに応じて、波長ごとに減衰させ、水の色を足します。カメラが水上にあっても効くので、浅瀬の海底を上から見たときも同じ処理になります。
- **光芒** — カメラが水中のとき、視線に沿って数点でコースティクスの模様を調べ、明るいところほど散乱光を強めます。

カメラが水中にある間は、空の代わりに「水だけが見える方向」の背景もエンジンが描きます。水面を下から見たときの見え方（真上に空が丸く見えるスネルの窓、その外側の全反射）は OceanEngine のシェーダが担当します。

## API

```js
const underwater = new UnderwaterEngine({
  environment,
  quality: 'high',
  waterHeight: (x, z) => ocean.getHeightAt(x, z),   // 省略時は平らな水位
});
underwater.addTo(scene);
underwater.applyTo(terrain.mesh.material);
underwater.applyTo(ocean.material, { surface: true });   // 水面そのもの
underwater.applyToObject(shipwreck);                      // 配下の標準マテリアル全部
underwater.update(deltaTime, camera);                     // 毎フレーム
```

AtmosphereEngine の `applyTo` も同じマテリアルに使う場合は、**大気を先、水中を後**に呼んでください（水中の区間に付いた霞を水の色が覆うようにするため）。

| メンバー | 意味 |
|---|---|
| `applyTo(material, { surface })` | マテリアルに水中の光学を足す。`surface: true` は水面用（下から見たときの距離減衰だけを受ける） |
| `applyToObject(object3d)` | 配下の Standard / Lambert / Phong / Basic マテリアルすべてに `applyTo` |
| `removeFrom(material)` | 取り消し（`dispose()` 時は自動） |
| `submerged` | 直近の `update()` でカメラが水面下だったか |
| `depth` | カメラの水深（m、水上では負） |

### パラメータ

| 名前 | 既定値 | 範囲 | 意味 |
|---|---|---|---|
| `clarity` | 40 | 2–120 | 水中の見通し（m）。緑の光が約 5 % まで減る距離 |
| `waterColor` | `#2a8fb0` | 色 | 水の色（散乱光の色） |
| `brightness` | 1 | 0–4 | 水の色の明るさ |
| `strength` | 1 | 0–2 | 効果全体の強さ（0 で無効） |
| `caustics` | 1 | 0–3 | コースティクスの強さ |
| `causticScale` | 7 | 1–40 | コースティクスの模様の大きさ（m） |
| `rays` | 1 | 0–3 | 光芒の強さ |
| `timeScale` | 1 | 0–4 | ゆらめきの速さ |

水の明るさは `WorldEnvironment` の空の色（`skyZenith` / `skyHorizon`）から決めるので、夕方や夜、曇天では水中も暗くなります。コースティクスと光芒は太陽が出ているときだけ現れます。

### 品質プリセット

| | ultra | high | medium | low |
|---|---|---|---|---|
| 光芒のサンプル数（画素あたり） | 10 | 8 | 5 | なし |

## パフォーマンス実測

Apple M4 Max、Chrome（ヘッドレス、ANGLE Metal）、1280×720、5 エンジンのデモで浅瀬の水中（画面全体が水中の処理を受ける、いちばん重い状況）。

| プリセット | FPS | GPU 時間（全エンジン合計） |
|---|---|---|
| ultra（サンプル 12 で計測） | 60（上限） | 16.3 ms |
| high（サンプル 8） | 60（上限） | 9.2 ms |
| medium（サンプル 5） | 60（上限） | 6.1 ms |
| low | 60（上限） | 1.9 ms |

ultra は 60fps の予算ぎりぎりだったため、計測後にサンプル数を 12 から 10 に下げました（下げた後の再計測はしていません）。水上にいるときの追加コストは high で 1 ms 弱です。**iPhone と Quest 3 では未計測です。**

## 既知の制限

- **画面全体のゆがみ・ぼかしがない。** 水中特有の像の揺らぎ、被写界深度、水面を境にした屈折のずれは、画面全体への後処理が必要なため未実装です（PostProcessEngine の担当）。
- **水面の出入りは瞬時に切り替わる。** カメラが水面をまたぐ瞬間の、画面の上半分が水上・下半分が水中という状態は表現できません。
- **光芒にざらつきが残ることがある。** 少ないサンプル数を画素ごとのずらしで補っています。
- **コースティクスは模様の投影。** 実際の波の形から計算したものではないので、波の向きや高さとは連動しません。物陰でも消えません（影は考慮しません）。
- **浮遊物（マリンスノー）や泡の粒子はない。**
- **`applyTo` していないマテリアルは水の影響を受けない。** 水中に置いた物体が、霞まずにくっきり見えてしまいます。`ShaderMaterial` など独自シェーダには自動では付きません。
- **水位は 1 つ。** 水面の高さは `WorldEnvironment.waterLevel` の平面として扱い、波による上下はカメラの水没判定（`waterHeight`）にだけ使います。
- **three のバージョン依存。** `fog_vertex` と `tonemapping_fragment` のチャンク名に依存しています。r170 で確認。
