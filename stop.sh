#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.pids"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { echo -e "${GREEN}[✔] $*${RESET}"; }
warn()  { echo -e "${YELLOW}[⚠] $*${RESET}"; }
error() { echo -e "${RED}[✘] $*${RESET}"; }

kill_pid() {
  local name="$1"
  local pid="$2"

  if [ -z "$pid" ]; then
    return
  fi

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && info "$name (PID $pid) stopped." \
      || warn "Failed to kill $name (PID $pid) — may already be gone."
  fi
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti TCP:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    info "Killed all processes on port $port."
  fi
}

echo -e "\n${BOLD}${CYAN}=== Stopping services ===${RESET}"

# ---------------------------------------------------------------------------
# 1. Kill PIDs from .pids file (graceful first)
# ---------------------------------------------------------------------------
if [ -f "$PID_FILE" ]; then
  # shellcheck disable=SC1090
  source "$PID_FILE"
  kill_pid "Backend " "${BACKEND_PID:-}"
  kill_pid "Frontend" "${FRONTEND_PID:-}"
else
  warn ".pids file not found — skipping PID-based kill."
fi

# ---------------------------------------------------------------------------
# 2. Force-kill any remaining processes on the service ports
# ---------------------------------------------------------------------------
kill_port 8000
kill_port 3000

# ---------------------------------------------------------------------------
# 3. Clean up PID file
# ---------------------------------------------------------------------------
rm -f "$PID_FILE"
info "Removed .pids file."

echo ""
echo -e "${BOLD}${GREEN}All services stopped.${RESET}"
echo ""
