/* ==========================================================================
   Shared helpers for the Qu'an Cloudflare Pages Functions.
   Files prefixed with "_" are NOT routed as endpoints — this is a library.

   Deliberately dependency-free: we call Stripe's REST API and Supabase's REST /
   auth API directly with fetch, so there is no SDK to bundle in a no-build repo.

   Expected environment bindings (set in the Cloudflare Pages dashboard —
   Settings → Environment variables, and as encrypted Secrets where noted):
     STRIPE_SECRET_KEY            (secret)  sk_live_… / sk_test_…
     STRIPE_WEBHOOK_SECRET        (secret)  whsec_…
     STRIPE_PRICE_OPERATOR_MONTHLY          price_…
     STRIPE_PRICE_OPERATOR_ANNUAL           price_…
     STRIPE_PRICE_DESK_MONTHLY              price_…
     STRIPE_PRICE_DESK_ANNUAL               price_…
     SUPABASE_URL                           https://…supabase.co
     SUPABASE_ANON_KEY                      eyJ…            (public anon key)
     SUPABASE_SERVICE_ROLE_KEY    (secret)  eyJ…            (bypasses RLS — webhook only)
   ========================================================================== */

// ---- responses -----------------------------------------------------------
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders }
  });
}
export const badRequest = (msg) => json({ error: msg || 'bad request' }, 400);
export const unauthorized = (msg) => json({ error: msg || 'sign in required' }, 401);
export const serverError = (msg) => json({ error: msg || 'server error' }, 500);

// ---- plan → Stripe price mapping ----------------------------------------
// Only paid plans live here; "scout" is free and never reaches the server.
export function priceIdFor(env, plan, cycle) {
  const c = cycle === 'annual' ? 'ANNUAL' : 'MONTHLY';
  const key = `STRIPE_PRICE_${String(plan || '').toUpperCase()}_${c}`;
  return env[key] || null;
}

// ---- Stripe REST (application/x-www-form-urlencoded) --------------------
// Flattens nested objects/arrays into Stripe's bracket notation, e.g.
//   { subscription_data: { trial_period_days: 14 } }
//     -> subscription_data[trial_period_days]=14
function toForm(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val === undefined || val === null) continue;
    const field = prefix ? `${prefix}[${key}]` : key;
    if (typeof val === 'object' && !Array.isArray(val)) {
      toForm(val, field, out);
    } else if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (item && typeof item === 'object') toForm(item, `${field}[${i}]`, out);
        else out.append(`${field}[${i}]`, String(item));
      });
    } else {
      out.append(field, String(val));
    }
  }
  return out;
}

export async function stripe(env, path, params, method = 'POST') {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };
  if (params && method !== 'GET') opts.body = toForm(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data && data.error && data.error.message) || `Stripe ${res.status}`;
    throw new Error(detail);
  }
  return data;
}

// ---- Stripe webhook signature verification (Web Crypto) -----------------
// Reimplements Stripe's constructEvent HMAC check without the SDK.
export async function verifyStripeSignature(rawBody, sigHeader, secret, toleranceSec = 300) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => kv.split('=').map((s) => s.trim()))
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  // replay window
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > toleranceSec) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, v1);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- Supabase: identify the caller from their access token --------------
export async function getUserFromRequest(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user && user.id ? user : null;
}

// ---- gate the publish / client-link endpoints to the app owner only -----
// There is no "operator" role in the DB (team_members.role is for a subscriber's
// own team) -- the whole app has exactly one operator, so a plain env var is the
// simplest correct check. Returns the user on success, or a Response to return
// as-is (401 signed out, 403 signed in but not the operator).
export async function requireOperator(env, request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return unauthorized();
  if (!env.OPERATOR_EMAIL || user.email !== env.OPERATOR_EMAIL) return json({ error: 'not authorized' }, 403);
  return user;
}

// ---- Supabase: service-role REST (bypasses RLS — webhook writes) --------
export async function supaAdmin(env, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || `Supabase ${res.status}`);
  return data;
}

// resolve the site origin for building success/cancel/return URLs
export function siteOrigin(env, request) {
  return env.APP_BASE_URL || new URL(request.url).origin;
}

/* ==========================================================================
   Data plane (Phase 1): identity, per-tier rate limiting, and the upstream
   quote/history fetch shared by /api/quote and /api/history.

   Two identities are legitimate callers of the market-data endpoints:
     • a signed-in Supabase user  → tier from their subscription plan
     • a client-view publish token → tier 'client'
   Everything else is anonymous and rejected (this closes the old open proxy).

   Rate-limit + plan-cache counters reuse the existing QUAN_PUBLISH KV namespace
   (prefixes rl: and plan:) so no new binding is required. KV is only coarsely
   consistent — good enough for per-minute throttling; a Durable Object is the
   precise upgrade (Phase 4). If KV isn't bound the limiter fails open.
   ========================================================================== */

