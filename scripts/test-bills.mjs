/* 栖间 · NestLedger —— 账单期次回归测试
 *
 * 运行：node scripts/test-bills.mjs
 *
 * 直接执行 web/index.html 里的真实脚本（去掉启动块），覆盖：
 *   - 「本次收租时间」与账期共用期次（用户截图场景 2026-12~2027-02 / 2026-11-24）
 *   - 新签合同兼容、四种付款方式、月末 / 跨年、已收讫、到期限制
 *   - 收款顺延、改合同后同步、旧版错位账单清理与重建、示例数据
 *   - v1.2.2：删空账单后重新生成、起始期下界、筛选校正与生成后可见性
 * 只使用临时 vm 环境，不读写真实数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'web/index.html';
const noop = () => {};

function load() {
  const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
    .split('/* ---------------- 启动 ---------------- */')[0];
  const doc = {
    title: '', addEventListener: noop, removeEventListener: noop,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ setAttribute: noop, appendChild: noop, style: {}, classList: { add: noop, remove: noop } }),
    body: { appendChild: noop, removeChild: noop, setAttribute: noop, style: {} },
    documentElement: { setAttribute: noop, style: {} }
  };
  const ls = { getItem: () => null, setItem: noop, removeItem: noop };
  const sandbox = {
    console, document: doc,
    window: { addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }), localStorage: ls },
    localStorage: ls, location: { protocol: 'file:', href: 'file:///index.html' },
    navigator: { userAgent: 'node' }, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.reject(new Error('offline')), Notification: undefined
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(script, { filename: FILE }).runInContext(ctx);
  return { run: code => vm.runInContext(code, ctx),
           setDB: o => vm.runInContext('db = ' + JSON.stringify(o) + ';', ctx) };
}

const contract = (o = {}) => ({
  id: 'c1', roomId: 'r1', tenantId: 't1',
  startDate: '2024-06-24', endDate: '2029-06-23',
  monthlyRent: 1600, deposit: 1600, payCycle: '季付',
  rentDate: '2026-11-24', rentSettled: '待收', status: '生效中', attachments: [], ...o
});
const emptyDB = c => ({
  version: 5, properties: [], rooms: [], tenants: [], contracts: [c], bills: [], txns: [],
  settings: { reminderEnabled: true, reminderDays: 7, browserNotify: false }, meta: {}
});

let pass = 0, fail = 0;
const ok = (m, c) => { try { assert.ok(c); console.log('  ✓ ' + m); pass++; } catch { console.log('  ✗ ' + m); fail++; } };
const eq = (m, a, b) => ok(m + '  → ' + JSON.stringify(a), a === b);

const { run, setDB } = load();
console.log('栖间 · NestLedger 账单期次回归\n');

// ---- 1. 用户截图场景 ----
setDB(emptyDB(contract()));
eq('billStartMonth 存量季付合同', run('billStartMonth(db.contracts[0])'), '2026-12');
eq('生成笔数', run("makeBillsFor(db,'2026-11')"), 1);
const b1 = JSON.parse(run('JSON.stringify(db.bills[0])'));
eq('账期起始月', b1.period, '2026-12');
eq('账期结束月', b1.periodEnd, '2027-02');
eq('收租时间', b1.dueDate, '2026-11-24');
eq('应收金额', b1.amount, 4800);
eq('重复生成不新增', run("makeBillsFor(db,'2026-11')"), 0);
const ni = JSON.parse(run('JSON.stringify(nextRentInfo(db.contracts[0]))'));
eq('下次交租时间', ni.date, '2026-11-24');
eq('下次交租账期', ni.period, '2026-12 ~ 2027-02');

// ---- 2. 新签合同保持原行为 ----
setDB(emptyDB(contract({ startDate: '2026-09-01', endDate: '2029-08-31', rentDate: '2026-09-01' })));
eq('新签 billStartMonth = 起租月', run('billStartMonth(db.contracts[0])'), '2026-09');
eq('新签生成笔数', run("makeBillsFor(db,'2026-11')"), 1);
const b2 = JSON.parse(run('JSON.stringify(db.bills[0])'));
eq('新签账期', b2.period + ' ~ ' + b2.periodEnd, '2026-09 ~ 2026-11');
eq('新签收租时间', b2.dueDate, '2026-09-01');

setDB(emptyDB(contract({ startDate: '2026-09-01', endDate: '2029-08-31', rentDate: '2026-10-24' })));
eq('收租晚 1 个月仍取起租月', run('billStartMonth(db.contracts[0])'), '2026-09');

