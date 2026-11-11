#!/usr/bin/env bash
# 栖间 · NestLedger —— 一键备份 NAS 上的 data 目录
# 用法：./scripts/backup.sh            （默认备份 ./data 到 ./backups）
#       DATA_DIR=/vol1/docker/nestledger/data ./scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_DIR="${DATA_DIR:-./data}"
OUT_DIR="${OUT_DIR:-./backups}"
KEEP="${KEEP:-30}"

if [ ! -d "$DATA_DIR" ]; then
  echo "找不到数据目录：$DATA_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
NAME="nestledger-data-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$OUT_DIR/$NAME" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
echo "备份完成：$OUT_DIR/$NAME  ($(du -h "$OUT_DIR/$NAME" | cut -f1))"

# 只保留最近 KEEP 份，避免备份本身撑满磁盘
ls -1t "$OUT_DIR"/nestledger-data-*.tar.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
done
echo "已保留最近 ${KEEP} 份备份。"
