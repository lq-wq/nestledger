#!/usr/bin/env node
'use strict';
/* ============================================================
   栖间 · NestLedger  |  零依赖本地服务端
   · 静态托管 web/index.html
   · /api/db        数据读写（权威副本 data/db.json）
   · /api/backups    自动快照 / 手动快照 / 下载
   · 原子写入 + 快照轮转 + 可选 HTTP Basic 认证
   只使用 Node 内置模块，无 npm 依赖，无外部网络访问
   ============================================================ */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

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
const APP_VERSION = '1.0.0';

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

/* ---------------- 文件与快照 ---------------- */
async function ensureDirs() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}
async function exists(file) {
  try { await fsp.access(file); return true; } catch (e) { return false; }
}
/* 先写临时文件再 rename，避免断电/中断留下半个 JSON */
async function atomicWrite(file, content) {
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
      ok: true, app: 'nestledger', version: APP_VERSION,
      hasData: await exists(DB_FILE), ...(await readMeta()),
      auth: !!(AUTH_USER && AUTH_PASS)
    });
  }
  if (!checkAuth(req, res)) return;

  if (p === '/api/meta') {
    if (method !== 'GET') return sendJSON(res, 405, { error: '仅支持 GET' });
    const m = await readMeta();
    return sendJSON(res, 200, { app: 'nestledger', version: APP_VERSION, hasData: m.hasData, rev: m.rev, updatedAt: m.updatedAt, backups: (await listBackups()).length });
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
  if (p.startsWith('/api/')) return sendJSON(res, 404, { error: '接口不存在' });

  // 静态资源（只允许 WEB_DIR 内的文件）
  if (method !== 'GET' && method !== 'HEAD') return sendJSON(res, 405, { error: '仅支持 GET' });
  if (p === '/favicon.ico') return sendEmpty(res, 204);
  const rel = (p === '/' || p === '/index.html') ? 'index.html' : p.replace(/^\/+/, '');
  const file = path.resolve(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR + path.sep) && file !== path.join(WEB_DIR, 'index.html')) {
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
  const meta = await readMeta();
  server.listen(PORT, HOST, () => {
    log('栖间 · NestLedger v' + APP_VERSION + ' 已启动');
    log('访问地址  http://localhost:' + PORT);
    log('数据目录  ' + DATA_DIR);
    log('网页目录  ' + WEB_DIR);
    log('已有数据  ' + (meta.hasData ? '是（rev ' + meta.rev + '）' : '否，等待首次同步'));
    log('自动快照  ' + (BACKUP_ON_WRITE ? '开启（保留最近 ' + BACKUP_KEEP + ' 份）' : '关闭'));
    log('访问认证  ' + (AUTH_USER && AUTH_PASS ? '已开启 Basic Auth' : '未开启（建议仅局域网使用）'));
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
