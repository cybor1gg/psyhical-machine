#!/usr/bin/env bash
# Stop this cabinet's processes (only the ones belonging to this folder).
# Idempotent: running it twice, or with nothing running, is fine and exits 0.
set -u
cd "$(dirname "$0")"
HERE="$(pwd)"
MONGO_PORT=27018
API_PORT=5001
RUN_DIR="$HERE/data/run"

say() { printf '  %s\n' "$*"; }

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
  SP_FOUND=0
  if [ -f "$SP_PIDFILE" ]; then
    SP_PID="$(cat "$SP_PIDFILE" 2>/dev/null)" || SP_PID=""
    case "$SP_PID" in *[!0-9]*|"") SP_PID="" ;; esac
    if [ -n "$SP_PID" ] && alive "$SP_PID"; then
      if pid_matches "$SP_PID" "$SP_MARKER"; then
        say "stopping $SP_LABEL (pid $SP_PID)..."
        term_then_kill "$SP_GRACE" "$SP_PID"
        SP_FOUND=1
      else
        say "stale $SP_LABEL pidfile pointed at an unrelated process — left alone"
      fi
    fi
    rm -f "$SP_PIDFILE"
  fi
  SP_PIDS="$(port_pids "$SP_PORT")"
  if [ -n "$SP_PIDS" ]; then
    say "stopping $SP_LABEL on port $SP_PORT (pid(s):$(printf ' %s' $SP_PIDS))..."
    # shellcheck disable=SC2086
    term_then_kill "$SP_GRACE" $SP_PIDS
    SP_FOUND=1
  fi
  # verify with a connect probe, not pid enumeration — a listener owned by
  # another user still answers a connect, but is invisible to port_pids
  if port_open "$SP_PORT"; then
    SP_PIDS="$(port_pids "$SP_PORT")"
    if [ -n "$SP_PIDS" ]; then SP_WHO=" by pid(s)$(printf ' %s' $SP_PIDS)"
    else SP_WHO=" by a process this user cannot see (started with sudo?)"; fi
    say "[warn] port $SP_PORT is still held$SP_WHO"
  elif [ "$SP_FOUND" = 0 ]; then
    say "$SP_LABEL was not running"
  fi
}

echo "Stopping the cabinet..."
stop_proc "cabinet"  "$RUN_DIR/api.pid"    "$HERE/api/server.js" "$API_PORT"   5
stop_proc "database" "$RUN_DIR/mongod.pid" "runtime/mongod"      "$MONGO_PORT" 10

# our mongods that slipped past pidfile and port (started by an older
# run-linux.sh, or still mid-shutdown) — found by this folder's dbpath
LEGACY=""
for P in $(pgrep -x mongod 2>/dev/null); do
  pid_matches "$P" "$HERE/data/db" && LEGACY="$LEGACY $P"
done
if [ -n "$LEGACY" ]; then
  say "stopping leftover database process(es):$LEGACY"
  # shellcheck disable=SC2086
  term_then_kill 10 $LEGACY
fi

echo "Stopped."
exit 0
