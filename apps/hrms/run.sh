#!/usr/bin/env bash
# Manath Homes HRMS - one-command setup and run (macOS / Linux)
#
#   ./run.sh              first run: install everything, seed, start server
#   ./run.sh --skip-setup start faster once installed
#   ./run.sh --test       run the test suite
#   ./run.sh --models     download face recognition models (~330 MB)
#   ./run.sh --recreate   rebuild the virtual environment from scratch
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\033[32m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m!!  %s\033[0m\n' "$1"; exit 1; }

MODE="${1:-}"
RECREATE=0
[ "$MODE" = "--recreate" ] && RECREATE=1

PY=".venv/bin/python"

# Upper bound is deliberate: pydantic-core and onnxruntime ship
# prebuilt wheels only up to 3.13. On 3.14 pip tries to compile pydantic-core
# from Rust source, and PyO3 0.22 doesn't support 3.14 either.
version_ok() {
  "$1" - <<'PYEOF' >/dev/null 2>&1
import sys
raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)
PYEOF
}

pyver() { "$1" -c 'import sys;print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "?"; }

find_python() {
  local rejected=""
  for c in python3.12 python3.11 python3.13 python3.10 python3 python; do
    command -v "$c" >/dev/null 2>&1 || continue
    if version_ok "$c"; then echo "$c"; return 0; fi
    rejected="$rejected\n      $c -> $(pyver "$c")"
  done
  if [ -n "$rejected" ]; then
    printf '\n\033[31m!!  Found Python, but no supported version.\033[0m'
    printf "$rejected\n\n"
    echo "    This project needs Python 3.10, 3.11, 3.12 or 3.13."
    echo "    Python 3.14 is too new: pydantic-core has no wheel for it yet."
    echo "    macOS:  brew install python@3.12"
    echo "    Ubuntu: sudo apt install python3.12 python3.12-venv"
    exit 1
  fi
  fail "Python was not found. Install Python 3.12 and try again."
}

# A venv built by an unsupported interpreter can't be repaired - rebuild it.
if [ -x "$PY" ] && [ "$RECREATE" -eq 0 ]; then
  if ! version_ok "$PY"; then
    warn "The existing .venv uses Python $(pyver "$PY"), which isn't supported. Rebuilding it."
    RECREATE=1
  fi
fi

if [ "$RECREATE" -eq 1 ] && [ -d .venv ]; then
  say "Removing the old virtual environment"
  rm -rf .venv
fi

FRESH=0
if [ ! -x "$PY" ]; then
  PYBIN="$(find_python)"
  say "Using $PYBIN ($(pyver "$PYBIN"))"
  say "Creating virtual environment"
  "$PYBIN" -m venv .venv
  FRESH=1
fi

[ -x "$PY" ] || fail "The virtual environment was created but $PY is missing."

if [ "$MODE" != "--skip-setup" ] || [ "$FRESH" -eq 1 ]; then
  say "Installing dependencies (first run takes a few minutes)"
  $PY -m pip install --upgrade pip --quiet
  $PY -m pip install -r requirements.txt
  $PY -c "import fastapi, sqlalchemy, uvicorn, pydantic" \
    || fail "Dependencies reported success but won't import. Try: ./run.sh --recreate"
  # Face recognition is mandatory now that PIN check-in is gone: without it
  # nobody can record attendance at all.
  $PY -c "import cv2, onnxruntime" 2>/dev/null \
    || fail "opencv/onnxruntime installed but won't import. Try: ./run.sh --recreate"
  say "Dependencies installed"
fi

# Models are required, not an extra. Fetch them on first run automatically.
MODEL_DIR="${FACE_MODEL_DIR:-$HOME/.insightface/models/buffalo_l}"
if [ "$MODE" = "--models" ] || [ ! -f "$MODEL_DIR/det_10g.onnx" ] \
   || [ ! -f "$MODEL_DIR/w600k_r50.onnx" ]; then
  say "Downloading face recognition models (about 275 MB, one time)"
  if ! $PY scripts/download_models.py; then
    warn "The face models could not be downloaded."
    warn "Attendance CANNOT be recorded until they are present - there is no PIN fallback."
    warn "Retry:     ./run.sh --models"
    warn "Diagnose:  $PY scripts/check_face_setup.py"
  fi
fi

if [ ! -f .env ]; then
  say "Creating .env with a generated signing key"
  SECRET=$($PY -c "import secrets;print(secrets.token_urlsafe(48))")
  sed "s|replace-me-with-64-random-characters|$SECRET|" .env.example > .env
fi

case "$MODE" in
  --test)   say "Running tests"; exec $PY -m pytest tests -q ;;
esac

if [ ! -f manath_homes.db ]; then
  say "Seeding database"
  if [ -z "${SEED_ADMIN_PASSWORD:-}" ]; then
    export SEED_ADMIN_PASSWORD=$($PY -c "import secrets;print(secrets.token_urlsafe(16))")
  fi
  export SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@manathhomes.ae}"
  $PY seed.py
  echo
  warn "Sign in as $SEED_ADMIN_EMAIL"
  warn "Admin password: $SEED_ADMIN_PASSWORD"
  warn "Write this down now - it is not stored anywhere."
  echo
fi

say "Starting Manath Homes HRMS"
echo "    App   http://localhost:8000/login.html"
echo "    API   http://localhost:8000/docs"
echo
exec $PY -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
