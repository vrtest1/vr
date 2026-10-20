# VOLT Volcano（Web版）

全国の噴火の発表（気象庁「噴火に関する火山観測報」）を一覧にし、選んだ火口へ移動して噴煙を3D地形上に表示する静的Webアプリ。Unity版 `Volt_Volcano_Plume` シーンの移植です。

## 起動
ES modules を使うため、ファイルを直接開かず HTTP サーバー経由で開きます。

```
python -m http.server 8765
```
→ http://127.0.0.1:8765/

GitHub Pages など静的ホスティングに、このフォルダ一式をそのまま置けます（サーバー処理・APIキー不要、ビルド不要）。

## 構成
| ファイル | 内容 |
|---|---|
| `index.html` / `volcano.css` | 画面。`style.css` は元の VOLT Disaster v3.15 のもの |
| `app.js` | カメラ・地名検索・地形・描画ループ（元アプリから災害一覧を除いたもの）と、火口への移動・構図 |
| `volcano-feed.js` | 気象庁 防災情報XML（eqvol フィード）から VFVO52/56/60 を取得・解析、warning.json の警戒レベル |
| `volcano-plume.js` | 噴煙の粒子シミュレーションと描画（three.js SpriteNodeMaterial のインスタンス描画） |
| `volcano-panel.js` | 噴火一覧・詳細・箱根山の想定／2015年再現・噴煙量・新着の自動表示 |
| `detail-texture.js` | カメラに近いズーム13の地形に、ズーム15の写真・地図 4×4枚から作った 1024px テクスチャを貼る（約16 m/px → 約4 m/px）。PC 12枚・スマホ 6枚・省電力 4枚まで |
| `near-imagery.js` | カメラ周辺の高精細写真を真上から投影（地形・高精細テクスチャ・建物の屋根）。PC：ズーム18（約0.5 m/px）約1 km四方＋ズーム16（約2 m/px）約4 km四方、スマホ：ズーム17 約2 km四方。9×9（スマホ 8×8）タイルのリングバッファで、移動時は入れ替わった端だけ読み直す。地上から高いと自動で無効（ズーム18は2,500 m、ズーム16は12,000 m） |
| `near-terrain.js` | カメラ周辺の詳細地形：国土地理院 DEM5A（航空レーザー 5 m）→ DEM5B（5 m）→ DEM10B（10 m）で約1 km四方のタイルを作る（PC 5×5・格子約8 m、スマホ 3×3・約16 m）。範囲内の粗い地形は描かず、頂点も細かい地形の下へ押し下げる。タイル同士の縁は高さ・法線を平均してそろえる。地上から5,000 m以上で停止。「詳細地形（5 m）」スイッチ |
| `plateau.js` | PLATEAU 建物（3D Tiles b3dm + Draco）。テクスチャ付き LOD2 は元のテクスチャ、無い部分は屋根に航空写真・壁は灰色。LOD2：半径 2 km（スマホ 1 km）を LOD2、外側 6 km（スマホ 3 km）までを LOD1（建物ごとに中心の距離で振り分け）。LOD1：半径 6 km。「LOD2の範囲を10倍」で LOD2 を半径 20 km（最大 400 タイル）まで。`volt_map_base/lib/plateau.js` と同じ（読み込みパスのみ違う） |
| `plateau-geoid.json` | 国土地理院 ジオイド2011 を PLATEAU 対象市区町村の範囲で 0.2° 格子に計算した表（国土地理院 API はブラウザから直接呼べないため同梱）。範囲外は建物の接地高さと地形の差から推定 |
| `terrain.js` ほか | 元アプリの地形 LOD（`terrain.js`・`lod-plan.js`・`terrain-seams.js`・`tile-cache.js` は変更なし。`lod-terrain.js` は高精細テクスチャ・周辺写真の呼び出しと、地形マテリアルの NodeMaterial 化を追加） |
| `map-gestures.js` | 元アプリのマウス・タッチ操作（変更なし） |
| `vendor/three.*.js` | three.js r180（WebGPU ビルド、TSL） |
| `vendor/addons/` | three.js r180 付属の GLTFLoader、DRACOLoader、BufferGeometryUtils |
| `vendor/draco/` | Draco デコーダ（wasm）。three.js r180 に同梱のもの |

## データ
- 気象庁 防災情報XML：`eqvol_l.xml`（起動時、約1週間分）→ `eqvol.xml`（60秒ごと）。CORS 許可あり（`Access-Control-Allow-Origin: *`、2026-10-20 確認）。
- 噴煙の高さ・流向・噴煙量は「噴火に関する火山観測報」、上空の風は同時に出る「推定噴煙流向報」。
- 噴煙の広がり・降灰の筋は見た目の再現で、拡散計算や降灰予報ではありません。
- 箱根山の「想定」は仮の値。「2015年 再現」は気象庁 火山活動解説資料（平成27年6・7月）の記録（噴煙 約50 m、降灰 北〜北東 最大約1.2 km）。向き・風速は推定・仮定。火口位置は国土地理院の地名「大涌谷」の点で、15-1火口の測量座標ではありません。
- 建物：国土交通省 PLATEAU（`api.plateauview.mlit.go.jp/datacatalog` の全国 3D Tiles）。CORS 許可あり（2026-10-20 確認）。箱根町はテクスチャ無し、品川区などは一部テクスチャ付き。

## ライセンス
- three.js：MIT License（`vendor/THREE-LICENSE.txt`）。`vendor/addons/` も three.js の一部です。
- Draco デコーダ（Google）：Apache License 2.0（`vendor/draco/LICENSE`、google/draco リポジトリから取得）。
- 地図・標高・写真・地名検索：国土地理院（地理院タイル、地名検索、ジオイド2011）。画面下に出典を表示しています。
- 建物：国土交通省 PLATEAU（3D都市モデル）。建物の表示中は画面下に出典を表示します。
- 火山情報：気象庁 防災情報XML（気象庁ホームページの利用規約に従って加工）。
