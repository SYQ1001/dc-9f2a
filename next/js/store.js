/* 存储层
 *
 * 定义存一份；事件按月分片，一个月一个键。
 * 这样长期使用时只加载最近几个月，同步也只推有变动的月份。
 */

import {
  SCHEMA_V, dateKey, monthOf, evId, sectionOf, timesOf,
} from './model.js';

const K = {
  meta: 'care.v3.meta',
  defs: 'care.v3.defs',
  ev: m => 'care.v3.ev.' + m,
};
// 旧版（当前线上那版）的键，只读，用来一次性迁移
const OLD = {
  plan: 'hospitalChecklistPlan_v1',
  days: 'hospitalDailyChecklist_v1',
};

const read = (k, d) => {
  try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; }
  catch (e) { return d; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { return false; }
};

export class Store {
  constructor() {
    this.meta = read(K.meta, null);
    this.defs = read(K.defs, null);
    this.months = new Map();      // '2026-09' -> [event]
    this.dirtyMonths = new Set();
    this.onFull = null;           // 存储写满时的回调
  }

  get initialized() { return !!this.meta && Array.isArray(this.defs); }

  init(seedDefs) {
    this.meta = { v: SCHEMA_V, createdAt: new Date().toISOString(), templateId: 'default' };
    this.defs = seedDefs;
    this.saveMeta(); this.saveDefs();
  }

  saveMeta() { write(K.meta, this.meta); }
  saveDefs() {
    if (!write(K.defs, this.defs) && this.onFull) this.onFull();
  }

  events(month) {
    if (!this.months.has(month)) this.months.set(month, read(K.ev(month), []));
    return this.months.get(month);
  }
  eventsOn(date) {
    return this.events(monthOf(date)).filter(e => e.date === date);
  }
  append(...evs) {
    for (const e of evs) {
      const m = monthOf(e.date);
      this.events(m).push(e);
      this.dirtyMonths.add(m);
    }
    this.flush();
  }
  flush() {
    for (const m of this.dirtyMonths) {
      if (!write(K.ev(m), this.events(m)) && this.onFull) this.onFull();
    }
    this.dirtyMonths.clear();
  }

  /** 已有事件的月份，新到旧 */
  knownMonths() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('care.v3.ev.')) out.push(k.slice('care.v3.ev.'.length));
    }
    return out.sort().reverse();
  }

  /** 有过记录的日期，新到旧 */
  knownDates() {
    const s = new Set();
    for (const m of this.knownMonths()) for (const e of this.events(m)) s.add(e.date);
    return [...s].sort().reverse();
  }

  export() {
    const ev = {};
    for (const m of this.knownMonths()) ev[m] = this.events(m);
    return { meta: this.meta, defs: this.defs, events: ev };
  }

  import(obj, incomingWins = false) {
    if (!obj || typeof obj !== 'object') throw new Error('不是合法的记录文件');
    if (!Array.isArray(obj.defs) && !obj.events) throw new Error('认不出这个格式');
    if (Array.isArray(obj.defs) && obj.defs.length) {
      const mine = new Map(this.defs.map(d => [d.id, d]));
      for (const d of obj.defs) {
        if (!d.id || !d.name) throw new Error('定义缺 id 或名称');
        if (!mine.has(d.id) || incomingWins) mine.set(d.id, d);
      }
      this.defs = [...mine.values()];
      this.saveDefs();
    }
    let added = 0;
    for (const [m, list] of Object.entries(obj.events || {})) {
      if (!Array.isArray(list)) throw new Error(m + ' 的事件不是数组');
      const seen = new Set(this.events(m).map(e => e.id));
      for (const e of list) {
        if (!e.id || !e.defId || !e.date) throw new Error(m + ' 里有事件缺字段');
        if (seen.has(e.id)) continue;
        this.events(m).push(e); seen.add(e.id); added++;
      }
      this.dirtyMonths.add(m);
    }
    this.flush();
    return added;
  }
}

/* ---------- 从旧版迁移 ---------- */
/** 同名条目合并成一个定义，多个时刻变成它的节奏 */
export function migrateFromV2() {
  const plan = read(OLD.plan, null);
  const days = read(OLD.days, null);
  if (!plan || !Array.isArray(plan.items)) return null;

  const byName = new Map();
  const idMap = new Map();          // 旧 id -> {defId, slot}
  for (const it of plan.items) {
    if (it.deleted) continue;
    const key = it.title.trim();
    if (!byName.has(key)) {
      byName.set(key, {
        id: 'd-' + (byName.size + 1).toString(36).padStart(2, '0'),
        name: key,
        type: it.type || '服药',
        note: it.desc || '',
        measure: it.kind && it.kind !== 'none' ? it.kind : 'none',
        ref: it.ref || '',
        rhythm: { kind: 'daily', times: [] },
        from: it.from || '', to: it.to || '',
        active: it.active !== false,
        leadDays: [],
        _times: [],
      });
    }
    const def = byName.get(key);
    def._times.push({ t: it.time, oldId: it.id });
    if (it.from && !def.from) def.from = it.from;
    if (it.to && !def.to) def.to = it.to;
    if (it.active === false) def.active = def.active && false;
  }

  const defs = [];
  for (const def of byName.values()) {
    def._times.sort((a, b) => a.t.localeCompare(b.t));
    def.rhythm.times = def._times.map(x => x.t);
    def._times.forEach((x, slot) => idMap.set(x.oldId, { defId: def.id, slot }));
    delete def._times;
    defs.push(def);
  }

  const events = {};
  let count = 0;
  if (days && typeof days === 'object') {
    for (const [date, d] of Object.entries(days)) {
      if (!d || !Array.isArray(d.items)) continue;
      const m = monthOf(date);
      events[m] = events[m] || [];
      const at = new Date(date + 'T12:00:00').getTime() || Date.now();
      for (const it of d.items) {
        const hit = idMap.get(it.id);
        if (!hit || it.removed) continue;
        if (it.done) { events[m].push({ id: evId(), defId: hit.defId, date, slot: hit.slot, k: 'st', v: 'done', at }); count++; }
        else if (it.skipped) { events[m].push({ id: evId(), defId: hit.defId, date, slot: hit.slot, k: 'st', v: 'skip', at }); count++; }
        for (const [f, v] of Object.entries(it.values || {})) {
          if (v === '' || v == null) continue;
          events[m].push({ id: evId(), defId: hit.defId, date, slot: hit.slot, k: 'val', f, v: String(v), at });
          count++;
        }
      }
    }
  }

  return {
    defs, events, count,
    merged: [...byName.values ? [] : []],
    report: defs
      .filter(d => timesOf(d).length > 1)
      .map(d => `${d.name} ← ${timesOf(d).length} 条（${timesOf(d).join(' / ')}）`),
  };
}

export { K as STORE_KEYS, OLD as LEGACY_KEYS };
