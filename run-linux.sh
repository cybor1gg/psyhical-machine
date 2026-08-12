#!/usr/bin/env bash
# Start the cabinet on Linux (after setup-linux.sh has run once).
#   bash run-linux.sh            → start + open the kiosk browser
#   bash run-linux.sh --no-kiosk → start the servers only
set -u
cd "$(dirname "$0")"
HERE="$(pwd)"

if [ ! -f web/dist/index.html ] || [ ! -x runtime/mongod ]; then
  echo "Not set up yet — run this first:   bash setup-linux.sh"
  exit 1
fi

echo "=========================================="
echo "  MTECH CABINET — starting"
echo "=========================================="

# ── database ───────────────────────────────────────────────────────────────
if pgrep -f "$HERE/runtime/mongod" >/dev/null 2>&1; then
  echo "[1/3] database already running"
else
  echo "[1/3] starting database..."
  mkdir -p data/db
  nohup ./runtime/mongod --dbpath "$HERE/data/db" --port 27018 --bind_ip 127.0.0.1 \
    >"$HERE/data/mongod.log" 2>&1 &
  sleep 6
  if ! pgrep -f "$HERE/runtime/mongod" >/dev/null 2>&1; then
    echo
    echo "  The database did not start. Usually a missing library:"
    echo "      sudo apt install -y libcurl4 openssl"
    echo "  Details: $HERE/data/mongod.log"
    exit 1
  fi
fi

# ── machine identity (idempotent) ──────────────────────────────────────────
echo "[2/3] checking machine identity..."
( cd api && node scripts/ensure-cabinet.js "../web/public/cabinet.config.json" ) || exit 1

# ── the cabinet ────────────────────────────────────────────────────────────
if pgrep -f "node server.js" >/dev/null 2>&1; then
  echo "[3/3] cabinet already running"
else
  echo "[3/3] starting cabinet..."
  ( cd api && nohup node server.js >"$HERE/data/cabinet.log" 2>&1 & )
  sleep 4
fi

echo
echo "  READY  ->  http://localhost:5001"
echo "  Backoffice: http://localhost:5001/admin  (admin@cabinet.local / admin12345)"
echo "  Stop with:  bash stop-linux.sh"
echo

[ "${1:-}" = "--no-kiosk" ] && exit 0

FLAGS="--kiosk http://localhost:5001 --incognito --noerrdialogs --disable-pinch
       --overscroll-history-navigation=0 --disable-session-crashed-bubble
       --autoplay-policy=no-user-gesture-required"
for BROWSER in google-chrome chromium chromium-browser microsoft-edge; do
  if command -v "$BROWSER" >/dev/null 2>&1; then
    echo "  opening in $BROWSER (kiosk mode) — leave with Alt+F4"
    # shellcheck disable=SC2086
    nohup "$BROWSER" $FLAGS >/dev/null 2>&1 &
    exit 0
  fi
done
echo "  No Chrome/Chromium found — open http://localhost:5001 yourself, or:"
echo "      sudo apt install -y chromium-browser"
