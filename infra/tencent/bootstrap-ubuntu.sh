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

# Docker Hub (registry-1.docker.io) is not reliably reachable from mainland
# China CVMs. Without a registry mirror the very first build step —
# `FROM node:22-bookworm-slim` — fails with an i/o timeout, and so does pulling
# caddy for the edge service. Tencent Cloud provides an in-VPC accelerator.
#
# Guard rails:
#   * Probe the mirror first, so hosts that do not need it stay untouched and
#     we never add an unreachable mirror that would only cost latency.
#   * Never overwrite an existing daemon.json; only an absent file is created.
#   * Restart Docker only when we actually wrote the file, so re-running this
#     script never bounces a running deployment.
#   * Set DOCKER_REGISTRY_MIRROR to an empty value to opt out entirely.
#     Note the single-dash form below: `:-` would substitute the default for an
#     explicitly empty value too, which makes the opt-out impossible.
DOCKER_REGISTRY_MIRROR=${DOCKER_REGISTRY_MIRROR-https://mirror.ccs.tencentyun.com}
DAEMON_JSON=/etc/docker/daemon.json
if [ -f "$DAEMON_JSON" ]; then
  if grep -q 'registry-mirrors' "$DAEMON_JSON"; then
    echo "$DAEMON_JSON already configures registry-mirrors; leaving it unchanged."
  else
    echo "WARNING: $DAEMON_JSON exists but has no registry-mirrors. If the image build cannot reach registry-1.docker.io, add one manually." >&2
  fi
elif [ -n "$DOCKER_REGISTRY_MIRROR" ]; then
  if curl -fsS -m 8 -o /dev/null "$DOCKER_REGISTRY_MIRROR/v2/" 2>/dev/null; then
    printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$DOCKER_REGISTRY_MIRROR" > "$DAEMON_JSON"
    chmod 644 "$DAEMON_JSON"
    systemctl restart docker
    echo "Configured Docker registry mirror: $DOCKER_REGISTRY_MIRROR"
  else
    echo "Registry mirror $DOCKER_REGISTRY_MIRROR is not reachable; using the default registries." >&2
  fi
fi

# The same problem exists one layer down, inside the build container: apt and
# npm both reach their upstream hosts but far too slowly. Measured on a Tencent
# CVM in this VPC, deb.debian.org served 1.35 MB/s and registry.npmjs.org
# 216 KB/s, against 39.3 MB/s and 1.39 MB/s from Tencent's in-VPC mirrors.
# Building then took tens of minutes, almost all of it waiting on downloads.
#
# Guard rails mirror the registry-mirror block above: probe before using, and
# keep the value to ourselves (exported for compose build-arg interpolation) so
# nothing is written to disk. Single-dash defaults again, so an explicit empty
# value opts out.
WANT_DEBIAN_MIRROR=${DEBIAN_MIRROR-http://mirrors.cloud.tencent.com}
WANT_NPM_REGISTRY=${NPM_REGISTRY-https://mirrors.cloud.tencent.com/npm}
DEBIAN_MIRROR=""
NPM_REGISTRY=""
if [ -n "$WANT_DEBIAN_MIRROR" ] \
   && curl -fsS -m 8 -o /dev/null "$WANT_DEBIAN_MIRROR/debian/dists/bookworm/Release" 2>/dev/null \
   && curl -fsS -m 8 -o /dev/null "$WANT_DEBIAN_MIRROR/debian-security/dists/bookworm-security/Release" 2>/dev/null; then
  DEBIAN_MIRROR="$WANT_DEBIAN_MIRROR"
  echo "Image build will use the Debian mirror $DEBIAN_MIRROR."
else
  echo "Debian mirror ${WANT_DEBIAN_MIRROR:-<disabled>} has no usable package indexes; the image build will use deb.debian.org." >&2
fi
if [ -n "$WANT_NPM_REGISTRY" ] \
   && curl -fsS -m 8 -o /dev/null -r 0-1023 "$WANT_NPM_REGISTRY/lodash/-/lodash-4.17.21.tgz" 2>/dev/null; then
  NPM_REGISTRY="$WANT_NPM_REGISTRY"
  echo "Image build will use the npm registry $NPM_REGISTRY."
else
  echo "npm registry ${WANT_NPM_REGISTRY:-<disabled>} is not reachable; the image build will use registry.npmjs.org." >&2
fi
export DEBIAN_MIRROR NPM_REGISTRY

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
