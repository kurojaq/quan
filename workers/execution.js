/* execution.js — standalone Cloudflare Worker: The Qu'an EXECUTION runtime.
 *
 * This is the backend for the EXECUTION module — the "Execution Runtime" half of
 * the design (the front-end cockpit in js/execution.js is the other half). It is
 * the ONLY place that ever holds a Tradovate access token or talks to Tradovate.
 *
 * Why a separate Worker (not a Pages Function):
 *   • It custodies the broker access token; that must not sit in client JS or on
 *     a publicly-routable surface.
 *   • The activation loop + order lifecycle (Phase 3b) will run in a Durable
 *     Object with alarm()/WebSocket — Pages Functions can't host those. Building
 *     the REST core here first means the DO slots in beside it with no move.
 *
 * ── Reachability ────────────────────────────────────────────────────────────
 *   Route-less (workers_dev = false, no routes). Reachable ONLY through the Pages
 *   Service binding EXECUTION (functions/api/execution.js proxies to it,
 *   operator-gated) — never over the open Internet. Mirrors the BARCHART Worker.
 *
 * ── Auth model — connect from the terminal, no CLI ──────────────────────────
 *   The operator clicks Connect in the cockpit and signs in (env + username +
 *   password, optional API key). Those land here via the `login` action; we
 *   exchange them for a Tradovate access token, cache the TOKEN in KV
 *   (exec:token) with its real expirationTime, and DISCARD the password — it is
 *   never persisted. Subsequent calls reuse the cached token and RENEW it
 *   (/auth/renewaccesstoken) as it nears expiry, so a single sign-in lasts.
 *   When renewal finally fails the cockpit simply prompts to sign in again.
 *
 *   Optional fallback: if TRADOVATE_USER/PASS/… are set as Worker secrets, a
 *   plain `connect` (no login) will use them — handy for an unattended/cron
 *   deployment. The UI path needs none of that.
 *
 * ── DEMO vs LIVE ────────────────────────────────────────────────────────────
 *   The environment is chosen at sign-in (defaulting demo) and stored on the
 *   token record, so every call routes to the right host. `health`/`connect`
 *   echo the active env, and the Pages proxy pre-checks it before any order so a
 *   live route can never slip through unacknowledged. TRADOVATE_ENV is only the
 *   default for the secret-fallback path.
 */

/* ── Tradovate hosts per environment ───────────────────────────────────────── */
const HOSTS = {
  demo: { rest: 'https://demo.tradovateapi.com/v1', md: 'wss://md.tradovateapi.com/v1/websocket', ws: 'wss://demo.tradovateapi.com/v1/websocket' },
  live: { rest: 'https://live.tradovateapi.com/v1', md: 'wss://md.tradovateapi.com/v1/websocket', ws: 'wss://live.tradovateapi.com/v1/websocket' },
};
const normEnv = (v) => (String(v || '').toLowerCase() === 'live' ? 'live' : 'demo');
const defaultEnv = (env) => normEnv(env.TRADOVATE_ENV || 'demo');

/* ── KV keys (shared QUAN_PUBLISH namespace, exec: prefix) ──────────────────── */
const K = {
  token: 'exec:token', // cached { accessToken, mdAccessToken, expirationTime, userId, name, env }
};

const nowMs = () => Date.now();
const TOKEN_SKEW_MS = 5 * 60 * 1000; // renew when within 5 min of expiry

async function readJSON(env, key, fallback) {
  if (!env.QUAN_PUBLISH) return fallback;
  try { const raw = await env.QUAN_PUBLISH.get(key); return raw ? JSON.parse(raw) : fallback; }
  catch (_) { return fallback; }
}
async function writeJSON(env, key, val, ttlSec) {
  if (!env.QUAN_PUBLISH) return;
  try { await env.QUAN_PUBLISH.put(key, JSON.stringify(val), ttlSec ? { expirationTtl: ttlSec } : undefined); }
  catch (_) {}
}

