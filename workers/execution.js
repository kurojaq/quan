/* execution.js — standalone Cloudflare Worker: The Qu'an EXECUTION runtime.
 *
 * This is the backend for the EXECUTION module — the "Execution Runtime" half of
 * the design (the front-end cockpit in js/execution.js is the other half). It is
 * the ONLY place that ever holds a Tradovate access token or talks to Tradovate.
 *
 * Why a separate Worker (not a Pages Function):
 *   • It custodies broker access tokens; those must not sit in client JS or on a
 *     publicly-routable surface.
 *   • The activation loop + order lifecycle run in a Durable Object with
 *     alarm()/storage — Pages Functions can't host those.
 *
 * ── Reachability ────────────────────────────────────────────────────────────
 *   Route-less (workers_dev = false, no routes). Reachable ONLY through the Pages
 *   Service binding EXECUTION (functions/api/execution.js proxies to it), never
 *   over the open Internet.
 *
 * ── MULTI-TENANCY (Prime) ───────────────────────────────────────────────────
 *   Every request arrives with { action, params, uid, role } where the Pages
 *   proxy has already verified the Supabase user + tier. This Worker TRUSTS
 *   uid/role because the internal Service binding is the only caller. It keys ALL
 *   state by uid:
 *     • token  → KV  exec:token:<uid>   (AES-GCM encrypted when EXEC_ENC_KEY is set)
 *     • queue  → Durable Object idFromName('u:'+uid)  (per-user launch queue+alarm)
 *   role ∈ 'operator' | 'subscriber':
 *     • operator   → live allowed; unattended secret-fallback creds allowed.
 *     • subscriber → CLAMPED TO DEMO (connect/route/automation); no secret fallback
 *                    (they must sign into their own Tradovate). This caps the
 *                    liability of automating real money for subscribers at launch.
 *   The single seam for a future per-user "live enabled" flag is userMayGoLive().
 *
 * ── Auth model — connect from the terminal, no CLI ──────────────────────────
 *   The user clicks Connect in the cockpit and signs in (env + username +
 *   password, optional API key). Those land here via `login`; we exchange them
 *   for a Tradovate access token, cache the TOKEN (per-user) with its real
 *   expirationTime, and DISCARD the password. Subsequent calls reuse + RENEW the
 *   token. Optional operator-only fallback: TRADOVATE_USER/PASS/… Worker secrets.
 */

/* ── Tradovate hosts per environment ───────────────────────────────────────── */
const HOSTS = {
  demo: { rest: 'https://demo.tradovateapi.com/v1', md: 'wss://md.tradovateapi.com/v1/websocket', ws: 'wss://demo.tradovateapi.com/v1/websocket' },
  live: { rest: 'https://live.tradovateapi.com/v1', md: 'wss://md.tradovateapi.com/v1/websocket', ws: 'wss://live.tradovateapi.com/v1/websocket' },
};
const normEnv = (v) => (String(v || '').toLowerCase() === 'live' ? 'live' : 'demo');
const defaultEnv = (env) => normEnv(env.TRADOVATE_ENV || 'demo');

// The single authority on whether a caller may touch the LIVE book. Today only
// the operator; a per-user flag can widen this later without touching call sites.
const userMayGoLive = (role) => role === 'operator';

/* ── Per-user token store (shared QUAN_PUBLISH namespace, exec:token: prefix) ──
   Encrypted at rest with AES-GCM when EXEC_ENC_KEY (base64 of 32 bytes) is set;
   plaintext JSON otherwise so a pre-config deploy still works. */
const tokenKey = (uid) => `exec:token:${uid || 'operator'}`;

const nowMs = () => Date.now();
const TOKEN_SKEW_MS = 5 * 60 * 1000; // renew when within 5 min of expiry

function b64ToBytes(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
function bytesToB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }

