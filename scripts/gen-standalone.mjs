/* 栖间 · NestLedger —— 生成「零文件依赖」的自包含 Compose（默认主文件）
 *
 * 用途：飞牛 NAS 图形界面只让「粘贴 YAML」、项目目录里没有任何源码文件时使用。
 *       把 server/index.js 与 web/index.html 压成一行 Brotli+base64，
 *       容器启动后由 Node 自己解包到 /app，因此不需要 build、Dockerfile 或本地文件。
 *
 * 运行：node scripts/gen-standalone.mjs
 * 产物：docker-compose.yml（默认主文件，docker compose up -d 直接用）
 *       docker-compose.standalone.yml（完全相同的兼容副本，供旧文档 / 旧链接使用）
 *
 * ⚠️ 每次修改 web/index.html 或 server/index.js 后，必须重跑本脚本，
 *    否则线上容器用的还是旧代码。scripts/check.mjs 会做一致性校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  'server/index.js': fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'),
  'web/index.html': fs.readFileSync(path.join(root, 'web/index.html'), 'utf8')
};

const bundle = zlib.brotliCompressSync(Buffer.from(JSON.stringify(files), 'utf8'), {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
}).toString('base64');

// 容器启动器：只用 Node 内置模块，不依赖 tar / base64 / gzip 等外部命令。
// APP_DIR 仅供本地验证时覆写，compose 里不设置，容器内恒为 /app。
const BOOT = `const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const APP_DIR = process.env.APP_DIR || '/app';
const files = JSON.parse(zlib.brotliDecompressSync(
  Buffer.from(process.env.APP_BUNDLE, 'base64')
).toString('utf8'));
for (const [name, content] of Object.entries(files)) {
  const dest = path.join(APP_DIR, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
}
console.log('[nestledger] 内联应用包已展开到 ' + APP_DIR);
require(path.join(APP_DIR, 'server/index.js'));`;

const indent = (text, n) => text.split('\n').map(l => ' '.repeat(n) + l).join('\n');

// 注释里不写具体文件名：同一份内容会同时作为主文件与兼容副本交付。
const yaml = `# 栖间 · NestLedger —— 自包含版（默认主文件 · 飞牛 NAS 粘贴即用 · 零文件依赖）
#
# ✅ 把本文件【全部内容】复制进 飞牛 Docker → Compose → 新增项目 → 粘贴 YAML，
#    直接启动；有完整项目目录时也可直接 docker compose up -d。
#    不需要 Dockerfile、server/、web/，也不需要 GitHub / GHCR。
#    本文件刻意不含 build 段，所以绝不会出现
#    「failed to read dockerfile: open Dockerfile: no such file or directory」。
#
# 原理：应用代码被压成下面 APP_BUNDLE 一行（Brotli + base64），
#       容器启动后由 node:22-alpine 里的 Node 自行解包到 /app 再运行。
#       业务数据仍在 Compose 项目目录的 ./data，重启 / 换版本都不丢。
#
# ⚠️ 唯一外部依赖是 node:22-alpine 基础镜像。若 NAS 拉不到 Docker Hub：
#    在「飞牛 Docker → 设置 → 镜像加速」配置加速器，或把下面 image 一行
#    改成你 NAS 能拉到的 node:22-alpine 完整地址（例如加速地址/library/node:22-alpine）。
#
# ⚠️ 端口 / 口令 / 备份份数直接改下面的 ports 与 environment，本文件不读 .env。
#
# ⚠️ 更新应用：改完 web/index.html 或 server/index.js 后，在本机执行
#    node scripts/gen-standalone.mjs
#    重新生成整个 YAML，再把新内容整体替换进飞牛 Compose 项目并重启。
#    scripts/check.mjs 会检查内联包与源码是否一致。
#
# 想长期更省心（git pull / 换镜像即更新），可改用 docker-compose.build.yml
# （源码构建，需完整项目目录）或 docker-compose.image.yml（GHCR 纯镜像）。
# 详见 docs/飞牛NAS部署.md。
services:
  nestledger:
    image: node:22-alpine
    container_name: nestledger
    restart: unless-stopped
    stop_grace_period: 10s
    working_dir: /app
    ports:
      - "8787:8787"
    environment:
      TZ: Asia/Shanghai
      PORT: 8787
      DATA_DIR: /data
      WEB_DIR: /app/web
      BACKUP_KEEP: 30
      BACKUP_ON_WRITE: 1
      MAX_BODY: 67108864
      # 需要口令时，在下面加两行（两个都要填）：
      # AUTH_USER: admin
      # AUTH_PASS: change-me
      APP_BUNDLE: "${bundle}"
    command:
      - node
      - -e
      - |
${indent(BOOT, 8)}
    volumes:
      - ./data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:8787/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "3"
`;

const roundtrip = JSON.parse(zlib.brotliDecompressSync(Buffer.from(bundle, 'base64')).toString('utf8'));
if (roundtrip['server/index.js'] !== files['server/index.js'] ||
    roundtrip['web/index.html'] !== files['web/index.html']) {
  throw new Error('内联包回读校验失败');
}

const targets = ['docker-compose.yml', 'docker-compose.standalone.yml'];
for (const name of targets) {
  fs.writeFileSync(path.join(root, name), yaml, 'utf8');
}
console.log('已生成（两份内容完全相同）：');
for (const name of targets) console.log('  ' + name);
console.log('  内联文件 : ' + Object.keys(files).join(', '));
console.log('  APP_BUNDLE: ' + bundle.length + ' 字符 (' + (bundle.length / 1024).toFixed(1) + ' KB)');
console.log('  YAML 大小: ' + (Buffer.byteLength(yaml) / 1024).toFixed(1) + ' KB');
console.log('  回读校验 : 通过（与源文件逐字一致）');
