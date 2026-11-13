/* 栖间 · NestLedger —— 零依赖自检（CI 与本地均可运行） */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
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
  'docker-compose.image.yml', 'docker-compose.autoupdate.yml',
  'VERSION', 'update/latest.json',
  '.env.example', '.gitignore', '.dockerignore', '.gitattributes',
  'README.md', 'LICENSE', 'CHANGELOG.md', '.github/workflows/release.yml',
  'scripts/check.mjs', 'scripts/smoke.mjs', 'scripts/predeploy.sh',
  'scripts/gen-standalone.mjs', 'scripts/sync-version.mjs',
  'scripts/test-standalone.mjs', 'scripts/test-bills.mjs', 'scripts/test-update.mjs',
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
check('生成下界覆盖合同起始期', html.includes('var firstPeriod=addMonths(baseM,k*span);') && html.includes('var through=throughMonth<firstPeriod?firstPeriod:throughMonth;'));
check('提醒与同步逻辑使用同一基准',
  html.includes('var span=cycleMonths(c), startM=billStartMonth(c);') &&
  html.includes('var startM=billStartMonth(c);\n    var endM='));
check('批量生成说明含新账期口径', html.includes('账期与收租时间共用同一期次'));
check('具备错位账单识别与清理', html.includes('function misalignedBillIds(') && html.includes('function removeMisalignedBills('));
check('批量生成提供清理选项', html.includes("key:'cleanStale'") && html.includes("v.cleanStale!=='保留'"));
check('账单页提供错位提示条', html.includes('旧版错位账单') && html.includes('var staleHTML='));
check('单合同生成同步清理', html.includes('removeMisalignedBills(db,c.id)'));
check('生成后清除筛选并跳到账单页', html.includes('function revealBills(') && html.includes('save(); revealBills(); render();'));
check('单合同生成同样清除筛选', html.includes('save(); modalClose(); revealBills(); render();'));
check('失效月份筛选自动校正', html.includes('function validMonthFilter(') && html.includes('var f=validMonthFilter(state.f.bills);'));
check('流水页同样校正月份筛选', html.includes('var f=validMonthFilter(state.f.txns);'));
check('筛选致空时提供一键清除', html.includes('var filterHTML=') && html.includes("case 'clear-bill-filter'"));
check('生成提示不再谎称已全部存在', !html.includes('该期间账单已全部存在，无需重复生成') && !html.includes('账单已全部存在，无需重复生成'));

// ---- v1.3.1 · 概览「本月」统计口径 ----
check('概览本月口径为独立纯函数', html.includes('function monthBillStats(d,cm){') && html.includes('function monthTxnStats(d,cm){'));
check('账单按本期收租时间归月', html.includes('return dm ? dm===cm : (b.period<=cm && b.periodEnd>=cm);'));
check('旧账单缺收租时间时回退账期覆盖', html.includes('var dm=String(b.dueDate||\'\').slice(0,7);') && html.includes('b.period<=cm && b.periodEnd>=cm'));
check('流水按日期归月', html.includes('return String(t.date||\'\').slice(0,7)===cm;'));
check('概览接入本月口径', html.includes('var ms=monthBillStats(db,cm), ts=monthTxnStats(db,cm);') && html.includes('var thisBills=ms.bills, due=ms.due, got=ms.got;'));
check('概览卡片说明按本月收租时间', html.includes('按本月收租时间'));
check('概览展示本月收支条', html.includes('+monthStrip+rulerHTML+') && html.includes('本月收支 · ') && html.includes('本月应收账单 '));
check('空数据不显示多余小计条', html.includes('var monthStrip=(ts.count||ms.count)?'));
check('不再用账期覆盖当月统计待收', !html.includes('账期覆盖当月的账单（含季付'));

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
check('纯镜像版引用本仓库 GHCR', imageCompose.includes('ghcr.io/lq-wq/nestledger:latest'));
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
check('CHANGELOG 含 v1.2.2 可见性修复', read('CHANGELOG.md').includes('v1.2.2') && read('CHANGELOG.md').includes('revealBills'));
check('README 说明生成后自动清除筛选', readme.includes('自动清除筛选'));
check('部署文档含 v1.2.2 生成可见性排障', doc.includes('提示已生成账单'));

