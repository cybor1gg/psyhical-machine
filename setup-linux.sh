#!/usr/bin/env bash
# One-time setup for a Linux cabinet, straight from a git clone.
#
#   bash setup-linux.sh            → sets up CABINET-0001
#   bash setup-linux.sh CABINET-0007
#
# Installs dependencies, fetches a private MongoDB binary, generates this
# machine's identity + secrets, and builds the kiosk. Re-runnable: existing
# secrets and identity are kept, everything else is refreshed.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
CAB_ID="${1:-CABINET-0001}"
MONGO_VER="8.0.4"

echo "=========================================="
echo "  MTECH CABINET — setup ($CAB_ID)"
echo "=========================================="

# ── 0. which package manager is this? (so every hint is the RIGHT command) ─
if   command -v dnf     >/dev/null 2>&1; then PKG="sudo dnf install -y"
elif command -v apt     >/dev/null 2>&1; then PKG="sudo apt install -y"
elif command -v pacman  >/dev/null 2>&1; then PKG="sudo pacman -S --noconfirm"
elif command -v zypper  >/dev/null 2>&1; then PKG="sudo zypper install -y"
else PKG="(your package manager) install"
fi

# ── 0b. tools this script itself needs ─────────────────────────────────────
MISSING=""
command -v curl >/dev/null 2>&1 || MISSING="$MISSING curl"
command -v tar  >/dev/null 2>&1 || MISSING="$MISSING tar"
if [ -n "$MISSING" ]; then
  echo "  Missing:$MISSING — install first:"
  echo "      $PKG$MISSING"
  exit 1
fi

# ── 1. Node ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is required. Install it, then run this again:"
  echo "      $PKG nodejs npm"
  echo "  (Node 20 or newer. If your distro ships an older one:"
  echo "      https://github.com/nvm-sh/nvm  →  nvm install 22 )"
  exit 1
fi
NODE_MAJOR="$(node -pe 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  Node $(node -v) is too old — this needs Node 20 or newer."
  echo "      $PKG nodejs npm     (or use nvm: nvm install 22)"
  exit 1
fi
echo "[1/5] node $(node -v)"

# ── 2. MongoDB (kept inside the project — no system install, no repo setup) ─
mkdir -p runtime data/db
if [ ! -x runtime/mongod ]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  MARCH="x86_64" ;;
    aarch64|arm64) MARCH="aarch64" ;;
    *) echo "  Unsupported CPU: $ARCH (MongoDB ships x86_64 and arm64 only)"; exit 1 ;;
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
    MAJOR="${VERSION_ID%%.*}"
    case "$ID" in
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
  echo "[2/5] fetching MongoDB $MONGO_VER ($DISTRO / $MARCH)..."
  if ! curl -fL# -o /tmp/$TARBALL "https://fastdl.mongodb.org/linux/$TARBALL"; then
    echo "      that build was not available — falling back to the generic one"
    DISTRO="ubuntu2204"
    TARBALL="mongodb-linux-${MARCH}-${DISTRO}-${MONGO_VER}.tgz"
    curl -fL# -o /tmp/$TARBALL "https://fastdl.mongodb.org/linux/$TARBALL"
  fi
  tar -xzf /tmp/$TARBALL -C /tmp --wildcards "*/bin/mongod"
  mv /tmp/mongodb-linux-${MARCH}-${DISTRO}-${MONGO_VER}/bin/mongod runtime/mongod
  chmod +x runtime/mongod
  rm -rf /tmp/$TARBALL /tmp/mongodb-linux-${MARCH}-${DISTRO}-${MONGO_VER}
else
  echo "[2/5] MongoDB already present"
fi

# ── 3. this machine's identity + secrets (generated once, never in git) ────
echo "[3/5] machine identity..."
if [ ! -f web/public/cabinet.config.json ]; then
  KEY="cab_$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
  cat > web/public/cabinet.config.json <<EOF
{
  "cabinetId": "$CAB_ID",
  "machineKey": "$KEY"
}
EOF
  echo "      created $CAB_ID with a fresh machine key"
else
  echo "      keeping existing $(node -pe 'JSON.parse(require("fs").readFileSync("web/public/cabinet.config.json")).cabinetId')"
fi

if [ ! -f api/.env ]; then
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')"
  cat > api/.env <<EOF
MONGODB_URI=mongodb://127.0.0.1:27018/cabinet
JWT_SECRET=$SECRET
PORT=5001
WEB_ORIGIN=http://localhost:5001
STATIC_DIR=../web/dist
EOF
  echo "      created api/.env with a fresh JWT secret"
else
  echo "      keeping existing api/.env"
fi

# ── 4. dependencies ────────────────────────────────────────────────────────
echo "[4/5] installing dependencies (this takes a minute)..."
( cd api && npm install --no-audit --no-fund --silent )
( cd web && npm install --no-audit --no-fund --silent )

# ── 5. build the kiosk ─────────────────────────────────────────────────────
echo "[5/5] building the kiosk..."
( cd web && npm run build )

chmod +x run-linux.sh 2>/dev/null || true

echo
echo "=========================================="
echo "  SETUP COMPLETE"
echo
echo "  Start the cabinet:   bash run-linux.sh"
echo "=========================================="
