/* realtime.js — standalone Cloudflare Worker with Durable Objects (Phase 4).
 *
 * Cloudflare *Pages* can't host Durable Objects (they need a Worker + migrations),
 * so real-time lives here, deployed separately. Two DO classes:
 *
 *   PriceRoom  — one instance per Yahoo symbol. Polls the quote ONCE (alarm-driven)
 *                and fans it out over WebSockets to every connected client. Replaces
 *                each browser polling /api/quote itself: one upstream fetch serves
 *                N traders, with sub-second push.
 *
 *   DeskRoom   — one instance per shared "desk" room id. Relays a leader/seat's
 *                instrument / date / anchor / lock changes to the other seats so a
 *                Desk-tier team watches the same field together. (Live price is NOT
 *                relayed here — each seat gets it straight from its own PriceRoom.)
 *
 * Auth: browsers can't set headers on a WebSocket, so the Supabase access token is
 * passed as ?token= and verified here (HS256, same scheme as workers/yahoo-proxy.js).
 * Set SUPABASE_JWT_SECRET (Supabase → Settings → API → JWT Secret); with it unset,
 * every request is rejected, so the endpoint is closed by default.
 *
 * Deploy needs migrations (DO), so use wrangler, not dashboard paste:
 *   npx wrangler deploy -c workers/wrangler-realtime.toml
 * then set the secret:
 *   npx wrangler secret put SUPABASE_JWT_SECRET -c workers/wrangler-realtime.toml
 * Finally put the resulting wss:// URL into js/realtime-config.js.
 */

const PRICE_INTERVAL_MS = 2500;
const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

// ---- Yahoo quote (single latest price) ----------------------------------
async function fetchQuote(symbol) {
  for (const host of YAHOO_HOSTS) {
    try {
      const r = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}`, { headers: YAHOO_HEADERS });
      const data = await r.json().catch(() => ({}));
      const result = data.chart && data.chart.result && data.chart.result[0];
      const meta = result && result.meta;
      if (meta && meta.regularMarketPrice != null) {
        return { price: meta.regularMarketPrice, time: Math.floor(Date.now() / 1000) };
      }
    } catch (_) { /* try next host */ }
  }
  return null;
}

// ---- Supabase JWT verification (HS256) ----------------------------------
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
async function verifyJWT(token, secret) {
  const parts = (token || '').split('.'); if (parts.length !== 3) return null;
  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(parts[2]), data);
  if (!ok) return null;
  let payload; try { payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))); } catch (_) { return null; }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

// ======================= PriceRoom DO ====================================
export class PriceRoom {
  constructor(state, env) { this.state = state; this.env = env; this.sockets = new Set(); this.last = null; }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const symbol = new URL(request.url).searchParams.get('symbol');
    if (symbol) await this.state.storage.put('symbol', symbol);

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    this.sockets.add(server);
    if (this.last) { try { server.send(JSON.stringify(this.last)); } catch (_) {} }
    const drop = () => { this.sockets.delete(server); };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    // kick the polling alarm if it isn't already scheduled
    if ((await this.state.storage.getAlarm()) == null) await this.state.storage.setAlarm(Date.now() + 200);
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    if (this.sockets.size === 0) return;                 // nobody listening → stop (don't reschedule)
    const symbol = await this.state.storage.get('symbol');
    if (symbol) {
      const q = await fetchQuote(symbol);
      if (q) { this.last = { type: 'price', symbol, price: q.price, time: q.time }; this.broadcast(this.last); }
    }
    await this.state.storage.setAlarm(Date.now() + PRICE_INTERVAL_MS);
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.sockets) { try { ws.send(s); } catch (_) { this.sockets.delete(ws); } }
  }
}

// ======================= DeskRoom DO =====================================
export class DeskRoom {
  constructor(state, env) { this.state = state; this.env = env; this.members = new Map(); }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const name = new URL(request.url).searchParams.get('name') || 'seat';

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    this.members.set(server, { name });
    this.broadcast({ type: 'presence', count: this.members.size }, null);

    server.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (!m || typeof m.type !== 'string') return;
      m.from = name;
      this.broadcast(m, server);                          // relay to the OTHER seats
    });
    const bye = () => { this.members.delete(server); this.broadcast({ type: 'presence', count: this.members.size }, null); };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.members.keys()) { if (ws === except) continue; try { ws.send(s); } catch (_) { this.members.delete(ws); } }
  }
}

// ======================= Worker (router + gate) ==========================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('quan realtime ok');

    // verify the Supabase token (query param, since WS can't carry headers)
    const claims = env.SUPABASE_JWT_SECRET ? await verifyJWT(url.searchParams.get('token') || '', env.SUPABASE_JWT_SECRET) : null;
    if (!claims) return new Response('authentication required', { status: 401 });

    if (url.pathname === '/price') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return new Response('symbol required', { status: 400 });
      const id = env.PRICE_ROOM.idFromName(symbol);
      return env.PRICE_ROOM.get(id).fetch(request);
    }
    if (url.pathname === '/desk') {
      const room = url.searchParams.get('room');
      if (!room) return new Response('room required', { status: 400 });
      const id = env.DESK_ROOM.idFromName(room);
      return env.DESK_ROOM.get(id).fetch(request);
    }
    return new Response('not found', { status: 404 });
  }
};