async function encKey(env) {
  if (!env.EXEC_ENC_KEY) return null;
  try { return await crypto.subtle.importKey('raw', b64ToBytes(env.EXEC_ENC_KEY), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
  catch (_) { return null; }
}
async function encStr(env, plaintext) {
  const key = await encKey(env);
  if (!key) return plaintext;                       // no key → store plaintext (back-compat)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `enc:v1:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(ct))}`;
}
async function decStr(env, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('enc:v1:')) return stored; // plaintext record
  const key = await encKey(env);
  if (!key) return null;                            // encrypted but key gone → unreadable
  try {
    const parts = stored.split(':'); // enc : v1 : iv : ct
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(parts[2]) }, key, b64ToBytes(parts[3]));
    return new TextDecoder().decode(pt);
  } catch (_) { return null; }
}

async function readTokenRec(env, uid) {
  if (!env.QUAN_PUBLISH) return null;
  let raw;
  try { raw = await env.QUAN_PUBLISH.get(tokenKey(uid)); } catch (_) { return null; }
  if (!raw) return null;
  const dec = await decStr(env, raw);
  if (dec == null) return null;
  try { return JSON.parse(dec); } catch (_) { return null; }
}
async function writeTokenRec(env, uid, rec) {
  if (!env.QUAN_PUBLISH) return;
  try { await env.QUAN_PUBLISH.put(tokenKey(uid), await encStr(env, JSON.stringify(rec))); } catch (_) {}
}
async function deleteTokenRec(env, uid) {
  if (!env.QUAN_PUBLISH) return;
  try { await env.QUAN_PUBLISH.delete(tokenKey(uid)); } catch (_) {}
}

// Optional Worker-secret credentials — OPERATOR-ONLY unattended fallback. Never
// offered to a subscriber (that would route them onto the operator's account).
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
   ctx = { env, uid, role } threads identity through every broker call. */
function tokenValid(rec) {
  if (!rec || !rec.accessToken) return false;
  const exp = Date.parse(rec.expirationTime || '');
  return isFinite(exp) && exp - nowMs() > TOKEN_SKEW_MS;
}

const needsLogin = (msg) => Object.assign(new Error(msg || 'not connected — sign in to Tradovate'), { needsLogin: true, status: 401 });

// Exchange credentials for an access token. `input` is the login form's params or
// a secretCreds() object (operator only). Subscribers are clamped to demo.
async function authenticate(ctx, input) {
  const { env, uid, role } = ctx;
  const allowSecret = role === 'operator';
  const c = input && input.name && input.password ? input : (allowSecret ? secretCreds(env) : null);
  if (!c || !c.name || !c.password) throw needsLogin();
  let envn = normEnv(c.env || defaultEnv(env));
  if (!userMayGoLive(role)) envn = 'demo';           // subscribers: demo-only, no matter what they asked for
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
  await writeTokenRec(env, uid, rec); // token only — the password is never stored
  return rec;
}

async function renew(ctx, rec) {
  const { env, uid, role } = ctx;
  const host = HOSTS[rec.env] || HOSTS[defaultEnv(env)];
  try {
    const res = await fetch(`${host.rest}/auth/renewaccesstoken`, { headers: { Authorization: `Bearer ${rec.accessToken}` } });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.accessToken) {
      const next = { ...rec, accessToken: data.accessToken, mdAccessToken: data.mdAccessToken || rec.mdAccessToken, expirationTime: data.expirationTime, obtained: nowMs() };
      await writeTokenRec(env, uid, next);
      return next;
    }
  } catch (_) { /* fall through */ }
  // Renewal failed — operator may fall back to secret creds; a subscriber cannot.
  if (role === 'operator') { const fb = secretCreds(env); if (fb) return authenticate(ctx, fb); }
  throw needsLogin('session expired — sign in to Tradovate again');
}

// Return a valid token, renewing/minting as needed. Throws needsLogin when there
// is no session (and, for the operator, no secret fallback).
async function getToken(ctx, force) {
  const rec = await readTokenRec(ctx.env, ctx.uid);
  if (!force && tokenValid(rec)) return rec;
  if (rec && rec.accessToken) return renew(ctx, rec);
  return authenticate(ctx); // operator: secret fallback, else throws needsLogin
}

