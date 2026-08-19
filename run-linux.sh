#!/usr/bin/env bash
# Start the cabinet on Linux. Fully re-runnable: whatever is already running —
# or half-running, or crashed and left stale pidfiles / lock files behind — is
# cleaned up first, so every run converges to one healthy instance. If the
# machine was never set up, setup-linux.sh runs automatically.
#   bash run-linux.sh            → start + open the kiosk browser
#   bash run-linux.sh --no-kiosk → start the servers only
# The kiosk browser is Firefox, started on a profile this script writes and
# owns (data/ff-profile) — never the operator's own. A Chromium-family browser
# is used only when the machine has no Firefox at all.
set -u
cd "$(dirname "$0")"
HERE="$(pwd)"
MONGO_PORT=27018
API_PORT=5001
URL="http://localhost:$API_PORT"
RUN_DIR="$HERE/data/run"
FF_PROFILE="$HERE/data/ff-profile"
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

# ── the kiosk browser: Firefox ──────────────────────────────────────────────
# Firefox is the cabinet browser. Everything the Chromium fallback further
# down takes as command-line flags — sound without a tap, forcing the GPU past
# the driver blocklist — Firefox takes as PREFS, and prefs need a profile we
# own. So the cabinet runs on its own profile under data/, rewritten on every
# start: the operator's profile (their history, extensions, update nags) is
# never touched, and nothing changed by hand there survives the next boot.
# Deliberately NOT private browsing, which Mozilla's own kiosk notes suggest:
# the kiosk keeps the language and volume choices in localStorage, and private
# browsing throws those away on exit. The dedicated profile already gives all
# the isolation private browsing was buying.

# our kiosk Firefox, found by the profile path on its command line — unique to
# this folder, immune to flag reordering, and it can never match an operator's
# own Firefox on their own profile (same idiom as mongod_here_pids above)
ff_kiosk_pids() {
  OUT=""
  for P in $(pgrep -f firefox 2>/dev/null); do
    pid_matches "$P" "$FF_PROFILE" && OUT="$OUT $P"
  done
  printf '%s' "$OUT"
}

# an already-open kiosk browser is kept — no second window per re-run. Two
# probes, because the browser families look different on the command line:
# Firefox by its profile path, the Chromium fallback by the --kiosk URL it was
# started with (which a Firefox launch happens to match as well).
if [ -n "$(ff_kiosk_pids)" ] || pgrep -f "kiosk.*localhost:$API_PORT" >/dev/null 2>&1; then
  echo "  kiosk browser already open — refresh it (F5) if it shows an error"
  exit 0
fi

