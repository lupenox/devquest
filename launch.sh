#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/lupenox/Projects/devquest"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
LOG_DIR="${HOME}/.local/share/devquest"
LOG_FILE="${LOG_DIR}/server.log"
URL="http://127.0.0.1:8765"

mkdir -p "$LOG_DIR"

is_healthy() {
  curl -sf --max-time 1 "${URL}/api/health" >/dev/null 2>&1
}

if ! is_healthy; then
  if [[ ! -d "${FRONTEND_DIR}/dist" ]]; then
    (cd "$FRONTEND_DIR" && npm run build >>"$LOG_FILE" 2>&1)
  fi

  nohup env PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    bash -c "cd '${BACKEND_DIR}' && exec uv run uvicorn app.main:app --host 127.0.0.1 --port 8765" \
    </dev/null >>"$LOG_FILE" 2>&1 &

  for _ in $(seq 1 40); do
    if is_healthy; then
      break
    fi
    sleep 0.3
  done
fi

if is_healthy; then
  nohup xdg-open "$URL" >/dev/null 2>&1 &
else
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "DevQuest" "Server failed to start. Check ${LOG_FILE}."
  fi
  exit 1
fi
