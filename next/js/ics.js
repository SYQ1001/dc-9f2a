/* 导出到系统日历。
 * 提醒这件事完全交给操作系统 —— 网页在后台会被挂起，靠不住。
 * UID 用定义 id + 槽位，保证重新导入是「覆盖」而不是「又堆一份」。
 */

import { timesOf, addDays, dateKey } from './model.js';

const esc = s => String(s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
  .replace(/,/g, '\\,').replace(/\n/g, '\\n');

const plain = s => s.replace(/-/g, '');

function fold(line) {
  const enc = new TextEncoder();
  let out = '', cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 70) { out += cur + '\r\n '; cur = ''; bytes = 1; }
    cur += ch; bytes += b;
  }
  return out + cur;
}

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function rruleFor(def, untilK) {
  const r = def.rhythm || { kind: 'daily' };
  const until = ';UNTIL=' + plain(untilK) + 'T235959';
  switch (r.kind) {
    case 'once': return null;
    case 'everyN': return 'FREQ=DAILY;INTERVAL=' + Math.max(1, r.n || 2) + until;
    case 'weekly': return 'FREQ=WEEKLY;BYDAY=' + (r.weekdays || []).map(i => WD[i]).join(',') + until;
    case 'monthly': return 'FREQ=MONTHLY;BYMONTHDAY=' + (r.dayOfMonth || 1) + until;
    default: return 'FREQ=DAILY' + until;
  }
}

/**
 * @param defs     定义列表
 * @param opts.types  只导出这些类别（空 = 全部）
 * @param opts.days   没有结束日期时导出多少天，默认 90
 */
export function buildICS(defs, opts = {}) {
  const today = dateKey();
  const horizon = addDays(today, opts.days || 90);
  const types = opts.types && opts.types.length ? new Set(opts.types) : null;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//每日清单//ZH',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + (opts.calName || '每日清单'),
    'X-WR-TIMEZONE:Asia/Shanghai',
  ];

  let n = 0;
  for (const def of defs) {
    if (!def.active) continue;
    if (types && !types.has(def.type)) continue;
    if (def.to && def.to < today) continue;
    const r = def.rhythm || {};
    const times = timesOf(def);

    times.forEach((t, slot) => {
      const [h, m] = t.split(':');
      const start = r.kind === 'once'
        ? (r.date || today)
        : (def.from && def.from > today ? def.from : today);
      const rule = rruleFor(def, def.to || horizon);

      L.push('BEGIN:VEVENT');
      // 稳定 UID：重新导入时覆盖同一条，不会堆重复
      L.push(`UID:${def.id}-s${slot}@care-daily`);
      L.push(`DTSTAMP:${stamp}`);
      L.push(`DTSTART:${plain(start)}T${h}${m}00`);
      L.push('DURATION:PT10M');
      if (rule) L.push('RRULE:' + rule);
      L.push(fold(`SUMMARY:${esc(def.type + ' · ' + def.name)}`));
      if (def.note) L.push(fold(`DESCRIPTION:${esc(def.note)}`));
      // 到点提醒
      L.push('BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY',
        fold(`DESCRIPTION:${esc(def.name)}`), 'END:VALARM');
      // 复诊这类要提前几天（当天才提醒来不及挂号）
      for (const dd of def.leadDays || []) {
        L.push('BEGIN:VALARM', `TRIGGER:-P${dd}D`, 'ACTION:DISPLAY',
          fold(`DESCRIPTION:${esc(def.name + ' 还有 ' + dd + ' 天')}`), 'END:VALARM');
      }
      L.push('END:VEVENT');
      n++;
    });
  }

  L.push('END:VCALENDAR');
  return { text: L.join('\r\n') + '\r\n', count: n };
}
