/* 栖间 · NestLedger —— 接口冒烟测试（无需 Docker，本地临时起两个服务） */
/* 运行：node scripts/smoke.mjs  · 只使用临时目录，不碰真实 data/ */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { installFetchShim } from './fetch-shim.mjs';
installFetchShim();

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
      BACKUP_KEEP: '3', AUTH_USER: '', AUTH_PASS: '', NESTLEDGER_TEST_NO_AUTH: '', ...extra
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
  children.push(start(PORT, { NESTLEDGER_TEST_NO_AUTH: '1' }));
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

  console.log('\n[3] 强制登录与用户管理');
  children.push(start(PORT_AUTH, {}));
  await waitHealth(PORT_AUTH);
  const b = 'http://127.0.0.1:' + PORT_AUTH;
  const post = (p, body, cookie) => fetch(b + p, {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
    body: JSON.stringify(body)
  });
  const cookieOf = r => String(r.headers.get('set-cookie') || '').split(';')[0];
  const authHeaders = cookie => ({ Cookie: cookie });

  ok('未登录首页仍可打开登录页', (await fetch(b + '/')).status === 200);
  ok('未登录业务接口返回 401', (await fetch(b + '/api/meta')).status === 401);
  ok('健康检查无需登录', (await fetch(b + '/api/health')).status === 200);
  const state = await (await fetch(b + '/api/auth/me')).json();
  ok('登录状态接口未登录', state.authenticated === false && state.mode === 'server');
  ok('错误密码被拒绝', (await post('/api/auth/login', { username: 'admin', password: 'wrong' })).status === 401);

  const login = await post('/api/auth/login', { username: 'admin', password: 'admin123' });
  const adminCookie = cookieOf(login);
  ok('默认管理员可以登录', login.status === 200 && !!adminCookie && (await login.json()).user.role === 'admin');
  ok('登录后可访问业务接口', (await fetch(b + '/api/meta', { headers: authHeaders(adminCookie) })).status === 200);
  ok('登录后登录状态返回用户', (await (await fetch(b + '/api/auth/me', { headers: authHeaders(adminCookie) })).json()).authenticated === true);

  ok('当前密码错误时不能改密', (await post('/api/auth/password', { oldPassword: 'bad', newPassword: 'secret456' }, adminCookie)).status === 400);
  ok('可以修改自己的密码', (await post('/api/auth/password', { oldPassword: 'admin123', newPassword: 'secret456' }, adminCookie)).status === 200);
  ok('旧密码登录失败', (await post('/api/auth/login', { username: 'admin', password: 'admin123' })).status === 401);
  const adminLogin2 = await post('/api/auth/login', { username: 'admin', password: 'secret456' });
  ok('新密码登录成功', adminLogin2.status === 200);
  const adminCookie2 = cookieOf(adminLogin2);

  const users = await (await fetch(b + '/api/auth/users', { headers: authHeaders(adminCookie2) })).json();
  ok('管理员可列出用户', users.users.length === 1 && users.users[0].username === 'admin');
  ok('可以添加用户', (await post('/api/auth/users', { username: 'alice', password: 'alice123', role: 'member' }, adminCookie2)).status === 200);
  const memberLogin = await post('/api/auth/login', { username: 'alice', password: 'alice123' });
  const memberCookie = cookieOf(memberLogin);
  ok('新用户可以登录', memberLogin.status === 200);
  ok('普通用户不能管理用户', (await fetch(b + '/api/auth/users', { headers: authHeaders(memberCookie) })).status === 403);
  ok('普通用户可以修改自己密码', (await post('/api/auth/password', { oldPassword: 'alice123', newPassword: 'alice456' }, memberCookie)).status === 200);

  ok('管理员可重置用户密码', (await post('/api/auth/users/alice/password', { password: 'alice789' }, adminCookie2)).status === 200);
  ok('重置密码后旧会话失效', (await fetch(b + '/api/meta', { headers: authHeaders(memberCookie) })).status === 401);
  ok('重置后新密码可登录', (await post('/api/auth/login', { username: 'alice', password: 'alice789' })).status === 200);
  ok('管理员可删除用户', (await fetch(b + '/api/auth/users/alice', { method: 'DELETE', headers: authHeaders(adminCookie2) })).status === 200);
  ok('删除后该用户无法登录', (await post('/api/auth/login', { username: 'alice', password: 'alice789' })).status === 401);
  const out = await post('/api/auth/logout', {}, adminCookie2);
  ok('退出登录返回 200', out.status === 200 && /Max-Age=0/.test(String(out.headers.get('set-cookie') || '')));
  ok('退出后 Cookie 失效', (await fetch(b + '/api/meta', { headers: authHeaders(adminCookie2) })).status === 401);

  const basic = 'Basic ' + Buffer.from('admin:secret456').toString('base64');
  ok('Basic Auth 仍可访问业务接口', (await fetch(b + '/api/meta', { headers: { Authorization: basic } })).status === 200);

  console.log('\n全部通过：' + pass + ' 项冒烟断言\n');
} finally {
  for (const c of children) c.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });
}
