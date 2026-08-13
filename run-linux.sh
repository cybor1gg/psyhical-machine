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
    echo "  The database did not start. Usually a missing system library:"
    if command -v dnf >/dev/null 2>&1; then
      echo "      sudo dnf install -y openssl-libs libcurl cyrus-sasl-lib"
    elif command -v apt >/dev/null 2>&1; then
      echo "      sudo apt install -y libcurl4 openssl"
    elif command -v pacman >/dev/null 2>&1; then
      echo "      sudo pacman -S --noconfirm openssl curl"
    elif command -v zypper >/dev/null 2>&1; then
      echo "      sudo zypper install -y libopenssl3 libcurl4"
    fi
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

URL="http://localhost:5001"

# Chromium-family flags. The in-page lockdown already blocks zoom, the
# context menu and selection, so a browser without these flags still behaves
# — they only remove chrome-level extras.
CHROME_FLAGS="--kiosk $URL --incognito --noerrdialogs --disable-pinch
       --overscroll-history-navigation=0 --disable-session-crashed-bubble
       --autoplay-policy=no-user-gesture-required"

# Any Chromium-based browser works: Chrome, Chromium (apt/snap/flatpak),
# Brave, Vivaldi, Opera, Edge.
for B in google-chrome google-chrome-stable chromium chromium-browser \
         brave-browser vivaldi-stable opera microsoft-edge microsoft-edge-stable; do
  if command -v "$B" >/dev/null 2>&1; then
    echo "  opening in $B (kiosk) — leave with Alt+F4"
    # shellcheck disable=SC2086
    nohup "$B" $CHROME_FLAGS >/dev/null 2>&1 &
    exit 0
  fi
done

# Flatpak Chromium / Brave, if that is how they are installed.
if command -v flatpak >/dev/null 2>&1; then
  for ID in org.chromium.Chromium com.brave.Browser com.google.Chrome; do
    if flatpak info "$ID" >/dev/null 2>&1; then
      echo "  opening in $ID via flatpak (kiosk) — leave with Alt+F4"
      # shellcheck disable=SC2086
      nohup flatpak run "$ID" $CHROME_FLAGS >/dev/null 2>&1 &
      exit 0
    fi
  done
fi

# FIREFOX — the usual fallback when Chromium is not an option. Its --kiosk
# is fullscreen with no toolbars, which is all a cabinet needs.
for F in firefox firefox-esr; do
  if command -v "$F" >/dev/null 2>&1; then
    echo "  opening in $F (kiosk) — leave with Alt+F4"
    nohup "$F" --kiosk "$URL" >/dev/null 2>&1 &
    exit 0
  fi
done
if command -v flatpak >/dev/null 2>&1 && flatpak info org.mozilla.firefox >/dev/null 2>&1; then
  echo "  opening in Firefox via flatpak (kiosk) — leave with Alt+F4"
  nohup flatpak run org.mozilla.firefox --kiosk "$URL" >/dev/null 2>&1 &
  exit 0
fi

# Last resort: hand it to the desktop's default browser, fullscreen with F11.
if command -v xdg-open >/dev/null 2>&1; then
  echo "  No kiosk-capable browser found — opening your default browser."
  echo "  Press F11 for fullscreen."
  nohup xdg-open "$URL" >/dev/null 2>&1 &
  exit 0
fi

echo "  No browser found. Open this address on the machine:  $URL"
echo "  Install one of:"
if command -v dnf >/dev/null 2>&1; then
  echo "      sudo dnf install -y firefox          # simplest"
  echo "      sudo dnf install -y chromium"
elif command -v apt >/dev/null 2>&1; then
  echo "      sudo apt install -y firefox          # simplest"
  echo "      sudo snap install chromium"
elif command -v pacman >/dev/null 2>&1; then
  echo "      sudo pacman -S --noconfirm firefox chromium"
elif command -v zypper >/dev/null 2>&1; then
  echo "      sudo zypper install -y MozillaFirefox chromium"
fi
echo "      flatpak install flathub org.chromium.Chromium   # works anywhere"
