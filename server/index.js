#!/usr/bin/env node
'use strict';
/* ============================================================
   栖间 · NestLedger  |  零依赖本地服务端
   · 静态托管 web/index.html
   · /api/db        数据读写（权威副本 data/db.json）
   · /api/backups    自动快照 / 手动快照 / 下载
   · /api/version    当前版本号（含自动更新覆盖层）
   · /api/update/*   从 GitHub 拉取更新包、校验、落盘、回滚、重启
   · 原子写入 + 快照轮转 + 可选 HTTP Basic 认证
   只使用 Node 内置模块，无 npm 依赖
   ============================================================ */

const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const WEB_DIR = path.resolve(process.env.WEB_DIR || path.join(__dirname, '..', 'web'));
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const MAX_BODY = Number(process.env.MAX_BODY || 64 * 1024 * 1024);   // 默认 64 MB，容纳 base64 附件
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 30));
const BACKUP_ON_WRITE = process.env.BACKUP_ON_WRITE !== '0';
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';
const APP_VERSION = '1.3.0';
// 容器启动器会写入内置包的真实版本；有覆盖层时它仍指内置版，避免与 APP_VERSION 混淆
const BUILTIN_VERSION = process.env.NESTLEDGER_BUILTIN || APP_VERSION;

/* ---- 自动更新配置 ---- */
const UPDATE_REPO = process.env.UPDATE_REPO || 'lq-wq/nestledger';
const UPDATE_BRANCH = process.env.UPDATE_BRANCH || 'main';
const UPDATE_OFF = process.env.UPDATE_OFF === '1';
const UPDATE_ONLY_CUSTOM = process.env.UPDATE_ONLY_CUSTOM === '1';
const UPDATE_TIMEOUT = Math.max(2000, Number(process.env.UPDATE_TIMEOUT || 8000));
const UPDATE_INTERVAL = Math.max(300, Number(process.env.UPDATE_INTERVAL || 21600)); // 秒，默认 6 小时
const OVERLAY_DIR = path.resolve(process.env.OVERLAY_DIR || path.join(DATA_DIR, 'app'));
const OVERLAY_META = path.join(OVERLAY_DIR, 'version.json');
const UPDATE_CONFIG_FILE = path.join(DATA_DIR, 'update-config.json');
const UPDATE_STATE_FILE = path.join(DATA_DIR, 'update-state.json');
const UPDATE_GUARD_FILE = path.join(DATA_DIR, 'update-guard.json');
const MAX_UPDATE_JSON = 8 * 1024 * 1024;
const MAX_WEB_BYTES = 3 * 1024 * 1024;
const MAX_SERVER_BYTES = 512 * 1024;
const IS_CONTAINER = process.env.NESTLEDGER_CONTAINER === '1';

const updateCfg = {
  auto: process.env.UPDATE_AUTO !== '0',
  autoRestart: process.env.UPDATE_AUTO_RESTART !== '0'
};
const updateState = {
  lastCheck: null, lastError: null, latest: null,
  hasUpdate: false, lastApplied: null, source: ''
};
let updateBusy = false;

