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

  let ident, rl;
  try {
    ident = await resolveIdentity(env, request);
    if (!ident) return dataJson(401, { error: 'authentication required' });
    rl = await checkRateLimit(env, ident.id, ident.tier);
  } catch (e) {
    return dataJson(500, { error: 'identity/rate-limit check failed: ' + String((e && e.message) || e) });
  }
  if (!rl.ok) return dataJson(429, { error: 'rate limit exceeded — slow down' }, { 'Retry-After': '60' });

  const ttl = QUOTE_TTL[ident.tier] || 15;
  const cache = caches.default;
  // cache per (symbol, tier) since paid tiers get a fresher (shorter) TTL
  const cacheKey = new Request(`${url.origin}/__cache/quote?s=${encodeURIComponent(symbol)}&t=${ident.tier}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    // Try Tick Engine first (Tradovate real-time data)
    let payload;
    try {
      payload = await fetchFromTickEngine(env, symbol);
    } catch (e) {
      console.warn(`[/api/quote] Tick Engine unavailable for ${symbol}:`, e.message);
      // Fallback to Yahoo (for non-Tradovate symbols or during transition)
      const result = await fetchYahooChart(symbol);
      const meta = result.meta || {};
      if (meta.regularMarketPrice == null) return dataJson(502, { error: `no price for ${symbol}` });
      payload = {
        symbol,
        price: meta.regularMarketPrice,
        previousClose: meta.previousClose ?? null,
        currency: meta.currency ?? null,
        exchangeName: meta.exchangeName ?? null,
        marketTime: meta.regularMarketTime ?? null,
        time: Math.floor(Date.now() / 1000),
        source: 'yahoo'
      };
    }

    const resp = dataJson(200, payload, { 'Cache-Control': `public, max-age=${ttl}` });
    await cache.put(cacheKey, resp.clone());
    return resp;
  } catch (e) {
    return dataJson(502, { error: String((e && e.message) || e) });
  }
}

/**
 * Fetch quote from Tick Engine (Tradovate market data)
 * Returns {symbol, price, bid, ask, bidSize, askSize, timestamp, source}
 */
async function fetchFromTickEngine(env, symbol) {
  if (!env.TICK_ENGINE) {
    throw new Error('Tick Engine not available');
  }

  const tickEngineId = env.TICK_ENGINE.idFromName(`${symbol}:live`);
  const tickEngine = env.TICK_ENGINE.get(tickEngineId);

  const response = await tickEngine.fetch(new Request('https://tick-engine/latest'));
  const tick = await response.json();

  if (!tick || !tick.price) {
    throw new Error(`No tick data for ${symbol}`);
  }

  return {
    symbol,
    price: tick.price,
    bid: tick.bid ?? null,
    ask: tick.ask ?? null,
    bidSize: tick.bidSize ?? null,
    askSize: tick.askSize ?? null,
    size: tick.size ?? 1,
    timestamp: tick.timestamp,
    source: 'tradovate-tick-engine'
  };
}
