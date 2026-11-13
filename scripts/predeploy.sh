#!/usr/bin/env bash
# 栖间 · NestLedger —— NAS 部署前置自检
#
# 用法：
#   bash scripts/predeploy.sh                                   （检查当前目录的默认主 compose）
#   bash scripts/predeploy.sh /vol1/docker/nestledger           （指定项目目录）
#   bash scripts/predeploy.sh /vol1/docker/nestledger docker-compose.build.yml
#
# 它专门排查「failed to read dockerfile: open Dockerfile: no such file or directory」。
# 当前默认主文件 docker-compose.yml 已是自包含版（不含 build），不会再触发该错误；
# 只有显式使用 docker-compose.build.yml 时才需要检查完整源码目录。
set -uo pipefail

TARGET="${1:-.}"
COMPOSE_FILE="${2:-docker-compose.yml}"
if [ ! -d "$TARGET" ]; then
  echo "✗ 目录不存在：$TARGET" >&2
  exit 1
fi
cd "$TARGET" || exit 1
HERE="$(pwd)"

echo "栖间 · NestLedger —— 部署前置自检"
echo "检查目录：$HERE"
echo "Compose 文件：$COMPOSE_FILE"
echo ""

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "✗ 找不到 $COMPOSE_FILE" >&2
  echo "  如果只上传了这一个文件，请用 git clone 或上传完整项目目录。" >&2
  exit 1
fi

# ---- 1. 判定 compose 模式 ----
if grep -qE '^[[:space:]]*build:' "$COMPOSE_FILE"; then
  MODE=build
elif grep -q 'APP_BUNDLE:' "$COMPOSE_FILE"; then
  MODE=standalone
elif grep -q 'image: ghcr.io' "$COMPOSE_FILE"; then
  MODE=image
else
  MODE=unknown
fi

echo "── 模式判定 ──"
case "$MODE" in
  standalone) echo "  ✓ 自包含版（不含 build，零文件依赖）" ;;
  image)      echo "  ✓ 纯镜像版（不含 build，依赖 GHCR 镜像）" ;;
  build)      echo "  ! 源码构建版（含 build，需要完整项目目录）" ;;
  *)          echo "  ? 无法识别模式，按构建版规则检查" ; MODE=build ;;
esac
echo ""

# ---- 2. 可选文件提示 ----
if [ -f .env ]; then
  echo "  ✓ .env 已存在（仅源码构建版读取；自包含版参数直接写在 YAML 里）"
else
  echo "  · 未找到 .env（可选）：源码构建版需要改端口/口令时执行 cp .env.example .env"
fi
if [ -d data ]; then
  echo "  ✓ data/ 已存在（内含业务数据，升级时不要删除）"
else
  echo "  · data/ 尚未创建，首次启动会自动生成"
fi
echo ""

# ---- 3. 自包含版 / 纯镜像版：无需任何源码文件 ----
if [ "$MODE" = standalone ] || [ "$MODE" = image ]; then
  if [ "$MODE" = standalone ]; then
    BUNDLE_LEN=$(grep -o 'APP_BUNDLE: "[A-Za-z0-9+/=]*"' "$COMPOSE_FILE" | head -1 | wc -c)
    if [ "$BUNDLE_LEN" -lt 50000 ]; then
      echo "════════════════════════════════════════════════════════"
      echo "✗ APP_BUNDLE 这一行看起来不完整（$BUNDLE_LEN 字符，预期 > 50000）"
      echo "════════════════════════════════════════════════════════"
      echo "多半是复制粘贴时被截断了。请从 docker-compose.yml 全选复制整份内容"
      echo "（约 76 KB），重新粘贴进飞牛 Compose 项目。"
      echo ""
      exit 1
    fi
    echo "  ✓ APP_BUNDLE 完整（$BUNDLE_LEN 字符）"
  else
    if grep -q 'ghcr.io/yourname/' "$COMPOSE_FILE"; then
      echo "  ! image 里还是占位符 yourname，请换成你的 GitHub 用户名，"
      echo "    并确认 GitHub Actions 已构建并推送镜像。"
    else
      echo "  ✓ image 地址已填写（默认 ghcr.io/lq-wq/nestledger:latest）"
    fi
  fi

  if grep -qE '^[[:space:]]*build:' "$COMPOSE_FILE"; then
    echo "  ✗ 文件里出现 build 段，这会导致 failed to read dockerfile" >&2
    exit 1
  fi
  echo "  ✓ 确认无 build 段 —— 不会出现找不到 Dockerfile 的报错"
  echo ""

  # Docker 可用性
  if command -v docker >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
      echo "  ✓ docker compose 可用"
    else
      echo "  ! docker 存在但 compose 插件不可用"
    fi
  else
    echo "  · 当前环境没有 docker 命令（本机静态检查时属正常）"
  fi

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "✓ 可以启动（不需要 Dockerfile / server / web，也不要加 --build）："
  echo "════════════════════════════════════════════════════════"
  if [ "$COMPOSE_FILE" = "docker-compose.yml" ]; then
    echo "  cd \"$HERE\" && docker compose up -d"
    echo "  docker compose ps"
  else
    echo "  cd \"$HERE\" && docker compose -f \"$COMPOSE_FILE\" up -d"
    echo "  docker compose -f \"$COMPOSE_FILE\" ps"
  fi
  echo ""
  echo "首次启动需拉取 node:22-alpine；若卡在 registry-1.docker.io 超时，"
  echo "先在「飞牛 Docker → 设置 → 镜像加速」配置加速器。"
  echo "端口 / 口令 / 备份份数直接改 $COMPOSE_FILE 里的 ports 与 environment。"
  echo ""
  exit 0
