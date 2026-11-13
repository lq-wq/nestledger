/* 栖间 · NestLedger —— 零依赖自检（CI 与本地均可运行） */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
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
  'docker-compose.yml', 'docker-compose.standalone.yml', 'docker-compose.build.yml',
  'docker-compose.image.yml',
  '.env.example', '.gitignore', '.dockerignore', '.gitattributes',
  'README.md', 'LICENSE', 'CHANGELOG.md', '.github/workflows/release.yml',
  'scripts/check.mjs', 'scripts/smoke.mjs', 'scripts/predeploy.sh',
  'scripts/gen-standalone.mjs', 'scripts/test-standalone.mjs', 'scripts/test-bills.mjs',
  'scripts/backup.sh', 'scripts/restore.sh',
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
check('账单期次基准函数存在', html.includes('function billStartMonth('));
check('账单生成以本次收租时间为基准', html.includes('var baseM=billStartMonth(c);'));
check('生成下界覆盖下一期账期', html.includes('var through=throughMonth<baseM?baseM:throughMonth;'));
check('提醒与同步逻辑使用同一基准',
  html.includes('var span=cycleMonths(c), startM=billStartMonth(c);') &&
  html.includes('var startM=billStartMonth(c);\n    var endM='));
check('批量生成说明含新账期口径', html.includes('账期与收租时间共用同一期次'));
check('具备错位账单识别与清理', html.includes('function misalignedBillIds(') && html.includes('function removeMisalignedBills('));
check('批量生成提供清理选项', html.includes("key:'cleanStale'") && html.includes("v.cleanStale!=='保留'"));
check('账单页提供错位提示条', html.includes('旧版错位账单') && html.includes('var staleHTML='));
check('单合同生成同步清理', html.includes('removeMisalignedBills(db,c.id)'));

execFileSync(process.execPath, ['--check', path.join(root, 'server/index.js')]);
check('服务端脚本语法', true);
const pkg = JSON.parse(read('server/package.json'));
check('服务端零 npm 依赖', Object.keys(pkg.dependencies || {}).length === 0);

const dockerfile = read('Dockerfile');
check('基础镜像可配置（BASE_IMAGE）', dockerfile.includes('ARG BASE_IMAGE=node:22-alpine'));
check('FROM 使用 BASE_IMAGE', /FROM \$\{BASE_IMAGE\}/.test(dockerfile));
check('声明数据卷', dockerfile.includes('VOLUME ["/data"]'));
check('只复制必要文件', dockerfile.includes('COPY server/package.json server/index.js ./server/') && dockerfile.includes('COPY web/index.html ./web/'));