// ---- 3. 四种付款方式 ----
for (const [cycle, span, expectedEnd] of [['月付', 1, '2026-12'], ['季付', 3, '2027-02'],
                                           ['半年付', 6, '2027-05'], ['年付', 12, '2027-11']]) {
  setDB(emptyDB(contract({ payCycle: cycle })));
  eq(cycle + ' billStartMonth', run('billStartMonth(db.contracts[0])'), '2026-12');
  eq(cycle + ' 生成笔数', run("makeBillsFor(db,'2026-11')"), 1);
  const b = JSON.parse(run('JSON.stringify(db.bills[0])'));
  eq(cycle + ' 账期', b.period + ' ~ ' + b.periodEnd, '2026-12 ~ ' + expectedEnd);
  eq(cycle + ' 收租时间', b.dueDate, '2026-11-24');
  eq(cycle + ' 金额', b.amount, 1600 * span);
}

// ---- 4. 月末 / 跨年 ----
setDB(emptyDB(contract({ rentDate: '2026-01-31', startDate: '2024-06-01', endDate: '2029-05-31' })));
eq('1/31 收租 → 账期从次月', run('billStartMonth(db.contracts[0])'), '2026-02');
eq('1/31 顺延一期不漂移', run('rentDateAt(db.contracts[0],1)'), '2026-04-30');
setDB(emptyDB(contract({ rentDate: '2026-12-24', startDate: '2024-06-24' })));
eq('跨年 billStartMonth', run('billStartMonth(db.contracts[0])'), '2027-01');
eq('跨年生成笔数', run("makeBillsFor(db,'2026-11')"), 1);
const b4 = JSON.parse(run('JSON.stringify(db.bills[0])'));
eq('跨年账期', b4.period + ' ~ ' + b4.periodEnd, '2027-01 ~ 2027-03');

// ---- 5. 已收讫 / 到期限制 ----
setDB(emptyDB(contract({ rentSettled: '已收讫' })));
eq('已收讫生成笔数', run("makeBillsFor(db,'2027-05')"), 1);
const pb = JSON.parse(run('JSON.stringify(db.bills[0])'));
eq('已收讫首笔账期', pb.period + ' ~ ' + pb.periodEnd, '2027-03 ~ 2027-05');
eq('已收讫首笔收租', pb.dueDate, '2027-02-24');
setDB(emptyDB(contract({ endDate: '2026-11-30' })));
eq('到期日早于下一期则不生成', run("makeBillsFor(db,'2027-05')"), 0);

// ---- 6. 收款顺延 / 改合同同步 ----
setDB(emptyDB(contract()));
run("makeBillsFor(db,'2026-11')");
eq('nextDueAfterBill 顺延一期', run('nextDueAfterBill(db.contracts[0],db.bills[0])'), '2027-02-24');
run("db.contracts[0].rentDate='2026-11-20';");
eq('改收租时间后同步未收账单', run('resyncBillDueDates(db.contracts[0],"季付")'), 1);
eq('同步后的收租时间', run('db.bills[0].dueDate'), '2026-11-20');

// ---- 7. 旧版错位账单：识别 → 清理 → 重建 ----
setDB(emptyDB(contract()));
for (let k = 0; k < 10; k++) {
  const p = run(`addMonths('2024-06',${k * 3})`);
  const pe = run(`addMonths('2024-06',${k * 3 + 2})`);
  const due = run(`rentDateAt(db.contracts[0],${k})`);
  run(`db.bills.push({id:'old${k}',contractId:'c1',period:'${p}',periodEnd:'${pe}',amount:4800,` +
      `dueDate:'${due}',paidAmount:0,paidDate:'',status:'未收',note:'',createdAt:'2026-11-12'})`);
}
eq('复现截图错位', run("db.bills[9].period+' ~ '+db.bills[9].periodEnd+' / '+db.bills[9].dueDate"),
   '2026-09 ~ 2026-11 / 2029-02-24');
eq('识别出 10 笔错位账单', run('Object.keys(misalignedBillIds(db)).length'), 10);
run("db.bills.push({id:'keep1',contractId:'c1',period:'2024-03',periodEnd:'2024-05',amount:4800,dueDate:'2029-09-24',paidAmount:4800,paidDate:'2026-01-01',status:'已收',note:''})");
run("db.bills.push({id:'keep2',contractId:'c1',period:'2024-04',periodEnd:'2024-06',amount:4800,dueDate:'2029-10-24',paidAmount:0,paidDate:'',status:'未收',note:'手工调整'})");
eq('已收 / 有备注账单不算错位', run('Object.keys(misalignedBillIds(db)).length'), 10);
eq('清理 10 笔', run('removeMisalignedBills(db)'), 10);
eq('保留 2 笔人工账单', run('db.bills.length'), 2);
eq('重建生成 1 笔', run("makeBillsFor(db,'2026-11')"), 1);
const rebuilt = JSON.parse(run('JSON.stringify(db.bills.filter(function(b){return b.id.indexOf("old")<0 && b.id.indexOf("keep")<0;})[0])'));
eq('重建账期', rebuilt.period + ' ~ ' + rebuilt.periodEnd, '2026-12 ~ 2027-02');
eq('重建收租时间', rebuilt.dueDate, '2026-11-24');
eq('重建后不再有错位账单', run('Object.keys(misalignedBillIds(db)).length'), 0);

