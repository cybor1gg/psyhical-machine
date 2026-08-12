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

# ── 1. Node ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is required. Install it, then run this again:"
  echo "      sudo apt install -y nodejs npm"
  echo "  (Ubuntu's package can be old; Node 20+ is recommended:"
  echo "      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs)"
  exit 1
fi
echo "[1/5] node $(node -v)"

# ── 2. MongoDB (kept inside the project — no system install, no apt repo) ──
mkdir -p runtime data/db
if [ ! -x runtime/mongod ]; then
  echo "[2/5] fetching MongoDB $MONGO_VER..."
  DISTRO="ubuntu2204"
  if [ -r /etc/os-release ]; then
    . /etc/os-release
    case "${ID}${VERSION_ID%%.*}" in
      ubuntu24|debian13) DISTRO="ubuntu2404" ;;
      ubuntu22|debian12) DISTRO="ubuntu2204" ;;
      ubuntu20|debian11) DISTRO="ubuntu2004" ;;
      rhel*|centos*|fedora*) DISTRO="rhel8" ;;
    esac
  fi
  TARBALL="mongodb-linux-x86_64-${DISTRO}-${MONGO_VER}.tgz"
  echo "      ($DISTRO build)"
  curl -fL# -o /tmp/$TARBALL "https://fastdl.mongodb.org/linux/$TARBALL"
  tar -xzf /tmp/$TARBALL -C /tmp --wildcards "*/bin/mongod"
  mv /tmp/mongodb-linux-x86_64-${DISTRO}-${MONGO_VER}/bin/mongod runtime/mongod
  chmod +x runtime/mongod
  rm -rf /tmp/$TARBALL /tmp/mongodb-linux-x86_64-${DISTRO}-${MONGO_VER}
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
