#!/usr/bin/env bash
# 每日备份 Lampstage 生产数据库（自建 PG 容器版）。
#
# 用法: sudo ./backup-db.sh [输出目录]
#   KEEP_DAYS=14   本地保留天数
#   SKIP_OFFSITE=1 跳过上传对象存储（只留本地）
#
# 为什么不能沿用「读 .env.prod 的 DIRECT_URL」那版：DIRECT_URL 现在是 `db:5432`，
# 那是 compose 网络内部的主机名，宿主机解析不了。所以 dump 必须在容器里做。
#
# 备份落在两处：
#   1. 本地 /srv/lampstage/backups/（保留 KEEP_DAYS 天）
#   2. 对象存储私有桶的 db-backups/ 前缀 —— 宿主机磁盘挂了，本地那份跟着没，
#      异地那份才是真正的保险。复用应用自己的 R2_* 凭证与 VIDEO_R2_BUCKET（私有桶）。
set -euo pipefail

REPO=/srv/lampstage/repo
DCK="docker compose --env-file infra/tencent/.env.prod -f infra/tencent/docker-compose.yml"
OUT_DIR=${1:-/srv/lampstage/backups}
KEEP_DAYS=${KEEP_DAYS:-14}
TS=$(date +%Y%m%d-%H%M%S)
DB_USER=lampstage_admin
DB_NAME=lampstage

cd "$REPO"
CT_DB=$($DCK ps -q db)
CT_WEB=$($DCK ps -q web)
[ -n "$CT_DB" ] || { echo "错误：db 容器没有运行" >&2; exit 1; }

mkdir -p "$OUT_DIR"

echo "[1/4] 容器内 pg_dump"
docker exec "$CT_DB" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --no-owner --no-privileges > "$OUT_DIR/lampstage-$TS.dump"
docker exec "$CT_DB" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --no-owner --no-privileges > "$OUT_DIR/lampstage-$TS.sql"

echo "[2/4] 校验 dump 可读（防止把空 dump 当成功）"
docker cp "$OUT_DIR/lampstage-$TS.dump" "$CT_DB:/tmp/selfcheck.dump"
TBL=$(docker exec "$CT_DB" pg_restore -l /tmp/selfcheck.dump 2>/dev/null | grep -c 'TABLE DATA' || true)
docker exec "$CT_DB" rm -f /tmp/selfcheck.dump
echo "      可还原的表数据段: $TBL"
if [ "${TBL:-0}" -lt 1 ]; then echo "错误：dump 里没有表数据，中止（不覆盖异地备份）" >&2; exit 1; fi

echo "[3/4] 清理本地超过 ${KEEP_DAYS} 天的备份"
find "$OUT_DIR" -maxdepth 1 -name 'lampstage-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$OUT_DIR" -maxdepth 1 -name 'lampstage-*.sql'  -mtime +"$KEEP_DAYS" -delete
ls -la "$OUT_DIR" | tail -6

if [ "${SKIP_OFFSITE:-0}" = "1" ]; then
  echo "[4/4] SKIP_OFFSITE=1，跳过异地上传"
  exit 0
fi

if [ -z "$CT_WEB" ]; then
  echo "[4/4] web 容器没在跑，跳过异地上传（本地备份已完成）" >&2
  exit 0
fi

echo "[4/4] 上传到对象存储 db-backups/ 前缀"
cat > /tmp/upload-backup.mjs <<'JS'
import { readFileSync } from "node:fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
const [file, key] = process.argv.slice(2);
const body = readFileSync(file);
const c = new S3Client({
  region: process.env.VIDEO_R2_REGION || process.env.R2_REGION,
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: (process.env.VIDEO_R2_FORCE_PATH_STYLE ?? process.env.R2_FORCE_PATH_STYLE) === "true",
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const r = await c.send(new PutObjectCommand({
  Bucket: process.env.VIDEO_R2_BUCKET, Key: key, Body: body,
  ContentType: "application/octet-stream", CacheControl: "private, no-store",
}));
console.log("      uploaded ->", process.env.VIDEO_R2_BUCKET + "/" + key, body.length, "bytes", r.ETag || "");
JS
docker cp /tmp/upload-backup.mjs "$CT_WEB:/app/apps/web/.upload-backup.mjs"
docker cp "$OUT_DIR/lampstage-$TS.dump" "$CT_WEB:/app/apps/web/.upload-backup.dump"
# 必须放在 /app/apps/web 下：ESM 的裸模块名（@aws-sdk/client-s3）从脚本所在目录
# 向上找 node_modules，放 /tmp 会报 ERR_MODULE_NOT_FOUND。
docker exec "$CT_WEB" node /app/apps/web/.upload-backup.mjs /app/apps/web/.upload-backup.dump "db-backups/lampstage-$TS.dump"
docker exec "$CT_WEB" rm -f /app/apps/web/.upload-backup.mjs /app/apps/web/.upload-backup.dump
rm -f /tmp/upload-backup.mjs

echo "完成: lampstage-$TS"
