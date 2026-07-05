// yahoo-proxy.js -- Cloudflare Worker replacement for yahoo_proxy.py.
//
// Same job, no local process: Yahoo Finance's chart endpoint doesn't send CORS
// headers, so a browser page can't fetch it directly. This Worker fetches it
// server-side (no CORS restriction there) and re-serves the result with a
// permissive CORS header, from a stable HTTPS URL any device can reach.
//
// Endpoints (identical shape to yahoo_proxy.py):
//   GET /quote?symbol=NG=F
//       -> {"symbol":"NG=F","price":3.245,"previousClose":3.196,"currency":"USD","exchangeName":"NYM","marketTime":1234567890,"time":1234567890}
//   GET /history?symbol=NG=F&range=5d&interval=5m
//       -> {"symbol":"NG=F","bars":[{"time":1234567890,"open":..,"high":..,"low":..,"close":..},...],"currency":"USD","exchangeName":"NYM"}
//
// Deploy: paste this file into a new Worker at https://dash.cloudflare.com (Workers & Pages ->
// Create -> "Hello World" template -> Quick edit -> replace all code -> Deploy). No build step,
// no Node/wrangler required.

const YAHOO_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function fetchChart(symbol, rang, interval) {
  const url = new URL(YAHOO_URL + encodeURIComponent(symbol));
  if (rang) url.searchParams.set('range', rang);
  if (interval) url.searchParams.set('interval', interval);
  const resp = await fetch(url.toString(), { headers: YAHOO_HEADERS });
  const data = await resp.json();
  const result = (data.chart && data.chart.result) || [];
  if (!result.length) {
    const err = data.chart && data.chart.error;
    throw new Error(`no data for symbol ${symbol} (${JSON.stringify(err)})`);
  }
  return result[0];
}

async function fetchQuote(symbol) {
  const result = await fetchChart(symbol);
  const meta = result.meta || {};
  if (meta.regularMarketPrice == null) throw new Error(`no regularMarketPrice for symbol ${symbol}`);
  return {
    symbol,
    price: meta.regularMarketPrice,
    previousClose: meta.previousClose ?? null,
    currency: meta.currency ?? null,
    exchangeName: meta.exchangeName ?? null,
    marketTime: meta.regularMarketTime ?? null,
    time: Math.floor(Date.now() / 1000),
  };
}

async function fetchHistory(symbol, rang, interval) {
  const result = await fetchChart(symbol, rang, interval);
  const ts = result.timestamp || [];
  const quote = ((result.indicators && result.indicators.quote) || [{}])[0] || {};
  const o = quote.open || [], h = quote.high || [], l = quote.low || [], c = quote.close || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    if (i >= o.length || i >= h.length || i >= l.length || i >= c.length) break;
    if (o[i] == null || h[i] == null || l[i] == null || c[i] == null) continue;
    bars.push({ time: Math.floor(ts[i]), open: o[i], high: h[i], low: l[i], close: c[i] });
  }
  const meta = result.meta || {};
  return { symbol, bars, currency: meta.currency ?? null, exchangeName: meta.exchangeName ?? null };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const symbol = url.searchParams.get('symbol') || '';
    if (!symbol) return json(400, { error: 'missing ?symbol=' });
    try {
      if (url.pathname === '/quote') {
        return json(200, await fetchQuote(symbol));
      } else if (url.pathname === '/history') {
        const rang = url.searchParams.get('range') || '5d';
        const interval = url.searchParams.get('interval') || '5m';
        return json(200, await fetchHistory(symbol, rang, interval));
      }
      return json(404, { error: 'unknown endpoint, use /quote?symbol=NG=F or /history?symbol=NG=F&range=5d&interval=5m' });
    } catch (e) {
      return json(502, { error: String(e && e.message || e) });
    }
  },
};
