#!/bin/bash

cd "$(dirname "$0")"

# 少し待ってからブラウザを開く
(sleep 1; open "http://localhost:8000") &

# ローカルWebサーバー起動
python3 -m http.server 8000