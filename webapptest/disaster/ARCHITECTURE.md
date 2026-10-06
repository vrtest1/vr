# v3の追加設計（現行）

- `lod-plan.js`：通信・描画非依存の四分木計画と、親子の排他的表示選択。
- `lod-terrain.js`：元Terrainを5段階で再利用する管理層。読込済みの親を保持し、子の領域が揃ってから切替。標高参照は表示中の最精細レベルを優先。
- `tile-cache.js`：画像メモリキャッシュ、同時HTTP取得数の上限、欠損応答の短期記録。
- `terrain.js`：オプションによるレベル・メッシュ密度設定、共有DEMキャッシュ、DEM全欠損時の暫定平面表示を追加。
- カメラ：far650km、最高高度300km、広域俯瞰、高度に応じた移動速度とnear。

以下はv1/v2時点の基礎構造の記録です。描画範囲・カメラfar・地形の無変更に関する記述は上記とREADMEのv3節を優先してください。

# 既存VOLTの解析と設計

## 1. 再利用する部分

`terrain.js`はDEMデコード、メッシュプール、タイル取得、中断・世代管理、隣接タイルの縫合、標高補間、メルカトル変換を持ち、雷雨モジュールと独立していました。v1では無変更でコピー。v2では表示半径・プール数・写真の色補正のみ変更しました。
`app.js`のカメラ（FOV62、near2、far45000）、WASD/QE/Shift、ドラッグ回転、ホイール・ピンチ移動、移動パッド、地名検索、プリセット、品質切替を残しました。
WebGPU初期化失敗時のWebGL2フォールバック、DPR制限、低FPS時の品質切替も残しています。UIの色・文字・半透明パネル・折りたたみを継承しました。

## 2. 削除する部分

`weather.js`、`rain.js`、`lightning.js`、`audio.js`と呼び出しを削除。落雷予約・乱数、音声許可、雷の距離計算、雨霧の強度調整、タップ落雷モード、雷用Bloom、専用UIを除去。
表示時刻は災害データの発表・取得時刻に一本化し、演出上の昼夕夜切替は削除しました。

## 3. 災害データ取得層

`JmaSource.load(progress)`は `{events,fetchedAt,feeds,errors,truncated,failed,coverage}` を返します。
将来のDataSourceも同じ返り値に合わせます。DataSourceは位置・範囲を公式に取得できないとき、nullまたは空のvisualizationsを返します。市名から勝手に緯度経度を推測しません。
HTMLのスクレイピングや公開CORSプロキシ、APIキー、有料サービスは使いません。

## 4. 共通Disaster Event Schema

```ts
interface DisasterEvent {
  schemaVersion: 1;
  id: string;
  type: 'earthquake'|'tsunami'|'volcano'|'rain'|'landslide'|'road'|'railway'|'shelter';
  title: string;
  status: 'CONFIRMED'|'MULTIPLE_REPORTS'|'SINGLE_REPORT'|'ESTIMATED';
  severity: 'warning'|'advisory'|'information'|'unknown';
  severityReason: string;
  lifecycle: 'bulletin'|'cancelled'; // 未確認のものをactiveとは呼ばない
  informationKind: 'official_forecast'|'official_bulletin';
  summary: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  updatedAt: string;
  fetchedAt: string;
  validUntil: string|null;
  latitude: number|null;
  longitude: number|null;
  visualizations: Visualization[];
  details: [string,string][];
  sourceKind: string;
}
```

地震の色は公表震度に基づくUI上の分類であり、被害や危険区域の推定ではありません。火山・津波等を本文キーワードだけで危険度分類しません。
将来は`sources[]`（独立性の根拠を含む）、位置推定の精度・手法、クラスタリング根拠を追加し、AIの生成結果はESTIMATEDとして流します。SNSの引用数だけでMULTIPLE_REPORTSへ昇格しません。

## 5. Visualization Layer

入力座標は `[longitude,latitude]`。メルカトル変換と既存Terrainの標高を使います。未読込DEMの地点では暫定的な地表高度0mからのオフセットを使用し、読込後に追従します。これは災害の高さを表す値ではありません。

```ts
interface Visualization {
  kind: string;
  coordinates: [number,number] | [number,number][];
  label: string;
  basis: string;
  validFrom?: string;
  validUntil?: string;
}
```

実装済みプリミティブ：point / warning marker / evacuation point / labelのマーカー系、polygon（輪郭線）/ route / blocked road / affected railway / flowの線系。
実データで接続済みなのは震源・火山点と公式降灰ポリゴンです。route等に実データ接続があるという意味ではありません。
未実装プリミティブ：面塗り、circle、heatmap、plume。公式の位置・半径・値が無い状態でこれらを補完生成しません。
ポリゴンの輪郭は入力頂点を地形に合わせる方式で、各線分の全点を地形に追従させる高密度細分割は未実装です。
対象時刻外の予報輪郭は非表示にします。詳細パネルには対象時間を残します。18個を超える画面内ラベルは抑制しますが、一覧は残ります。

## 6. UI変更

手動更新／処理状態／最終取得、発表一覧、クリック詳細、出典リンク、表示フィルター、現在位置、JSON保存。
失敗時は「前回取得分」、一部失敗と打切りは明示します。再取得の間隔制限は1分です。
道路・鉄道は未接続として表示します。避難所は独立したShelterSourceで手動取得し、共通イベントに変換します。openingStatusはunknown、informationKindはdesignated_facilityです。地理情報がない情報は一覧のみです。

## 7. 外部API・CORS

DATA_SOURCES.md参照。気象庁のヘッダー実測により直接取得を採用。ただしCORSの永続保証ではありません。認証キーは一切内蔵していません。

## 8. GitHub Pagesの制約

静的HTML/ES modulesとして配置可能。取得先のCORS変更はPagesでは解決できません。公開CORSプロキシへの自動切替はしません。
ODPT等の秘密キーが必要なサービスを将来使う場合、公開JSへ埋め込まず、別の認証・中継構成を設計する必要があります。
長期の状態保存や公式発表の全履歴を突き合わせる現在有効性の管理は、この静的初期版の範囲外です。

## v3.5追記
AreaLocator.enrichはonChangeコールバックにより代表1点と推定参考凸包を段階通知。DisasterUIは公式スナップショットを先に表示し、AbortControllerで背景地域検索の世代を分離。reference outlineはESTIMATEDのLineDashedMaterial。種類別取得は選択時にキューへ追加し、結果を種類単位で置き換える。