// Optional Worker-secret credentials (unattended fallback). The UI login path
// supplies its own and needs none of these.
function secretCreds(env) {
  if (!env.TRADOVATE_USER || !env.TRADOVATE_PASS) return null;
  return {
    name: env.TRADOVATE_USER,
    password: env.TRADOVATE_PASS,
    appId: env.TRADOVATE_APP_ID || "The Qu'an",
    appVersion: env.TRADOVATE_APP_VERSION || '1.0',
    cid: env.TRADOVATE_CID ? Number(env.TRADOVATE_CID) : undefined,
    sec: env.TRADOVATE_SEC || undefined,
    deviceId: env.TRADOVATE_DEVICE_ID || undefined,
    env: defaultEnv(env),
  };
}

/* ── Token lifecycle ────────────────────────────────────────────────────────
   A token is valid while it exists and is more than TOKEN_SKEW_MS from expiry.
   The env is whatever was chosen at sign-in (stored on the record). */
function tokenValid(rec) {
  if (!rec || !rec.accessToken) return false;
  const exp = Date.parse(rec.expirationTime || '');
  return isFinite(exp) && exp - nowMs() > TOKEN_SKEW_MS;
}

const needsLogin = (msg) => Object.assign(new Error(msg || 'not connected — sign in to Tradovate'), { needsLogin: true, status: 401 });

