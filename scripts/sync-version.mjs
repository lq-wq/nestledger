/* 栖间 · NestLedger —— 版本号单一真源与更新包生成器
 *
 * 唯一真源：仓库根目录的 VERSION 文件（一行 semver，如 1.3.0）。
 *
 * 用法：
 *   node scripts/sync-version.mjs            # 按 VERSION 同步所有位置并重建 update/latest.json
 *   node scripts/sync-version.mjs 1.3.1      # 顺便把版本号改成 1.3.1
 *
 * 会做四件事：
 *   1) 把版本号写入 server/index.js 的 APP_VERSION 与 server/package.json
 *   2) 把版本号写入 web/index.html 与仓库外根目录的单文件版（若存在）
 *   3) 从 CHANGELOG.md 摘出该版本的更新说明
 *   4) 把 web/index.html + server/index.js 压成 Brotli+base64，生成 update/latest.json
 *      —— 这是 NAS 服务端自动更新时下载的唯一文件，含 sha256 校验。
 *
 * ⚠️ 发版顺序：改完代码与 CHANGELOG 后，先跑本脚本，再跑
 *    node scripts/gen-standalone.mjs 重建自包含 Compose。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = path.join(root, 'VERSION');
const LOCAL_HTML = path.resolve(root, '..', '房屋租赁管理系统.html');
const REPO = 'lq-wq/nestledger';
const BRANCH = 'main';

let version = (process.argv[2] || '').trim();
if (version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('版本号必须是 semver，例如 1.3.1（收到：' + version + '）');
  }
  fs.writeFileSync(VERSION_FILE, version + '\n', 'utf8');
} else {
  version = fs.readFileSync(VERSION_FILE, 'utf8').trim();
}
if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('VERSION 文件内容不合法：' + version);

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function replaceOnce(file, from, to, label) {
  const s = fs.readFileSync(file, 'utf8');
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(label + '：预期命中 1 处，实际 ' + n + ' 处（' + file + '）');
  fs.writeFileSync(file, s.replace(from, to), 'utf8');
  console.log('  ✓ ' + label);
}

console.log('同步版本号 v' + version + '\n');

/* ---- 1. 服务端 ---- */
const server = path.join(root, 'server/index.js');
let serverSrc = fs.readFileSync(server, 'utf8');
const srvRe = /^const APP_VERSION = '[^']*';/m;
if (!srvRe.test(serverSrc)) throw new Error('server/index.js 缺少 const APP_VERSION');
serverSrc = serverSrc.replace(srvRe, "const APP_VERSION = '" + version + "';");
fs.writeFileSync(server, serverSrc, 'utf8');
console.log('  ✓ server/index.js APP_VERSION');

const pkgFile = path.join(root, 'server/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('  ✓ server/package.json version');

/* ---- 2. 两份 HTML ---- */
function injectHtmlVersion(file, label) {
  let s = fs.readFileSync(file, 'utf8');
  const re = /^var APP_VERSION='[^']*';/m;
  if (re.test(s)) {
    s = s.replace(re, "var APP_VERSION='" + version + "';");
  } else {
    // 首次注入：紧跟 STORE_KEY 之后（两份 HTML 都有这一行）
    const anchor = "var STORE_KEY = 'rental_manager_db_v1';";
    if (s.indexOf(anchor) < 0) throw new Error(label + '：找不到版本注入锚点');
    s = s.replace(anchor, anchor + "\nvar APP_VERSION='" + version + "';  /* 由 scripts/sync-version.mjs 维护 */");
  }
  fs.writeFileSync(file, s, 'utf8');
  console.log('  ✓ ' + label);
}
injectHtmlVersion(path.join(root, 'web/index.html'), 'web/index.html APP_VERSION');
if (fs.existsSync(LOCAL_HTML)) {
  injectHtmlVersion(LOCAL_HTML, '根目录单文件版 APP_VERSION');
} else {
  console.log('  · 根目录单文件版不存在，跳过（ZIP 解压后的仓库属正常情况）');
}

/* ---- 3. 更新说明 ---- */
let notes = '栖间 · NestLedger v' + version;
try {
  const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const sec = log.split(/^## /m).find(x => new RegExp('^v' + version.replace(/\./g, '\\.') + '(?:\\s|$)').test(x));
  if (sec) {
    const body = sec.slice(sec.indexOf('\n') + 1);
    const para = body.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)[0] || '';
    const plain = para.replace(/\*\*/g, '').replace(/[`*_>#]/g, '').replace(/\s+/g, ' ').trim();
    if (plain) notes = plain.slice(0, 240);
  }
} catch (e) { /* 没有 CHANGELOG 时用默认说明 */ }

/* ---- 4. 更新包 update/latest.json ---- */
const files = {
  'web/index.html': fs.readFileSync(path.join(root, 'web/index.html')),
  'server/index.js': fs.readFileSync(path.join(root, 'server/index.js'))
};
const payload = zlib.brotliCompressSync(Buffer.from(JSON.stringify(
  Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString('utf8')]))
), 'utf8'), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).toString('base64');

const manifest = {
  schema: 1,
  version,
  repo: REPO,
  branch: BRANCH,
  channel: 'stable',
  builtAt: new Date().toISOString(),
  notes,
  files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { bytes: v.length, sha256: sha256(v) }])),
  sha256: sha256(Buffer.from(payload, 'utf8')),
  payload
};

const outDir = path.join(root, 'update');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'latest.json');
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// 回读校验：解压后必须与磁盘源码逐字一致
const back = JSON.parse(fs.readFileSync(outFile, 'utf8'));
const unpacked = JSON.parse(zlib.brotliDecompressSync(Buffer.from(back.payload, 'base64')).toString('utf8'));
if (sha256(Buffer.from(back.payload, 'utf8')) !== back.sha256) throw new Error('更新包 payload 校验失败');
for (const [k, v] of Object.entries(files)) {
  if (unpacked[k] !== v.toString('utf8') || back.files[k].sha256 !== sha256(v)) {
    throw new Error('更新包回读不一致：' + k);
  }
}

console.log('  ✓ update/latest.json（' + (Buffer.byteLength(fs.readFileSync(outFile, 'utf8')) / 1024).toFixed(1) + ' KB）');
console.log('\n更新说明：' + notes);
console.log('下一步：node scripts/gen-standalone.mjs\n');
