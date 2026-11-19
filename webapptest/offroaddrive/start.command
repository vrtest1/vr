#!/bin/zsh
# ダブルクリックで起動（ローカルで遊ぶとき）: このフォルダを配信して、ブラウザで開く。
# 終わるときは、このウィンドウを閉じるか Ctrl + C。
cd "${0:A:h}"
PORT=8771
( sleep 1; open "http://127.0.0.1:$PORT/drive/" ) &
echo "オフロード・ドライブを http://127.0.0.1:$PORT/drive/ で配信します。"
exec python3 serve.py $PORT