// ---- v1.3.0 · 版本号单一真源 ----
const VERSION = read('VERSION').trim();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
check('VERSION 是合法 semver', /^\d+\.\d+\.\d+/.test(VERSION));
check('服务端 APP_VERSION 与 VERSION 一致', read('server/index.js').includes("const APP_VERSION = '" + VERSION + "';"));
check('package.json 版本与 VERSION 一致', JSON.parse(read('server/package.json')).version === VERSION);
check('前端 APP_VERSION 与 VERSION 一致', html.includes("var APP_VERSION='" + VERSION + "';"));
const localHtml = path.resolve(root, '..', '房屋租赁管理系统.html');
const localSrc = fs.existsSync(localHtml) ? fs.readFileSync(localHtml, 'utf8') : '';
check('根目录单文件版版本号同步', !localSrc || localSrc.includes("var APP_VERSION='" + VERSION + "';"));
check('版本同步脚本以 VERSION 为真源',
  read('scripts/sync-version.mjs').includes('readFileSync(VERSION_FILE') &&
  read('scripts/sync-version.mjs').includes('brotliCompressSync'));

// ---- v1.3.0 · 更新清单 ----
const manifest = JSON.parse(read('update/latest.json'));
check('更新清单 schema 与版本', manifest.schema === 1 && manifest.version === VERSION);
check('更新清单指向正确仓库与分支', manifest.repo === 'lq-wq/nestledger' && manifest.branch === 'main');
check('更新清单 payload sha256 正确', sha(Buffer.from(manifest.payload, 'utf8')) === manifest.sha256);
const payloadFiles = JSON.parse(zlib.brotliDecompressSync(Buffer.from(manifest.payload, 'base64')).toString('utf8'));
check('更新包只含两个运行文件', Object.keys(payloadFiles).sort().join(',') === 'server/index.js,web/index.html');
check('更新包 web 与源码逐字一致', payloadFiles['web/index.html'] === html);
check('更新包 server 与源码逐字一致', payloadFiles['server/index.js'] === read('server/index.js'));
for (const n of ['web/index.html', 'server/index.js']) {
  const b = Buffer.from(payloadFiles[n], 'utf8');
  check('更新清单校验和 ' + n, manifest.files[n].sha256 === sha(b) && manifest.files[n].bytes === b.length);
}
check('更新包内前端版本号一致', payloadFiles['web/index.html'].includes("var APP_VERSION='" + VERSION + "';"));
check('更新包内服务端版本号一致', payloadFiles['server/index.js'].includes("const APP_VERSION = '" + VERSION + "';"));

