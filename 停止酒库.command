#!/bin/zsh
cd "${0:A:h}"

PID_FILE="$PWD/data/server.pid"
if [[ ! -f "$PID_FILE" ]]; then
  echo "酒库存系统当前没有运行。"
  sleep 1
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE")"
if [[ "$SERVER_PID" == <-> ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
  kill "$SERVER_PID"
  echo "酒库存系统已停止。"
else
  echo "酒库存系统当前没有运行。"
fi

rm -f "$PID_FILE"
sleep 1