// Exchange credentials for an access token. `input` is the login form's params
// (env/name/password/appId/appVersion/cid/sec) or a secretCreds() object.
async function authenticate(env, input) {
  const c = input && input.name && input.password ? input : secretCreds(env);
  if (!c || !c.name || !c.password) throw needsLogin();
  const envn = normEnv(c.env || defaultEnv(env));
  const host = HOSTS[envn];
  const payload = {
    name: c.name,
    password: c.password,
    appId: c.appId || env.TRADOVATE_APP_ID || "The Qu'an",
    appVersion: c.appVersion || env.TRADOVATE_APP_VERSION || '1.0',
    cid: c.cid != null && c.cid !== '' ? Number(c.cid) : undefined,
    sec: c.sec || undefined,
    deviceId: c.deviceId || env.TRADOVATE_DEVICE_ID || undefined,
  };
  const res = await fetch(`${host.rest}/auth/accesstokenrequest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (data && data['p-ticket']) {
    const e = new Error(`Tradovate throttled the login — retry in ${data['p-time'] || '?'}s`);
    e.penalty = { ticket: data['p-ticket'], time: data['p-time'], captcha: !!data['p-captcha'] };
    throw e;
  }
  if (!res.ok || !data.accessToken) throw new Error(data.errorText || data.errorMessage || `Tradovate auth failed (${res.status})`);
  const rec = {
    accessToken: data.accessToken,
    mdAccessToken: data.mdAccessToken || null,
    expirationTime: data.expirationTime,
    userId: data.userId,
    name: data.name,
    hasLive: !!data.hasLive,
    env: envn,
    obtained: nowMs(),
  };
  await writeJSON(env, K.token, rec); // token only — the password is never stored
  return rec;
}

async function renew(env, rec) {
  const host = HOSTS[rec.env] || HOSTS[defaultEnv(env)];
  try {
    const res = await fetch(`${host.rest}/auth/renewaccesstoken`, { headers: { Authorization: `Bearer ${rec.accessToken}` } });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.accessToken) {
      const next = { ...rec, accessToken: data.accessToken, mdAccessToken: data.mdAccessToken || rec.mdAccessToken, expirationTime: data.expirationTime, obtained: nowMs() };
      await writeJSON(env, K.token, next);
      return next;
    }
  } catch (_) { /* fall through */ }
  // Renewal failed — try the secret-fallback creds; otherwise the session is over.
  const fb = secretCreds(env);
  if (fb) return authenticate(env, fb);
  throw needsLogin('session expired — sign in to Tradovate again');
}

// Return a valid token, renewing/minting as needed. Throws needsLogin when there
// is no session and no secret fallback.
async function getToken(env, force) {
  const rec = await readJSON(env, K.token, null);
  if (!force && tokenValid(rec)) return rec;
  if (rec && rec.accessToken) return renew(env, rec);
  return authenticate(env); // secret fallback, or throws needsLogin
}

/* ── Tradovate REST helper (one re-auth retry on 401) ──────────────────────── */
async function tv(env, path, { method = 'GET', body, _retried } = {}) {
  const rec = await getToken(env);
  const host = HOSTS[rec.env] || HOSTS[defaultEnv(env)];
  const res = await fetch(`${host.rest}${path}`, {
    method,
    headers: { Authorization: `Bearer ${rec.accessToken}`, ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
    body: method !== 'GET' && body != null ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !_retried) { await getToken(env, true); return tv(env, path, { method, body, _retried: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errorText || data.errorMessage || `Tradovate ${method} ${path} → ${res.status}`);
  return data;
}

/* ── Higher-level operations the cockpit calls ─────────────────────────────── */

// Identity + accounts (with balances) in one round-trip for the status bar.
function sessionPayload(rec, accounts) {
  return { connected: true, env: rec.env, userId: rec.userId, name: rec.name, hasLive: !!rec.hasLive, expirationTime: rec.expirationTime, accounts };
}

// Sign in with credentials from the cockpit's Connect popover.
async function login(env, params) {
  const rec = await authenticate(env, {
    env: params.env, name: params.name, password: params.password,
    appId: params.appId, appVersion: params.appVersion, cid: params.cid, sec: params.sec, deviceId: params.deviceId,
  });
  return sessionPayload(rec, await accountsWithBalances(env));
}

// Reuse an existing session (or the secret fallback). If neither exists, report
// needsLogin rather than throwing — the cockpit shows the Connect popover.
async function connect(env) {
  let rec;
  try { rec = await getToken(env); }
  catch (e) { if (e.needsLogin) return { connected: false, needsLogin: true, env: defaultEnv(env) }; throw e; }
  return sessionPayload(rec, await accountsWithBalances(env));
}

async function logout(env) {
  if (env.QUAN_PUBLISH) { try { await env.QUAN_PUBLISH.delete(K.token); } catch (_) {} }
  return { connected: false, env: defaultEnv(env) };
}

async function accountsWithBalances(env) {
  const list = await tv(env, '/account/list');
  const accounts = Array.isArray(list) ? list : [];
  const out = [];
  for (const a of accounts) {
    let balance = null;
    try {
      const snap = await tv(env, '/cashBalance/getcashbalancesnapshot', { method: 'POST', body: { accountId: a.id } });
      balance = snap && (snap.totalCashValue != null ? snap.totalCashValue : snap.amount);
    } catch (_) {}
    out.push({ id: a.id, name: a.name, nickname: a.nickname || null, accountType: a.accountType, active: a.active, legalStatus: a.legalStatus, balance });
  }
  return out;
}

async function placeOrder(env, p) {
  const orderType = p.orderType || 'Limit';
  const body = {
    accountId: Number(p.accountId),
    accountSpec: p.accountSpec || undefined,
    action: p.action,
    symbol: p.symbol,
    orderQty: Number(p.orderQty),
    orderType,
    price: (orderType === 'Limit' || orderType === 'StopLimit') && p.price != null ? Number(p.price) : undefined,
    stopPrice: (orderType === 'Stop' || orderType === 'StopLimit') && p.stopPrice != null ? Number(p.stopPrice) : undefined,
    timeInForce: p.timeInForce || 'Day',
    isAutomated: true,
  };
  const data = await tv(env, '/order/placeorder', { method: 'POST', body });
  if (data && data.failureReason) throw new Error(`${data.failureReason}: ${data.failureText || ''}`.trim());
  return data;
}

async function placeBracket(env, p) {
  const entryType = p.orderType || 'Limit';
  const body = {
    accountId: Number(p.accountId),
    accountSpec: p.accountSpec || undefined,
    action: p.action,
    symbol: p.symbol,
    orderQty: Number(p.orderQty),
    orderType: entryType,
    price: (entryType === 'Limit' || entryType === 'StopLimit') && p.price != null ? Number(p.price) : undefined,
    stopPrice: (entryType === 'Stop' || entryType === 'StopLimit') && p.stopPrice != null ? Number(p.stopPrice) : undefined,
    timeInForce: p.timeInForce || 'Day',
    isAutomated: true,
    bracket1: p.stopLoss != null ? { action: opposite(p.action), orderType: 'Stop', stopPrice: Number(p.stopLoss) } : undefined,
    bracket2: p.takeProfit != null ? { action: opposite(p.action), orderType: 'Limit', price: Number(p.takeProfit) } : undefined,
  };
  const data = await tv(env, '/order/placeOSO', { method: 'POST', body });
  if (data && data.failureReason) throw new Error(`${data.failureReason}: ${data.failureText || ''}`.trim());
  return data;
}
const opposite = (a) => (String(a).toLowerCase() === 'buy' ? 'Sell' : 'Buy');

async function cancelOrder(env, orderId) { return tv(env, '/order/cancelorder', { method: 'POST', body: { orderId: Number(orderId) } }); }
async function modifyOrder(env, p) {
  const body = { orderId: Number(p.orderId) };
  if (p.orderQty != null) body.orderQty = Number(p.orderQty);
  if (p.price != null) body.price = Number(p.price);
  if (p.stopPrice != null) body.stopPrice = Number(p.stopPrice);
  return tv(env, '/order/modifyorder', { method: 'POST', body });
}

async function book(env) {
  const [orders, positions, fills] = await Promise.all([
    tv(env, '/order/list').catch(() => []),
    tv(env, '/position/list').catch(() => []),
    tv(env, '/fill/list').catch(() => []),
  ]);
  const rec = await readJSON(env, K.token, null);
  return { env: (rec && rec.env) || defaultEnv(env), orders, positions, fills };
}

async function health(env) {
  const rec = await readJSON(env, K.token, null);
  const connected = tokenValid(rec);
  return { ok: true, env: (rec && rec.env) || defaultEnv(env), connected, needsLogin: !connected && !secretCreds(env) };
}

/* ── Action dispatch (called by the Pages proxy over the service binding) ───── */
async function dispatch(env, action, params) {
  switch (action) {
    case 'health': return health(env);
    case 'login': return login(env, params);
    case 'logout': return logout(env);
    case 'connect': return connect(env);
    case 'accounts': return { env: (await readJSON(env, K.token, {})).env || defaultEnv(env), accounts: await accountsWithBalances(env) };
    case 'book': return book(env);
    case 'placeorder': return placeOrder(env, params);
    case 'bracket': return placeBracket(env, params);
    case 'cancelorder': return cancelOrder(env, params.orderId);
    case 'modifyorder': return modifyOrder(env, params);
    default: throw Object.assign(new Error(`unknown action "${action}"`), { status: 400 });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 3b — Temporal Order Activator (Durable Object).

   The cockpit's pending queue is a launch queue: orders staged here are DORMANT
   until their activation conditions qualify, at which point they route to the
   broker — and, crucially, that evaluation runs SERVER-SIDE on a Durable Object
   alarm() every ~5s, so a staged order fires even with the browser closed.

   What can be evaluated headless vs. from a pushed snapshot:
     • clock (ET) and CME session-fraction  → computed natively here (Intl), fully
       headless. These are the "browser can be closed" conditions.
     • price                                → polled from a market-data source when
       the order carries a quoteSymbol; else the terminal's last pushed price.
     • detector / field / chronometer state → the terminal pushes a snapshot while
       open (pushState); evaluated against the most recent one.

   MARKET-DATA SOURCE IS PLUGGABLE. getPrice() is the single seam: today it polls a
   quote feed / uses the pushed price. When the proprietary Tick Engine lands (its
   own blueprint), this becomes a subscription to the tick stream and NOTHING else
   in the activation engine changes — same lifecycle, same audit, same state
   machine. That is the whole point of isolating it here.
   ═══════════════════════════════════════════════════════════════════════════ */

const TERMINAL = new Set(['filled', 'rejected', 'cancelled']);
const MAX_PENDING = 100;
const ALARM_MS = 5000;

// ET wall-clock parts (DST-correct via the platform's tz database).
function etParts(d) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday };
}
// CME-style session fraction: 18:00 ET → 17:00 ET next day (23h span). Matches the
// terminal's session model; used only when no fresh pushed sessionT is available.
function cmeSessionFrac(d) {
  const { hour, minute } = etParts(d);
  const et = hour * 60 + minute;
  const since18 = (et - 18 * 60 + 1440) % 1440; // minutes since 18:00 ET
  const span = 23 * 60;
  if (since18 > span) return 1; // 17:00–18:00 ET maintenance window
  return Math.max(0, Math.min(1, since18 / span));
}
const hhmmToMin = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// Yahoo last price — the interim market-data source (see getPrice seam above).
async function fetchQuote(symbol) {
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  for (const h of hosts) {
    try {
      const r = await fetch(`${h}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d = await r.json().catch(() => ({}));
      const m = d && d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta;
      if (m && m.regularMarketPrice != null) return Number(m.regularMarketPrice);
    } catch (_) {}
  }
  return null;
}