// ---- v1.3.0 · 网页版本入口与更新客户端 ----
for (const [label, src] of [['web', html], ['单文件版', localSrc]]) {
  if (!src) continue;
  check(label + ' 含版本号常量', src.includes("var APP_VERSION='" + VERSION + "';"));
  check(label + ' 含关于与更新入口', src.includes("setAttribute('data-act','open-about')"));
  check(label + ' 含更新模块', src.includes('function initUpdate(') && src.includes('function aboutDialog('));
  check(label + ' 调用更新接口', src.includes("'/api/update/status'") && src.includes("'/api/update/apply'"));
  check(label + ' 本地模式不联网', src.includes('function updServerMode()') && src.includes("if(!updServerMode()){"));
  check(label + ' 支持配置/回滚/重启', src.includes("'/api/update/config'") && src.includes("'/api/update/rollback'") && src.includes("'/api/update/restart'"));
  check(label + ' 事件分支齐全', src.includes("case 'open-about':") && src.includes("case 'upd-apply':") && src.includes("case 'upd-config':"));
  check(label + ' 启动时挂载版本按钮', src.includes('initUpdate();'));
}
const updSlice = s => s.slice(s.indexOf('/* ---------------- 版本与自动更新'), s.indexOf('/* ---------------- 启动'));
check('两份 HTML 版本模块逐字一致', !localSrc || updSlice(html) === updSlice(localSrc));
// 两份 HTML 的示例数据提示文案本来就有差异（NAS 版用 storagePhrase()），
// 因此只比对「本月」口径的纯函数与接入片段，不做整段逐字比较。
const dashCore = s => s.slice(s.indexOf('/* 「本月」统计口径'), s.indexOf('function rentRulerHTML('));
check('两份 HTML 本月口径函数逐字一致', !localSrc || dashCore(html) === dashCore(localSrc));
for (const frag of [
  'var ms=monthBillStats(db,cm), ts=monthTxnStats(db,cm);',
  'var thisBills=ms.bills, due=ms.due, got=ms.got;',
  'var monthStrip=(ts.count||ms.count)?',
  '+monthStrip+rulerHTML+',
  '按本月收租时间'
]) check('单文件版同步概览口径 ' + frag.slice(0, 26), !localSrc || localSrc.includes(frag));

// ---- v1.3.0 · 服务端更新链路 ----
const srv = read('server/index.js');
for (const p of ['/api/version', '/api/update/status', '/api/update/check', '/api/update/apply', '/api/update/config', '/api/update/rollback', '/api/update/restart']) {
  check('服务端路由 ' + p, srv.includes("p === '" + p + "'"));
}
check('服务端严格校验更新包', srv.includes('function verifyManifest(') && srv.includes('sha256 校验失败') && srv.includes('checkServerSyntax('));
check('服务端覆盖层优先', srv.includes('function effectiveWebDir(') && srv.includes('const webDir = effectiveWebDir();'));
check('服务端更新前生成快照', srv.includes('snapshot = await createSnapshot((await readMeta()).rev)'));
check('服务端防重启循环', srv.includes('10 分钟内已重启 2 次'));
check('服务端支持自定义与 CDN 更新源', srv.includes('UPDATE_MANIFEST_URL') && srv.includes('cdn.jsdelivr.net/gh/'));
check('更新接口在认证检查之后', srv.indexOf('if (!checkAuth(req, res)) return;') < srv.indexOf("p === '/api/update/apply'"));

// ---- v1.3.0 · 部署与 CI ----
const gen = read('scripts/gen-standalone.mjs');
check('启动器标记容器运行方式', gen.includes("process.env.NESTLEDGER_CONTAINER = '1';"));
check('启动器应用更新覆盖层', gen.includes("path.join(OVERLAY_DIR, 'version.json')") && gen.includes('fs.copyFileSync(src, dest)'));
check('主 compose 开启网页端自动更新', composeCode.includes('UPDATE_AUTO: 1') && composeCode.includes('UPDATE_REPO: lq-wq/nestledger'));
check('主 compose 未关闭更新', !/^\s*UPDATE_OFF:/m.test(composeCode));
check('镜像版由容器层更新', imageCompose.includes('UPDATE_OFF: 1'));
check('源码构建版由源码更新', buildCompose.includes('UPDATE_OFF: 1'));
const autoCompose = read('docker-compose.autoupdate.yml');
check('自动更新版含 Watchtower', autoCompose.includes('containrrr/watchtower') && autoCompose.includes('WATCHTOWER_POLL_INTERVAL'));
check('自动更新版挂载 docker.sock', autoCompose.includes('/var/run/docker.sock:/var/run/docker.sock'));
check('自动更新版按标签过滤容器', autoCompose.includes('com.centurylinklabs.watchtower.enable'));
check('自动更新版引用本仓库镜像', autoCompose.includes('ghcr.io/lq-wq/nestledger:latest'));
const wf = read('.github/workflows/release.yml');
check('Actions 名称保持 Build and Publish Image', wf.startsWith('name: Build and Publish Image'));
check('Actions 允许发布 Release', /contents:\s*write/.test(wf));
check('Actions 跑一致性门禁', wf.includes('node scripts/check.mjs'));
check('Actions 发布更新清单', wf.includes('Publish update manifest') && wf.includes('update/latest.json'));
check('Actions 上传清单产物', wf.includes('nestledger-update-manifest'));
check('CHANGELOG 含 v1.3.0', read('CHANGELOG.md').includes('v1.3.0'));
check('README 说明自动更新', readme.includes('自动更新') && readme.includes('关于与更新'));
check('README 收录同步版本命令', readme.includes('scripts/sync-version.mjs'));
check('README 收录更新回归命令', readme.includes('scripts/test-update.mjs'));
check('部署文档说明网页端自动更新', doc.includes('网页端自动更新') && doc.includes('UPDATE_MANIFEST_URL'));

