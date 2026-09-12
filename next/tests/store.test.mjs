// localStorage 垫片
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i],
  get length() { return mem.size; },
  clear: () => mem.clear(),
};

const { Store, migrateFromV2 } = await import('../js/store.js');
const { mkStatus, mkValue, fold, occurrencesOn, timesOf } = await import('../js/model.js');
const { SEED_DEFS } = await import('../js/seed.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}（得到 ${JSON.stringify(a)}）`);

console.log('\n[出厂模版：41 条合并成多少个定义]');
eq(SEED_DEFS.length, 23, '定义数');
const totalTimes = SEED_DEFS.reduce((n, d) => n + timesOf(d).length, 0);
eq(totalTimes, 41, '展开后仍是 41 个时刻 —— 一条没丢');
const lhqw = SEED_DEFS.find(d => d.name.includes('连花清瘟'));
eq(timesOf(lhqw).length, 3, '连花清瘟一条定义管三次');

console.log('\n[分片存储]');
const s = new Store();
s.init(JSON.parse(JSON.stringify(SEED_DEFS)));
s.append(mkStatus('d-01', '2026-09-13', 0, 'done'));
s.append(mkValue('d-01', '2026-09-13', 0, 'glucose', '6.2'));
s.append(mkStatus('d-01', '2026-10-02', 0, 'done'));
eq(s.knownMonths(), ['2026-10', '2026-09'], '按月分片，新到旧');
eq(s.events('2026-09').length, 2, '9 月 2 条');
eq(s.events('2026-10').length, 1, '10 月 1 条');
ok(mem.has('care.v3.ev.2026-09') && mem.has('care.v3.ev.2026-10'), '两个月各写一个键');

const s2 = new Store();
ok(s2.initialized, '重新加载能认出已初始化');
eq(fold(s2.eventsOn('2026-09-13')).value('d-01', 0, 'glucose'), '6.2', '重新加载后数据还在');

console.log('\n[导出导入：同一条不会重复]');
const dump = s.export();
const before = s.events('2026-09').length;
eq(s.import(dump), 0, '导入自己的备份，新增 0 条');
eq(s.events('2026-09').length, before, '没有产生重复');
const extra = { defs: [], events: { '2026-09': [mkStatus('d-02', '2026-09-14', 0, 'done')] } };
eq(s.import(extra), 1, '导入新记录，新增 1 条');

console.log('\n[坏数据要挡住]');
let threw = false;
try { s.import({ defs: [], events: { '2026-09': 'nope' } }); } catch (e) { threw = true; }
ok(threw, '事件不是数组 → 报错');
threw = false;
try { s.import({ defs: [{ name: '缺 id' }] }); } catch (e) { threw = true; }
ok(threw, '定义缺 id → 报错');

console.log('\n[从旧版迁移]');
mem.clear();
// 造一份旧版数据：连花清瘟三条独立、体温多条、他汀停用
const oldPlan = { items: [
  { id: 'base-0', section: '清晨', time: '06:45', type: '测量', title: '空腹血糖', desc: '', kind: 'glucose', ref: '', active: true, from: '', to: '', deleted: false },
  { id: 'base-7', section: '上午', time: '09:10', type: '服药', title: '连花清瘟颗粒', desc: '温水冲服', kind: 'none', active: true, from: '', to: '', deleted: false },
  { id: 'base-19', section: '中午', time: '13:15', type: '服药', title: '连花清瘟颗粒', desc: '温水冲服', kind: 'none', active: true, from: '', to: '', deleted: false },
  { id: 'base-30', section: '傍晚', time: '17:44', type: '服药', title: '连花清瘟颗粒', desc: '温水冲服', kind: 'none', active: true, from: '', to: '', deleted: false },
  { id: 'base-38', section: '睡前', time: '21:17', type: '服药', title: '阿托伐他汀钙片', desc: '', kind: 'none', active: false, from: '', to: '', deleted: false },
] };
const oldDays = {
  '2026-09-10': { items: [
    { id: 'base-0', done: true, skipped: false, removed: false, values: { glucose: '6.6' } },
    { id: 'base-7', done: true, skipped: false, removed: false, values: {} },
    { id: 'base-19', done: false, skipped: true, removed: false, values: {} },
    { id: 'base-30', done: false, skipped: false, removed: false, values: {} },
  ], notified: [] },
  '2026-09-11': { items: [
    { id: 'base-0', done: true, skipped: false, removed: false, values: { glucose: '5.9' } },
  ], notified: [] },
};
mem.set('hospitalChecklistPlan_v1', JSON.stringify(oldPlan));
mem.set('hospitalDailyChecklist_v1', JSON.stringify(oldDays));

const mig = migrateFromV2();
eq(mig.defs.length, 3, '5 条旧条目 → 3 个定义（连花清瘟三条合一）');
const m1 = mig.defs.find(d => d.name === '连花清瘟颗粒');
eq(timesOf(m1), ['09:10', '13:15', '17:44'], '合并后节奏含三个时刻');
const statin = mig.defs.find(d => d.name.includes('他汀'));
eq(statin.active, false, '旧版停用状态带过来了');
eq(mig.count, 6, '迁出 6 条事件（3 次打勾 + 1 次跳过 + 2 个血糖值）');

const s3 = new Store();
s3.init(mig.defs);
for (const [m, list] of Object.entries(mig.events)) { s3.events(m).push(...list); s3.dirtyMonths.add(m); }
s3.flush();

const f10 = fold(s3.eventsOn('2026-09-10'));
eq(f10.value(m1 ? 'd-01' : 'x', 0, 'glucose'), '6.6', '9/10 的血糖搬过来了');
eq(f10.status(m1.id, 0), 'done', '9/10 连花清瘟第 1 次 = 完成');
eq(f10.status(m1.id, 1), 'skip', '9/10 连花清瘟第 2 次 = 跳过（槽位没错位）');
eq(f10.status(m1.id, 2), 'none', '9/10 连花清瘟第 3 次 = 未处理');

const occ = occurrencesOn(s3.defs, '2026-09-10');
eq(occ.length, 4, '迁移后当天展开成 4 个时刻（他汀本来就停用，不计）');

console.log('\n[停用一次管全天多次]');
m1.active = false;
eq(occurrencesOn(s3.defs, '2026-09-12').length, 1, '停掉连花清瘟一次，当天从 4 个时刻降到 1 个');

console.log('\n' + (fail ? `✗ ${fail} 项未通过` : '✓ 全部通过'));
process.exit(fail ? 1 : 0);