/* ── Tradovate REST helper (one re-auth retry on 401) ──────────────────────── */
async function tv(ctx, path, { method = 'GET', body, _retried } = {}) {
  const rec = await getToken(ctx);
  // Defense-in-depth: a subscriber's record must never resolve to the live host.
  if (rec.env === 'live' && !userMayGoLive(ctx.role)) throw new Error('live routing is not permitted for this account');
  const host = HOSTS[rec.env] || HOSTS[defaultEnv(ctx.env)];
  const res = await fetch(`${host.rest}${path}`, {
    method,
    headers: { Authorization: `Bearer ${rec.accessToken}`, ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
    body: method !== 'GET' && body != null ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !_retried) { await getToken(ctx, true); return tv(ctx, path, { method, body, _retried: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errorText || data.errorMessage || `Tradovate ${method} ${path} → ${res.status}`);
  return data;
}

/* ── Higher-level operations the cockpit calls ─────────────────────────────── */

// Identity + accounts (with balances) in one round-trip for the status bar.
// liveAllowed tells the cockpit whether to offer the LIVE env option.
function sessionPayload(ctx, rec, accounts) {
  return { connected: true, env: rec.env, userId: rec.userId, name: rec.name, hasLive: !!rec.hasLive, liveAllowed: userMayGoLive(ctx.role), expirationTime: rec.expirationTime, accounts };
}

// Sign in with credentials from the cockpit's Connect popover.
async function login(ctx, params) {
  const rec = await authenticate(ctx, {
    env: params.env, name: params.name, password: params.password,
    appId: params.appId, appVersion: params.appVersion, cid: params.cid, sec: params.sec, deviceId: params.deviceId,
  });
  return sessionPayload(ctx, rec, await accountsWithBalances(ctx));
}

// Reuse an existing session (or, for the operator, the secret fallback). If
// neither exists, report needsLogin so the cockpit shows the Connect popover.
async function connect(ctx) {
  let rec;
  try { rec = await getToken(ctx); }
  catch (e) { if (e.needsLogin) return { connected: false, needsLogin: true, env: defaultEnv(ctx.env), liveAllowed: userMayGoLive(ctx.role) }; throw e; }
  return sessionPayload(ctx, rec, await accountsWithBalances(ctx));
}

async function logout(ctx) {
  await deleteTokenRec(ctx.env, ctx.uid);
  return { connected: false, env: defaultEnv(ctx.env) };
}

async function accountsWithBalances(ctx) {
  const list = await tv(ctx, '/account/list');
  const accounts = Array.isArray(list) ? list : [];
  const out = [];
  for (const a of accounts) {
    let balance = null;
    try {
      const snap = await tv(ctx, '/cashBalance/getcashbalancesnapshot', { method: 'POST', body: { accountId: a.id } });
      balance = snap && (snap.totalCashValue != null ? snap.totalCashValue : snap.amount);
    } catch (_) {}
    out.push({ id: a.id, name: a.name, nickname: a.nickname || null, accountType: a.accountType, active: a.active, legalStatus: a.legalStatus, balance });
  }
  return out;
}

async function placeOrder(ctx, p) {
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
  const data = await tv(ctx, '/order/placeorder', { method: 'POST', body });
  if (data && data.failureReason) throw new Error(`${data.failureReason}: ${data.failureText || ''}`.trim());
  return data;
}

async function placeBracket(ctx, p) {
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
  const data = await tv(ctx, '/order/placeOSO', { method: 'POST', body });
  if (data && data.failureReason) throw new Error(`${data.failureReason}: ${data.failureText || ''}`.trim());
  return data;
}
const opposite = (a) => (String(a).toLowerCase() === 'buy' ? 'Sell' : 'Buy');

async function cancelOrder(ctx, orderId) { return tv(ctx, '/order/cancelorder', { method: 'POST', body: { orderId: Number(orderId) } }); }
async function modifyOrder(ctx, p) {
  const body = { orderId: Number(p.orderId) };
  if (p.orderQty != null) body.orderQty = Number(p.orderQty);
  if (p.price != null) body.price = Number(p.price);
  if (p.stopPrice != null) body.stopPrice = Number(p.stopPrice);
  return tv(ctx, '/order/modifyorder', { method: 'POST', body });
}

async function book(ctx) {
  const [orders, positions, fills] = await Promise.all([
    tv(ctx, '/order/list').catch(() => []),
    tv(ctx, '/position/list').catch(() => []),
    tv(ctx, '/fill/list').catch(() => []),
  ]);
  const rec = await readTokenRec(ctx.env, ctx.uid);
  return { env: (rec && rec.env) || defaultEnv(ctx.env), orders, positions, fills };
}

async function health(ctx) {
  const rec = await readTokenRec(ctx.env, ctx.uid);
  const connected = tokenValid(rec);
  return {
    ok: true,
    env: (rec && rec.env) || defaultEnv(ctx.env),
    connected,
    liveAllowed: userMayGoLive(ctx.role),
    needsLogin: !connected && !(ctx.role === 'operator' && secretCreds(ctx.env)),
  };
}

/* ── Action dispatch (called by the Pages proxy over the service binding) ───── */
async function dispatch(ctx, action, params) {
  switch (action) {
    case 'health': return health(ctx);
    case 'login': return login(ctx, params);
    case 'logout': return logout(ctx);
    case 'connect': return connect(ctx);
    case 'accounts': { const rec = await readTokenRec(ctx.env, ctx.uid); return { env: (rec && rec.env) || defaultEnv(ctx.env), accounts: await accountsWithBalances(ctx) }; }
    case 'book': return book(ctx);
    case 'placeorder': return placeOrder(ctx, params);
    case 'bracket': return placeBracket(ctx, params);
    case 'cancelorder': return cancelOrder(ctx, params.orderId);
    case 'modifyorder': return modifyOrder(ctx, params);
    default: throw Object.assign(new Error(`unknown action "${action}"`), { status: 400 });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Temporal Order Activator (Durable Object) — PER USER.

   Orders staged here are DORMANT until their activation conditions qualify, at
   which point they route to the broker — evaluated SERVER-SIDE on an alarm()
   every ~5s, so a staged order fires even with the browser closed. Each user has
   their OWN instance (idFromName('u:'+uid)); the DO persists its owner's
   { uid, role } so the detached alarm() routes with that user's token.

   MARKET-DATA SOURCE IS PLUGGABLE via getPrice() — the single seam the Tick
   Engine plugs into later with no other change to the activation engine.
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
async function pollOrderStatus(ctx, orderId) {
  if (orderId == null) return null;
  try { const o = await tv(ctx, `/order/item?id=${Number(orderId)}`); return o && (o.ordStatus || o.status) ? String(o.ordStatus || o.status) : null; }
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

  // The owner's identity, persisted so the detached alarm() can route with it.
  async brokerCtx() {
    const c = await this._get('ctx', { uid: 'operator', role: 'operator' });
    return { env: this.env, uid: c.uid, role: c.role };
  }

  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    // Persist the caller's identity (each DO instance is 1:1 with a uid, so this
    // only ever records this user's own context) for the headless alarm loop.
    // Only real proxy calls carry BOTH uid+role; the scheduled() watchdog pokes
    // with uid only and must NOT overwrite the stored role.
    if (body.uid && body.role) await this._put('ctx', { uid: String(body.uid), role: body.role === 'operator' ? 'operator' : 'subscriber' });
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
      case 'watchdog': return this.watchdog();
      default: throw Object.assign(new Error(`unknown DO action "${action}"`), { status: 400 });
    }
  }

  // Registry of DOs with live orders, so the cron watchdog can find them without
  // enumerating every user. Refreshed whenever an alarm is (re)armed; expires on
  // its own so an idle user drops out.
  async register() {
    try {
      const c = await this._get('ctx', null);
      if (c && c.uid && this.env.QUAN_PUBLISH) await this.env.QUAN_PUBLISH.put('exec:active:' + c.uid, '1', { expirationTtl: 3 * 3600 });
    } catch (_) {}
  }
  async deregister() {
    try {
      const c = await this._get('ctx', null);
      if (c && c.uid && this.env.QUAN_PUBLISH) await this.env.QUAN_PUBLISH.delete('exec:active:' + c.uid);
    } catch (_) {}
  }
  // Cron safety net: if this DO still has live orders but its alarm was somehow
  // dropped, re-arm it; otherwise fall out of the active registry.
  async watchdog() {
    const pending = await this._get('pending', []);
    const alive = pending.some((o) => !TERMINAL.has(o.status) && (o.armed || o.status === 'sent' || o.status === 'working'));
    if (alive) await this.ensureAlarm();
    else await this.deregister();
    return { alive };
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
    // If it has already routed, cancel at the broker too — with the owner's token.
    if (o.orderId != null && (o.status === 'sent' || o.status === 'working')) { try { await cancelOrder(await this.brokerCtx(), o.orderId); } catch (_) {} }
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

  async ensureAlarm() { if ((await this.state.storage.getAlarm()) == null) await this.state.storage.setAlarm(Date.now() + ALARM_MS); await this.register(); }

  async alarm() {
    const pending = await this._get('pending', []);
    const snapshot = await this._get('snapshot', null);
    const bctx = await this.brokerCtx();
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
        const st = await pollOrderStatus(bctx, o.orderId);
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
          ? await placeBracket(bctx, o.ticket) : await placeOrder(bctx, o.ticket);
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

// DO-routed actions (each user's launch queue lives in their own DO instance).
const DO_ACTIONS = new Set(['stage', 'listPending', 'cancelPending', 'arm', 'disarm', 'pushState', 'clearTerminal']);
function execDo(env, uid) { return env.EXEC_DO.get(env.EXEC_DO.idFromName('u:' + (uid || 'operator'))); }

export default {
  async fetch(request, env) {
    if (env.EXECUTION_KEY) {
      const key = request.headers.get('X-Execution-Key') || '';
      if (key !== env.EXECUTION_KEY) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    if (request.method !== 'POST') {
      // Unattended health probe → operator context.
      return new Response(JSON.stringify(await health({ env, uid: 'operator', role: 'operator' }), null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    const body = await request.json().catch(() => ({}));
    const action = body && body.action;
    if (!action) return new Response(JSON.stringify({ error: 'action required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    // Identity from the trusted Pages proxy. No uid → unattended/cron = operator.
    let uid = body.uid, role;
    if (uid == null || uid === '') { uid = 'operator'; role = 'operator'; }
    else { uid = String(uid); role = body.role === 'operator' ? 'operator' : 'subscriber'; }

    // Launch-queue / activation actions live in the per-user Durable Object.
    if (DO_ACTIONS.has(action)) {
      if (!env.EXEC_DO) return new Response(JSON.stringify({ error: 'EXEC_DO durable object not bound' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      return execDo(env, uid).fetch('https://exec.do/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, params: body.params || {}, uid, role }) });
    }

    try {
      const result = await dispatch({ env, uid, role }, action, body.params || {});
      return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      const status = err.status || 502;
      const payload = { error: err.message };
      if (err.needsLogin) payload.needsLogin = true;
      if (err.penalty) payload.penalty = err.penalty;
      return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    }
  },

  // Cron watchdog (every ~10 min per wrangler-execution.toml). Also the deploy
  // TARGET that lets this route-less Worker actually deploy so the EXECUTION
  // service binding resolves. Pokes every user DO that has live orders (via the
  // exec:active: KV registry) so a dropped alarm gets re-armed. Cheap: only
  // active users are listed, and each poke is a no-op when the alarm is healthy.
  async scheduled(event, env) {
    if (!env.EXEC_DO || !env.QUAN_PUBLISH) return;
    try {
      const listing = await env.QUAN_PUBLISH.list({ prefix: 'exec:active:' });
      for (const k of (listing.keys || [])) {
        const uid = k.name.slice('exec:active:'.length);
        try {
          await execDo(env, uid).fetch('https://exec.do/rpc', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'watchdog', params: {}, uid }), // uid only — no role, so ctx is preserved
          });
        } catch (_) {}
      }
    } catch (_) {}
  },
};
