import {
  sectionOf, occursOn, occurrencesOn, timesOf, fold, mkStatus, mkValue,
  addDays, daysBetween, adherence, seriesFor, alertFor, monthOf,
} from '../js/model.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + `  （得到 ${JSON.stringify(a)}）`);

const D = (o) => ({
  id: 'x', name: '药', type: '服药', note: '', measure: 'none', ref: '',
  rhythm: { kind: 'daily', times: ['08:00'] }, from: '', to: '',
  active: true, leadDays: [], ...o,
});

console.log('\n[分区从时间推导]');
eq(sectionOf('06:45'), '清晨', '06:45 → 清晨');
eq(sectionOf('08:00'), '上午', '08:00 → 上午');
eq(sectionOf('12:45'), '中午', '12:45 → 中午');
eq(sectionOf('14:36'), '下午', '14:36 → 下午');
eq(sectionOf('17:17'), '傍晚', '17:17 → 傍晚');
eq(sectionOf('23:00'), '睡前', '23:00 → 睡前');

console.log('\n[一种药一条，一日三次是节奏]');
const lhqw = D({ id: 'd-08', name: '连花清瘟', rhythm: { kind: 'daily', times: ['09:10', '13:15', '17:44'] } });
eq(timesOf(lhqw).length, 3, '一个定义带三个时刻');
eq(occurrencesOn([lhqw], '2026-09-13').length, 3, '当天展开成 3 条');
lhqw.active = false;
eq(occurrencesOn([lhqw], '2026-09-13').length, 0, '停用一次，三次全没了 ← 旧版要点三次');
lhqw.active = true;

console.log('\n[生效日期]');
const s = D({ from: '2026-09-15', to: '2026-09-19' });
ok(!occursOn(s, '2026-09-14'), '没到开始日期不出现');
ok(occursOn(s, '2026-09-15'), '开始当天出现');
ok(occursOn(s, '2026-09-19'), '结束当天仍出现');
ok(!occursOn(s, '2026-09-20'), '过了结束日期消失');

console.log('\n[各种节奏]');
const everyOther = D({ rhythm: { kind: 'everyN', n: 2, anchor: '2026-09-13', times: ['08:00'] } });
ok(occursOn(everyOther, '2026-09-13'), '隔天：基准日做');
ok(!occursOn(everyOther, '2026-09-14'), '隔天：第二天不做');
ok(occursOn(everyOther, '2026-09-15'), '隔天：第三天做');
const weekly = D({ rhythm: { kind: 'weekly', weekdays: [1, 4], times: ['09:00'] } });
ok(occursOn(weekly, '2026-09-14'), '每周一：9/14 是周一');
ok(!occursOn(weekly, '2026-09-15'), '每周一：周二不做');
const monthly = D({ rhythm: { kind: 'monthly', dayOfMonth: 8, times: ['09:00'] } });
ok(occursOn(monthly, '2026-10-08'), '每月 8 号');
ok(!occursOn(monthly, '2026-10-09'), '9 号不做');
const visit = D({ type: '就诊', rhythm: { kind: 'once', date: '2026-10-08', time: '09:00' } });
ok(occursOn(visit, '2026-10-08'), '复诊：当天出现');
ok(!occursOn(visit, '2026-10-09'), '复诊：只出现一次');

console.log('\n[事件折叠：只追加，最后写入的赢]');
const evs = [];
evs.push(mkStatus('d-1', '2026-09-13', 0, 'done'));
let f = fold(evs);
eq(f.status('d-1', 0), 'done', '打勾');
evs.push({ ...mkStatus('d-1', '2026-09-13', 0, 'none'), at: Date.now() + 10 });
f = fold(evs);
eq(f.status('d-1', 0), 'none', '取消打勾（追加一条，不改历史）');
eq(evs.length, 2, '历史事件没被删除');
evs.push(mkValue('d-1', '2026-09-13', 0, 'temp', '37.4'));
evs.push(mkValue('d-1', '2026-09-13', 1, 'temp', '38.9'));
f = fold(evs);
eq(f.value('d-1', 0, 'temp'), '37.4', '第 1 次体温');
eq(f.value('d-1', 1, 'temp'), '38.9', '第 2 次体温（同一定义不同槽位互不干扰）');

console.log('\n[异常提示]');
eq(alertFor('temp', { temp: '38.9' })[0], 'danger', '高热 → 红');
eq(alertFor('temp', { temp: '36.8' }), null, '正常体温 → 无');
eq(alertFor('glucose', { glucose: '3.2' })[0], 'danger', '低血糖 → 红');
eq(alertFor('bp', { spo2: '92' })[0], 'warn', '低血氧 → 黄');

console.log('\n[依从性统计]');
const defs = [D({ id: 'a', rhythm: { kind: 'daily', times: ['08:00', '20:00'] } })];
const store = { '2026-09': [
  mkStatus('a', '2026-09-13', 0, 'done'),
  mkStatus('a', '2026-09-13', 1, 'done'),
  mkStatus('a', '2026-09-14', 0, 'done'),
  mkStatus('a', '2026-09-14', 1, 'skip'),
  // 9/15 两次都没记 → 漏做
] };
const ad = adherence(defs, m => store[m] || [], '2026-09-13', '2026-09-15');
eq(ad.due, 6, '三天 × 每天两次 = 应做 6');
eq(ad.done, 3, '完成 3');
eq(ad.skip, 1, '跳过 1');
eq(ad.missed, 2, '漏做 2');
eq(ad.missByBand['睡前'], 1, '漏的里有 1 次在睡前');

console.log('\n[趋势序列]');
const gd = [D({ id: 'g', measure: 'glucose', rhythm: { kind: 'daily', times: ['06:45'] } })];
const gs = { '2026-09': [
  mkValue('g', '2026-09-13', 0, 'glucose', '6.2'),
  mkValue('g', '2026-09-15', 0, 'glucose', '5.4'),
] };
const pts = seriesFor(gd, m => gs[m] || [], 'glucose', '2026-09-13', '2026-09-15');
eq(pts.length, 2, '跨天取到 2 个点');
eq(pts[0].v, 6.2, '第一个点 6.2');
eq(pts[1].date, '2026-09-15', '按日期排序');

console.log('\n[日期工具]');
eq(addDays('2026-09-30', 1), '2026-10-01', '跨月');
eq(addDays('2026-12-31', 1), '2027-01-01', '跨年');
eq(daysBetween('2026-09-13', '2026-09-20'), 7, '相差 7 天');
eq(monthOf('2026-09-13'), '2026-09', '月份分片键');

console.log('\n' + (fail ? `✗ ${fail} 项未通过` : '✓ 全部通过'));
process.exit(fail ? 1 : 0);
