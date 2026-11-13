/* 栖间 · NestLedger —— 自动更新链路回归测试（完全离线，不访问 GitHub）
 *
 * 用一个本地 HTTP 服务冒充 GitHub 的 update/latest.json，再启动真实的
 * server/index.js（UPDATE_MANIFEST_URL 指向它），把「检查 → 校验 → 快照 →
 * 写覆盖层 → 前端生效 → 回滚」整条链路和多种坏包都跑一遍。
 *
 * 运行：node scripts/test-update.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nestledger-upd-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
let pass = 0;
function ok(name, cond) {
  if (!cond) throw new Error('失败：' + name);
  pass++;
  console.log('  ✓ ' + name);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const BASE_VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
const NEW_VERSION = (() => {
  const [a, b, c] = BASE_VERSION.split('.').map(Number);
  return a + '.' + b + '.' + (c + 1);
})();
const OLD_VERSION = (() => {
  const [a, b, c] = BASE_VERSION.split('.').map(Number);
  return a + '.' + b + '.' + Math.max(0, c - 1);
})();

const webBase = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
const srvBase = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');

/* 构造更新清单：version 与两个文件内容里的版本标记同步替换 */
function buildManifest(version, mode) {
  const files = {
    'web/index.html': webBase.replace("var APP_VERSION='" + BASE_VERSION + "';", "var APP_VERSION='" + version + "';"),
    'server/index.js': srvBase.replace("const APP_VERSION = '" + BASE_VERSION + "';", "const APP_VERSION = '" + version + "';")
  };
  if (mode === 'badSyntax') files['server/index.js'] = files['server/index.js'].replace("'use strict';", "'use strict';\nfunction ((( ");
  if (mode === 'badVersionTag') files['web/index.html'] = files['web/index.html'].replace("var APP_VERSION='" + version + "';", "var APP_VERSION='9.9.9';");
  if (mode === 'missingScript') files['web/index.html'] = files['web/index.html'].replace('<script>', '<noscript>');

  const payload = zlib.brotliCompressSync(Buffer.from(JSON.stringify(files), 'utf8'),
    { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).toString('base64');
  const m = {
    schema: 1, version, repo: 'lq-wq/nestledger', branch: 'main', channel: 'stable',
    builtAt: '2026-11-13T00:00:00.000Z', notes: '自动更新回归测试包 v' + version,
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => {
      const b = Buffer.from(v, 'utf8');
      return [k, { bytes: b.length, sha256: sha(b) }];
    })),
    sha256: sha(Buffer.from(payload, 'utf8')), payload
  };
  if (mode === 'badSha') m.sha256 = '0'.repeat(64);
  if (mode === 'badFileSha') m.files['web/index.html'].sha256 = '0'.repeat(64);
  if (mode === 'badBytes') m.files['server/index.js'].bytes += 7;
  if (mode === 'badSchema') m.schema = 99;
  return m;
}

let fakeMode = 'good';
let fakeDrop = false;
const fakePort = await freePort();
const fake = http.createServer((req, res) => {
  if (fakeDrop) { req.socket.destroy(); return; }
  const m = buildManifest(fakeMode === 'oldver' ? OLD_VERSION : NEW_VERSION, fakeMode);
  const body = Buffer.from(JSON.stringify(m), 'utf8');
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': body.length });
  res.end(body);
});
await new Promise(r => fake.listen(fakePort, '127.0.0.1', r));
console.log('本地假更新源 http://127.0.0.1:' + fakePort + '\n');