function log(msg) {
  console.log('[' + new Date().toISOString() + '] ' + msg);
}
function pad(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  d = d || new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function prettyTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/* ---------------- 文件与快照 ---------------- */
async function ensureDirs() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}
async function exists(file) {
  try { await fsp.access(file); return true; } catch (e) { return false; }
}
/* 先写临时文件再 rename，避免断电/中断留下半个 JSON */
async function atomicWrite(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 7);
  await fsp.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
  try { await fsp.rename(tmp, file); }
  catch (e) {
    await fsp.unlink(tmp).catch(() => {});
    throw e;
  }
}
async function readMeta() {
  try {
    const m = JSON.parse(await fsp.readFile(META_FILE, 'utf8'));
    return { rev: Number(m.rev) || 0, updatedAt: m.updatedAt || null, hasData: await exists(DB_FILE) };
  } catch (e) {
    let updatedAt = null;
    try { updatedAt = (await fsp.stat(DB_FILE)).mtime.toISOString(); } catch (e2) {}
    return { rev: updatedAt ? 1 : 0, updatedAt, hasData: !!updatedAt };
  }
}
async function readDB() {
  if (!await exists(DB_FILE)) return null;
  try { return JSON.parse(await fsp.readFile(DB_FILE, 'utf8')); }
  catch (e) { throw Object.assign(new Error('服务器数据文件损坏：' + e.message), { status: 500 }); }
}
function validDB(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  return ['properties', 'rooms', 'tenants', 'contracts', 'bills', 'txns']
    .every(k => Array.isArray(d[k]));
}
function snapshotName(rev) {
  return 'db-' + stamp() + '-r' + rev + '.json';
}
function safeBackupName(name) {
  return /^db-[A-Za-z0-9._-]+\.json$/.test(name);
}
async function createSnapshot(rev) {
  await ensureDirs();
  if (!await exists(DB_FILE)) return null;
  let name = snapshotName(Number(rev) || 0);
  let i = 2;
  while (await exists(path.join(BACKUP_DIR, name))) {
    name = snapshotName(Number(rev) || 0).replace(/\.json$/, '-' + i + '.json');
    i++;
  }
  await fsp.copyFile(DB_FILE, path.join(BACKUP_DIR, name));
  await pruneBackups();
  return name;
}
async function pruneBackups() {
  const files = (await fsp.readdir(BACKUP_DIR))
    .filter(f => safeBackupName(f)).sort().reverse();
  for (const f of files.slice(BACKUP_KEEP)) {
    await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
  }
}
async function listBackups() {
  await ensureDirs();
  const files = (await fsp.readdir(BACKUP_DIR))
    .filter(f => safeBackupName(f)).sort().reverse();
  const out = [];
  for (const f of files.slice(0, 60)) {
    const st = await fsp.stat(path.join(BACKUP_DIR, f)).catch(() => null);
    if (!st) continue;
    out.push({ name: f, size: st.size, time: prettyTime(st.mtime.toISOString()) });
  }
  return out;
}
async function writeDB(db) {
  await ensureDirs();
  const meta = await readMeta();
  let backup = null;
  if (BACKUP_ON_WRITE && await exists(DB_FILE)) {
    backup = await createSnapshot(meta.rev);
  }
  await atomicWrite(DB_FILE, JSON.stringify(db, null, 2));
  const next = { rev: meta.rev + 1, updatedAt: new Date().toISOString() };
  await atomicWrite(META_FILE, JSON.stringify(next, null, 2));
  log('数据已保存 rev=' + next.rev + ' bytes=' + Buffer.byteLength(JSON.stringify(db)) + (backup ? ' snapshot=' + backup : ''));
  return { rev: next.rev, updatedAt: next.updatedAt, backup };
}

/* ---------------- 版本与自动更新 ----------------
   更新包是仓库里的 update/latest.json：一份 Brotli+base64 的应用包，
   含 web/index.html 与 server/index.js，带整体 sha256 与逐文件 sha256。
   服务端只负责：下载 → 校验 → 写 data/app 覆盖层 → 必要时重启容器。
   业务数据始终在 data/db.json，更新前还会额外生成一次快照。
   ------------------------------------------------ */
