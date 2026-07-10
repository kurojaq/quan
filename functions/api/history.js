/* GET /api/history?symbol=NG=F&range=5d&interval=5m
   Gated, edge-cached, rate-limited replacement for the open yahoo-proxy Worker's
   /history endpoint. Same response shape, so js/chart-tab.js & js/compass.js just
   change host. Caller must be a signed-in user or a valid client-view token.
*/
import { resolveIdentity, checkRateLimit, fetchYahooChart, dataJson, dataCors, HISTORY_TTL } from './_shared.js';

export const onRequestOptions = () => new Response(null, { status: 204, headers: dataCors });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol') || '';
  if (!symbol) return dataJson(400, { error: 'missing ?symbol=' });
  const range = url.searchParams.get('range') || '5d';
  const interval = url.searchParams.get('interval') || '5m';

  let ident, rl;
  try {
    ident = await resolveIdentity(env, request);
    if (!ident) return dataJson(401, { error: 'authentication required' });
    rl = await checkRateLimit(env, ident.id, ident.tier);
  } catch (e) {
    return dataJson(500, { error: 'identity/rate-limit check failed: ' + String((e && e.message) || e) });
  }
  if (!rl.ok) return dataJson(429, { error: 'rate limit exceeded — slow down' }, { 'Retry-After': '60' });

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__cache/history?s=${encodeURIComponent(symbol)}&r=${range}&i=${interval}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // warm layer: the cron Worker (workers/cron-warm.js) pre-fetches common combos
  // into KV so the first load of the day is instant instead of a cold Yahoo hit.
  if (env.QUAN_PUBLISH) {
    try {
      const warm = await env.QUAN_PUBLISH.get(`warm:hist:${symbol}:${range}:${interval}`);
      if (warm) {
        const resp = dataJson(200, JSON.parse(warm), { 'Cache-Control': `public, max-age=${HISTORY_TTL}` });
        await cache.put(cacheKey, resp.clone());
        return resp;
      }
    } catch (_) { /* fall through to a live fetch */ }
  }

  try {
    const result = await fetchYahooChart(symbol, range, interval);
    const ts = result.timestamp || [];
    const q = ((result.indicators && result.indicators.quote) || [{}])[0] || {};
    const o = q.open || [], h = q.high || [], l = q.low || [], c = q.close || [], v = q.volume || [];
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      if (i >= o.length || i >= h.length || i >= l.length || i >= c.length) break;
      if (o[i] == null || h[i] == null || l[i] == null || c[i] == null) continue;
      bars.push({ time: Math.floor(ts[i]), open: o[i], high: h[i], low: l[i], close: c[i], volume: v[i] == null ? null : v[i] });
    }
    const meta = result.meta || {};
    const payload = { symbol, bars, currency: meta.currency ?? null, exchangeName: meta.exchangeName ?? null };
    const resp = dataJson(200, payload, { 'Cache-Control': `public, max-age=${HISTORY_TTL}` });
    await cache.put(cacheKey, resp.clone());
    return resp;
  } catch (e) {
    return dataJson(502, { error: String((e && e.message) || e) });
  }
}