// requests/minute per tier. trialing == an Operator trial.
export const RATE_LIMITS = { desk: 240, operator: 120, trialing: 120, scout: 20, client: 40 };
// edge-cache TTL (seconds) for /quote per tier — paid tiers get fresher data.
export const QUOTE_TTL = { desk: 8, operator: 8, trialing: 8, scout: 30, client: 20 };
export const HISTORY_TTL = 60; // history is far less latency-sensitive

const ACTIVE_STATUS = new Set(['active', 'trialing']);

// look up a user's plan ('operator' | 'desk' | 'scout'), cached ~60s in KV.
async function planForUser(env, userId) {
  try { const c = env.QUAN_PUBLISH && await env.QUAN_PUBLISH.get(`plan:${userId}`); if (c) return c; } catch (_) {}
  let plan = 'scout';
  try {
    const rows = await supaAdmin(env, `subscriptions?user_id=eq.${userId}&select=plan,status&limit=1`);
    const s = Array.isArray(rows) && rows[0];
    if (s && ACTIVE_STATUS.has(s.status) && s.plan) plan = s.plan;
  } catch (_) { /* Supabase hiccup → treat as scout, don't hard-fail data */ }
  try { if (env.QUAN_PUBLISH) await env.QUAN_PUBLISH.put(`plan:${userId}`, plan, { expirationTtl: 60 }); } catch (_) {}
  return plan;
}

// Returns { id, tier, userId } for a legitimate caller, or null for anonymous.
export async function resolveIdentity(env, request) {
  // 1) Supabase-authenticated user (the full terminal)
  const user = await getUserFromRequest(env, request);
  if (user) {
    let tier;
    if (env.OPERATOR_EMAIL && user.email === env.OPERATOR_EMAIL) tier = 'desk'; // app owner: unthrottled tier
    else tier = await planForUser(env, user.id);
    return { id: `u:${user.id}`, tier, userId: user.id };
  }
  // 2) client-view publish token (view.html) — the token itself is the secret
  const url = new URL(request.url);
  const ptoken = request.headers.get('X-Quan-Token') || url.searchParams.get('ptoken');
  if (ptoken && env.QUAN_PUBLISH) {
    try { if (await env.QUAN_PUBLISH.get(`token:${ptoken}`)) return { id: `c:${ptoken}`, tier: 'client', userId: null }; } catch (_) {}
  }
  return null;
}

// Fixed-window (per calendar minute) KV counter. Fails open if KV is absent.
export async function checkRateLimit(env, id, tier) {
  const limit = RATE_LIMITS[tier] || RATE_LIMITS.scout;
  if (!env.QUAN_PUBLISH) return { ok: true, limit, remaining: limit };
  const key = `rl:${id}:${Math.floor(Date.now() / 60000)}`;
  let n = 0;
  try { n = parseInt((await env.QUAN_PUBLISH.get(key)) || '0', 10) || 0; } catch (_) {}
  if (n >= limit) return { ok: false, limit, remaining: 0 };
  try { await env.QUAN_PUBLISH.put(key, String(n + 1), { expirationTtl: 120 }); } catch (_) {}
  return { ok: true, limit, remaining: limit - n - 1 };
}

// Yahoo chart fetch with query1 → query2 host fallback. Returns result[0] or throws.
const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
export async function fetchYahooChart(symbol, range, interval) {
  let lastErr;
  for (const host of YAHOO_HOSTS) {
    try {
      const u = new URL(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
      if (range) u.searchParams.set('range', range);
      if (interval) u.searchParams.set('interval', interval);
      const r = await fetch(u.toString(), { headers: YAHOO_HEADERS });
      const data = await r.json().catch(() => ({}));
      const result = data.chart && data.chart.result;
      if (result && result.length) return result[0];
      lastErr = new Error((data.chart && data.chart.error && JSON.stringify(data.chart.error)) || `no data for ${symbol}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`no data for ${symbol}`);
}

// CORS + JSON helpers for the market-data endpoints (they set their own
// Cache-Control, so they don't use json()'s no-store default).
export const dataCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-Quan-Token, Content-Type'
};
export function dataJson(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json', ...dataCors, ...extraHeaders }
  });
}

// raw bearer token from the request (for calling Supabase as the user)
export function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// Supabase REST as the CALLING USER — RLS (auth.uid() = user_id) does the
// isolation, so no service-role key is involved. Used by /api/state.
export async function supaAsUser(env, token, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || `Supabase ${res.status}`);
  return data;
}
