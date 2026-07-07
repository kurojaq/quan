/* cron-warm.js — standalone Cloudflare Worker (Phase 3).
 *
 * Cloudflare *Pages* projects can't run scheduled functions, so this EOD warmer
 * is a separate Worker on a Cron Trigger. It pre-fetches daily/intraday price
 * history for a configured instrument set and writes it into the SAME KV
 * namespace the Pages site reads (QUAN_PUBLISH), under `warm:hist:*`. /api/history
 * checks that warm layer first, so the first chart/compass load of the day is
 * instant instead of a cold Yahoo round-trip.
 *
 * Deploy (dashboard, no build — same flow as yahoo-proxy.js):
 *   1. Workers & Pages → Create → Worker → Quick edit → paste this file → Deploy.
 *   2. Settings → Variables → KV Namespace Bindings → add QUAN_PUBLISH → the same
 *      namespace bound to the Pages project.
 *   3. Settings → Variables → add WARM_SYMBOLS (optional, comma-separated Yahoo
 *      symbols, e.g. "ES=F,NQ=F,GC=F,CL=F,NG=F"). Defaults below if unset.
 *   4. Settings → Triggers → Cron Triggers → add e.g. "0 22 * * 1-5"
 *      (22:00 UTC on weekdays, after the US cash close). Adjust to taste.
 *
 * A GET to the Worker runs the same warm pass on demand (handy for testing).
 */

const DEFAULT_SYMBOLS = 'ES=F,NQ=F,YM=F,RTY=F,GC=F,SI=F,CL=F,NG=F,ZN=F,ZB=F,6E=F';
// (range, interval) combos the terminal actually requests — keep in sync with
// js/chart-tab.js timeframe buttons + js/compass.js live-price pull.
const COMBOS = [['5d', '5m'], ['1mo', '15m'], ['6mo', '1d']];
const TTL_SEC = 20 * 3600;   // ~a trading day; refreshed each cron run
const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

async function fetchYahooChart(symbol, range, interval) {
  let lastErr;
  for (const host of YAHOO_HOSTS) {
    try {
      const u = new URL(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
      u.searchParams.set('range', range);
      u.searchParams.set('interval', interval);
      const r = await fetch(u.toString(), { headers: YAHOO_HEADERS });
      const data = await r.json().catch(() => ({}));
      const result = data.chart && data.chart.result;
      if (result && result.length) return result[0];
      lastErr = new Error(`no data for ${symbol}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`no data for ${symbol}`);
}

function toHistory(symbol, result) {
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
  return { symbol, bars, currency: meta.currency ?? null, exchangeName: meta.exchangeName ?? null };
}

async function warm(env) {
  if (!env.QUAN_PUBLISH) return { error: 'QUAN_PUBLISH KV not bound' };
  const symbols = (env.WARM_SYMBOLS || DEFAULT_SYMBOLS).split(',').map((s) => s.trim()).filter(Boolean);
  let ok = 0, fail = 0;
  for (const sym of symbols) {
    for (const [range, interval] of COMBOS) {
      try {
        const result = await fetchYahooChart(sym, range, interval);
        const payload = toHistory(sym, result);
        if (payload.bars.length) {
          await env.QUAN_PUBLISH.put(`warm:hist:${sym}:${range}:${interval}`, JSON.stringify(payload), { expirationTtl: TTL_SEC });
          ok++;
        } else { fail++; }
      } catch (_) { fail++; }
    }
  }
  return { symbols: symbols.length, combos: COMBOS.length, warmed: ok, failed: fail };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(warm(env)); },
  async fetch(_request, env) {
    const res = await warm(env);
    return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json' } });
  }
};