// ---- 8. 示例数据 ----
const demo = JSON.parse(run('JSON.stringify(buildDemo())'));
ok('示例数据生成账单', demo.bills.length > 0);
ok('示例账单无荒谬收租时间', demo.bills.every(b => b.dueDate < '2030-01-01'));
ok('示例账期均合法', demo.bills.every(b => /^\d{4}-\d{2}$/.test(b.period) && b.periodEnd >= b.period));

// ---- 9. v1.2.2 删空账单后重新生成的可见性 ----
// 用户场景：手动删除全部账单 → 再点批量生成 → 提示已生成，页面却看不到
setDB(emptyDB(contract()));
eq('首次生成 1 笔', run("makeBillsFor(db,'2026-11')"), 1);
run('db.bills=[];');
eq('删空后重新生成仍 1 笔', run("makeBillsFor(db,'2026-11')"), 1);
const rb = JSON.parse(run('JSON.stringify(db.bills[0])'));
eq('重建账期', rb.period + ' ~ ' + rb.periodEnd, '2026-12 ~ 2027-02');
eq('重建收租时间', rb.dueDate, '2026-11-24');

// 本次已收讫时起始期是 k=1，生成下界必须一起抬高，否则生成至当月会一笔都不生成
setDB(emptyDB(contract({ rentSettled: '已收讫' })));
eq('已收讫删空后生成至当月仍生成 1 笔', run("makeBillsFor(db,'2026-11')"), 1);
const sb = JSON.parse(run('JSON.stringify(db.bills[0])'));
eq('已收讫首笔为下一期', sb.period + ' ~ ' + sb.periodEnd, '2027-03 ~ 2027-05');
eq('已收讫首笔收租', sb.dueDate, '2027-02-24');

// 幽灵月份筛选：账单删空后该月份已从下拉消失，内部值必须回落到 all
setDB(emptyDB(contract()));
run("makeBillsFor(db,'2026-11'); state.f.bills={status:'all',month:'1999-01',q:''};");
eq('失效月份被校正为 all', run('validMonthFilter(state.f.bills).month'), 'all');
run("state.f.bills={status:'all',month:'2026-12',q:''};");
eq('有效月份予以保留', run('validMonthFilter(state.f.bills).month'), '2026-12');

// 生成后清筛选、清勾选、跳账单页
run("state.page='contracts'; state.sel.bill=['x']; state.f.bills={status:'逾期',month:'1999-01',q:'abc'}; revealBills();");
eq('生成后回到账单页', run('state.page'), 'bills');
eq('生成后状态筛选清空', run('state.f.bills.status'), 'all');
eq('生成后月份筛选清空', run('state.f.bills.month'), 'all');
eq('生成后关键词清空', run('state.f.bills.q'), '');
eq('生成后勾选清空', run('state.sel.bill.length'), 0);

// ---- 10. 静态口径 ----
const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
ok('具备期次基准函数', html.includes('function billStartMonth('));
ok('具备错位清理函数', html.includes('function removeMisalignedBills('));
ok('批量生成含新口径', html.includes('账期与收租时间共用同一期次'));
ok('批量生成含清理选项', html.includes("key:'cleanStale'"));
ok('账单页含错位提示条', html.includes('var staleHTML='));
ok('具备生成后可见性 helper', html.includes('function revealBills('));
ok('具备失效月份校正', html.includes('function validMonthFilter('));
ok('账单页使用月份校正', html.includes('var f=validMonthFilter(state.f.bills);'));
ok('生成后清除筛选', html.includes('save(); revealBills(); render();'));
ok('筛选致空提供一键清除', html.includes('var filterHTML=') && html.includes("case 'clear-bill-filter'"));
ok('提示不再谎称账单已全部存在', !html.includes('该期间账单已全部存在，无需重复生成'));

console.log('\n全部通过：' + pass + ' 项\n');
process.exit(fail ? 1 : 0);
