# 公開データ調査（2026-10-05）

「直接取得できる」と「現在の災害状態を完全に復元できる」は別です。
本版で利用するのは気象庁公式XMLと元VOLTの地理院タイルです。

|サービス|利用条件・APIキー|更新頻度|CORS・ブラウザ直取得|今回の採否|
|---|---|---|---|---|
|気象庁防災XML（地震・津波・火山・気象・土砂）|キー不要。気象庁利用規約に従い出典・加工を表示|高頻度フィード毎分、直近少なくとも10分。長期フィード毎時、数日間。掲載期間は永続保証なし|採用する3フィードと取得した個別地震・火山XMLで、Origin付きGET/HEADの `Access-Control-Allow-Origin: *` を実測。実ブラウザfetchは未検証|採用。全電文種別対応ではなく対象タイトル・解析可能フィールドに限定|
|国土地理院DEM・写真・地図|キー不要。地理院タイル一覧の個別出典・利用規約に従う|データ・地域ごと。災害発生の実況ではない|元VOLTの既存取得実装を継承。本作業環境で全タイルの再検証はしていない|採用。地形処理を継承（v2で範囲・色補正を変更）|
|指定緊急避難場所・指定避難所|公式にCSV/GeoJSON提供。自治体登録・公開同意の範囲。キーを使うAPIとは別のダウンロード方式|自治体の登録・更新に依存。公式の公開・更新CSVあり|v3.3: z10 GeoJSONタイルを直接取得。skhb04をOrigin付きでCORS *確認、sih実データ解析確認。APIキー不要|v3.3接続済み（周辺5km・最大200件）。指定情報は「開設中」「受入可能」「安全な経路」の意味ではない|
|国交省・不動産情報ライブラリ防災API|利用規約同意、申請・承認、発行キーが必要|原典データの更新と常時同期ではない。ハザード想定等|公式説明がCORS回避のためブラウザから送信しないよう指定|未採用。静的Pages単独でキーを安全に扱う構成にはしない|
|JARTICオープンデータ|公開CSV。専用規約は出典・加工明示。商用利用も可能|オープンデータは毎月月初更新。HPの5分更新表示と混同しない|今回はCSV配布のCORS未検証。リアルタイム通行止めを取得できる無料APIは確認できていない|未採用。サイト画面をスクレイピングしない|
|ODPT|開発者登録無料、個別利用条件に従う。キー・権限は利用するデータセット/APIについて確認が必要|事業者・データセット依存。リアルタイムデータを含むが全国共通ではない|登録後の対象API仕様・認証・CORSをこのセッションでは確認できていない|未接続。運行情報の欠落を正常運行としない|

## 気象庁の実装対象

- `https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml`
- `https://www.data.jma.go.jp/developer/xml/feed/eqvol_l.xml`
- `https://www.data.jma.go.jp/developer/xml/feed/extra.xml`
- フィードが指す同じ公式ホストの `/developer/xml/data/*.xml`

CORS実測のOriginは `https://vrtest1.github.io`。初回のOrigin無しHEADには許可ヘッダーが出ず、Originを送ると許可されました。
これはサーバー側の現時点のヘッダー確認であり、全エンドポイントの恒久的保証ではありません。

長期・高頻度の併用は直近発表を取りこぼしにくくするためです。それでも取得上限や配信遅延があるため、全国の現行警報の完全性は主張しません。
情報源ごとに件数・失敗・取得範囲を出し、欠落をユーザーに知らせます。

## 一次資料

- 気象庁PULL型公開・頻度・留意事項： https://xml.kishou.go.jp/xmlpull.html
- 気象庁FAQ（保存期間・二次利用）： https://xml.kishou.go.jp/qanda.html
- 気象庁利用規約： https://www.jma.go.jp/jma/kishou/info/coment.html
- 気象庁GIS（公式区域形状を今後接続する場合）： https://www.data.jma.go.jp/developer/gis.html
- 地理院タイルと出典： https://maps.gsi.go.jp/development/ichiran.html
- 地理院利用規約： https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html
- 指定緊急避難場所・指定避難所： https://www.gsi.go.jp/bousaichiri/hinanbasho.html
- 国交省API（キー・ブラウザCORS制約）： https://www.reinfolib.mlit.go.jp/help/apiManual/
- JARTICオープンデータ（更新頻度）： https://www.jartic.or.jp/service/opendata/
- JARTIC専用利用規約： https://www.jartic.or.jp/d/opendata/riyou_kiyaku.pdf
- ODPT概要・無料登録・個別利用条件： https://www.odpt.org/overview/
- ODPT開発者サイト： https://developer.odpt.org/

## 今後の優先事項

1. 実ブラウザでの描画・CORS・タッチ操作検証。
2. 気象庁の新しい防災気象情報仕様を含む、電文種別ごとの解除・訂正・現在有効性の処理。
3. 公式区域GISとのコード結合、津波沿岸・警報区域の可視化。
4. 公式避難施設データを登録情報として追加。開設・収容状態は別ソースが必要。
5. 道路・交通は対象APIと権限を確認後に個別DataSource化。


施設タイル仕様・属性: https://maps.gsi.go.jp/development/ichiran.html
利用上の注意: https://www.gsi.go.jp/bousaichiri/hinanbasho-menseki.html

### v3.4 地域代表点
既存の国土地理院地名検索 https://msearch.gsi.go.jp/address-search/AddressSearch を使用。APIキーなし。2026-10-05に神奈川県横浜市の検索でHTTP成功・Origin付きCORS *を確認。公式座標ではなく地名検索による配置で、災害情報自体の公式出典と分離。自治体・地域名の完全対応のみ採用し、曖昧な結果は非表示。随時変更・提供停止等があり得るため失敗時は公式の一覧を維持。
