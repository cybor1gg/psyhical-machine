#!/usr/bin/env bash
# Start the cabinet on Linux. Fully re-runnable: whatever is already running —
# or half-running, or crashed and left stale pidfiles / lock files behind — is
# cleaned up first, so every run converges to one healthy instance. If the
# machine was never set up, setup-linux.sh runs automatically.
#   bash run-linux.sh            → start + open the kiosk browser
#   bash run-linux.sh --no-kiosk → start the servers only
set -u
cd "$(dirname "$0")"
HERE="$(pwd)"
MONGO_PORT=27018
API_PORT=5001
URL="http://localhost:$API_PORT"
RUN_DIR="$HERE/data/run"
MONGOD_BIN="$HERE/runtime/mongod"
NODE_DIR="$HERE/tools/linux/node-v22.14.0-linux-x64"

say() { printf '  %s\n' "$*"; }
die() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }

# kill -0 fails with EPERM on a LIVE process owned by another user (say, a
# mongod once launched with sudo) — /proc is the tiebreak, so such a process
# is never mistaken for a dead one
alive() { kill -0 "$1" 2>/dev/null || [ -e "/proc/$1" ]; }
# substring match against the process's full command line — the guard that
# keeps a recycled pid (same number, different program) from being killed
pid_matches() { case "$(ps -p "$1" -o args= 2>/dev/null)" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# a TCP connect succeeds only against a real listener — a port stuck in
# TIME_WAIT refuses it, so leftovers are never mistaken for a running server
port_open() { ( exec 3<>"/dev/tcp/127.0.0.1/$1" ) 2>/dev/null; }

# pids LISTENING on a tcp port (TIME_WAIT sockets have no owner and are
# naturally excluded); ss / lsof / fuser — whichever this distro has
port_pids() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u
  elif command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$1" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u
  fi
  return 0
}

# after we start a process, the port answering is not enough — a foreign
# listener could be answering while ours is already dead. Confirm the pid we
# launched is alive and (where pid enumeration can see owners) IS the listener.
listener_is() {  # <pid> <port>
  alive "$1" || return 1
  LI_PIDS="$(port_pids "$2")"
  [ -z "$LI_PIDS" ] && return 0
  # shellcheck disable=SC2086
  case "$(printf ' %s' $LI_PIDS) " in *" $1 "*) return 0 ;; esac
  return 1
}

term_then_kill() {  # <grace-seconds> <pid>... — TERM, wait, then KILL survivors
  GRACE="$1"; shift
  [ "$#" -gt 0 ] || return 0
  for P in "$@"; do
    if ! kill -TERM "$P" 2>/dev/null && alive "$P"; then
      say "[warn] cannot signal pid $P (owned by another user?)"
    fi
  done
  I=0
  while [ "$I" -lt "$((GRACE * 5))" ]; do
    LEFT=0
    for P in "$@"; do alive "$P" && LEFT=1; done
    [ "$LEFT" = 0 ] && return 0
    sleep 0.2
    I=$((I + 1))
  done
  for P in "$@"; do alive "$P" && kill -KILL "$P" 2>/dev/null; done
  sleep 0.5
  return 0
}

