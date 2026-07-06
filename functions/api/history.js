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

  const ident = await resolveIdentity(env, request);
  if (!ident) return dataJson(401, { error: 'authentication required' });

  const rl = await checkRateLimit(env, ident.id, ident.tier);
  if (!rl.ok) return dataJson(429, { error: 'rate limit exceeded — slow down' }, { 'Retry-After': '60' });

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__cache/history?s=${encodeURIComponent(symbol)}&r=${range}&i=${interval}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const result = await fetchYahooChart(symbol, range, interval);
    const ts = result.timestamp || [];
    const q = ((result.indicators && result.indicators.quote) || [{}])[0] || {};
    const o = q.open || [], h = q.high || [], l = q.low || [], c = q.close || [];
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      if (i >= o.length || i >= h.length || i >= l.length || i >= c.length) break;
      if (o[i] == null || h[i] == null || l[i] == null || c[i] == null) continue;
      bars.push({ time: Math.floor(ts[i]), open: o[i], high: h[i], low: l[i], close: c[i] });
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
