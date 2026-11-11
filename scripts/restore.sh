#!/usr/bin/env bash
# 栖间 · NestLedger —— 从 backup.sh 生成的压缩包恢复数据
# 用法：./scripts/restore.sh ./backups/nestledger-data-20261109-131000.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法：./scripts/restore.sh <备份文件.tar.gz>" >&2
  echo "可先用 ./scripts/backup.sh 生成备份；恢复前请执行 docker compose down" >&2
  exit 1
fi

echo "⚠ 此操作会用备份覆盖当前 ./data 目录。请先停止容器：docker compose down"
printf '确认继续？输入 yes： '
read -r ans
if [ "$ans" != "yes" ]; then echo "已取消，未修改任何文件。"; exit 0; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$FILE" -C "$TMP"
if [ ! -d "$TMP/data" ]; then
  echo "备份包内没有 data 目录，已中止。" >&2
  exit 1
fi
mkdir -p ./data
cp -a "$TMP/data/." ./data/
echo "恢复完成。现在可以执行：docker compose up -d"
