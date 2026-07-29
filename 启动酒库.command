#!/bin/zsh
cd "${0:A:h}"

NODE_BIN="/Users/linyue/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node 2>/dev/null)"
fi

APP_URL="http://127.0.0.1:8787"
LOG_FILE="$PWD/data/server.log"
PID_FILE="$PWD/data/server.pid"

show_error() {
  echo
  echo "酒库存系统启动失败：$1"
  echo
  echo "错误日志：$LOG_FILE"
  if [[ -f "$LOG_FILE" ]]; then
    echo "------------------------------"
    tail -n 20 "$LOG_FILE"
  fi
  echo
  read -k 1 "?按任意键退出..."
  exit 1
}

if curl -fsS "$APP_URL/api/products" >/dev/null 2>&1; then
  open "$APP_URL"
  exit 0
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  show_error "没有找到 Node.js 运行环境。"
fi

if [[ ! -f dist/index.html ]]; then
  show_error "没有找到构建完成的网页文件。"
fi

mkdir -p data
: > "$LOG_FILE"
"$NODE_BIN" server/index.mjs >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
SERVER_PID=$!

for attempt in {1..30}; do
  if curl -fsS "$APP_URL/api/products" >/dev/null 2>&1; then
    open "$APP_URL"
    echo "酒类仓库已启动，正在打开浏览器…"
    echo "使用期间请保留这个窗口；需要关闭服务时可直接关闭窗口。"
    wait "$SERVER_PID"
    rm -f "$PID_FILE"
    exit $?
  fi
  sleep 0.2
done

show_error "本地服务没有正常响应。"