fi

# ---- 4. 源码构建版：必需文件 ----
echo "── 必需文件（build 模式）──"
NEED=("Dockerfile" "server/index.js" "server/package.json" "web/index.html")
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

if [ "$MISSING" -gt 0 ]; then
  echo "════════════════════════════════════════════════════════"
  echo "✗ 目录不完整，现在执行 docker compose up -d --build 一定会失败"
  echo "════════════════════════════════════════════════════════"

  # 4a. ZIP 解压多套一层：完整项目藏在某个子目录里
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
    echo "       cd \"$HERE/$FOUND\" && bash scripts/predeploy.sh . $COMPOSE_FILE"
    echo "       docker compose -f $COMPOSE_FILE up -d --build"
    echo "  B. 把子目录内容整体上移一层："
    echo "       shopt -s dotglob && mv \"$FOUND\"/* . && rmdir \"$FOUND\""
    echo "       bash scripts/predeploy.sh . $COMPOSE_FILE"
    echo "  C. 【最快】改用默认主文件 docker-compose.yml（自包含版，不含 build），"
    echo "     或把 docker-compose.standalone.yml 全部内容粘贴进飞牛 Compose。"
  else
    echo ""
    echo "诊断：当前目录里没有完整源码。常见原因："
    echo "  1) 只上传了 compose 文件一个文件"
    echo "  2) 在飞牛图形界面用「粘贴 YAML / 导入 Compose 文件」新建项目，"
    echo "     GUI 只保存了这段 YAML，并不会把 Dockerfile、server/、web/ 一起放进来"
    echo ""
    echo "修复（三选一）："
    echo "  A. 【最快，推荐】把默认主文件 docker-compose.yml 的全部内容粘贴进"
    echo "     飞牛 Compose。v1.2.0 起主文件已是自包含版、不含 build，零文件即可运行。"
    echo "     兼容副本 docker-compose.standalone.yml 内容完全相同。"
    echo "  B. 把整个项目文件夹（ZIP 解压后的 nestledger/ 里面的内容）上传到本目录，"
    echo "     或重新用 git clone 拉完整仓库，再重跑本脚本。"
    echo "  C. 已推 GitHub 且 GHCR 镜像可用：粘贴 docker-compose.image.yml"
    echo "     （已指向 ghcr.io/lq-wq/nestledger:latest；fork 到其他账号时替换 lq-wq）。"
    echo "  D. 想让 Actions 推完镜像后自动更新容器：用 docker-compose.autoupdate.yml"
    echo "     （含 Watchtower，需要 NAS 允许挂载 docker.sock）。"
  fi
  echo ""
  exit 1
fi

# ---- 5. Compose 一致性 ----
if grep -q '^[[:space:]]*image:' "$COMPOSE_FILE"; then
  echo "  ! 注意：$COMPOSE_FILE 里出现 image: 字段，可能导致 Compose 先去"
  echo "     Docker Hub 拉取并报 registry-1.docker.io 超时。"
fi
if ! grep -q 'context: \.' "$COMPOSE_FILE"; then
  echo "  ! 注意：$COMPOSE_FILE 未声明 build.context: ."
fi

# ---- 6. Docker 可用性 ----
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
echo "  docker compose -f $COMPOSE_FILE up -d --build"
echo "  docker compose -f $COMPOSE_FILE ps"
echo ""
echo "首次构建需要从镜像源拉取 node:22-alpine；若卡在 registry-1.docker.io"
echo "超时，先在「飞牛 Docker → 设置 → 镜像加速」配置加速器，"
echo "或在 .env 里设置 BASE_IMAGE 为 NAS 能拉到的地址。"
echo ""
exit 0
