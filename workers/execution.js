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
