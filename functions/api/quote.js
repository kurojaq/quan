/* GET /api/quote?symbol=NG=F
   Gated, edge-cached, rate-limited replacement for the open yahoo-proxy Worker's
   /quote endpoint. Same response shape, so js/live-anchor.js just changes host.

   Caller must be either a signed-in Supabase user or a valid client-view token
   (see resolveIdentity). Anonymous callers get 401 — the proxy is no longer open.
*/
import { resolveIdentity, checkRateLimit, fetchYahooChart, dataJson, dataCors, QUOTE_TTL } from './_shared.js';

export const onRequestOptions = () => new Response(null, { status: 204, headers: dataCors });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol') || '';
  if (!symbol) return dataJson(400, { error: 'missing ?symbol=' });

  const ident = await resolveIdentity(env, request);
  if (!ident) return dataJson(401, { error: 'authentication required' });

  const rl = await checkRateLimit(env, ident.id, ident.tier);
  if (!rl.ok) return dataJson(429, { error: 'rate limit exceeded — slow down' }, { 'Retry-After': '60' });

  const ttl = QUOTE_TTL[ident.tier] || 15;
  const cache = caches.default;
  // cache per (symbol, tier) since paid tiers get a fresher (shorter) TTL
  const cacheKey = new Request(`${url.origin}/__cache/quote?s=${encodeURIComponent(symbol)}&t=${ident.tier}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const result = await fetchYahooChart(symbol);
    const meta = result.meta || {};
    if (meta.regularMarketPrice == null) return dataJson(502, { error: `no price for ${symbol}` });
    const payload = {
      symbol,
      price: meta.regularMarketPrice,
      previousClose: meta.previousClose ?? null,
      currency: meta.currency ?? null,
      exchangeName: meta.exchangeName ?? null,
      marketTime: meta.regularMarketTime ?? null,
      time: Math.floor(Date.now() / 1000)
    };
    const resp = dataJson(200, payload, { 'Cache-Control': `public, max-age=${ttl}` });
    await cache.put(cacheKey, resp.clone());
    return resp;
  } catch (e) {
    return dataJson(502, { error: String((e && e.message) || e) });
  }
}