// Poll a single order's broker status to advance the lifecycle after routing.
async function pollOrderStatus(env, orderId) {
  if (orderId == null) return null;
  try { const o = await tv(env, `/order/item?id=${Number(orderId)}`); return o && (o.ordStatus || o.status) ? String(o.ordStatus || o.status) : null; }
  catch (_) { return null; }
}
function mapBrokerStatus(st) {
  if (/fill/i.test(st)) return 'filled';
  if (/reject/i.test(st)) return 'rejected';
  if (/cancel|expired/i.test(st)) return 'cancelled';
  if (/work|accept|new|pending/i.test(st)) return 'working';
  return null;
}

// A condition is one clause; an order qualifies when EVERY clause holds (AND).
function condTrue(c, ctx) {
  const v = c.value;
  switch (c.type) {
    case 'clockAfter': { const m = hhmmToMin(v); return ctx.etMin != null && m != null && ctx.etMin >= m; }
    case 'clockBefore': { const m = hhmmToMin(v); return ctx.etMin != null && m != null && ctx.etMin <= m; }
    case 'sessionAbove': return ctx.sessionFrac != null && ctx.sessionFrac >= Number(v);
    case 'sessionBelow': return ctx.sessionFrac != null && ctx.sessionFrac <= Number(v);
    case 'priceAbove': return ctx.price != null && ctx.price >= Number(v);
    case 'priceBelow': return ctx.price != null && ctx.price <= Number(v);
    case 'priceInside': return ctx.price != null && Array.isArray(v) && ctx.price >= Math.min(v[0], v[1]) && ctx.price <= Math.max(v[0], v[1]);
    case 'detectorIs': return ctx.detector != null && ctx.detector.toLowerCase().indexOf(String(v).toLowerCase()) >= 0;
    default: return false;
  }
}
const condLabel = (c) => {
  const map = { clockAfter: 'clock ≥', clockBefore: 'clock ≤', sessionAbove: 'session ≥', sessionBelow: 'session ≤', priceAbove: 'price ≥', priceBelow: 'price ≤', priceInside: 'price ∈', detectorIs: 'detector ∋' };
  return (map[c.type] || c.type) + ' ' + (Array.isArray(c.value) ? c.value.join('–') : c.value);
};