// ---- 默认主 compose：自包含版，零文件依赖（飞牛 GUI 粘贴默认走它）----
const compose = read('docker-compose.yml');
const composeCode = compose.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
check('主 compose 不含 build（默认零文件依赖）', !/\bbuild:/.test(composeCode));
check('主 compose 不依赖 Dockerfile（非注释行）', !/dockerfile/i.test(composeCode));
check('主 compose 使用 node 基础镜像', composeCode.includes('image: node:22-alpine'));
check('主 compose 无 compose 变量插值（兼容飞牛 GUI）', !/\$\{/.test(compose));
check('主 compose 挂载 ./data', composeCode.includes('./data:/data'));
check('主 compose 含健康检查', composeCode.includes('healthcheck:'));
const mainBundle = compose.match(/APP_BUNDLE: "([A-Za-z0-9+/=]+)"/);
check('主 compose 含单行内联包', !!mainBundle);
const embedded = JSON.parse(
  zlib.brotliDecompressSync(Buffer.from(mainBundle[1], 'base64')).toString('utf8')
);
check('主 compose 内联包 server 与源码逐字一致', embedded['server/index.js'] === read('server/index.js'));
check('主 compose 内联包 web 与源码逐字一致', embedded['web/index.html'] === html);
check('主 compose 内联包只含两个运行必需文件', Object.keys(embedded).length === 2);
check('主 compose 不读 .env（参数写在 YAML 里）', !/env_file|\$\{/.test(compose));

// ---- 兼容副本：与默认主文件逐字一致 ----
const standalone = read('docker-compose.standalone.yml');
const stCode = standalone.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
check('兼容副本与主 compose 逐字一致', standalone === compose);
check('自包含版不触发 build（非注释行）', !/\bbuild:/.test(stCode));
check('自包含版不依赖 Dockerfile（非注释行）', !/dockerfile/i.test(stCode));
check('自包含版无 compose 变量插值', !/\$\{/.test(standalone));
const bundleMatch = standalone.match(/APP_BUNDLE: "([A-Za-z0-9+/=]+)"/);
check('自包含版含单行内联包', !!bundleMatch && bundleMatch[1] === mainBundle[1]);
check('生成脚本同时产出主 compose 与兼容副本',
  read('scripts/gen-standalone.mjs').includes("'docker-compose.yml'") &&
  read('scripts/gen-standalone.mjs').includes("'docker-compose.standalone.yml'"));
check('生成脚本可重建内联包', read('scripts/gen-standalone.mjs').includes('brotliCompressSync'));

// ---- 源码构建版：含 build，必须完整项目目录 ----
const buildCompose = read('docker-compose.build.yml');
check('源码构建版含 build 段', /\bbuild:/.test(buildCompose));
check('源码构建版挂载 ./data', buildCompose.includes('./data:/data'));
check('源码构建版可配置端口', buildCompose.includes('${PORT:-8787}:8787'));
check('源码构建版构建上下文为当前目录', /context: \./.test(buildCompose));
check('源码构建版指定 Dockerfile', /dockerfile: Dockerfile/.test(buildCompose));
check('源码构建版传递 BASE_IMAGE', buildCompose.includes('BASE_IMAGE: ${BASE_IMAGE:-node:22-alpine}'));
check('源码构建版不写 image 字段（避免无谓 Pulling）', !/^\s*image:/m.test(buildCompose));

// ---- GHCR 纯镜像版 ----
const imageCompose = read('docker-compose.image.yml');
check('纯镜像版引用 GHCR', imageCompose.includes('ghcr.io/yourname/nestledger:latest'));
check('纯镜像版不触发 build', !/\bbuild:/.test(imageCompose));
check('纯镜像版挂载 ./data', imageCompose.includes('./data:/data'));
check('纯镜像版端口一致', imageCompose.includes('"8787:8787"'));

const env = read('.env.example');
check('.env.example 提供 BASE_IMAGE', env.includes('BASE_IMAGE=node:22-alpine'));
check('.env.example 说明 IMAGE 仅用于纯镜像版', env.includes('docker-compose.image.yml'));
check('.env.example 说明主 compose 不读 .env', env.includes('docker-compose.yml'));

const predeploy = read('scripts/predeploy.sh');
check('部署自检识别自包含主 compose', predeploy.includes('MODE=standalone'));
check('部署自检支持指定 compose 文件', predeploy.includes('COMPOSE_FILE'));
check('部署自检覆盖 Dockerfile', predeploy.includes('"Dockerfile"'));
check('部署自检覆盖 server 与 web', predeploy.includes('"server/index.js"') && predeploy.includes('"web/index.html"'));
check('部署自检识别 ZIP 多套一层', predeploy.includes('多套了一层'));
check('部署自检识别 GUI 只导入 YAML', predeploy.includes('粘贴 YAML'));
check('部署自检给出自包含版建议', predeploy.includes('docker-compose.standalone.yml'));

const readme = read('README.md');
check('README 说明主 compose 为自包含版', readme.includes('docker-compose.build.yml') && readme.includes('自包含'));
check('README 无过期的「主 compose 用 build」说法', !readme.includes('`docker-compose.yml` 用的是 `build: { context: . }`'));
const doc = read('docs/飞牛NAS部署.md');
check('部署文档说明主 compose 已零文件依赖', doc.includes('docker-compose.build.yml') && doc.includes('v1.2.0'));
check('CHANGELOG 含 v1.2.0', read('CHANGELOG.md').includes('v1.2.0'));
check('CHANGELOG 含 v1.2.1 账单修复说明',
  read('CHANGELOG.md').includes('v1.2.1') && read('CHANGELOG.md').includes('billStartMonth'));
check('README 收录账单回归测试命令', readme.includes('scripts/test-bills.mjs'));
check('README 说明升级后清理错位账单', readme.includes('清理（推荐）'));
check('部署文档提供 v1.2.1 升级清理步骤', doc.includes('清理旧版错位账单'));

console.log('\n全部通过：' + passed + ' 项检查\n');