stop_proc() {  # <label> <pidfile> <cmdline-marker> <port> <grace-seconds>
  SP_LABEL="$1"; SP_PIDFILE="$2"; SP_MARKER="$3"; SP_PORT="$4"; SP_GRACE="$5"
  if [ -f "$SP_PIDFILE" ]; then
    SP_PID="$(cat "$SP_PIDFILE" 2>/dev/null)" || SP_PID=""
    case "$SP_PID" in *[!0-9]*|"") SP_PID="" ;; esac
    if [ -n "$SP_PID" ] && alive "$SP_PID"; then
      if pid_matches "$SP_PID" "$SP_MARKER"; then
        say "stopping old $SP_LABEL (pid $SP_PID)..."
        term_then_kill "$SP_GRACE" "$SP_PID"
      else
        say "stale $SP_LABEL pidfile pointed at an unrelated process — left alone"
      fi
    fi
    rm -f "$SP_PIDFILE"
  fi
  SP_PIDS="$(port_pids "$SP_PORT")"
  if [ -n "$SP_PIDS" ]; then
    say "port $SP_PORT busy — stopping pid(s):$(printf ' %s' $SP_PIDS)"
    # shellcheck disable=SC2086
    term_then_kill "$SP_GRACE" $SP_PIDS
  fi
  # verify with a connect probe, not pid enumeration — a listener owned by
  # another user still answers a connect, but is invisible to port_pids
  if port_open "$SP_PORT"; then
    SP_PIDS="$(port_pids "$SP_PORT")"
    if [ -n "$SP_PIDS" ]; then SP_WHO=" by pid(s)$(printf ' %s' $SP_PIDS)"
    else SP_WHO=" by a process this user cannot see (started with sudo?)"; fi
    die "$SP_LABEL port $SP_PORT is still held$SP_WHO — stop that process manually"
  fi
}

# our mongod instances, found by dbpath (matches old launches without pidfiles)
mongod_here_pids() {
  OUT=""
  for P in $(pgrep -x mongod 2>/dev/null); do
    pid_matches "$P" "$HERE/data/db" && OUT="$OUT $P"
  done
  printf '%s' "$OUT"
}

# ── never set up (or half set up)? then set up first ────────────────────────
if [ ! -x "$MONGOD_BIN" ] || [ ! -f web/dist/index.html ] || [ ! -d api/node_modules ] \
   || [ ! -f api/.env ] || [ ! -f web/public/cabinet.config.json ]; then
  echo "Not fully set up — running setup-linux.sh first..."
  bash "$HERE/setup-linux.sh" || die "setup failed — fix the error above and re-run"
fi

[ -x "$NODE_DIR/bin/node" ] && export PATH="$NODE_DIR/bin:$PATH"
command -v node >/dev/null 2>&1 || die "node not found — run:  bash setup-linux.sh"

echo "=========================================="
echo "  MTECH CABINET — starting"
echo "=========================================="
mkdir -p data/db "$RUN_DIR"

# ── clear anything already (or still) running so we start clean ─────────────
echo "[1/4] clearing anything already running..."
stop_proc "cabinet"  "$RUN_DIR/api.pid"    "$HERE/api/server.js" "$API_PORT"   5
stop_proc "database" "$RUN_DIR/mongod.pid" "runtime/mongod"      "$MONGO_PORT" 10

# ── database ────────────────────────────────────────────────────────────────
echo "[2/4] database..."
# a lock file with no mongod behind it is debris from an unclean shutdown;
# with a live mongod it is real and must stay
if [ -f data/db/mongod.lock ] && [ -z "$(mongod_here_pids)" ] && [ -z "$(port_pids "$MONGO_PORT")" ]; then
  say "removing stale mongod.lock left by an unclean shutdown"
  rm -f data/db/mongod.lock
fi
say "starting database..."
# cache capped at 256MB: WiredTiger's default is HALF THE MACHINE'S RAM minus
# 1GB — on a small cabinet PC that quietly eats the memory the games need.
# One cabinet's data fits in a fraction of this.
nohup "$MONGOD_BIN" --dbpath "$HERE/data/db" --port "$MONGO_PORT" --bind_ip 127.0.0.1 \
  --wiredTigerCacheSizeGB 0.25 \
  >"$HERE/data/mongod.log" 2>&1 &