const doJson = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export class ExecutionEngine {
  constructor(state, env) { this.state = state; this.env = env; }
  async _get(k, f) { const v = await this.state.storage.get(k); return v === undefined ? f : v; }
  async _put(k, v) { await this.state.storage.put(k, v); }

  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    try { return doJson({ ok: true, result: await this.op(body.action, body.params || {}) }); }
    catch (e) { return doJson({ error: e.message, needsLogin: !!e.needsLogin }, e.status || 502); }
  }
  async op(action, p) {
    switch (action) {
      case 'stage': return this.stage(p);
      case 'listPending': return this.list();
      case 'cancelPending': return this.cancel(p.id);
      case 'arm': return this.setArmed(p.id, true);
      case 'disarm': return this.setArmed(p.id, false);
      case 'pushState': return this.pushState(p);
      case 'clearTerminal': return this.clearTerminal();
      default: throw Object.assign(new Error(`unknown DO action "${action}"`), { status: 400 });
    }
  }

  async list() {
    const pending = await this._get('pending', []);
    const snapshot = await this._get('snapshot', null);
    return { pending, snapshot, serverTime: Date.now() };
  }
  async pushState(p) {
    await this._put('snapshot', { sessionT: p.sessionT != null ? Number(p.sessionT) : null, date: p.date || null, detector: p.detector || null, price: p.price != null ? Number(p.price) : null, ts: Date.now() });
    return { ok: true };
  }
  async stage(p) {
    const t = p.ticket || {};
    if (!t.symbol || !(Number(t.orderQty) > 0)) throw Object.assign(new Error('ticket needs symbol + qty'), { status: 400 });
    const pending = await this._get('pending', []);
    if (pending.length >= MAX_PENDING) throw Object.assign(new Error('pending queue full'), { status: 400 });
    const now = Date.now();
    const order = {
      id: 'o' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      ticket: t,
      conditions: Array.isArray(p.conditions) ? p.conditions : [],
      quoteSymbol: p.quoteSymbol || null,
      armed: !!p.armed,
      status: p.armed ? 'armed' : 'staged',
      orderId: null, note: '',
      createdTs: now, updatedTs: now,
      audit: [{ ts: now, to: p.armed ? 'armed' : 'staged', note: 'staged' }],
    };
    pending.push(order);
    await this._put('pending', pending);
    if (order.armed) await this.ensureAlarm();
    return order;
  }
  async setArmed(id, armed) {
    const pending = await this._get('pending', []);
    const o = pending.find((x) => x.id === id);
    if (!o) throw Object.assign(new Error('not found'), { status: 404 });
    if (TERMINAL.has(o.status)) throw Object.assign(new Error('order is terminal'), { status: 400 });
    o.armed = armed; this._transition(o, armed ? 'armed' : 'staged', armed ? 'armed' : 'disarmed');
    await this._put('pending', pending);
    if (armed) await this.ensureAlarm();
    return o;
  }
  async cancel(id) {
    const pending = await this._get('pending', []);
    const o = pending.find((x) => x.id === id);
    if (!o) throw Object.assign(new Error('not found'), { status: 404 });
    // If it has already routed, cancel at the broker too.
    if (o.orderId != null && (o.status === 'sent' || o.status === 'working')) { try { await cancelOrder(this.env, o.orderId); } catch (_) {} }
    o.armed = false; this._transition(o, 'cancelled', 'cancelled by operator');
    await this._put('pending', pending);
    return o;
  }
  async clearTerminal() {
    let pending = await this._get('pending', []);
    pending = pending.filter((o) => !TERMINAL.has(o.status));
    await this._put('pending', pending);
    return { ok: true, remaining: pending.length };
  }

  _transition(o, to, note) {
    o.status = to; o.updatedTs = Date.now(); o.note = note || o.note;
    o.audit = (o.audit || []).concat([{ ts: o.updatedTs, to, note }]).slice(-40);
  }

  // Single market-data seam (see header). Returns a price or null.
  async getPrice(order, snapshot, cache) {
    if (order.quoteSymbol) {
      if (!(order.quoteSymbol in cache)) cache[order.quoteSymbol] = await fetchQuote(order.quoteSymbol);
      if (cache[order.quoteSymbol] != null) return cache[order.quoteSymbol];
    }
    if (snapshot && Date.now() - snapshot.ts < 90000 && snapshot.price != null) return snapshot.price;
    return null;
  }

  async ensureAlarm() { if ((await this.state.storage.getAlarm()) == null) await this.state.storage.setAlarm(Date.now() + ALARM_MS); }

  async alarm() {
    const pending = await this._get('pending', []);
    const snapshot = await this._get('snapshot', null);
    const now = Date.now();
    const fresh = snapshot && now - snapshot.ts < 90000;
    const base = { etMin: (() => { const p = etParts(new Date(now)); return p.hour * 60 + p.minute; })(),
      sessionFrac: (fresh && snapshot.sessionT != null) ? snapshot.sessionT : cmeSessionFrac(new Date(now)),
      detector: (snapshot && now - snapshot.ts < 300000 && snapshot.detector) ? [snapshot.detector.direction, snapshot.detector.bias, snapshot.detector.action].filter(Boolean).join(' ') : null };
    const priceCache = {};
    let alive = false;

    for (const o of pending) {
      if (TERMINAL.has(o.status)) continue;
      // Advance already-routed orders by polling broker status.
      if (o.status === 'sent' || o.status === 'working') {
        alive = true;
        const st = await pollOrderStatus(this.env, o.orderId);
        const mapped = st && mapBrokerStatus(st);
        if (mapped && mapped !== o.status) this._transition(o, mapped, 'broker: ' + st);
        continue;
      }
      if (!o.armed) continue;
      alive = true;
      const price = await this.getPrice(o, snapshot, priceCache);
      const ctx = { etMin: base.etMin, sessionFrac: base.sessionFrac, detector: base.detector, price };
      const qualifies = (o.conditions || []).every((c) => condTrue(c, ctx));
      if (!qualifies) continue;
      this._transition(o, 'qualified', 'conditions met');
      try {
        const res = (o.ticket.bracket && (o.ticket.stopLoss != null || o.ticket.takeProfit != null))
          ? await placeBracket(this.env, o.ticket) : await placeOrder(this.env, o.ticket);
        o.orderId = res && (res.orderId != null ? res.orderId : (res.orderId === 0 ? 0 : null));
        this._transition(o, 'sent', 'routed order ' + (o.orderId != null ? o.orderId : '?'));
      } catch (e) {
        // needsLogin/transient → stay blocked and retry next tick; hard reject → terminal.
        this._transition(o, e.needsLogin ? 'blocked' : 'rejected', 'place failed: ' + e.message);
        if (e.needsLogin) { o.armed = true; alive = true; } // keep trying once reconnected
      }
    }

    await this._put('pending', pending);
    if (alive) await this.state.storage.setAlarm(now + ALARM_MS);
  }
}