const appPort = await freePort();
const dataDir = path.join(TMP, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const env = {
  ...process.env,
  PORT: String(appPort), HOST: '127.0.0.1',
  DATA_DIR: dataDir, WEB_DIR: path.join(ROOT, 'web'),
  UPDATE_MANIFEST_URL: 'http://127.0.0.1:' + fakePort + '/update/latest.json',
  UPDATE_ONLY_CUSTOM: '1',   // 测试期间绝不回退到真实 GitHub
  UPDATE_TIMEOUT: '2500', UPDATE_INTERVAL: '999999', UPDATE_AUTO: '0',
  NESTLEDGER_CONTAINER: '', AUTH_USER: '', AUTH_PASS: ''
};
const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let childLog = '';
child.stdout.on('data', d => { childLog += d; });
child.stderr.on('data', d => { childLog += d; });
const base = 'http://127.0.0.1:' + appPort;
const req = (p, opt) => fetch(base + p, opt);
const json = async (p, opt) => (await req(p, opt)).json();
const post = (p, body) => json(p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
});
async function waitHealth() {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('服务端提前退出：\n' + childLog);
    try { if ((await req('/api/health')).ok) return; } catch (e) {}
    await sleep(100);
  }
  throw new Error('服务端未在 8 秒内启动：\n' + childLog);
}