MPID=$!
echo "$MPID" > "$RUN_DIR/mongod.pid"
I=0
while :; do
  # crash check FIRST — a foreign listener could satisfy the port probe on
  # the very first pass while the mongod we launched is already dead
  if ! alive "$MPID"; then
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
    echo "  Last log lines:"
    tail -n 6 "$HERE/data/mongod.log" 2>/dev/null | sed 's/^/    /'
    echo "  Details: $HERE/data/mongod.log"
    rm -f "$RUN_DIR/mongod.pid"
    exit 1
  fi
  port_open "$MONGO_PORT" && break
  I=$((I + 1))
  [ "$I" -gt 300 ] && die "database did not accept connections within 60s — see $HERE/data/mongod.log"
  sleep 0.2
done
listener_is "$MPID" "$MONGO_PORT" \
  || die "port $MONGO_PORT answered, but not from the database we started (pid $MPID) — another mongod is on this port"
say "database ready on port $MONGO_PORT"

# ── machine identity (idempotent) ───────────────────────────────────────────
echo "[3/4] checking machine identity..."
( cd api && node scripts/ensure-cabinet.js "../web/public/cabinet.config.json" ) \
  || die "identity check failed — see the message above"

# ── the cabinet ─────────────────────────────────────────────────────────────
echo "[4/4] starting cabinet..."
# an api/.env carried over from a dev machine may lack STATIC_DIR — without
# it the kiosk serves nothing. dotenv never overrides a real environment
# variable, so pre-setting it here fills only that gap.
grep -q '^STATIC_DIR=' api/.env 2>/dev/null || export STATIC_DIR="$HERE/web/dist"
# exec inside the backgrounded subshell makes $! the pid of node ITSELF —
# without it some bashes fork, and the pidfile would name a wrapper shell
( cd api && exec nohup node "$HERE/api/server.js" >"$HERE/data/cabinet.log" 2>&1 ) &
APID=$!
echo "$APID" > "$RUN_DIR/api.pid"
I=0
while :; do
  # crash check FIRST — a foreign listener could satisfy the port probe on
  # the very first pass while the node we launched is already dead
  if ! alive "$APID"; then
    echo "  The cabinet crashed on start. Last log lines:"
    tail -n 15 "$HERE/data/cabinet.log" 2>/dev/null | sed 's/^/    /'
    rm -f "$RUN_DIR/api.pid"
    die "details: $HERE/data/cabinet.log"
  fi
  port_open "$API_PORT" && break
  I=$((I + 1))
  [ "$I" -gt 150 ] && die "cabinet did not answer on port $API_PORT within 30s — see $HERE/data/cabinet.log"
  sleep 0.2
done
listener_is "$APID" "$API_PORT" \
  || die "port $API_PORT answered, but not from the cabinet we started (pid $APID) — another server is on this port"

echo
echo "  READY  ->  $URL"
echo "  Backoffice: $URL/admin  (admin@cabinet.local / admin12345)"
echo "  Stop with:  bash stop-linux.sh"
echo

[ "${1:-}" = "--no-kiosk" ] && exit 0

# an already-open kiosk browser is kept — no window per re-run
if pgrep -f "kiosk.*localhost:$API_PORT" >/dev/null 2>&1; then
  echo "  kiosk browser already open — refresh it (F5) if it shows an error"
  exit 0
fi

# Chromium-family flags. The in-page lockdown already blocks zoom, the
# context menu and selection, so a browser without these flags still behaves
# — they only remove chrome-level extras.
# The GPU flags matter as much as the kiosk ones on cheap hardware: Chromium
# blocklists a lot of Linux drivers and silently falls back to SOFTWARE
# rendering, which turns a smooth scene into a slideshow. These force the
# GPU path back on. Check the result at chrome://gpu.
CHROME_FLAGS="--kiosk $URL --incognito --noerrdialogs --disable-pinch
       --overscroll-history-navigation=0 --disable-session-crashed-bubble
       --autoplay-policy=no-user-gesture-required
       --ignore-gpu-blocklist --enable-gpu-rasterization
       --enable-zero-copy --disable-features=UseChromeOSDirectVideoDecoder
       --canvas-oop-rasterization"

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