function cmpVersion(a, b) {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
function overlayVersion() {
  try {
    const m = JSON.parse(fs.readFileSync(OVERLAY_META, 'utf8'));
    if (m && /^\d+\.\d+\.\d+/.test(String(m.version))) return String(m.version);
  } catch (e) {}
  return null;
}
function activeVersion() { return overlayVersion() || APP_VERSION; }
function effectiveWebDir() {
  try {
    if (fs.existsSync(path.join(OVERLAY_DIR, 'web', 'index.html'))) return path.join(OVERLAY_DIR, 'web');
  } catch (e) {}
  return WEB_DIR;
}
function manifestURLs() {
  const list = [];
  const custom = String(process.env.UPDATE_MANIFEST_URL || '').trim();
  if (custom) list.push(custom);
  if (UPDATE_ONLY_CUSTOM) return list;   // 自定义镜像源专用：不再回退到 GitHub
  if (!UPDATE_OFF) {
    list.push('https://cdn.jsdelivr.net/gh/' + UPDATE_REPO + '@' + UPDATE_BRANCH + '/update/latest.json');
    list.push('https://raw.githubusercontent.com/' + UPDATE_REPO + '/' + UPDATE_BRANCH + '/update/latest.json');
    list.push('https://github.com/' + UPDATE_REPO + '/releases/download/latest/latest.json');
  }
  return list;
}
function fetchURL(url, timeout, redirects) {
  redirects = redirects || 0;
  if (redirects > 3) return Promise.reject(new Error('更新源重定向次数过多'));
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('更新源地址非法')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('仅支持 http/https 更新源'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, {
      headers: { 'User-Agent': 'NestLedger-Updater/1.0', 'Accept': 'application/json, text/plain, */*' },
      timeout: timeout || UPDATE_TIMEOUT
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        try { return resolve(fetchURL(new URL(res.headers.location, u).toString(), timeout, redirects + 1)); }
        catch (e) { return reject(e); }
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      let size = 0, done = false;
      res.on('data', c => {
        if (done) return;
        size += c.length;
        if (size > MAX_UPDATE_JSON) {
          done = true; reject(new Error('更新包超过 ' + (MAX_UPDATE_JSON / 1024 / 1024) + ' MB')); req.destroy(); return;
        }
        chunks.push(c);
      });
      res.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
      res.on('error', e => { if (!done) { done = true; reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('连接更新源超时')));
    req.on('error', e => reject(e));
  });
}
async function fetchManifest() {
  const urls = manifestURLs();
  if (!urls.length) throw new Error('自动更新已关闭');
  let lastErr = null;
  for (const url of urls) {
    try {
      const buf = await fetchURL(url);
      const json = JSON.parse(buf.toString('utf8'));
      if (!json || json.schema !== 1) throw new Error('更新清单格式不支持');
      return { json, source: url };
    } catch (e) { lastErr = e; }
  }
  throw new Error('所有更新源均不可用（' + (lastErr ? lastErr.message : '未知') + '）');
}
/* 严格校验：整体 sha256 → 解压 → 逐文件 sha256 / 体积 / 版本标记 → 服务端语法 */
function verifyManifest(m) {
  if (!/^\d+\.\d+\.\d+/.test(String(m.version || ''))) throw new Error('更新包版本号不合法');
  if (typeof m.payload !== 'string' || !m.payload) throw new Error('更新包缺少 payload');
  if (m.sha256 !== sha256(Buffer.from(m.payload, 'utf8'))) throw new Error('更新包 sha256 校验失败，已拒绝安装');
  let files;
  try { files = JSON.parse(zlib.brotliDecompressSync(Buffer.from(m.payload, 'base64')).toString('utf8')); }
  catch (e) { throw new Error('更新包解压失败'); }
  for (const n of ['web/index.html', 'server/index.js']) {
    const content = files[n];
    if (typeof content !== 'string') throw new Error('更新包缺少 ' + n);
    const b = Buffer.from(content, 'utf8');
    const lim = n === 'web/index.html' ? MAX_WEB_BYTES : MAX_SERVER_BYTES;
    if (b.length > lim) throw new Error(n + ' 体积异常（' + b.length + ' 字节）');
    const d = m.files && m.files[n];
    if (!d || d.sha256 !== sha256(b) || d.bytes !== b.length) throw new Error(n + ' 校验和不匹配');
  }
  if (files['web/index.html'].indexOf('<script>') < 0) throw new Error('前端文件结构异常');
  if (files['web/index.html'].indexOf("var APP_VERSION='" + m.version + "';") < 0) throw new Error('前端版本号与清单不一致');
  if (files['server/index.js'].indexOf("const APP_VERSION = '" + m.version + "';") < 0) throw new Error('服务端版本号与清单不一致');
  return files;
}
function checkServerSyntax(content) {
  const tmp = path.join(DATA_DIR, 'update-server-check-' + process.pid + '.js');
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('新服务端语法检查未通过：' + String(r.stderr || '').slice(0, 200));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}
async function saveUpdateState() {
  await atomicWrite(UPDATE_STATE_FILE, JSON.stringify(updateState, null, 2));
}
function updateStatus() {
  return {
    enabled: !UPDATE_OFF,
    current: activeVersion(), builtin: BUILTIN_VERSION, overlay: overlayVersion(),
    auto: updateCfg.auto, autoRestart: updateCfg.autoRestart,
    repo: UPDATE_REPO, branch: UPDATE_BRANCH, channel: 'stable',
    sources: manifestURLs(), source: updateState.source,
    lastCheck: updateState.lastCheck, lastError: updateState.lastError,
    latest: updateState.latest, hasUpdate: !!updateState.hasUpdate && !UPDATE_OFF,
    lastApplied: updateState.lastApplied,
    container: IS_CONTAINER, interval: UPDATE_INTERVAL
  };
}
async function performCheck() {
  if (UPDATE_OFF) throw new Error('自动更新已在服务端关闭（UPDATE_OFF=1）');
  const { json, source } = await fetchManifest();
  updateState.lastCheck = new Date().toISOString();
  updateState.lastError = null;
  updateState.source = source;
  updateState.latest = { version: String(json.version), notes: String(json.notes || ''), builtAt: json.builtAt || null };
  updateState.hasUpdate = cmpVersion(json.version, activeVersion()) > 0;
  await saveUpdateState();
  return updateStatus();
}
async function scheduleRestart(reason, manual) {
  if (!IS_CONTAINER) return false;                       // 直跑 Node 时不能自己拉起自己
  if (!manual && !updateCfg.autoRestart) return false;
  const now = Date.now();
  let times = [];
  try {
    const g = JSON.parse(await fsp.readFile(UPDATE_GUARD_FILE, 'utf8'));
    times = (g.times || []).filter(t => now - t < 600000);
  } catch (e) {}
  if (times.length >= 2) { log('10 分钟内已重启 2 次，停止自动重启以免循环'); return false; }
  times.push(now);
  await atomicWrite(UPDATE_GUARD_FILE, JSON.stringify({ times }, null, 2));
  setTimeout(() => { log('重启容器：' + reason); process.exit(0); }, 1500).unref();
  return true;
}
async function performApply() {
  if (UPDATE_OFF) throw new Error('自动更新已在服务端关闭（UPDATE_OFF=1）');
  if (updateBusy) throw new Error('已有更新任务正在进行');
  updateBusy = true;
  try {
    const { json, source } = await fetchManifest();
    const now = new Date().toISOString();
    if (cmpVersion(json.version, activeVersion()) <= 0) {
      updateState.lastCheck = now;
      updateState.lastError = null;
      updateState.source = source;
      updateState.latest = { version: String(json.version), notes: String(json.notes || ''), builtAt: json.builtAt || null };
      updateState.hasUpdate = false;
      await saveUpdateState();
      return { ok: true, already: true, version: activeVersion() };
    }
    const files = verifyManifest(json);
    checkServerSyntax(files['server/index.js']);

    // 更新前先留一份数据快照；失败不阻断更新，但会记录日志
    let snapshot = null;
    try { if (await exists(DB_FILE)) snapshot = await createSnapshot((await readMeta()).rev); }
    catch (e) { log('更新前生成快照失败：' + e.message); }

    // 保留上一版覆盖层，便于回退
    try {
      if (await exists(OVERLAY_META)) {
        const prev = path.join(OVERLAY_DIR, 'previous');
        await fsp.mkdir(prev, { recursive: true });
        for (const n of ['web/index.html', 'server/index.js', 'version.json']) {
          const src = path.join(OVERLAY_DIR, n);
          if (await exists(src)) await fsp.copyFile(src, path.join(prev, n.replace(/\//g, '_')));
        }
      }
    } catch (e) { log('备份旧覆盖层失败：' + e.message); }

    await atomicWrite(path.join(OVERLAY_DIR, 'web/index.html'), files['web/index.html']);
    await atomicWrite(path.join(OVERLAY_DIR, 'server/index.js'), files['server/index.js']);
    await atomicWrite(OVERLAY_META, JSON.stringify({
      version: String(json.version), builtAt: json.builtAt || null, source,
      repo: json.repo || UPDATE_REPO, sha256: json.sha256, appliedAt: now
    }, null, 2));

    updateState.lastCheck = now;
    updateState.lastError = null;
    updateState.source = source;
    updateState.latest = { version: String(json.version), notes: String(json.notes || ''), builtAt: json.builtAt || null };
    updateState.hasUpdate = false;
    updateState.lastApplied = { version: String(json.version), at: now, snapshot };
    await saveUpdateState();

    // 服务端文件有变化才需要重启；前端是每次请求实时读盘，立即生效
    let runningServer = '';
    try { runningServer = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8'); } catch (e) {}
    const serverChanged = runningServer !== files['server/index.js'];
    const restarting = serverChanged ? await scheduleRestart('应用 v' + json.version, false) : false;
    log('更新完成 v' + json.version + '（快照 ' + (snapshot || '无') + '，服务端' + (serverChanged ? '需重启' : '无变化') + (restarting ? '，即将重启' : '') + '）');
    return {
      ok: true, version: String(json.version), files: ['web/index.html', 'server/index.js'],
      snapshot, needRestart: serverChanged, restarting
    };
  } finally { updateBusy = false; }
}
async function performRollback() {
  if (!OVERLAY_DIR.startsWith(DATA_DIR + path.sep)) throw new Error('覆盖层路径非法');
  await fsp.rm(OVERLAY_DIR, { recursive: true, force: true });
  updateState.hasUpdate = false;
  updateState.lastApplied = null;
  updateState.lastError = null;
  await saveUpdateState();
  const restarting = await scheduleRestart('恢复内置版本', true);
  log('已恢复内置版本 v' + BUILTIN_VERSION);
  return { ok: true, version: BUILTIN_VERSION, needRestart: true, restarting };
}
async function loadUpdateConfig() {
  try {
    const c = JSON.parse(await fsp.readFile(UPDATE_CONFIG_FILE, 'utf8'));
    if (typeof c.auto === 'boolean') updateCfg.auto = c.auto;
    if (typeof c.autoRestart === 'boolean') updateCfg.autoRestart = c.autoRestart;
  } catch (e) {}
}
async function loadUpdateState() {
  try {
    const s = JSON.parse(await fsp.readFile(UPDATE_STATE_FILE, 'utf8'));
    updateState.lastCheck = s.lastCheck || null;
    updateState.lastError = s.lastError || null;
    updateState.latest = s.latest || null;
    updateState.hasUpdate = !!s.hasUpdate;
    updateState.lastApplied = s.lastApplied || null;
    updateState.source = s.source || '';
  } catch (e) {}
}
function startAutoUpdate() {
  if (UPDATE_OFF) { log('自动更新  已关闭（UPDATE_OFF=1）'); return; }
  log('自动更新  ' + (updateCfg.auto ? '开启' : '仅检查') + ' · 每 ' + UPDATE_INTERVAL + ' 秒 · 更新源 ' + manifestURLs().length + ' 个');
  setTimeout(() => {
    autoUpdateTick();
    setInterval(autoUpdateTick, UPDATE_INTERVAL * 1000).unref();
  }, 30000).unref();
}
async function autoUpdateTick() {
  if (UPDATE_OFF) return;
  try {
    const st = await performCheck();
    if (st.hasUpdate && updateCfg.auto) await performApply();
  } catch (e) {
    updateState.lastError = e.message || String(e);
    updateState.lastCheck = new Date().toISOString();
    await saveUpdateState().catch(() => {});
    log('自动更新检查失败：' + updateState.lastError);
  }
}

/* ---------------- HTTP 辅助 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};
function baseHeaders(extra) {
  return Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  }, extra || {});
}
function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, baseHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length
  }));
  res.end(body);
}
function sendEmpty(res, code) {
  res.writeHead(code, baseHeaders());
  res.end();
}
async function sendFile(res, file, type, downloadName) {
  let data;
  try { data = await fsp.readFile(file); }
  catch (e) { return sendJSON(res, 404, { error: '文件不存在' }); }
  const h = { 'Content-Type': type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': data.length };
  if (downloadName) h['Content-Disposition'] = 'attachment; filename="' + downloadName + '"';
  res.writeHead(200, baseHeaders(h));
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) {
        done = true;
        reject(Object.assign(new Error('请求体超过上限 ' + Math.round(MAX_BODY / 1024 / 1024) + ' MB'), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', e => { if (!done) { done = true; reject(e); } });
  });
}
async function parseBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); }
  catch (e) { throw Object.assign(new Error('请求不是合法 JSON'), { status: 400 }); }
}
function checkAuth(req, res) {
  if (!AUTH_USER || !AUTH_PASS) return true;
  const h = String(req.headers.authorization || '');
  let ok = false;
  if (h.startsWith('Basic ')) {
    let pair = '';
    try { pair = Buffer.from(h.slice(6), 'base64').toString('utf8'); } catch (e) {}
    const i = pair.indexOf(':');
    if (i >= 0) {
      const a = crypto.createHash('sha256').update(pair.slice(0, i)).digest();
      const b = crypto.createHash('sha256').update(AUTH_USER).digest();
      const c = crypto.createHash('sha256').update(pair.slice(i + 1)).digest();
      const d = crypto.createHash('sha256').update(AUTH_PASS).digest();
      ok = crypto.timingSafeEqual(a, b) && crypto.timingSafeEqual(c, d);
    }
  }
  if (!ok) {
    res.writeHead(401, baseHeaders({
      'WWW-Authenticate': 'Basic realm="NestLedger", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8'
    }));
    res.end('需要账号密码才能访问 栖间 · NestLedger');
    return false;
  }
  return true;
}

/* ---------------- 路由 ---------------- */
async function handle(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch (e) { return sendJSON(res, 400, { error: '无效的请求地址' }); }
  const p = decodeURIComponent(url.pathname);
  const method = (req.method || 'GET').toUpperCase();

  // 健康检查不加认证，便于容器 / 反向代理探活（不返回任何业务数据）
  if (p === '/api/health') {
    return sendJSON(res, 200, {
      ok: true, app: 'nestledger', version: activeVersion(),
      hasData: await exists(DB_FILE), ...(await readMeta()),
      auth: !!(AUTH_USER && AUTH_PASS)
    });
  }
  if (!checkAuth(req, res)) return;

  if (p === '/api/version') {
    if (method !== 'GET') return sendJSON(res, 405, { error: '仅支持 GET' });
    return sendJSON(res, 200, {
      app: 'nestledger', name: '栖间 · NestLedger',
      version: activeVersion(), builtin: BUILTIN_VERSION, overlay: overlayVersion(),
      repo: UPDATE_REPO, branch: UPDATE_BRANCH, channel: 'stable',
      container: IS_CONTAINER, updateEnabled: !UPDATE_OFF
    });
  }
  if (p === '/api/meta') {
    if (method !== 'GET') return sendJSON(res, 405, { error: '仅支持 GET' });
    const m = await readMeta();
    return sendJSON(res, 200, { app: 'nestledger', version: activeVersion(), hasData: m.hasData, rev: m.rev, updatedAt: m.updatedAt, backups: (await listBackups()).length });
  }
  if (p === '/api/db') {
    if (method === 'GET') {
      const m = await readMeta();
      const db = m.hasData ? await readDB() : null;
      return sendJSON(res, 200, { hasData: !!db, db, rev: m.rev, updatedAt: m.updatedAt });
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await parseBody(req);
      if (!validDB(body.db)) return sendJSON(res, 400, { error: '数据格式不正确：缺少业务数组字段' });
      const r = await writeDB(body.db);
      return sendJSON(res, 200, { ok: true, rev: r.rev, updatedAt: r.updatedAt, backup: r.backup });
    }
    return sendJSON(res, 405, { error: '仅支持 GET / PUT / POST' });
  }
  if (p === '/api/backups') {
    if (method === 'GET') return sendJSON(res, 200, { backups: await listBackups(), keep: BACKUP_KEEP });
    if (method === 'POST') {
      const m = await readMeta();
      const name = await createSnapshot(m.rev);
      if (!name) return sendJSON(res, 409, { error: '当前还没有数据，无法生成快照' });
      log('手动快照 ' + name);
      return sendJSON(res, 200, { ok: true, name });
    }
    return sendJSON(res, 405, { error: '仅支持 GET / POST' });
  }
  if (p.startsWith('/api/backups/')) {
    if (method !== 'GET') return sendJSON(res, 405, { error: '仅支持 GET' });
    const name = p.slice('/api/backups/'.length);
    if (!safeBackupName(name)) return sendJSON(res, 400, { error: '非法的快照文件名' });
    const file = path.join(BACKUP_DIR, name);
    if (!file.startsWith(BACKUP_DIR + path.sep)) return sendJSON(res, 400, { error: '非法的快照路径' });
    if (!await exists(file)) return sendJSON(res, 404, { error: '快照不存在' });
    return sendFile(res, file, 'application/json; charset=utf-8', name);
  }

  // ---- 自动更新接口（均在 Basic Auth 之后）----
  if (p === '/api/update/status') {
    if (method !== 'GET') return sendJSON(res, 405, { error: '仅支持 GET' });
    return sendJSON(res, 200, updateStatus());
  }
  if (p === '/api/update/check') {
    if (method !== 'GET') return sendJSON(res, 405, { error: '仅支持 GET' });
    try { return sendJSON(res, 200, await performCheck()); }
    catch (e) {
      updateState.lastError = e.message || String(e);
      updateState.lastCheck = new Date().toISOString();
      await saveUpdateState().catch(() => {});
      return sendJSON(res, 200, Object.assign(updateStatus(), {
        error: updateState.lastError, force: url.searchParams.has('force')
      }));
    }
  }
  if (p === '/api/update/apply') {
    if (method !== 'POST') return sendJSON(res, 405, { error: '仅支持 POST' });
    try { return sendJSON(res, 200, await performApply()); }
    catch (e) { log('更新失败：' + e.message); return sendJSON(res, 200, { error: e.message || String(e) }); }
  }
  if (p === '/api/update/config') {
    if (method !== 'POST') return sendJSON(res, 405, { error: '仅支持 POST' });
    const b = await parseBody(req);
    if (typeof b.auto === 'boolean') updateCfg.auto = b.auto;
    if (typeof b.autoRestart === 'boolean') updateCfg.autoRestart = b.autoRestart;
    await atomicWrite(UPDATE_CONFIG_FILE, JSON.stringify(updateCfg, null, 2));
    return sendJSON(res, 200, updateStatus());
  }
  if (p === '/api/update/rollback') {
    if (method !== 'POST') return sendJSON(res, 405, { error: '仅支持 POST' });
    try { return sendJSON(res, 200, await performRollback()); }
    catch (e) { return sendJSON(res, 200, { error: e.message || String(e) }); }
  }
  if (p === '/api/update/restart') {
    if (method !== 'POST') return sendJSON(res, 405, { error: '仅支持 POST' });
    if (!IS_CONTAINER) return sendJSON(res, 200, { error: '当前不是容器运行方式，请在 NAS 上手动重启容器' });
    const restarting = await scheduleRestart('页面手动重启', true);
    return sendJSON(res, 200, { ok: true, restarting });
  }

  if (p.startsWith('/api/')) return sendJSON(res, 404, { error: '接口不存在' });

  // 静态资源（只允许当前生效的网页目录内的文件）
  if (method !== 'GET' && method !== 'HEAD') return sendJSON(res, 405, { error: '仅支持 GET' });
  if (p === '/favicon.ico') return sendEmpty(res, 204);
  const webDir = effectiveWebDir();
  const rel = (p === '/' || p === '/index.html') ? 'index.html' : p.replace(/^\/+/, '');
  const file = path.resolve(webDir, rel);
  if (!file.startsWith(webDir + path.sep) && file !== path.join(webDir, 'index.html')) {
    return sendJSON(res, 403, { error: '禁止访问' });
  }
  if (method === 'HEAD') { res.writeHead(200, baseHeaders({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })); return res.end(); }
  return sendFile(res, file, MIME[path.extname(file).toLowerCase()]);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    const code = e.status || 500;
    if (code === 500) log('请求失败 ' + (req.method || '') + ' ' + req.url + ' → ' + e.message);
    if (!res.headersSent) sendJSON(res, code, { error: e.message || '服务器内部错误' });
    else res.end();
  });
});

async function main() {
  await ensureDirs();
  await loadUpdateConfig();
  await loadUpdateState();
  const meta = await readMeta();
  server.listen(PORT, HOST, () => {
    log('栖间 · NestLedger v' + activeVersion() + ' 已启动' + (overlayVersion() ? '（覆盖层，内置 v' + BUILTIN_VERSION + '）' : ''));
    log('访问地址  http://localhost:' + PORT);
    log('数据目录  ' + DATA_DIR);
    log('网页目录  ' + effectiveWebDir());
    log('已有数据  ' + (meta.hasData ? '是（rev ' + meta.rev + '）' : '否，等待首次同步'));
    log('自动快照  ' + (BACKUP_ON_WRITE ? '开启（保留最近 ' + BACKUP_KEEP + ' 份）' : '关闭'));
    log('访问认证  ' + (AUTH_USER && AUTH_PASS ? '已开启 Basic Auth' : '未开启（建议仅局域网使用）'));
    startAutoUpdate();
  });
}
function shutdown(sig) {
  log('收到 ' + sig + '，正在退出…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', e => log('未捕获异常：' + e.stack));

main().catch(e => { console.error('启动失败：', e); process.exit(1); });
