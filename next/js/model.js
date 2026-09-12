/* 数据模型：定义(def) + 事件(event)
 *
 * 定义 = 一种药/一项测量是什么、按什么节奏做。长期存在，可编辑。
 * 事件 = 某天某个时刻被打勾 / 跳过 / 填了什么数。只追加，不修改。
 * 今天的清单 = 定义按日期展开 + 当天事件折叠出状态。
 */

export const SCHEMA_V = 3;

/* ---------- 日期 ---------- */
export const pad = n => String(n).padStart(2, '0');
export const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = k => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const monthOf = k => k.slice(0, 7);
export const addDays = (k, n) => {
  const d = parseDate(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
export const daysBetween = (a, b) =>
  Math.round((parseDate(b) - parseDate(a)) / 86400000);
export const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);

/* ---------- 分区：从时间推导，不再手工标 ---------- */
const BANDS = [
  ['清晨', 0, 480], ['上午', 480, 690], ['中午', 690, 840],
  ['下午', 840, 990], ['傍晚', 990, 1200], ['睡前', 1200, 1441],
];
export const SECTION_ORDER = BANDS.map(b => b[0]);
export const sectionOf = t => {
  const m = toMin(t);
  return (BANDS.find(([, a, b]) => m >= a && m < b) || BANDS[5])[0];
};

/* ---------- 节奏 ---------- */
export const RHYTHMS = {
  daily: '每天',
  everyN: '隔天/每 N 天',
  weekly: '每周',
  monthly: '每月',
  once: '只做一次',
};

export function timesOf(def) {
  const r = def.rhythm || {};
  if (r.kind === 'once') return [r.time || '09:00'];
  return r.times && r.times.length ? r.times : ['08:00'];
}

export function occursOn(def, dk) {
  if (!def.active) return false;
  if (def.from && dk < def.from) return false;
  if (def.to && dk > def.to) return false;
  const r = def.rhythm || { kind: 'daily' };
  switch (r.kind) {
    case 'once': return r.date === dk;
    case 'everyN': {
      const base = r.anchor || def.from || dk;
      const n = Math.max(1, r.n || 2);
      return ((daysBetween(base, dk) % n) + n) % n === 0;
    }
    case 'weekly': return (r.weekdays || []).includes(parseDate(dk).getDay());
    case 'monthly': return parseDate(dk).getDate() === (r.dayOfMonth || 1);
    case 'daily':
    default: return true;
  }
}

/** 某天该做的所有「时刻」，按时间排序 */
export function occurrencesOn(defs, dk) {
  const out = [];
  defs.forEach(def => {
    if (!occursOn(def, dk)) return;
    timesOf(def).forEach((t, slot) => {
      out.push({ key: def.id + '#' + slot, defId: def.id, def, slot, time: t, date: dk });
    });
  });
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.defId.localeCompare(b.defId));
}

/* ---------- 事件折叠 ---------- */
export const evId = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

export const mkStatus = (defId, date, slot, v) =>
  ({ id: evId(), defId, date, slot, k: 'st', v, at: Date.now() });
export const mkValue = (defId, date, slot, f, v) =>
  ({ id: evId(), defId, date, slot, k: 'val', f, v, at: Date.now() });

/** 把一堆事件折叠成「当前状态」。同一目标取 at 最大的那条。 */
export function fold(events) {
  const st = new Map(), val = new Map();
  for (const e of events) {
    const base = e.defId + '#' + e.slot;
    if (e.k === 'st') {
      const p = st.get(base);
      if (!p || e.at > p.at) st.set(base, e);
    } else if (e.k === 'val') {
      const kk = base + '#' + e.f;
      const p = val.get(kk);
      if (!p || e.at > p.at) val.set(kk, e);
    }
  }
  return {
    status: (defId, slot) => (st.get(defId + '#' + slot) || {}).v || 'none',
    value: (defId, slot, f) => {
      const e = val.get(defId + '#' + slot + '#' + f);
      return e ? e.v : '';
    },
    values: (defId, slot) => {
      const o = {}, pre = defId + '#' + slot + '#';
      for (const [kk, e] of val) if (kk.startsWith(pre)) o[e.f] = e.v;
      return o;
    },
  };
}

/* ---------- 测量字段 ---------- */
export const MEASURES = {
  none: { label: '不记录', fields: [] },
  temp: { label: '体温', fields: [['temp', '体温 ℃', 'decimal']] },
  glucose: { label: '血糖', fields: [['glucose', '血糖 mmol/L', 'decimal']] },
  spo2: { label: '血氧', fields: [['spo2', '血氧 %', 'numeric']] },
  bp: {
    label: '血压心率血氧',
    fields: [
      ['sys', '收缩压', 'numeric'], ['dia', '舒张压', 'numeric'],
      ['hr', '心率', 'numeric'], ['spo2', '血氧 %', 'numeric'],
    ],
  },
  meal: { label: '用餐时间', fields: [['mealTime', '第一口时间', 'time']] },
};

/** 异常提示。只提示、不诊断。 */
export function alertFor(measure, values) {
  const n = k => (values[k] === '' || values[k] == null ? null : +values[k]);
  if (measure === 'glucose' && n('glucose') != null) {
    if (n('glucose') < 3.9) return ['danger', '血糖低于 3.9 mmol/L，请立即联系护士'];
    if (n('glucose') > 13.9) return ['warn', '血糖明显偏高，请告知医护'];
  }
  if (measure === 'temp' && n('temp') != null && n('temp') >= 38.5)
    return ['danger', '体温 ≥ 38.5 ℃，请立即联系护士'];
  if ((measure === 'bp' || measure === 'spo2') && n('spo2') != null && n('spo2') < 95)
    return ['warn', '血氧低于 95%，请按医嘱观察并联系医护'];
  if (measure === 'bp' && (n('sys') >= 180 || n('dia') >= 110))
    return ['danger', '血压明显偏高，请联系医护'];
  return null;
}

/* ---------- 依从性 ---------- */
export function adherence(defs, eventsByMonth, fromK, toK) {
  let due = 0, done = 0, skip = 0;
  const missByBand = {};
  for (let k = fromK; k <= toK; k = addDays(k, 1)) {
    const f = fold(eventsByMonth(monthOf(k)).filter(e => e.date === k));
    for (const oc of occurrencesOn(defs, k)) {
      due++;
      const s = f.status(oc.defId, oc.slot);
      if (s === 'done') done++;
      else if (s === 'skip') skip++;
      else {
        const b = sectionOf(oc.time);
        missByBand[b] = (missByBand[b] || 0) + 1;
      }
    }
  }
  return { due, done, skip, missed: due - done - skip, missByBand };
}

/* ---------- 趋势序列 ---------- */
export function seriesFor(defs, eventsByMonth, field, fromK, toK) {
  const pts = [];
  for (let k = fromK; k <= toK; k = addDays(k, 1)) {
    const evs = eventsByMonth(monthOf(k)).filter(e => e.date === k);
    const f = fold(evs);
    for (const oc of occurrencesOn(defs, k)) {
      const v = f.value(oc.defId, oc.slot, field);
      if (v === '' || v == null) continue;
      const num = +v;
      if (!isFinite(num)) continue;
      pts.push({ date: k, time: oc.time, v: num, label: oc.def.name });
    }
  }
  return pts.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
