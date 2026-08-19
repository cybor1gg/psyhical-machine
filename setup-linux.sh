#!/usr/bin/env bash
# Setup for a Linux cabinet, straight from a copy of this folder.
#
#   bash setup-linux.sh            → sets up CABINET-0001
#   bash setup-linux.sh CABINET-0007
#
# Fully re-runnable: every step first checks what is already in place and only
# does the missing part. Existing secrets, identity and database files are
# never touched; a broken half-install (missing or empty binary, stale build)
# is repaired instead of tripped over.
set -u
cd "$(dirname "$0")"
HERE="$(pwd)"
CAB_ID="${1:-CABINET-0001}"
MONGO_VER="8.0.4"

# bundled runtimes shipped alongside the repo (preferred: no network needed)
NODE_DIR="$HERE/tools/linux/node-v22.14.0-linux-x64"
NODE_TAR="$HERE/tools/linux/node-linux.tar.xz"
MONGO_DIR="$HERE/tools/linux/mongodb-linux-x86_64-ubuntu2204-8.0.4"
MONGO_TGZ="$HERE/tools/linux/mongo-linux.tgz"
STATE_DIR="$HERE/data/state"
TMP_DIR="$HERE/data/tmp"

ok()   { printf '  [ok]   %s\n' "$*"; }
skip() { printf '  [skip] %s\n' "$*"; }
fix()  { printf '  [fix]  %s\n' "$*"; }
die()  { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }

echo "=========================================="
echo "  MTECH CABINET — setup ($CAB_ID)"
echo "=========================================="

mkdir -p "$STATE_DIR" "$TMP_DIR" runtime
# the database's files: created if missing, NEVER wiped if already present
if [ -d data/db ]; then
  skip "database files exist — keeping them"
else
  mkdir -p data/db
fi

# ── which package manager is this? (so every hint is the RIGHT command) ─────
if   command -v dnf     >/dev/null 2>&1; then PKG="sudo dnf install -y"
elif command -v apt     >/dev/null 2>&1; then PKG="sudo apt install -y"
elif command -v pacman  >/dev/null 2>&1; then PKG="sudo pacman -S --noconfirm"
elif command -v zypper  >/dev/null 2>&1; then PKG="sudo zypper install -y"
else PKG="(your package manager) install"
fi
command -v tar >/dev/null 2>&1 || die "tar is required — install it first:  $PKG tar"

# ── 1/6 Node ────────────────────────────────────────────────────────────────
echo "[1/6] node..."
# npm must be checked too: an interrupted or foreign extraction can leave
# bin/node without the npm symlinks, which breaks setup much later
node_runtime_ok() { [ -x "$NODE_DIR/bin/node" ] && [ -e "$NODE_DIR/bin/npm" ]; }

if node_runtime_ok; then
  skip "bundled node already extracted"
