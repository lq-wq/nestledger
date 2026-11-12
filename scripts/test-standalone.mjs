/* 栖间 · NestLedger —— 自包含版真实启动验证
 *
 * 运行：node scripts/test-standalone.mjs
 *
 * 从【交付的】docker-compose.standalone.yml 里提取 APP_BUNDLE 与 command 启动器，
 * 用真实 Node 进程解包并起服务，验证：
 *   - 解包出的 server/index.js、web/index.html 与源码逐字一致
 *   - 首页 / favicon / 健康检查 / 数据读写 / 快照可用
 * 只使用系统临时目录，不碰真实 data/。改完前端或服务端后建议跑一次。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nestledger-st-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

const yaml = fs.readFileSync(path.join(REPO, 'docker-compose.standalone.yml'), 'utf8');
let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };

// 验证的是交付物本身，不读生成脚本里的变量
const bm = yaml.match(/      APP_BUNDLE: "([A-Za-z0-9+/=]+)"/);
ok('YAML 中能提取 APP_BUNDLE', !!bm);
const bootMatch = yaml.match(/      - \|\r?\n((?:        [^\r\n]*\r?\n)+)/);
ok('YAML 中能提取 command 启动器', !!bootMatch);
const boot = bootMatch[1].split(/\r?\n/).filter(l => l.length).map(l => l.slice(8)).join('\n');
ok('启动器是合法 JS', (() => { try { new Function(boot); return true; } catch { return false; } })());
const code = yaml.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
ok('非注释行不含 build 字段', !/\bbuild:/.test(code));
ok('非注释行不含 Dockerfile 依赖', !/dockerfile/i.test(code));

const appDir = path.join(TMP, 'app');
const dataDir = path.join(TMP, 'data');
const PORT = Number(process.env.STANDALONE_TEST_PORT || 8811);
const child = spawn(process.execPath, ['-e', boot], {
  cwd: REPO,
  env: {
    ...process.env,
    APP_BUNDLE: bm[1], APP_DIR: appDir, DATA_DIR: dataDir,
    WEB_DIR: path.join(appDir, 'web'), PORT: String(PORT), HOST: '127.0.0.1',
    BACKUP_KEEP: '3', BACKUP_ON_WRITE: '1', AUTH_USER: '', AUTH_PASS: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', d => { log += d; });
child.stderr.on('data', d => { log += d; });
const base = 'http://127.0.0.1:' + PORT;
const req = (p, opt = {}) => fetch(base + p, opt);

async function waitHealth() {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('启动器进程提前退出：\n' + log);
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('服务未在 8 秒内启动：\n' + log);
}

try {
  console.log('\n栖间 · NestLedger 自包含版真实启动验证\n[1] 解包');
  await waitHealth();
  ok('启动器成功起服务（/api/health 200）', true);
  ok('解包出 server/index.js', fs.existsSync(path.join(appDir, 'server/index.js')));
  ok('解包出 web/index.html', fs.existsSync(path.join(appDir, 'web/index.html')));
  const srcJs = fs.readFileSync(path.join(REPO, 'server/index.js'), 'utf8');
  const srcHtml = fs.readFileSync(path.join(REPO, 'web/index.html'), 'utf8');
  ok('server 与源码逐字一致', fs.readFileSync(path.join(appDir, 'server/index.js'), 'utf8') === srcJs);
  ok('web 与源码逐字一致', fs.readFileSync(path.join(appDir, 'web/index.html'), 'utf8') === srcHtml);
  ok('启动日志含解包提示', log.includes('内联应用包已展开'));

  console.log('\n[2] 静态页面与基础接口');
  ok('GET / 返回 200', (await req('/')).status === 200);
  const html = await (await req('/')).text();
  ok('首页含品牌与同步层', html.includes('栖间') && html.includes('NestLedger') && html.includes('function initSync()'));
  ok('首页 HTML 与源文件一致', html === srcHtml);
  ok('favicon 返回 204', (await req('/favicon.ico')).status === 204);
  ok('健康检查 ok', (await (await req('/api/health')).json()).ok === true);
  ok('初始无数据', (await (await req('/api/meta')).json()).hasData === false);

  console.log('\n[3] 数据读写与快照');
  const db = {
    version: 5, properties: [{ id: 'p1', name: '自包含版测试房源' }], rooms: [], tenants: [],
    contracts: [], bills: [], txns: [], settings: { reminderEnabled: true, reminderDays: 7 },
    meta: { demo: false, createdAt: '2026-11-12' }
  };
  const put = d => req('/api/db', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ db: d, baseRev: 0 })
  });
  const w1 = await (await put(db)).json();
  ok('首次写入 rev=1', w1.ok === true && w1.rev === 1);
  const got = await (await req('/api/db')).json();
  ok('读回数据一致', got.hasData && got.db.properties[0].name === '自包含版测试房源');
  const w2 = await (await put({ ...db, properties: [...db.properties, { id: 'p2', name: '第二处' }] })).json();
  ok('二次写入生成快照', w2.rev === 2 && typeof w2.backup === 'string');
  const list = await (await req('/api/backups')).json();
  ok('快照列表可读', list.backups.length >= 1);
  ok('db.json 确实落在 DATA_DIR', fs.existsSync(path.join(dataDir, 'db.json')));

  console.log('\n全部通过：' + pass + ' 项\n');
} finally {
  child.kill('SIGTERM');
}