// ---- v1.3.1 · 概览本月口径文档 ----
check('CHANGELOG 含 v1.3.1 概览口径修复', read('CHANGELOG.md').includes('v1.3.1') && read('CHANGELOG.md').includes('monthBillStats'));
check('README 说明概览本月口径', readme.includes('概览本月口径') && readme.includes('本月收支'));
check('README 账单回归项数已同步', readme.includes('（111 项）') && !readme.includes('（83 项）'));
check('部署文档含概览待收排障', doc.includes('概览「本月待收」是 ¥0') && doc.includes('本期收租时间'));

// ---- v1.3.2 · 多源取最高版本与更新诊断 ----
check('服务端并发拉取所有更新源', srv.includes('async function fetchManifests()') && srv.includes('Promise.all(urls.map('));
check('不再使用首个成功即停的取源逻辑', !srv.includes('async function fetchManifest()') && !srv.includes('return { json, source: url };'));
check('按版本号降序取最高', srv.includes('cmpVersion(b.version, a.version)'));
check('Release 资产优先于 jsDelivr 分支缓存', srv.indexOf('releases/download/latest') < srv.indexOf('cdn.jsdelivr.net/gh/'));
check('标记 CDN 缓存滞后源', srv.includes('c.stale = true') && srv.includes('staleSources:'));
check('支持多个自定义镜像源', srv.includes('UPDATE_MANIFEST_URLS'));
check('更新请求携带 no-cache 头', srv.includes("'Cache-Control': 'no-cache'"));
check('apply 从最高版本逐个校验并回退', srv.includes('for (const cand of candidates)') && srv.includes('所有新版更新包均未通过校验'));
check('already 返回明确诊断而非笼统提示', srv.includes("hint: '更新源最高版本为") && srv.includes('sourcesChecked: checked, hasUpdate: false'));
check('status 暴露源检查明细', srv.includes('sourcesChecked: updateState.sourcesChecked || []'));
for (const frag of ['function updSourcesHTML(', 'sourcesChecked:[],staleSources:0', "r.hint||('更新源最高为 v", '缓存滞后', 'upd-sources-title']) {
  check('前端版本模块含 ' + frag.slice(0, 26), html.includes(frag));
}
check('前端不再笼统提示已是最新版本', !html.includes("toast('已是最新版本','ok')"));
check('单文件版同步更新源诊断模块', !localSrc || (localSrc.includes('function updSourcesHTML(') && localSrc.includes('sourcesChecked:[],staleSources:0')));
const updTest = read('scripts/test-update.mjs');
check('更新回归覆盖多源场景', updTest.includes('首个源陈旧仍能发现新版本') && updTest.includes('最高版本包损坏时自动回退次高'));
check('CHANGELOG 含 v1.3.2', read('CHANGELOG.md').includes('v1.3.2'));
check('README 说明多源与 CDN 缓存', readme.includes('多源') && readme.includes('CDN 缓存'));
check('部署文档含「已是最新版本」排障', doc.includes('已是最新版本') && doc.includes('UPDATE_MANIFEST_URL'));

console.log('\n全部通过：' + passed + ' 项检查\n');
