import {
  dateKey, hhmm, addDays, timesOf, mkStatus, mkValue, fold, occurrencesOn,
} from './model.js';
import { Store, migrateFromV2 } from './store.js';
import { SEED_DEFS } from './seed.js';
import { UI, esc } from './ui.js';
import { buildICS } from './ics.js';

const $ = id => document.getElementById(id);
const store = new Store();
const ui = new UI(store);
window.__care = { store, ui };          // 方便排查问题

store.onFull = () => ui.toast('手机存储写满了，先导出备份再清理');

/* ---------- 启动：没数据就先试着从旧版迁移 ---------- */
let migrationNote = null;
if (!store.initialized) {
  const mig = migrateFromV2();
  if (mig && mig.defs.length) {
    store.init(mig.defs);
    for (const [m, list] of Object.entries(mig.events)) {
      store.events(m).push(...list);
      store.dirtyMonths.add(m);
    }
    store.flush();
    migrationNote = mig;
  } else {
    store.init(JSON.parse(JSON.stringify(SEED_DEFS)));
  }
}

/* ---------- 视图切换 ---------- */
document.querySelectorAll('.tabs button[data-view]').forEach(b => {
  b.onclick = () => {
    ui.view = b.dataset.view;
    document.querySelectorAll('.tabs button[data-view]')
      .forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view')
      .forEach(v => v.classList.toggle('active', v.id === ui.view));
    ui.renderAll();
    scrollTo({ top: 0, behavior: 'smooth' });
  };
});

/* ---------- 今天 ---------- */
$('todayList').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const card = btn.closest('.item');
  const defId = card.dataset.defId, slot = +card.dataset.slot;
  const f = fold(store.eventsOn(ui.date));
  const cur = f.status(defId, slot);
  const act = btn.dataset.act;

  if (act === 'done') store.append(mkStatus(defId, ui.date, slot, cur === 'done' ? 'none' : 'done'));
  else if (act === 'skip') store.append(mkStatus(defId, ui.date, slot, cur === 'skip' ? 'none' : 'skip'));
  else if (act === 'goto-def') {
    ui.editing = defId; ui.view = 'template';
    document.querySelectorAll('.tabs button[data-view]')
      .forEach(x => x.classList.toggle('active', x.dataset.view === 'template'));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'template'));
    ui.renderAll();
    document.querySelector(`#tplList [data-def-id="${defId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  ui.renderToday();
});

$('todayList').addEventListener('change', e => {
  const inp = e.target; if (!inp.dataset.f) return;
  const card = inp.closest('.item');
  store.append(mkValue(card.dataset.defId, ui.date, +card.dataset.slot, inp.dataset.f, inp.value));
  ui.renderToday();
});

$('prevDay').onclick = () => { ui.date = addDays(ui.date, -1); ui.renderToday(); };
$('nextDay').onclick = () => {
  if (ui.date >= dateKey()) return ui.toast('还没到那天');
  ui.date = addDays(ui.date, 1); ui.renderToday();
};
$('todayBtn').onclick = () => { ui.date = dateKey(); ui.renderToday(); };

/* ---------- 模版 ---------- */
$('tplList').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const card = btn.closest('.item');
  const defId = card.dataset.defId;
  const def = ui.defById(defId);
  const act = btn.dataset.act;

  if (act === 'edit') { ui.editing = ui.editing === defId ? null : defId; ui.renderTemplate(); }
  else if (act === 'cancel-edit') { ui.editing = null; ui.renderTemplate(); }
  else if (act === 'stop') {
    const today = occurrencesOn([def], dateKey()).length > 0;
    let alsoToday = false;
    if (today) {
      const r = await ui.ask('停用「' + def.name + '」',
        '明天起不再出现。今天已经排好的怎么办？', [
          { label: '今天也去掉', value: 'both', primary: true },
          { label: '今天保留', value: 'future' },
          { label: '算了', value: 'cancel' },
        ]);
      if (r === 'cancel') return;
      alsoToday = r === 'both';
    }
    def.active = false;
    if (alsoToday) def.to = addDays(dateKey(), -1);
    store.saveDefs(); ui.renderAll();
    ui.toast('已停用');
  }
  else if (act === 'start') {
    def.active = true;
    const dk = dateKey();
    if (def.to && def.to < dk) def.to = '';
    if (def.from && def.from > dk) def.from = '';
    store.saveDefs(); ui.renderAll();
    ui.toast('已启用');
  }
  else if (act === 'purge') {
    if (!confirm('彻底删除「' + def.name + '」？已经记录的历史会保留，但这条以后不再出现。')) return;
    store.defs = store.defs.filter(d => d.id !== defId);
    store.saveDefs(); ui.editing = null; ui.renderAll();
    ui.toast('已删除');
  }
  else if (act === 'save-edit') {
    const v = ui.readEdit(btn.closest('.edit'));
    if (!v.name.trim()) return ui.toast('名称不能为空');
    const times = v.times.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    if (!times.length || times.some(t => !/^\d{1,2}:\d{2}$/.test(t)))
      return ui.toast('时间格式不对，例如 09:10, 13:15');
    const norm = times.map(t => t.padStart(5, '0')).sort();

    def.name = v.name.trim();
    def.type = v.type;
    def.note = (v.note || '').trim();
    def.measure = v.measure;
    def.from = v.from || '';
    def.to = v.to || '';
    def.rhythm = { kind: v.kind, times: norm };
    if (v.kind === 'everyN') def.rhythm.n = Math.max(1, +v.n || 2), def.rhythm.anchor = def.from || dateKey();
    if (v.kind === 'weekly') def.rhythm.weekdays = (v.weekdays || '').split(/[,，\s]+/).map(Number).filter(n => n >= 0 && n <= 6);
    if (v.kind === 'monthly') def.rhythm.dayOfMonth = Math.min(31, Math.max(1, +v.dayOfMonth || 1));
    if (v.kind === 'once') { def.rhythm.date = v.date || dateKey(); def.rhythm.time = norm[0]; }
    if (v.leadDays != null) def.leadDays = v.leadDays.split(/[,，\s]+/).map(Number).filter(n => n > 0);

    store.saveDefs(); ui.editing = null; ui.renderAll();
    ui.toast('已保存，以后每天都按新的来');
    markCalendarStale();
  }
});

$('tplList').addEventListener('change', e => {
  if (e.target.dataset.e !== 'kind') return;      // 换节奏时刷新下面的附加字段
  const card = e.target.closest('.item');
  const def = ui.defById(card.dataset.defId);
  def.rhythm = { ...(def.rhythm || {}), kind: e.target.value };
  ui.renderTemplate();
});

$('addDefBtn').onclick = () => {
  const id = 'c-' + Date.now().toString(36);
  store.defs.push({
    id, name: '新事项', type: '服药', note: '', measure: 'none', ref: '',
    rhythm: { kind: 'daily', times: [hhmm()] },
    from: '', to: '', active: true, confirm: false, leadDays: [],
  });
  store.saveDefs(); ui.editing = id; ui.renderAll();
  document.querySelector(`#tplList [data-def-id="${id}"]`)?.scrollIntoView({ block: 'center' });
};

