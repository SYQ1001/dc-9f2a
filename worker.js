/**
 * 住院一日清单 · 同步后端
 *
 * 需要在 Cloudflare 控制台配置：
 *   KV 绑定   变量名 DATA        → 一个 KV 命名空间
 *   机密变量  变量名 FAMILY_KEY  → 家庭口令（越长越好）
 *   普通变量  变量名 ALLOW_ORIGIN → https://syq1001.github.io
 *
 * 接口：
 *   GET  /data  →  {rev, data, at}
 *   PUT  /data  ←  {rev, data}   rev 对不上返回 409 和服务端当前内容
 */

const STORE_KEY = 'checklist';

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', ...cors },
  });
}

// 定长比较，避免按字符逐位试探口令
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export default {
  async fetch(req, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type,x-family-key',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (url.pathname !== '/data') return json({ error: '没有这个接口' }, 404, cors);

    if (!env.FAMILY_KEY) return json({ error: '服务端还没设置 FAMILY_KEY' }, 500, cors);
    if (!sameSecret(req.headers.get('x-family-key') || '', env.FAMILY_KEY)) {
      return json({ error: '口令不对' }, 401, cors);
    }

    if (req.method === 'GET') {
      const raw = await env.DATA.get(STORE_KEY);
      return json(raw ? JSON.parse(raw) : { rev: 0, data: null, at: null }, 200, cors);
    }

    if (req.method === 'PUT') {
      let body;
      try { body = await req.json() } catch (e) { return json({ error: '不是合法 JSON' }, 400, cors) }
      if (!body || typeof body.rev !== 'number' || !body.data) {
        return json({ error: '缺少 rev 或 data' }, 400, cors);
      }
      const raw = await env.DATA.get(STORE_KEY);
      const cur = raw ? JSON.parse(raw) : { rev: 0, data: null, at: null };
      if (body.rev !== cur.rev) {
        // 别人先写了。把服务端当前内容回给客户端，让它合并后重试
        return json({ conflict: true, ...cur }, 409, cors);
      }
      const next = { rev: cur.rev + 1, data: body.data, at: new Date().toISOString() };
      await env.DATA.put(STORE_KEY, JSON.stringify(next));
      return json({ rev: next.rev, at: next.at }, 200, cors);
    }

    return json({ error: '不支持的方法' }, 405, cors);
  },
};
