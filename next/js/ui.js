import {
  dateKey, hhmm, addDays, monthOf, sectionOf, SECTION_ORDER, timesOf,
  occurrencesOn, fold, MEASURES, RHYTHMS, alertFor, adherence, seriesFor,
  mkStatus, mkValue, parseDate, daysBetween,
} from './model.js';

export const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $ = id => document.getElementById(id);
const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export class UI {
  constructor(store) {
    this.store = store;
    this.date = dateKey();
    this.view = 'today';
    this.editing = null;       // 正在编辑的定义 id
    this.trendWindow = 7;
    this.trendField = 'glucose';
    this.openDate = null;
  }

  /* ---------- 通用 ---------- */
  toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
  }
  ask(title, msg, opts) {
    return new Promise(res => {
      const m = $('choiceModal');
      m.querySelector('[data-title]').textContent = title;
      m.querySelector('[data-msg]').textContent = msg;
      const box = m.querySelector('[data-opts]'); box.innerHTML = '';
      for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'pill ' + (o.primary ? 'primary' : 'ghost');
        b.textContent = o.label;
        b.onclick = () => { m.classList.remove('show'); res(o.value); };
        box.appendChild(b);
      }
      m.classList.add('show');
    });
  }

  defById(id) { return this.store.defs.find(d => d.id === id); }

  /* ---------- 今天 ---------- */
  renderToday() {
    const dk = this.date;
    const f = fold(this.store.eventsOn(dk));
    const occ = occurrencesOn(this.store.defs, dk);
    const now = hhmm();
    const isToday = dk === dateKey();

    const d = parseDate(dk);
    $('dateText').textContent =
      `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${WEEK[d.getDay()]}`
      + (isToday ? '' : '（回看）');

    let done = 0, overdue = [];
    for (const oc of occ) {
      const s = f.status(oc.defId, oc.slot);
      if (s === 'done') done++;
      else if (s === 'none' && isToday && oc.time < now) overdue.push(oc);
    }
    $('progressText').textContent = `${done}/${occ.length} 已完成`;
    $('progressBar').style.width = (occ.length ? done / occ.length * 100 : 0) + '%';

    // 过期只作为状态出现，不弹窗、不响声
    const bar = $('overdueBar');
    if (overdue.length) {
      bar.style.display = 'block';
      bar.innerHTML = `有 <b>${overdue.length}</b> 项已过点还没处理 · 点这里看第一条`;
      bar.onclick = () => {
        const el = document.querySelector(`[data-key="${overdue[0].key}"]`);
        el && el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    } else bar.style.display = 'none';

    const next = occ.find(o => f.status(o.defId, o.slot) === 'none' && (!isToday || o.time >= now));
    $('nextTitle').textContent = next ? next.def.name : (occ.length ? '今天已全部处理' : '今天没有安排');
    $('nextTime').textContent = next ? `${next.time} · ${next.def.type}` : '—';
    $('nextBox').onclick = () => {
      if (!next) return;
      const el = document.querySelector(`[data-key="${next.key}"]`);
      el && el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const box = $('todayList'); box.innerHTML = '';
    const groups = new Map();
    for (const oc of occ) {
      const sec = sectionOf(oc.time);
      if (!groups.has(sec)) groups.set(sec, []);
      groups.get(sec).push(oc);
    }
    for (const sec of SECTION_ORDER) {
      const arr = groups.get(sec);
      if (!arr) continue;
      const sd = arr.filter(o => f.status(o.defId, o.slot) === 'done').length;
      const wrap = document.createElement('div');
      wrap.className = 'section';
      wrap.innerHTML = `<div class="section-head"><h2>${esc(sec)}</h2><span>${sd}/${arr.length}</span></div>`;
      for (const oc of arr) wrap.appendChild(this.card(oc, f, isToday, now));
      box.appendChild(wrap);
    }
  }

  card(oc, f, isToday, now) {
    const def = oc.def;
    const st = f.status(oc.defId, oc.slot);
    const values = f.values(oc.defId, oc.slot);
    const over = st === 'none' && isToday && oc.time < now;
    const el = document.createElement('div');
    el.className = 'item' + (st === 'done' ? ' done' : '') + (st === 'skip' ? ' skipped' : '') + (over ? ' overdue' : '');
    el.dataset.key = oc.key;
    el.dataset.defId = oc.defId;
    el.dataset.slot = oc.slot;

    const times = timesOf(def);
    const badges = [];
    if (times.length > 1) badges.push(`<span class="badge">第 ${oc.slot + 1}/${times.length} 次</span>`);
    if (def.confirm) badges.push('<span class="badge check">待确认</span>');
    if (def.to) badges.push(`<span class="badge range">到 ${esc(def.to)} 为止</span>`);
    if (over) badges.push('<span class="badge late">已过点</span>');

    const fields = (MEASURES[def.measure] || MEASURES.none).fields;
    const fieldHtml = fields.length ? `<div class="fields">${fields.map(([k, label, mode]) => `
      <div class="field"><label>${esc(label)}</label>
      <input ${mode === 'time' ? 'type="time"' : `inputmode="${mode}"`} data-f="${k}"
             value="${esc(values[k] || (mode === 'time' ? oc.time : ''))}"></div>`).join('')}</div>` : '';

    const warn = alertFor(def.measure, values);

    el.innerHTML = `<div class="row"><div class="time">${esc(oc.time)}</div><div class="main">
      <div class="meta">${esc(def.type)}${badges.join('')}</div>
      <div class="title">${esc(def.name)}</div>
      ${def.note ? `<div class="desc">${esc(def.note)}</div>` : ''}
      ${def.ref ? `<div class="desc">${esc(def.ref)}</div>` : ''}
      ${fieldHtml}
      ${warn ? `<div class="alert ${warn[0]}">⚠ ${esc(warn[1])}</div>` : ''}
      <div class="actions">
        <button class="pill skip" data-act="skip">${st === 'skip' ? '取消跳过' : '今天跳过'}</button>
        <button class="pill complete" data-act="done">${st === 'done' ? '取消完成' : '标记完成 ✓'}</button>
        <button class="pill" data-act="goto-def">改这条</button>
      </div>
    </div></div>`;
    return el;
  }

  /* ---------- 模版 ---------- */
  renderTemplate() {
    const dk = dateKey();
    const box = $('tplList'); box.innerHTML = '';
    const defs = [...this.store.defs].sort((a, b) =>
      timesOf(a)[0].localeCompare(timesOf(b)[0]));
    const live = defs.filter(d => d.active && (!d.from || d.from <= dk) && (!d.to || d.to >= dk)).length;
    $('tplCount').textContent = `${defs.length} 个事项 · 今天生效 ${live} 个`;

    for (const def of defs) {
      const el = document.createElement('div');
      const running = def.active && (!def.from || def.from <= dk) && (!def.to || def.to >= dk);
      el.className = 'item' + (running ? '' : ' off');
      el.dataset.defId = def.id;
      const times = timesOf(def);
      const r = def.rhythm || {};
      let rhythmTxt = RHYTHMS[r.kind] || '每天';
      if (r.kind === 'everyN') rhythmTxt = `每 ${r.n || 2} 天`;
      if (r.kind === 'weekly') rhythmTxt = '每周 ' + (r.weekdays || []).map(i => WEEK[i].slice(2)).join('、');
      if (r.kind === 'monthly') rhythmTxt = `每月 ${r.dayOfMonth || 1} 号`;
      if (r.kind === 'once') rhythmTxt = `只做一次 · ${r.date || ''}`;

      const tags = [];
      if (!def.active) tags.push('<span class="badge stop">已停用</span>');
      else if (def.from && def.from > dk) tags.push(`<span class="badge range">${esc(def.from)} 起</span>`);
      else if (def.to && def.to < dk) tags.push(`<span class="badge stop">${esc(def.to)} 已结束</span>`);
      else if (def.to) tags.push(`<span class="badge range">到 ${esc(def.to)}</span>`);
      if (def.confirm) tags.push('<span class="badge check">待确认</span>');

      el.innerHTML = `<div class="row"><div class="time">${esc(times[0])}</div><div class="main">
        <div class="meta">${esc(def.type)} · ${esc(rhythmTxt)}${tags.join('')}</div>
        <div class="title">${esc(def.name)}</div>
        <div class="desc">${times.length > 1 ? `每天 ${times.length} 次：${esc(times.join(' / '))}` : ''}${def.note ? (times.length > 1 ? '<br>' : '') + esc(def.note) : ''}</div>
        <div class="actions">
          <button class="pill" data-act="edit">编辑</button>
          ${def.active
          ? '<button class="pill delete" data-act="stop">停用</button>'
          : '<button class="pill complete" data-act="start">启用</button>'}
        </div>
        <div data-editbox>${this.editing === def.id ? this.editForm(def) : ''}</div>
      </div></div>`;
      box.appendChild(el);
    }
  }

  editForm(def) {
    const r = def.rhythm || { kind: 'daily' };
    const times = timesOf(def);
    return `<div class="edit">
      <label>名称</label><input data-e="name" value="${esc(def.name)}">
      <label>类别</label>
      <select data-e="type">${['服药', '测量', '护理', '输液', '进食', '就诊', '其他']
        .map(t => `<option${t === def.type ? ' selected' : ''}>${t}</option>`).join('')}</select>

      <label>节奏</label>
      <select data-e="kind">${Object.entries(RHYTHMS)
        .map(([k, v]) => `<option value="${k}"${k === r.kind ? ' selected' : ''}>${v}</option>`).join('')}</select>

      <div data-rhythm-extra>
        ${r.kind === 'everyN' ? `<label>每几天一次</label><input type="number" min="1" data-e="n" value="${r.n || 2}">` : ''}
        ${r.kind === 'weekly' ? `<label>星期几（0=日，逗号分隔）</label><input data-e="weekdays" value="${(r.weekdays || []).join(',')}">` : ''}
        ${r.kind === 'monthly' ? `<label>每月几号</label><input type="number" min="1" max="31" data-e="dayOfMonth" value="${r.dayOfMonth || 1}">` : ''}
        ${r.kind === 'once' ? `<label>哪一天</label><input type="date" data-e="date" value="${esc(r.date || '')}">` : ''}
      </div>

      <label>${r.kind === 'once' ? '几点' : '每天几点（多次用逗号分隔）'}</label>
      <input data-e="times" value="${esc(times.join(', '))}" placeholder="09:10, 13:15, 17:44">

      <label>记录什么数字</label>
      <select data-e="measure">${Object.entries(MEASURES)
        .map(([k, v]) => `<option value="${k}"${k === def.measure ? ' selected' : ''}>${v.label}</option>`).join('')}</select>

      <label>说明</label><textarea data-e="note" rows="2">${esc(def.note)}</textarea>

      <div class="two">
        <div><label>从哪天开始</label><input type="date" data-e="from" value="${esc(def.from)}"></div>
        <div><label>到哪天为止</label><input type="date" data-e="to" value="${esc(def.to)}"></div>
      </div>
      ${def.type === '就诊' || (def.rhythm || {}).kind === 'once'
        ? `<label>提前几天提醒（逗号分隔，写进日历）</label><input data-e="leadDays" value="${(def.leadDays || []).join(',')}" placeholder="3,1">` : ''}
      <div class="hint">改这里是长期生效的，以后每天都按新的来。已经过去的记录不受影响。</div>
      <div class="actions">
        <button class="pill primary" data-act="save-edit">保存</button>
        <button class="pill ghost" data-act="cancel-edit">取消</button>
        <button class="pill delete" data-act="purge">彻底删除</button>
      </div>
    </div>`;
  }

  readEdit(root) {
    const o = {};
    root.querySelectorAll('[data-e]').forEach(i => o[i.dataset.e] = i.value);
    return o;
  }

  /* ---------- 趋势 ---------- */
  renderTrend() {
    const to = dateKey();
    const from = addDays(to, -(this.trendWindow - 1));
    const ev = m => this.store.events(m);

    document.querySelectorAll('[data-win]').forEach(b =>
      b.classList.toggle('active', +b.dataset.win === this.trendWindow));
    document.querySelectorAll('[data-field]').forEach(b =>
      b.classList.toggle('active', b.dataset.field === this.trendField));

    const conf = {
      glucose: { title: '血糖 mmol/L', lo: 3, hi: 12, refs: [3.9, 10] },
      temp: { title: '体温 ℃', lo: 35.5, hi: 39, refs: [36, 37.2] },
      spo2: { title: '血氧 %', lo: 88, hi: 100, refs: [95] },
      sys: { title: '收缩压 mmHg', lo: 90, hi: 180, refs: [140] },
      dia: { title: '舒张压 mmHg', lo: 50, hi: 110, refs: [90] },
    }[this.trendField];

    const pts = seriesFor(this.store.defs, ev, this.trendField, from, to);
    $('trendTitle').textContent = conf.title;
    this.drawTrend('trendChart', pts, conf, from, to);

    if (pts.length) {
      const vals = pts.map(p => p.v);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      $('trendStat').textContent =
        `${pts.length} 次记录 · 最低 ${Math.min(...vals)} · 最高 ${Math.max(...vals)} · 平均 ${avg.toFixed(1)}`;
    } else {
      $('trendStat').textContent = '这段时间还没有记录';
    }

    const ad = adherence(this.store.defs, ev, from, to);
    const rate = ad.due ? Math.round(ad.done / ad.due * 100) : 0;
    $('adhBar').style.width = rate + '%';
    $('adhText').textContent = `${rate}%（应做 ${ad.due}，完成 ${ad.done}，跳过 ${ad.skip}，漏做 ${ad.missed}）`;
    const worst = Object.entries(ad.missByBand).sort((a, b) => b[1] - a[1]).slice(0, 3);
    $('adhDetail').innerHTML = worst.length
      ? '漏得最多的时段：' + worst.map(([b, n]) => `${esc(b)} ${n} 次`).join('、')
      : '这段时间没有漏做的。';
  }

  drawTrend(id, pts, conf, from, to) {
    const svg = $(id), W = 700, H = 240, P = 38;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (!pts.length) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#7a8490">还没有数据</text>';
      return;
    }
    const span = Math.max(1, daysBetween(from, to));
    const lo = Math.min(conf.lo, ...pts.map(p => p.v));
    const hi = Math.max(conf.hi, ...pts.map(p => p.v));
    const rng = Math.max(1, hi - lo);
    const X = p => P + (W - 2 * P) * (daysBetween(from, p.date) / span);
    const Y = v => H - P - (H - 2 * P) * (v - lo) / rng;

    let h = `<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#ccd2d8"/>`;
    for (const r of conf.refs) {
      h += `<line x1="${P}" y1="${Y(r)}" x2="${W - P}" y2="${Y(r)}" stroke="#d9dde2" stroke-dasharray="5 4"/>`
        + `<text x="${W - P + 2}" y="${Y(r) + 4}" font-size="10" fill="#9aa4ae">${r}</text>`;
    }
    // 按天分组连线，同一天多次测量也按时间顺序
    h += `<polyline fill="none" stroke="currentColor" stroke-width="2.5"
      points="${pts.map(p => X(p) + ',' + Y(p.v)).join(' ')}"/>`;
    for (const p of pts) {
      h += `<circle cx="${X(p)}" cy="${Y(p.v)}" r="3.5" fill="currentColor"/>`;
    }
    // 只标首末和极值，避免长窗口糊成一团
    const marks = new Set([pts[0], pts[pts.length - 1],
      pts.reduce((a, b) => a.v > b.v ? a : b), pts.reduce((a, b) => a.v < b.v ? a : b)]);
    for (const p of marks) {
      h += `<text x="${X(p)}" y="${Y(p.v) - 9}" text-anchor="middle" font-size="11">${p.v}</text>`;
    }
    const step = span > 40 ? 7 : (span > 14 ? 3 : 1);
    for (let i = 0; i <= span; i += step) {
      const k = addDays(from, i);
      h += `<text x="${P + (W - 2 * P) * (i / span)}" y="${H - 12}" text-anchor="middle"
             font-size="10" fill="#788390">${k.slice(5)}</text>`;
    }
    svg.innerHTML = h;
  }

  /* ---------- 记录 ---------- */
  renderHistory() {
    const box = $('historyList');
    const dates = this.store.knownDates();
    if (!dates.length) { box.innerHTML = '<div class="desc">还没有记录。</div>'; return; }
    box.innerHTML = dates.map(k => {
      const f = fold(this.store.eventsOn(k));
      const occ = occurrencesOn(this.store.defs, k);
      const done = occ.filter(o => f.status(o.defId, o.slot) === 'done').length;
      const nums = this.store.eventsOn(k).filter(e => e.k === 'val').length;
      const open = this.openDate === k;
      return `<div class="history-day" data-day="${esc(k)}">
        <strong>${esc(k)}</strong>${k === dateKey() ? '<span class="badge">今天</span>' : ''}
        <div class="desc">${done}/${occ.length} 已完成 · ${nums} 个数字　${open ? '收起 ▴' : '展开 ▾'}</div>
        ${open ? this.dayDetail(k, f, occ) : ''}
        ${open ? `<div class="actions"><button class="pill" data-act="open-day">在「今天」里打开这天</button></div>` : ''}
      </div>`;
    }).join('');
  }

  dayDetail(k, f, occ) {
    if (!occ.length) return '<div class="desc">这天没有安排。</div>';
    const L = { temp: '体温', glucose: '血糖', spo2: '血氧', sys: '收缩压', dia: '舒张压', hr: '心率', mealTime: '第一口' };
    return '<div class="detail">' + occ.map(oc => {
      const st = f.status(oc.defId, oc.slot);
      const vals = Object.entries(f.values(oc.defId, oc.slot))
        .filter(([, v]) => v !== '' && v != null)
        .map(([kk, v]) => `${L[kk] || kk} ${esc(v)}`).join(' · ');
      return `<div class="drow">
        <span class="dt">${esc(oc.time)}</span>
        <span class="dn">${esc(oc.def.name)}${vals ? `<span class="desc">${vals}</span>` : ''}</span>
        <span class="dm ${st}">${st === 'done' ? '✓' : st === 'skip' ? '跳过' : '—'}</span>
      </div>`;
    }).join('') + '</div>';
  }

  renderAll() {
    this.renderToday();
    this.renderTemplate();
    if (this.view === 'trend') this.renderTrend();
    if (this.view === 'history') this.renderHistory();
  }
}