# The cabinet's browser configuration. Firefox applies user.js OVER prefs.js at
# every startup, which is what makes this converge: an operator who pokes at
# about:config gets the cabinet's values back on the next start.
write_ff_user_js() {  # <path>
  cat > "$1" <<'FFPREFS'
// GENERATED by run-linux.sh — rewritten on every start. Edit the heredoc in
// run-linux.sh instead; changes made here are thrown away.
//
// Several graphics and media prefs below are read ONCE at process start, so a
// change takes effect on the next full Firefox restart, never on a reload.

// ── GPU: force the accelerated path past the driver blocklist ──────────────
// Firefox has no command-line switch for any of this. Left alone, a cheap
// cabinet GPU is quietly demoted to SOFTWARE rendering and a smooth scene
// becomes a slideshow. Check it in about:support → Graphics: "Compositing"
// must read "WebRender", not "WebRender (Software)".
user_pref("gfx.webrender.all", true);
user_pref("gfx.webrender.software", false);
user_pref("layers.acceleration.force-enabled", true);
// The highest-value pref for THIS app: SpaceBackground paints the sun video
// into a 2D canvas with drawImage on every single frame.
user_pref("gfx.canvas.accelerated", true);
user_pref("widget.dmabuf.force-enabled", true);
// -1 = follow the panel's own vsync. That is also the default; it is set here
// so a stray profile value cannot pin it, and never 0 ("unlimited"), which
// would burn GPU forever on frames a 24/7 cabinet never shows.
user_pref("layout.frame_rate", -1);
// gfx.webrender.compositor is already true on GTK — deliberately not set.

// ── Hardware video decode ──────────────────────────────────────────────────
// media.ffmpeg.vaapi.enabled is GONE from current Firefox; it was folded into
// media.hardware-video-decoding.*, so every guide still naming it is stale.
// Decoding only ever runs in the RDD process, and Firefox switches it off
// entirely whenever WebRender is software — the block above is a hard
// prerequisite for this one, not a nice-to-have.
user_pref("media.hardware-video-decoding.enabled", true);
user_pref("media.hardware-video-decoding.force-enabled", true);
user_pref("media.rdd-process.enabled", true);
user_pref("media.rdd-ffmpeg.enabled", true);
user_pref("media.ffvpx-hw.enabled", true);

// ── Autoplay: the pref that keeps the cabinet from booting silent ──────────
// The space theme builds one WebAudio context and resumes it on load
// (web/src/space/spaceAudio.js). At the default (1 = block audible media)
// that resume is refused until someone touches the screen, so a freshly
// started cabinet would sit there mute. 0 = allowed. WebAudio has no separate
// pref any more — media.autoplay.block-webaudio no longer exists, this covers
// both it and the muted sun video.
user_pref("media.autoplay.default", 0);
user_pref("media.autoplay.blocking_policy", 0);
user_pref("media.autoplay.block-event.enabled", false);
user_pref("media.block-autoplay-until-in-foreground", false);

// ── First run, nags, and the "restore session" trap ────────────────────────
// --kiosk hides the browser's chrome but none of these. A cabinet must come
// up on the game and nothing else — including after a pulled plug.
user_pref("browser.startup.page", 0);
user_pref("browser.startup.homepage", "about:blank");
user_pref("browser.startup.homepage_override.mstone", "ignore");  // no "What's New"
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.sessionstore.resume_from_crash", false);  // no "Restore Session"
user_pref("browser.sessionstore.max_resumed_crashes", 0);
// -1 = never offer Safe Mode. Without it a cabinet that crash-loops ends up
// on the "Firefox has crashed repeatedly" modal — a black screen until
// somebody drives out to the machine.
user_pref("toolkit.startup.max_resumed_crashes", -1);
user_pref("signon.rememberSignons", false);
user_pref("browser.formfill.enable", false);
user_pref("permissions.default.desktop-notification", 2);  // 2 = deny, never ask

// ── Input a player must not be able to trigger ─────────────────────────────
// The in-page lockdown (web/src/kiosk/lockdown.js) already blocks the context
// menu, selection and the zoom shortcuts; these close what is left at browser
// level on a touchscreen or an attached keyboard.
// NOTE: dom.event.contextmenu.enabled is deliberately NOT set. It means "a
// page is allowed to suppress the context menu" — turning it off would BREAK
// the in-page handler and force the browser's own menu to appear, the exact
// opposite of what a kiosk wants. The four browser.gesture.pinch.* prefs are
// not here either: --disable-pinch on the launch line sets and LOCKS them.
user_pref("apz.allow_zooming", false);
user_pref("apz.allow_double_tap_zooming", false);
user_pref("zoom.minPercent", 100);
user_pref("zoom.maxPercent", 100);
user_pref("accessibility.browsewithcaret", false);
user_pref("accessibility.browsewithcaret_shortcut.enabled", false);  // kills the F7 prompt
user_pref("accessibility.typeaheadfind", false);
user_pref("full-screen-api.warning.timeout", 0);
user_pref("full-screen-api.warning.delay", -1);
user_pref("full-screen-api.transition-duration.enter", "0 0");
user_pref("full-screen-api.transition-duration.leave", "0 0");

// ── Background work: nothing may compete with the games ────────────────────
// Telemetry, Safe Browsing list downloads and update checks all wake up on
// their own timers. On a cabinet they buy nothing and cost CPU, disk and
// network at exactly the wrong moment — mid-spin.
user_pref("toolkit.telemetry.unified", false);
user_pref("toolkit.telemetry.archive.enabled", false);
user_pref("toolkit.telemetry.newProfilePing.enabled", false);
user_pref("toolkit.telemetry.shutdownPingSender.enabled", false);
user_pref("toolkit.telemetry.updatePing.enabled", false);
user_pref("toolkit.telemetry.bhrPing.enabled", false);
user_pref("toolkit.telemetry.firstShutdownPing.enabled", false);
user_pref("toolkit.telemetry.server", "data:,");
user_pref("toolkit.coverage.enabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("app.normandy.enabled", false);
user_pref("app.shield.optoutstudies.enabled", false);
user_pref("browser.discovery.enabled", false);

// A crash must never put a reporter window in front of the game.
user_pref("breakpad.reportURL", "");
user_pref("browser.tabs.crashReporting.sendReport", false);
user_pref("browser.crashReports.unsubmittedCheck.enabled", false);
user_pref("browser.crashReports.unsubmittedCheck.autoSubmit2", false);

// Safe Browsing pulls multi-megabyte lists on a timer, to vet URLs this
// machine never visits: it only ever loads http://localhost.
user_pref("browser.safebrowsing.malware.enabled", false);
user_pref("browser.safebrowsing.phishing.enabled", false);
user_pref("browser.safebrowsing.blockedURIs.enabled", false);
user_pref("browser.safebrowsing.downloads.enabled", false);
user_pref("browser.safebrowsing.downloads.remote.enabled", false);
user_pref("browser.safebrowsing.provider.google4.updateURL", "");
user_pref("browser.safebrowsing.provider.google4.gethashURL", "");
user_pref("browser.safebrowsing.provider.mozilla.updateURL", "");

// An update that lands mid-shift is a cabinet that restarts mid-shift.
user_pref("app.update.auto", false);
user_pref("app.update.checkInstallTime", false);
user_pref("app.update.langpack.enabled", false);
user_pref("browser.search.update", false);
user_pref("extensions.update.enabled", false);
user_pref("extensions.update.autoUpdateDefault", false);
user_pref("extensions.systemAddon.update.enabled", false);
user_pref("extensions.getAddons.cache.enabled", false);
// The blocklist sync is real background network and disk. Switching it off
// also switches off the mechanism that would disable a known-bad add-on —
// sound here ONLY because this profile has no add-ons and cannot gain any
// (xpinstall below). If this cabinet ever needs an extension, restore this
// line first.
user_pref("extensions.blocklist.enabled", false);
user_pref("xpinstall.enabled", false);

// The new tab page is never opened (Ctrl+T is dead in kiosk mode), but it
// still fetches sponsored tiles and stories in the background if left on.
user_pref("browser.newtabpage.enabled", false);
user_pref("browser.newtabpage.activity-stream.feeds.topsites", false);
user_pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
user_pref("browser.newtabpage.activity-stream.showSponsored", false);
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
user_pref("browser.newtabpage.activity-stream.discoverystream.enabled", false);
user_pref("browser.newtabpage.activity-stream.asrouter.useRemoteL10n", false);
user_pref("browser.newtabpage.activity-stream.unifiedAds.tiles.enabled", false);
user_pref("browser.newtabpage.activity-stream.unifiedAds.spocs.enabled", false);
user_pref("browser.topsites.contile.enabled", false);

// Nothing to speculate about on a single local URL.
user_pref("network.prefetch-next", false);
user_pref("network.dns.disablePrefetch", true);
user_pref("network.http.speculative-parallel-limit", 0);
user_pref("browser.urlbar.speculativeConnect.enabled", false);
user_pref("browser.places.speculativeConnect.enabled", false);

// Phone-home services. The captive-portal and connectivity checks are the
// notable ones: they poke the network on a timer forever.
user_pref("network.captive-portal-service.enabled", false);
user_pref("network.connectivity-service.enabled", false);
user_pref("browser.region.network.url", "");
user_pref("browser.uitour.enabled", false);
user_pref("identity.fxaccounts.enabled", false);
user_pref("browser.vpn_promo.enabled", false);
user_pref("browser.preferences.moreFromMozilla", false);
user_pref("browser.translations.enable", false);
user_pref("browser.ml.enable", false);

// ── Disk wear ──────────────────────────────────────────────────────────────
// Session store writes every 15 seconds by default: ~5,700 writes a day into
// the profile of a machine that never shuts down, to remember one tab on one
// URL. Half an hour is generous.
user_pref("browser.sessionstore.interval", 1800000);
user_pref("browser.sessionstore.interval.idle", 3600000);
user_pref("browser.sessionstore.max_tabs_undo", 0);
user_pref("browser.sessionstore.max_windows_undo", 0);
user_pref("browser.sessionstore.privacy_level", 2);

// ── Memory on modest cabinet hardware ──────────────────────────────────────
// One origin, one tab, forever: a pool of content processes and site
// isolation buy nothing here and cost a few hundred MB the games want. This
// is a performance choice, and it is only sound BECAUSE the cabinet loads
// nothing but http://localhost — never a third-party page.
user_pref("dom.ipc.processCount", 1);
user_pref("fission.autostart", false);
user_pref("dom.ipc.processPrelaunch.enabled", false);
user_pref("browser.cache.memory.capacity", 65536);  // KiB
// The disk cache stays ON: the assets are local, but re-parsing the bundle
// and a multi-megabyte video on every restart is not free.
FFPREFS
}

# Create the profile if it is missing and (re)write user.js. Firefox builds
# everything else in there on first run — no profile manager needed, and the
# path form of --profile never registers it in profiles.ini, so it cannot
# collide with the operator's own profile list.
provision_ff_profile() {
  if ! mkdir -p "$FF_PROFILE" 2>/dev/null; then
    say "[warn] cannot create $FF_PROFILE — Firefox will start on its own defaults"
    return 1
  fi
  if ! write_ff_user_js "$FF_PROFILE/user.js.new" 2>/dev/null; then
    rm -f "$FF_PROFILE/user.js.new"
    say "[warn] could not write the kiosk profile — Firefox keeps its old settings"
    return 1
  fi
  FF_NEW="$(cksum < "$FF_PROFILE/user.js.new")"
  # 2>/dev/null goes FIRST: on a fresh profile it is the input redirect itself
  # that fails, and the shell reports that before cksum ever runs
  FF_OLD="$(cksum 2>/dev/null < "$FF_PROFILE/user.js")" || FF_OLD=""
  if [ "$FF_NEW" = "$FF_OLD" ]; then
    rm -f "$FF_PROFILE/user.js.new"
    return 0
  fi
  mv "$FF_PROFILE/user.js.new" "$FF_PROFILE/user.js" || return 1
  # A pref dropped from (or changed in) user.js is NOT reverted by Firefox:
  # the value it last applied stays behind in prefs.js as a user-set value.
  # So whenever the set changes, prefs.js goes and Firefox rebuilds it from
  # user.js — the profile converges instead of accreting old settings. The
  # previous user.js is the stamp; no extra state file needed.
  rm -f "$FF_PROFILE/prefs.js"
  say "kiosk browser profile written (data/ff-profile/user.js)"
  return 0
}

# A profile lock with no Firefox behind it is debris from an unclean shutdown;
# with a live Firefox it is real and must stay — deleting a HELD lock would
# let a second Firefox take a fresh one and two of them would then write the
# same profile. Same rule as the mongod.lock check above.
# .parentlock is an fcntl lock the kernel drops when the process dies, so it
# rarely goes stale; `lock` is the symlink Firefox falls back to where fcntl
# locking is unavailable (NFS, some FUSE mounts), and THAT one really does
# survive a crash and would block every boot after it.
clear_ff_lock() {
  [ -n "$(ff_kiosk_pids)" ] && return 0
  [ -L "$FF_PROFILE/lock" ] && say "clearing a stale Firefox profile lock from an unclean shutdown"
  rm -f "$FF_PROFILE/lock" "$FF_PROFILE/.parentlock" 2>/dev/null
  return 0
}

launch_firefox() {  # "$@" = the command that starts Firefox
  # Firefox reads none of the GPU or autoplay switches from the command line,
  # so the launch line carries only what is genuinely environment — and only
  # on the browser, via env: this script's own environment stays untouched.
  #   MOZ_ENABLE_WAYLAND is asserted ONLY when a Wayland socket actually
  #     exists. Fedora 44 has no X11 session left and Firefox picks Wayland by
  #     itself when WAYLAND_DISPLAY is set, but forcing it with no compositor
  #     (a TTY, a systemd unit) makes Firefox fail to start rather than fall
  #     back. Wayland also earns the DMABuf upload path, which keeps even a
  #     software-decoded frame on the GPU for the canvas draw.
  #   MOZ_CRASHREPORTER_DISABLE keeps a crash from spawning a reporter window
  #     in front of the game.
  FF_ENV="MOZ_CRASHREPORTER_DISABLE=1"
  [ -n "${WAYLAND_DISPLAY:-}" ] && FF_ENV="$FF_ENV MOZ_ENABLE_WAYLAND=1"
  # --new-instance keeps this launch from being handed to an operator's
  #   already-running Firefox as a new tab in THEIR window. (--no-remote, which
  #   every kiosk guide still recommends, is stripped as unsupported by current
  #   Firefox; the dedicated profile is what really separates the instances.)
  # --profile takes a PATH, unlike -P, which takes a profile NAME.
  # --allow-downgrade keeps an unattended box from stopping on a modal if a
  #   package rollback ever makes Firefox older than the profile.
  # --disable-pinch sets and locks the four browser.gesture.pinch.* prefs.
  # --kiosk is fullscreen with no browser chrome at all, and takes the URL as
  #   its positional argument.
  # shellcheck disable=SC2086
  nohup env $FF_ENV "$@" --new-instance --allow-downgrade \
      --profile "$FF_PROFILE" --disable-pinch --kiosk "$URL" >/dev/null 2>&1 &
}

ff_go() {  # provision, then launch — "$@" = the command that starts Firefox
  provision_ff_profile
  clear_ff_lock
  launch_firefox "$@"
}

# 1) Firefox from a normal package install — on Fedora that is the RPM, which
#    puts a wrapper at /usr/bin/firefox around the real binary in /usr/lib64.
FF_CMD=""
for F in firefox firefox-esr firefox-bin \
         /usr/lib64/firefox/firefox /usr/lib/firefox/firefox \
         /opt/firefox/firefox /usr/local/firefox/firefox; do
  case "$F" in
    /*) [ -x "$F" ] || continue ;;
    *)  command -v "$F" >/dev/null 2>&1 || continue ;;
  esac
  # Ask the binary what it is before committing to it: a dangling symlink left
  # by a failed package transaction still satisfies command -v and then fails
  # at launch, and the ladder would never reach a browser that works.
  if "$F" --version 2>/dev/null | grep -qi 'mozilla firefox'; then FF_CMD="$F"; break; fi
  say "[warn] $F does not run — trying the next browser"
done
if [ -n "$FF_CMD" ]; then
  echo "  opening in Firefox (kiosk) — leave with Alt+F4"
  ff_go "$FF_CMD"
  exit 0
fi

# 2) Flatpak Firefox — how Fedora increasingly ships browsers.
if command -v flatpak >/dev/null 2>&1 && flatpak info org.mozilla.firefox >/dev/null 2>&1; then
  echo "  opening in Firefox via flatpak (kiosk) — leave with Alt+F4"
  # --filesystem is NOT optional: the sandbox remaps $HOME, so without a grant
  # for this folder Firefox cannot see the --profile path, quietly falls back
  # to a throwaway profile inside the sandbox, and every pref above is ignored
  # — a cabinet that looks right while running muted on software rendering.
  ff_go flatpak run --filesystem="$HERE" org.mozilla.firefox
  exit 0
fi

# 3) Snap Firefox. Fedora ships no snapd, so this is defensive — and the snap
#    wrapper is normally on PATH, which step 1 already covers. Its sandbox can
#    only reach the profile while this folder is under $HOME.
for F in /snap/bin/firefox /var/lib/snapd/snap/bin/firefox; do
  if [ -x "$F" ]; then
    echo "  opening in Firefox via snap (kiosk) — leave with Alt+F4"
    ff_go "$F"
    exit 0
  fi
done

# ── fallback: the Chromium family ───────────────────────────────────────────
# Firefox is the cabinet browser; everything below is only what happens on a
# machine that has none installed.
# Chromium-family flags. The in-page lockdown already blocks zoom, the
# context menu and selection, so a browser without these flags still behaves
# — they only remove chrome-level extras.
# The GPU flags matter as much as the kiosk ones on cheap hardware: Chromium
# blocklists a lot of Linux drivers and silently falls back to SOFTWARE
# rendering, which turns a smooth scene into a slideshow. These force the
# GPU path back on. Check the result at chrome://gpu. Firefox needs none of
# them on the command line — for it they are prefs, written into the profile
# above, and its equivalent report is about:support → Graphics.
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

# Last resort: hand it to the desktop's default browser, fullscreen with F11.
if command -v xdg-open >/dev/null 2>&1; then
  echo "  No kiosk-capable browser found — opening your default browser."
  echo "  Press F11 for fullscreen."
  nohup xdg-open "$URL" >/dev/null 2>&1 &
  exit 0
fi

echo "  No browser found. Open this address on the machine:  $URL"
echo "  Install Firefox — it is the browser this cabinet is built around:"
if command -v dnf >/dev/null 2>&1; then
  echo "      sudo dnf install -y firefox"
  echo "      sudo dnf install -y chromium         # fallback only"
elif command -v apt >/dev/null 2>&1; then
  echo "      sudo apt install -y firefox"
  echo "      sudo snap install chromium           # fallback only"
elif command -v pacman >/dev/null 2>&1; then
  echo "      sudo pacman -S --noconfirm firefox"
elif command -v zypper >/dev/null 2>&1; then
  echo "      sudo zypper install -y MozillaFirefox"
fi
echo "      flatpak install flathub org.mozilla.firefox     # works anywhere"
