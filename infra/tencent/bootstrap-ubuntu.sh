#!/usr/bin/env bash
set -euo pipefail

# Run as root on an Ubuntu 22.04/24.04 Tencent CVM.
# Resource creation, billing and DNS changes stay in the Tencent console.
ROOT=/srv/lampstage
REPO_URL=${REPO_URL:-https://github.com/boss007jie-ui/lampstage.git}
BRANCH=${BRANCH:-master}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script with sudo: sudo bash infra/tencent/bootstrap-ubuntu.sh" >&2
  exit 1
fi

. /etc/os-release
if [ "$ID" != ubuntu ] || { [ "$VERSION_ID" != 22.04 ] && [ "$VERSION_ID" != 24.04 ]; }; then
  echo "This bootstrap supports Ubuntu 22.04 and 24.04 only." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  # Docker's official apt repository provides Engine, Buildx and Compose for
  # both supported Ubuntu releases.
  apt-get remove -y docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc || true
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Install docker-compose-plugin for your Docker distribution." >&2
  exit 1
fi
systemctl enable --now docker
install -d -m 0755 "$ROOT"
if [ ! -d "$ROOT/repo/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$ROOT/repo"
else
  if ! git -C "$ROOT/repo" diff --quiet || ! git -C "$ROOT/repo" diff --cached --quiet; then
    echo "Repository has local changes. Commit or move them before updating; no files were overwritten." >&2
    exit 1
  fi
  if [ "$(git -C "$ROOT/repo" branch --show-current)" != "$BRANCH" ]; then
    echo "Repository must be on branch $BRANCH before updating." >&2
    exit 1
  fi
  git -C "$ROOT/repo" fetch origin "$BRANCH"
  git -C "$ROOT/repo" merge --ff-only FETCH_HEAD
fi

cd "$ROOT/repo"
mkdir -p infra/tencent/runtime
if [ ! -f infra/tencent/.env.prod ]; then
  cp infra/tencent/.env.prod.example infra/tencent/.env.prod
  chmod 600 infra/tencent/.env.prod
  echo "Fill infra/tencent/.env.prod and place account01.runtime.json in infra/tencent/runtime, then rerun this script."
  exit 0
fi
if [ ! -f infra/tencent/runtime/account01.runtime.json ] || [ ! -f infra/tencent/runtime/account01.runtime.json.account.json ]; then
  echo "Missing isolated Hypit account01 runtime files under infra/tencent/runtime."
  exit 1
fi

docker compose --env-file infra/tencent/.env.prod -f infra/tencent/docker-compose.yml build
docker compose --env-file infra/tencent/.env.prod -f infra/tencent/docker-compose.yml run --rm web npx prisma migrate deploy
docker compose --env-file infra/tencent/.env.prod -f infra/tencent/docker-compose.yml up -d
docker compose --env-file infra/tencent/.env.prod -f infra/tencent/docker-compose.yml ps
