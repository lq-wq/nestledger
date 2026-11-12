#!/usr/bin/env bash
# 栖间 · NestLedger —— NAS 部署前置自检
# 用法： bash scripts/predeploy.sh            （在项目根目录运行）
#        bash scripts/predeploy.sh /vol1/docker/nestledger   （指定路径）
#
# 它专门排查「failed to read dockerfile: open Dockerfile: no such file or directory」
# 这类错误：Compose 的 build.context: . 指向的目录里必须有完整源码。
set -uo pipefail

TARGET="${1:-.}"
if [ ! -d "$TARGET" ]; then
  echo "✗ 目录不存在：$TARGET" >&2
  exit 1
fi
cd "$TARGET" || exit 1
HERE="$(pwd)"

echo "栖间 · NestLedger —— 部署前置自检"
echo "检查目录：$HERE"
echo ""

# ---- 1. 必需文件 ----
NEED=("docker-compose.yml" "Dockerfile" "server/index.js" "server/package.json" "web/index.html")
MISSING=0
for f in "${NEED[@]}"; do
  if [ -f "$f" ]; then
    printf '  ✓ %s\n' "$f"
  else
    printf '  ✗ %-28s ← 缺失\n' "$f"
    MISSING=$((MISSING + 1))
  fi
done
echo ""

# ---- 2. 可选但建议存在的文件 ----
if [ -f .env ]; then
  echo "  ✓ .env 已存在"
else
  echo "  · 未找到 .env（可选）：所有配置都有默认值，需要改端口/口令时执行 cp .env.example .env"
fi
if [ -d data ]; then
  echo "  ✓ data/ 已存在（内含业务数据，升级时不要删除）"
else
  echo "  · data/ 尚未创建，首次启动会自动生成"
fi
echo ""

# ---- 3. 失败时给出精确诊断 ----
if [ "$MISSING" -gt 0 ]; then
  echo "════════════════════════════════════════════════════════"
  echo "✗ 目录不完整，现在执行 docker compose up -d --build 一定会失败"
  echo "════════════════════════════════════════════════════════"

  # 3a. ZIP 解压多套一层：完整项目藏在某个子目录里
  FOUND=""
  for d in */; do
    if [ -f "${d}Dockerfile" ] && [ -f "${d}server/index.js" ] && [ -f "${d}web/index.html" ]; then
      FOUND="${d%/}"
      break
    fi
  done
  if [ -n "$FOUND" ]; then
    echo ""
    echo "诊断：完整项目在子目录 $FOUND/ 里 —— ZIP 解压时多套了一层目录。"
    echo "      Compose 的 build.context: . 指向当前目录，所以找不到 Dockerfile。"
    echo ""
    echo "修复（三选一）："
    echo "  A. 进到真正的目录里再启动："
    echo "       cd \"$HERE/$FOUND\" && bash scripts/predeploy.sh && docker compose up -d --build"
    echo "  B. 把子目录内容整体上移一层："
    echo "       shopt -s dotglob && mv \"$FOUND\"/* . && rmdir \"$FOUND\""
    echo "       bash scripts/predeploy.sh && docker compose up -d --build"
    echo "  C. 不想动目录：把 docker-compose.standalone.yml 全部内容粘贴进飞牛"
    echo "     Compose，它不含 build 段，零本地文件即可运行。"
  else
    echo ""
    echo "诊断：当前目录里没有完整源码。常见原因："
    echo "  1) 只上传了 docker-compose.yml / compose.yaml 一个文件"
    echo "  2) 在飞牛图形界面用「粘贴 YAML / 导入 Compose 文件」新建项目，"
    echo "     GUI 只保存了这段 YAML，并不会把 Dockerfile、server/、web/ 一起放进来"
    echo ""
    echo "修复（三选一）："
    echo "  A. 把整个项目文件夹（ZIP 解压后的 nestledger/ 里面的内容）"
    echo "     上传到本目录，或重新用 git clone 拉完整仓库，再重跑本脚本。"
    echo "  B. 【最快，不需要 GitHub】把 docker-compose.standalone.yml 的全部"
    echo "     内容粘贴进飞牛 Compose。它不含 build 段，零本地文件即可运行。"
    echo "  C. 已推 GitHub 且 GHCR 镜像可用：粘贴 docker-compose.image.yml，"
    echo "     并把 yourname 换成你的 GitHub 用户名。"
  fi
  echo ""
  exit 1
fi

# ---- 4. Compose 文件一致性 ----
if grep -q '^[[:space:]]*image:' docker-compose.yml; then
  echo "  ! 注意：docker-compose.yml 里出现 image: 字段，可能导致 Compose 先去"
  echo "     Docker Hub 拉取并报 registry-1.docker.io 超时。当前项目版本不应有此行。"
fi
if ! grep -q 'context: \.' docker-compose.yml; then
  echo "  ! 注意：docker-compose.yml 未声明 build.context: ."
fi

# ---- 5. Docker 可用性 ----
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    echo "  ✓ docker compose 可用"
  else
    echo "  ! docker 存在但 compose 插件不可用，请确认已安装 docker-compose-plugin"
  fi
else
  echo "  · 当前环境没有 docker 命令（在 Windows / 本机上做静态检查时属正常）"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "✓ 目录结构完整，可以启动："
echo "════════════════════════════════════════════════════════"
echo "  cd \"$HERE\""
echo "  docker compose up -d --build"
echo "  docker compose ps"
echo ""
echo "首次构建需要从镜像源拉取 node:22-alpine；若卡在 registry-1.docker.io"
echo "超时，先在「飞牛 Docker → 设置 → 镜像加速」配置加速器，"
echo "或在 .env 里设置 BASE_IMAGE 为 NAS 能拉到的地址。"
echo ""
exit 0
