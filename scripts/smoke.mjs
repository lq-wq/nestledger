/* 栖间 · NestLedger —— 接口冒烟测试（无需 Docker，本地临时起两个服务） */
/* 运行：node scripts/smoke.mjs  · 只使用临时目录，不碰真实 data/ */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 8799);
const PORT_AUTH = Number(process.env.SMOKE_PORT_AUTH || 8800);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nestledger-smoke-'));
const dataDir = path.join(tmp, 'data');
let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('  ✓ ' + name); };
const base = 'http://127.0.0.1:' + PORT;
const req = (p, opt = {}) => fetch(base + p, opt);
const db = {
  version: 5, properties: [{ id: 'p1', name: '测试房源' }], rooms: [], tenants: [],
  contracts: [], bills: [], txns: [], settings: { reminderEnabled: true, reminderDays: 7 },
  meta: { demo: false, createdAt: '2026-11-09' }
};
const putDB = d => req('/api/db', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ db: d, baseRev: 0 })
});

async function waitHealth(port) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/api/health'); if (r.ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('服务未在 6 秒内启动');
}
function start(port, extra) {
  const child = spawn(process.execPath, [path.join(root, 'server/index.js')], {
    cwd: root,
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir,
      BACKUP_KEEP: '3', AUTH_USER: '', AUTH_PASS: '', ...extra
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  return child;
}

const children = [];
try {
  console.log('栖间 · NestLedger 接口冒烟测试\n[1] 静态与基础接口');
  children.push(start(PORT, {}));
  await waitHealth(PORT);
  ok('GET / 返回 200', (await req('/')).status === 200);
  const html = await (await req('/')).text();
  ok('首页含品牌名', html.includes('栖间') && html.includes('NestLedger'));
  ok('首页含同步层', html.includes('function initSync()'));
  ok('favicon 不报 404', (await req('/favicon.ico')).status === 204);
  ok('健康检查 ok', (await (await req('/api/health')).json()).ok === true);
  const meta0 = await (await req('/api/meta')).json();
  ok('初始无数据', meta0.hasData === false && meta0.rev === 0);
  ok('空库读取正常', (await (await req('/api/db')).json()).hasData === false);

  console.log('\n[2] 写入、快照与防护');
  const w1 = await (await putDB(db)).json();
  ok('首次写入 rev=1', w1.ok === true && w1.rev === 1);
  ok('首次写入不产生快照', w1.backup === null);
  const got = await (await req('/api/db')).json();
  ok('读回数据一致', got.hasData && got.db.properties[0].name === '测试房源' && got.rev === 1);
  const db2 = { ...db, properties: [...db.properties, { id: 'p2', name: '第二处房源' }] };
  const w2 = await (await putDB(db2)).json();
  ok('二次写入 rev=2 且生成快照', w2.rev === 2 && typeof w2.backup === 'string');
  const list = await (await req('/api/backups')).json();
  ok('快照列表可读', list.backups.length >= 1 && list.backups[0].size > 0);
  const snap = await req('/api/backups/' + encodeURIComponent(list.backups[0].name));
  ok('快照可下载', snap.status === 200);
  ok('快照内容是上一版数据', (await snap.json()).properties.length === 1);
  ok('可手动生成快照', !!(await (await req('/api/backups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  })).json()).name);
  ok('非法数据被拒绝', (await putDB({ nope: 1 })).status === 400);
  ok('路径穿越被拒绝', (await req('/api/backups/..%2F..%2Fdb.json')).status === 400);
  ok('不存在的接口 404', (await req('/api/nothing')).status === 404);
  ok('数据文件已落盘', fs.existsSync(path.join(dataDir, 'db.json')));

  console.log('\n[3] 可选 Basic Auth');
  children.push(start(PORT_AUTH, { AUTH_USER: 'admin', AUTH_PASS: 'secret' }));
  await waitHealth(PORT_AUTH);
  const b = 'http://127.0.0.1:' + PORT_AUTH;
  ok('无密码访问首页 401', (await fetch(b + '/')).status === 401);
  ok('健康检查无需密码', (await fetch(b + '/api/health')).status === 200);
  const good = 'Basic ' + Buffer.from('admin:secret').toString('base64');
  ok('正确密码可访问', (await fetch(b + '/', { headers: { Authorization: good } })).status === 200);
  const bad = 'Basic ' + Buffer.from('admin:bad').toString('base64');
  ok('错误密码被拒绝', (await fetch(b + '/', { headers: { Authorization: bad } })).status === 401);

  console.log('\n全部通过：' + pass + ' 项冒烟断言\n');
} finally {
  for (const c of children) c.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });
}
