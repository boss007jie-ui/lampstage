#!/usr/bin/env bash
# 验证备份可恢复：把 dump 还原到一个临时容器，逐表比对行数，完了自动清理。
# 用法: sudo ./verify-backup.sh <dump 文件路径>
set -euo pipefail

DUMP=${1:?用法: verify-backup.sh <dump 路径>}
CT=lampstage-restore-test
PW=verify_only_temp

cleanup() { docker rm -f "$CT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f "$CT" >/dev/null 2>&1 || true
docker run -d --name "$CT" -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=lampstage postgres:16-alpine >/dev/null

echo "等待临时库就绪..."
for _ in $(seq 1 30); do
  if docker exec "$CT" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

docker cp "$DUMP" "$CT:/tmp/d.dump" >/dev/null

echo "--- pg_restore ---"
docker exec "$CT" pg_restore --no-owner --no-privileges \
  -d "postgresql://postgres:$PW@localhost/lampstage" /tmp/d.dump 2>&1 | tail -8 || true

echo "--- 还原后逐表行数 ---"
docker exec "$CT" psql -U postgres -d lampstage -tAc \
  "select relname || ' = ' || n_live_tup from pg_stat_user_tables order by relname"

echo "--- 关键表抽查 ---"
docker exec "$CT" psql -U postgres -d lampstage -tAc \
  "select 'User=' || (select count(*) from \"User\") || ' ApiKey=' || (select count(*) from \"ApiKey\") || ' migrations=' || (select count(*) from _prisma_migrations)"

echo "--- 余额与 key 哈希前缀（确认数据本身完整）---"
docker exec "$CT" psql -U postgres -d lampstage -tAc \
  "select 'credit_balance=' || credit_balance from \"User\"; select name || ' ' || left(key_hash,8) from \"ApiKey\" order by created_at;"
