#!/usr/bin/env bash
set -euo pipefail

# Run on a fresh Ubuntu 22.04/24.04 Tencent CVM after cloning this repository.
# Resource creation, billing and DNS changes stay in the Tencent console.
ROOT=/srv/lampstage
REPO_URL=${REPO_URL:-https://github.com/boss007jie-ui/lampstage.git}
BRANCH=${BRANCH:-master}

sudo apt-get update
sudo apt-get install -y ca-certificates curl git docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo mkdir -p "$ROOT"
sudo chown -R "$USER":"$USER" "$ROOT"
if [ ! -d "$ROOT/repo/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$ROOT/repo"
else
  git -C "$ROOT/repo" fetch origin "$BRANCH"
  git -C "$ROOT/repo" reset --hard "origin/$BRANCH"
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