try {
  await waitHealth();

  /* ---- 1. 版本接口 ---- */
  const h = await json('/api/health');
  ok('健康检查返回当前版本', h.ok === true && h.version === BASE_VERSION);
  const v0 = await json('/api/version');
  ok('/api/version 字段完整', v0.version === BASE_VERSION && v0.builtin === BASE_VERSION &&
    v0.overlay === null && v0.repo === 'lq-wq/nestledger' && v0.updateEnabled === true);
  const st0 = await json('/api/update/status');
  ok('初始更新状态正确', st0.enabled === true && st0.current === BASE_VERSION &&
    st0.auto === false && st0.hasUpdate === false && st0.lastCheck === null);
  ok('更新源首位是自定义地址', st0.sources[0].startsWith('http://127.0.0.1:'));

  /* ---- 2. 检查更新 ---- */
  const c1 = await json('/api/update/check?force=1');
  ok('检查发现新版本', c1.hasUpdate === true && c1.latest.version === NEW_VERSION);
  ok('检查记录来源与时间', !!c1.lastCheck && c1.source.startsWith('http://127.0.0.1:'));
  ok('检查不改动当前版本', c1.current === BASE_VERSION && c1.overlay === null);

  fakeMode = 'oldver';
  const cOld = await json('/api/update/check?force=1');
  ok('更低版本不会被当成更新', cOld.hasUpdate === false && cOld.latest.version === OLD_VERSION);
  ok('降级包不触发安装', (await post('/api/update/apply')).already === true);

  /* ---- 3. 配置开关 ---- */
  const cfg = await post('/api/update/config', { auto: true, autoRestart: true });
  ok('配置开关可写入并即时生效', cfg.auto === true && cfg.autoRestart === true);
  ok('配置持久化到 data 目录', JSON.parse(fs.readFileSync(path.join(dataDir, 'update-config.json'), 'utf8')).auto === true);
  await post('/api/update/config', { auto: false });

  /* ---- 4. 写入业务数据，验证更新不丢 ---- */
  const db = {
    version: 5, properties: [{ id: 'p1', name: '更新测试房源' }],
    rooms: [], tenants: [], contracts: [], bills: [], txns: [],
    settings: {}, meta: { demo: false, createdAt: '2026-11-13' }
  };
  const w = await json('/api/db', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ db })
  });
  ok('写入业务数据成功', w.ok === true && w.rev >= 1);

  /* ---- 5. 坏包一律拒绝，且不落盘 ---- */
  const bad = [
    ['badSha', '整体 sha256'],
    ['badFileSha', '逐文件 sha256'],
    ['badBytes', '文件体积'],
    ['badSchema', '清单格式'],
    ['badVersionTag', '版本标记'],
    ['missingScript', '前端结构'],
    ['badSyntax', '服务端语法']
  ];
  for (const [mode, label] of bad) {
    fakeMode = mode;
    const r = await post('/api/update/apply');
    ok('拒绝坏包 · ' + label, !!r.error && !r.ok);
    ok('坏包未产生覆盖层 · ' + label, !fs.existsSync(path.join(dataDir, 'app', 'version.json')));
  }
  ok('坏包不改动当前版本', (await json('/api/version')).version === BASE_VERSION);

  /* ---- 6. 正常更新 ---- */
  fakeMode = 'good';
  const a = await post('/api/update/apply');
  ok('正常更新成功', a.ok === true && a.version === NEW_VERSION);
  ok('更新前生成了数据快照', typeof a.snapshot === 'string' && a.snapshot.endsWith('.json'));
  ok('快照文件真实存在', fs.existsSync(path.join(dataDir, 'backups', a.snapshot)));
  ok('服务端代码有变化需重启', a.needRestart === true);
  ok('非容器环境不会自行退出', a.restarting === false && child.exitCode === null);
  ok('覆盖层两个文件已落盘',
    fs.existsSync(path.join(dataDir, 'app', 'web/index.html')) &&
    fs.existsSync(path.join(dataDir, 'app', 'server/index.js')));
  const ovMeta = JSON.parse(fs.readFileSync(path.join(dataDir, 'app', 'version.json'), 'utf8'));
  ok('覆盖层元数据正确', ovMeta.version === NEW_VERSION && ovMeta.sha256.length === 64);

  const v1 = await json('/api/version');
  ok('版本接口显示新版本与来源', v1.version === NEW_VERSION && v1.builtin === BASE_VERSION && v1.overlay === NEW_VERSION);
  const home = await (await req('/')).text();
  ok('首页已切换到新版前端', home.includes("var APP_VERSION='" + NEW_VERSION + "';"));
  ok('新版前端仍含版本入口', home.includes('function initUpdate(') && home.includes("data-act','open-about'"));
  const dbAfter = await json('/api/db');
  ok('业务数据更新后完好', dbAfter.hasData === true && dbAfter.db.properties[0].name === '更新测试房源');
  const bks = await json('/api/backups');
  ok('快照列表可见', bks.backups.length >= 1);

  const st1 = await json('/api/update/status');
  ok('更新后状态收敛', st1.hasUpdate === false && st1.lastApplied && st1.lastApplied.version === NEW_VERSION);
  const again = await post('/api/update/apply');
  ok('重复更新幂等', again.already === true && again.version === NEW_VERSION);

  /* ---- 7. 回滚后仍可再次更新 ---- */
  const rb0 = await post('/api/update/rollback');
  ok('第一次回滚成功', rb0.ok === true);
  ok('覆盖层已清除', !fs.existsSync(path.join(dataDir, 'app', 'version.json')));
  const a2 = await post('/api/update/apply');
  ok('回滚后可以重新更新', a2.ok === true && a2.version === NEW_VERSION);

  /* ---- 8. 回滚 ---- */
  const rb = await post('/api/update/rollback');
  ok('回滚成功', rb.ok === true && rb.version === BASE_VERSION);
  ok('非容器环境回滚不自行退出', rb.restarting === false && child.exitCode === null);
  const v2 = await json('/api/version');
  ok('回滚后回到内置版本', v2.version === BASE_VERSION && v2.overlay === null);
  const home2 = await (await req('/')).text();
  ok('首页恢复内置前端', home2.includes("var APP_VERSION='" + BASE_VERSION + "';"));
  const dbRb = await json('/api/db');
  ok('回滚后业务数据完好', dbRb.hasData === true && dbRb.db.properties[0].name === '更新测试房源');
  ok('回滚后快照仍保留', (await json('/api/backups')).backups.length >= 1);

  /* ---- 9. 更新源不可用时静默降级 ---- */
  fakeDrop = true;
  const cf = await json('/api/update/check?force=1');
  ok('更新源不可用不返回 5xx', !!cf.error && cf.hasUpdate === false);
  ok('更新源不可用不影响业务接口', (await json('/api/health')).ok === true);
  ok('更新失败后仍可访问首页', (await req('/')).status === 200);
  fakeDrop = false;

  /* ---- 10. 重启接口在非容器模式给出明确提示 ---- */
  const rs = await post('/api/update/restart');
  ok('非容器模式重启给出提示', !!rs.error && child.exitCode === null);

  console.log('\n全部通过：' + pass + ' 项\n');
} finally {
  fake.close();
  child.kill('SIGTERM');
  await sleep(200);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}