elif [ -f "$NODE_TAR" ]; then
  [ -d "$NODE_DIR" ] && fix "bundled node dir is incomplete — re-extracting"
  command -v xz >/dev/null 2>&1 || die "xz is needed to unpack node:  $PKG xz-utils"
  rm -rf "$TMP_DIR/node" && mkdir -p "$TMP_DIR/node"
  # extract into a temp dir first so an interrupted run never leaves a
  # half-extracted tree at the final path
  tar -xJf "$NODE_TAR" -C "$TMP_DIR/node" || die "could not extract $NODE_TAR"
  SRC=""
  for d in "$TMP_DIR"/node/*/; do SRC="${d%/}"; done
  [ -n "$SRC" ] && [ -x "$SRC/bin/node" ] || die "extraction of $NODE_TAR produced no bin/node"
  rm -rf "$NODE_DIR"
  mv "$SRC" "$NODE_DIR" || die "could not move the node runtime into place"
  rm -rf "$TMP_DIR/node"
  ok "bundled node extracted"
fi

if node_runtime_ok; then
  export PATH="$NODE_DIR/bin:$PATH"
else
  # no bundled runtime with this copy — fall back to the system's node
  if ! command -v node >/dev/null 2>&1; then
    echo "  Node.js is required. Install it, then run this again:"
    echo "      $PKG nodejs npm"
    echo "  (Node 20 or newer. If your distro ships an older one:"
    echo "      https://github.com/nvm-sh/nvm  →  nvm install 22 )"
    exit 1
  fi
  NODE_MAJOR="$(node -pe 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null \
    || die "node $(node -v) is too old — needs 20+:  $PKG nodejs npm  (or nvm install 22)"
fi
ok "using node $(node -v)  ($(command -v node))"

# ── 2/6 MongoDB (kept inside the project — no system install) ───────────────
echo "[2/6] mongodb..."
if [ -s runtime/mongod ] && [ ! -x runtime/mongod ]; then
  fix "runtime/mongod lost its executable bit"
  chmod +x runtime/mongod
fi
if [ -x runtime/mongod ] && [ -s runtime/mongod ]; then
  skip "runtime/mongod already installed"
else
  [ -e runtime/mongod ] && fix "runtime/mongod is broken — reinstalling"
  rm -f runtime/mongod
  rm -rf "$TMP_DIR/mongo" && mkdir -p "$TMP_DIR/mongo"

  if [ -s "$MONGO_DIR/bin/mongod" ]; then
    cp "$MONGO_DIR/bin/mongod" "$TMP_DIR/mongo/mongod" || die "could not copy the bundled mongod"
    ok "using bundled mongod from tools/linux/"
  elif [ -f "$MONGO_TGZ" ]; then
    tar -xzf "$MONGO_TGZ" -C "$TMP_DIR/mongo" --wildcards "*/bin/mongod" \
      || die "could not extract $MONGO_TGZ"
    F=""
    for f in "$TMP_DIR"/mongo/*/bin/mongod; do F="$f"; done
    [ -n "$F" ] && [ -s "$F" ] || die "extraction of $MONGO_TGZ produced no bin/mongod"
    mv "$F" "$TMP_DIR/mongo/mongod"
    ok "bundled mongod extracted from tools/linux/"
  else
    # nothing bundled — download the right build (needs network + curl)
    command -v curl >/dev/null 2>&1 \
      || die "no bundled mongodb found and curl is missing:  $PKG curl"
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64)  MARCH="x86_64" ;;
      aarch64|arm64) MARCH="aarch64" ;;
      *) die "unsupported CPU: $ARCH (MongoDB ships x86_64 and arm64 only)" ;;
    esac
    # musl systems (Alpine) cannot run the official glibc builds at all
    if [ -f /etc/alpine-release ]; then
      echo "  Alpine/musl is not supported by the official MongoDB builds."
      echo "  Use a glibc distro, or run MongoDB in Docker and point MONGODB_URI at it."
      exit 1
    fi
    # Only builds that actually exist on fastdl are listed here.
    DISTRO="ubuntu2204"
    if [ -r /etc/os-release ]; then
      . /etc/os-release
      # rolling-release distros ship no VERSION_ID — don't trip over set -u
      MAJOR="${VERSION_ID:-}"; MAJOR="${MAJOR%%.*}"
      case "${ID:-}" in
        ubuntu)   case "$MAJOR" in 24) DISTRO=ubuntu2404 ;; 20) DISTRO=ubuntu2004 ;; *) DISTRO=ubuntu2204 ;; esac ;;
        debian)   case "$MAJOR" in 11) DISTRO=debian11 ;; *) DISTRO=debian12 ;; esac ;;
        fedora)   DISTRO=rhel93 ;;                       # Fedora tracks newer glibc than RHEL 9
        rhel|rocky|almalinux|centos|ol)
                  case "$MAJOR" in 8) DISTRO=rhel8 ;; *) DISTRO=rhel93 ;; esac ;;
        opensuse*|sles) DISTRO=suse15 ;;
        arch|manjaro|endeavouros) DISTRO=ubuntu2204 ;;    # glibc-compatible
        *)        DISTRO=ubuntu2204 ;;
      esac
    fi
    [ "$MARCH" = "aarch64" ] && case "$DISTRO" in rhel*|suse*) DISTRO=ubuntu2204 ;; esac

    TARBALL="mongodb-linux-${MARCH}-${DISTRO}-${MONGO_VER}.tgz"
    echo "  fetching MongoDB $MONGO_VER ($DISTRO / $MARCH)..."
    if ! curl -fL# -o "$TMP_DIR/mongo/$TARBALL" "https://fastdl.mongodb.org/linux/$TARBALL"; then
      echo "  that build was not available — falling back to the generic one"
      DISTRO="ubuntu2204"
      TARBALL="mongodb-linux-${MARCH}-${DISTRO}-${MONGO_VER}.tgz"
      curl -fL# -o "$TMP_DIR/mongo/$TARBALL" "https://fastdl.mongodb.org/linux/$TARBALL" \
        || die "could not download MongoDB — no network? ship tools/linux/mongo-linux.tgz instead"
    fi
    tar -xzf "$TMP_DIR/mongo/$TARBALL" -C "$TMP_DIR/mongo" --wildcards "*/bin/mongod" \
      || die "could not extract the downloaded $TARBALL"
    F=""
    for f in "$TMP_DIR"/mongo/*/bin/mongod; do F="$f"; done
    [ -n "$F" ] && [ -s "$F" ] || die "the downloaded $TARBALL contained no bin/mongod"
    mv "$F" "$TMP_DIR/mongo/mongod"
    ok "mongod downloaded"
  fi

  chmod +x "$TMP_DIR/mongo/mongod"
  mv "$TMP_DIR/mongo/mongod" runtime/mongod || die "could not move mongod into place"
  rm -rf "$TMP_DIR/mongo"
  ok "runtime/mongod installed"
fi

# ── 3/6 this machine's identity + secrets (generated once, never in git) ────
echo "[3/6] machine identity..."
if [ ! -f web/public/cabinet.config.json ]; then
  KEY="cab_$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')" \
    || die "could not generate a machine key"
  cat > web/public/cabinet.config.json <<EOF
{
  "cabinetId": "$CAB_ID",
  "machineKey": "$KEY"
}
EOF
  ok "created $CAB_ID with a fresh machine key"
else
  skip "keeping existing $(node -pe 'JSON.parse(require("fs").readFileSync("web/public/cabinet.config.json")).cabinetId')"
fi

if [ ! -f api/.env ]; then
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')" \
    || die "could not generate a JWT secret"
  cat > api/.env <<EOF
MONGODB_URI=mongodb://127.0.0.1:27018/cabinet
JWT_SECRET=$SECRET
PORT=5001
WEB_ORIGIN=http://localhost:5001
STATIC_DIR=../web/dist
EOF
  ok "created api/.env with a fresh JWT secret"
elif grep -q '^STATIC_DIR=' api/.env; then
  skip "keeping existing api/.env"
else
  # an .env carried over from a dev machine predates the single-port design;
  # the kiosk serves nothing without STATIC_DIR, so heal the file in place
  printf '\nSTATIC_DIR=../web/dist\n' >> api/.env
  fix "api/.env had no STATIC_DIR — appended STATIC_DIR=../web/dist"
fi

# ── 4/6 dependencies (skipped when nothing changed since the last install) ──
echo "[4/6] dependencies..."
deps_install() {  # $1 = api | web
  DEP_DIR="$HERE/$1"
  DEP_STAMP="$STATE_DIR/$1-deps.stamp"
  DEP_CUR="$(cd "$DEP_DIR" && cksum package.json package-lock.json 2>/dev/null)"
  if [ -d "$DEP_DIR/node_modules" ] && [ -f "$DEP_STAMP" ] \
     && [ "$(cat "$DEP_STAMP")" = "$DEP_CUR" ]; then
    skip "$1 dependencies unchanged"
    return 0
  fi
  ( cd "$DEP_DIR" && npm install --no-audit --no-fund --silent ) \
    || die "npm install failed in $1/ — see the output above"
  # npm install may rewrite package-lock.json, so hash AFTER installing
  ( cd "$DEP_DIR" && cksum package.json package-lock.json 2>/dev/null ) > "$DEP_STAMP"
  ok "$1 dependencies installed"
}
deps_install api

# web dependencies are BUILD tooling only — decide whether a build is due
# BEFORE touching them, so an offline cabinet with a fresh web/dist never
# needs npm to reach the registry (a node_modules copied from another OS
# would force npm to download this platform's native binaries)
NEED_BUILD=0
if [ ! -f web/dist/index.html ]; then
  NEED_BUILD=1
elif [ -n "$(find web/src web/public web/index.html web/vite.config.js web/package.json \
              -newer web/dist/index.html -print -quit 2>/dev/null)" ]; then
  NEED_BUILD=1
fi
if [ "$NEED_BUILD" = 1 ]; then
  deps_install web
else
  skip "web dependencies not needed — kiosk build is up to date"
fi

# ── 5/6 build the kiosk (only when the sources are newer than the build) ────
echo "[5/6] kiosk build..."
if [ "$NEED_BUILD" = 1 ]; then
  ( cd web && npm run build ) || die "kiosk build failed — fix the error above and re-run"
  ok "kiosk built"
else
  skip "kiosk build is up to date"
fi

# ── 6/6 the kiosk browser ───────────────────────────────────────────────────
echo "[6/6] kiosk browser..."
# Firefox is the cabinet browser: run-linux.sh starts it in kiosk mode on a
# profile it writes itself (data/ff-profile), forcing the GPU path and letting
# sound play without a tap. Nothing is installed here — this step exists so an
# operator learns NOW that the machine has no browser, instead of at the end
# of the first start, when the cabinet is supposed to be running.
# The profile is deliberately NOT written here: run-linux.sh rewrites it on
# every start, so there is one copy of the pref list and it keeps converging
# on a machine where setup is never run again.
# openSUSE is the one distro that does not call the package "firefox"
FF_PKG="firefox"
command -v zypper >/dev/null 2>&1 && FF_PKG="MozillaFirefox"
FF_VER=""
for B in firefox firefox-esr firefox-bin \
         /usr/lib64/firefox/firefox /usr/lib/firefox/firefox \
         /opt/firefox/firefox /usr/local/firefox/firefox; do
  case "$B" in
    /*) [ -x "$B" ] || continue ;;
    *)  command -v "$B" >/dev/null 2>&1 || continue ;;
  esac
  # a dangling symlink from a failed package transaction still satisfies
  # command -v and only fails at launch — ask the binary what it is
  V="$("$B" --version 2>/dev/null | grep -i 'mozilla firefox')" || V=""
  [ -n "$V" ] && { FF_VER="$V"; break; }
done
if [ -n "$FF_VER" ]; then
  ok "$FF_VER — the cabinet will run in kiosk mode on it"
elif command -v flatpak >/dev/null 2>&1 && flatpak info org.mozilla.firefox >/dev/null 2>&1; then
  ok "Firefox (flatpak) — the cabinet will run in kiosk mode on it"
else
  CHROME_ALT=""
  for B in google-chrome google-chrome-stable chromium chromium-browser \
           brave-browser vivaldi-stable opera microsoft-edge microsoft-edge-stable; do
    command -v "$B" >/dev/null 2>&1 && { CHROME_ALT="$B"; break; }
  done
  if [ -n "$CHROME_ALT" ]; then
    skip "no Firefox — the cabinet will fall back to $CHROME_ALT"
    echo "  Firefox is the browser this cabinet is tuned for:"
    echo "      $PKG $FF_PKG"
  else
    echo "  No kiosk-capable browser is installed yet. Setup is otherwise"
    echo "  complete — install Firefox, then start the cabinet:"
    echo "      $PKG $FF_PKG"
    echo "      bash run-linux.sh"
  fi
fi

chmod +x run-linux.sh stop-linux.sh 2>/dev/null || true

echo
echo "=========================================="
echo "  SETUP COMPLETE"
echo
echo "  Start the cabinet:   bash run-linux.sh"
echo "=========================================="
