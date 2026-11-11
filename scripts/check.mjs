/* 栖间 · NestLedger —— 零依赖自检（CI 与本地均可运行） */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
function check(name, condition) {
  if (!condition) throw new Error('检查失败：' + name);
  passed++;
  console.log('  ✓ ' + name);
}
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const has = f => fs.existsSync(path.join(root, f));

console.log('栖间 · NestLedger 项目自检\n');
for (const f of [
  'web/index.html', 'server/index.js', 'server/package.json', 'Dockerfile',
  'docker-compose.yml', '.env.example', '.gitignore', '.dockerignore', '.gitattributes',
  'README.md', 'LICENSE', 'CHANGELOG.md', '.github/workflows/release.yml',
  'scripts/check.mjs', 'scripts/smoke.mjs', 'scripts/backup.sh', 'scripts/restore.sh',
  'docs/飞牛NAS部署.md', 'docs/备份与恢复.md'
]) check('存在 ' + f, has(f));

const html = read('web/index.html');
const script = html.match(/<script>([\s\S]*?)<\/script>/);
check('页面含且仅含一个内联脚本', script && html.match(/<script/g).length === 1);
new vm.Script(script[1], { filename: 'web/index.html' });
check('前端脚本语法', true);
check('无外部资源引用', !/(?:src|href)=["']https?:\/\//i.test(html));
check('品牌为 栖间 · NestLedger', html.includes('栖间') && html.includes('NestLedger'));
check('无「缴租」旧文案', !html.includes('缴租'));
check('保留单文件本地模式', html.includes("location.protocol==='file:'"));
check('具备 NAS 同步入口', html.includes('function initSync()') && html.includes('api/db'));
check('具备时间色阶', html.includes('DUE_AMBER_MAX'));

execFileSync(process.execPath, ['--check', path.join(root, 'server/index.js')]);
check('服务端脚本语法', true);
const pkg = JSON.parse(read('server/package.json'));
check('服务端零 npm 依赖', Object.keys(pkg.dependencies || {}).length === 0);

const dockerfile = read('Dockerfile');
check('镜像基于 node alpine', /FROM node:.*-alpine/.test(dockerfile));
check('声明数据卷', dockerfile.includes('VOLUME ["/data"]'));
const compose = read('docker-compose.yml');
check('compose 挂载 ./data', compose.includes('./data:/data'));
check('compose 可配置端口', compose.includes('${PORT:-8787}:8787'));

console.log('\n全部通过：' + passed + ' 项检查\n');
