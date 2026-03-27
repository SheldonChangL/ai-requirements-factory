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
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
PID_FILE="$SCRIPT_DIR/.pids"
BACKEND_LOG="$SCRIPT_DIR/backend.log"
FRONTEND_LOG="$SCRIPT_DIR/frontend.log"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()    { echo -e "${GREEN}[✔] $*${RESET}"; }
warn()    { echo -e "${YELLOW}[⚠] $*${RESET}"; }
error()   { echo -e "${RED}[✘] $*${RESET}"; }
section() { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}"; }

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti TCP:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    info "Force-killed existing process(es) on port $port."
  fi
}

wait_for_url() {
  local url="$1"
  local name="$2"
  local pid="$3"
  local attempts="${4:-30}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      info "$name is responding at $url"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      error "$name process exited before becoming ready."
      return 1
    fi
    sleep 1
  done

  error "$name did not become ready at $url in time."
  return 1
}

# ---------------------------------------------------------------------------
# Pre-flight: force-clear ports 8000 and 3000
# ---------------------------------------------------------------------------
section "Clearing ports"

kill_port 8000
kill_port 3000

# Remove any stale PID file from a previous run
rm -f "$PID_FILE"

if [ ! -d "$BACKEND_DIR" ]; then
  error "Backend directory not found: $BACKEND_DIR"
  exit 1
fi

if [ ! -d "$FRONTEND_DIR" ]; then
  error "Frontend directory not found: $FRONTEND_DIR"
  exit 1
fi

info "Ports 8000 and 3000 are clear."

# ---------------------------------------------------------------------------
# Resolve python3
# ---------------------------------------------------------------------------
section "Python environment"

PYTHON_BIN="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_BIN" ]; then
  error "python3 not found. Install Python 3 and re-run."
  exit 1
fi
info "Python: $PYTHON_BIN ($("$PYTHON_BIN" --version 2>&1))"

# ---------------------------------------------------------------------------
# Activate venv if present
# ---------------------------------------------------------------------------
VENV_PATH="$BACKEND_DIR/.venv"
if [ -f "$VENV_PATH/bin/activate" ]; then
  # shellcheck disable=SC1090
  source "$VENV_PATH/bin/activate"
  # After activation, 'python3' in PATH now points into the venv
  PYTHON_BIN="$(command -v python3)"
  info "Activated venv: $VENV_PATH"
else
  warn "No venv found at $VENV_PATH — using system Python."
fi

# ---------------------------------------------------------------------------
# Ensure uvicorn is importable; auto-install if not
# ---------------------------------------------------------------------------
if ! "$PYTHON_BIN" -c "import uvicorn" 2>/dev/null; then
  warn "uvicorn not found in Python environment. Installing from backend/requirements.txt..."

  if ! "$PYTHON_BIN" -m pip install -r "$BACKEND_DIR/requirements.txt"; then
    error "pip install failed. Check the output above and fix any errors."
    exit 1
  fi
  info "pip install completed."

  # Verify the install actually worked
  if ! "$PYTHON_BIN" -c "import uvicorn" 2>/dev/null; then
    error "uvicorn still not importable after install."
    error "Python used: $PYTHON_BIN"
    error "Try running manually: $PYTHON_BIN -m pip install -r backend/requirements.txt"
    exit 1
  fi
  info "uvicorn is now available."
else
  info "uvicorn already installed."
fi

# ---------------------------------------------------------------------------
# Start Backend
# ---------------------------------------------------------------------------
section "Starting Backend (FastAPI on :8000)"

truncate -s 0 "$BACKEND_LOG"

cd "$BACKEND_DIR"
nohup "$PYTHON_BIN" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload \
  < /dev/null > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
disown "$BACKEND_PID" 2>/dev/null || true
cd "$SCRIPT_DIR"

if kill -0 "$BACKEND_PID" 2>/dev/null; then
  info "Backend started  (PID $BACKEND_PID) → log: backend.log"
else
  error "Backend failed to start. Check backend.log for details."
  exit 1
fi

if ! wait_for_url "http://localhost:8000/health" "Backend" "$BACKEND_PID"; then
  error "Backend failed readiness check. Check backend.log for details."
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi

# ---------------------------------------------------------------------------
# Ensure frontend node_modules exist
# ---------------------------------------------------------------------------
section "Frontend dependencies"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  warn "node_modules not found. Running npm install..."
  cd "$FRONTEND_DIR"
  if ! npm install; then
    error "npm install failed. Check the output above."
    kill "$BACKEND_PID" 2>/dev/null || true
    exit 1
  fi
  info "npm install completed."
  cd "$SCRIPT_DIR"
else
  info "node_modules already present."
fi

# ---------------------------------------------------------------------------
# Start Frontend
# ---------------------------------------------------------------------------
section "Starting Frontend (Next.js on :3000)"

truncate -s 0 "$FRONTEND_LOG"

cd "$FRONTEND_DIR"
nohup npm run dev -- --hostname 0.0.0.0 \
  < /dev/null > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
disown "$FRONTEND_PID" 2>/dev/null || true
cd "$SCRIPT_DIR"

if kill -0 "$FRONTEND_PID" 2>/dev/null; then
  info "Frontend started (PID $FRONTEND_PID) → log: frontend.log"
else
  error "Frontend failed to start. Check frontend.log for details."
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi

if ! wait_for_url "http://localhost:3000" "Frontend" "$FRONTEND_PID"; then
  error "Frontend failed readiness check. Check frontend.log for details."
  kill "$FRONTEND_PID" 2>/dev/null || true
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi

# ---------------------------------------------------------------------------
# Save PIDs
# ---------------------------------------------------------------------------
{
  echo "BACKEND_PID=$BACKEND_PID"
  echo "FRONTEND_PID=$FRONTEND_PID"
} > "$PID_FILE"
info "PIDs saved to .pids"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}Both services are running.${RESET}"
echo -e "  Backend  → ${CYAN}http://localhost:8000${RESET}  (docs: ${CYAN}http://localhost:8000/docs${RESET})"
echo -e "  Frontend → ${CYAN}http://localhost:3000${RESET}"
echo ""
echo -e "  Logs:  ${YELLOW}tail -f backend.log${RESET}   |   ${YELLOW}tail -f frontend.log${RESET}"
echo -e "  Stop:  ${YELLOW}./stop.sh${RESET}"
echo ""