// DO-routed actions (the singleton activation engine holds all launch-queue state).
const DO_ACTIONS = new Set(['stage', 'listPending', 'cancelPending', 'arm', 'disarm', 'pushState', 'clearTerminal']);
function execDo(env) { return env.EXEC_DO.get(env.EXEC_DO.idFromName('operator')); }

export default {
  async fetch(request, env) {
    if (env.EXECUTION_KEY) {
      const key = request.headers.get('X-Execution-Key') || '';
      if (key !== env.EXECUTION_KEY) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify(await health(env), null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    const body = await request.json().catch(() => ({}));
    const action = body && body.action;
    if (!action) return new Response(JSON.stringify({ error: 'action required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    // Launch-queue / activation actions live in the Durable Object.
    if (DO_ACTIONS.has(action)) {
      if (!env.EXEC_DO) return new Response(JSON.stringify({ error: 'EXEC_DO durable object not bound' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      return execDo(env).fetch('https://exec.do/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, params: body.params || {} }) });
    }

    try {
      const result = await dispatch(env, action, body.params || {});
      return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      const status = err.status || 502;
      const payload = { error: err.message };
      if (err.needsLogin) payload.needsLogin = true;
      if (err.penalty) payload.penalty = err.penalty;
      return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    }
  },
};