/* ---------- 趋势 ---------- */
document.querySelectorAll('[data-win]').forEach(b =>
  b.onclick = () => { ui.trendWindow = +b.dataset.win; ui.renderTrend(); });
document.querySelectorAll('[data-field]').forEach(b =>
  b.onclick = () => { ui.trendField = b.dataset.field; ui.renderTrend(); });

/* ---------- 记录 ---------- */
$('historyList').addEventListener('click', e => {
  if (e.target.closest('[data-act="open-day"]')) {
    const k = e.target.closest('[data-day]').dataset.day;
    ui.date = k; ui.view = 'today';
    document.querySelectorAll('.tabs button[data-view]')
      .forEach(x => x.classList.toggle('active', x.dataset.view === 'today'));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'today'));
    ui.renderToday(); scrollTo({ top: 0 });
    return;
  }
  const card = e.target.closest('[data-day]'); if (!card) return;
  ui.openDate = ui.openDate === card.dataset.day ? null : card.dataset.day;
  ui.renderHistory();
});

/* ---------- 日历 ---------- */
const CAL_STALE = 'care.v3.calStale';
function markCalendarStale() {
  localStorage.setItem(CAL_STALE, '1');
  paintCalBar();
}
function paintCalBar() {
  $('calBar').style.display = localStorage.getItem(CAL_STALE) ? 'block' : 'none';
}
$('calBar').onclick = () => $('icsModal').classList.add('show');
$('icsBtn').onclick = () => $('icsModal').classList.add('show');
$('icsClose').onclick = () => $('icsModal').classList.remove('show');
$('icsRun').onclick = () => {
  const types = [...document.querySelectorAll('#icsTypes input:checked')].map(i => i.value);
  const { text, count } = buildICS(store.defs, { types, days: 90 });
  download(new Blob([text], { type: 'text/calendar;charset=utf-8' }), '每日清单.ics');
  localStorage.removeItem(CAL_STALE); paintCalBar();
  $('icsModal').classList.remove('show');
  ui.toast(`已生成 ${count} 条日程，用手机日历打开导入`);
};

/* ---------- 导入导出 ---------- */
$('exportBtn').onclick = () =>
  download(new Blob([JSON.stringify(store.export(), null, 2)], { type: 'application/json' }),
    '每日清单-' + dateKey() + '.json');

$('importBtn').onclick = () => $('importModal').classList.add('show');
$('importClose').onclick = () => $('importModal').classList.remove('show');
$('importRun').onclick = async () => {
  const f = $('importFile').files[0];
  let raw = $('importText').value.trim();
  try {
    if (f) raw = await f.text();
    if (!raw) return ui.toast('请选文件或粘贴内容');
    const n = store.import(JSON.parse(raw), $('importWin').checked);
    $('importModal').classList.remove('show');
    ui.renderAll();
    ui.toast(`已导入 ${n} 条记录`);
  } catch (err) { ui.toast('导入失败：' + err.message); }
};

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- 跨天 ---------- */
setInterval(() => {
  if (ui.date !== dateKey() && ui.date === addDays(dateKey(), -1)) {
    ui.date = dateKey();      // 过了午夜自动翻到新的一天
  }
  if (ui.view === 'today') ui.renderToday();
}, 30000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ui.view === 'today') ui.renderToday();
});

/* ---------- 首屏 ---------- */
paintCalBar();
ui.renderAll();
if (migrationNote) {
  const lines = migrationNote.report;
  ui.ask('已从旧版搬过来',
    `${migrationNote.defs.length} 个事项、${migrationNote.count} 条记录。`
    + (lines.length ? '\n\n合并了同名的多次服用：\n' + lines.join('\n') : ''),
    [{ label: '知道了', value: 1, primary: true }]);
}
