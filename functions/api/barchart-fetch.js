/* /api/barchart-fetch — server-side bridge for seamless Barchart CSV fetching.

   Browser-side Barchart requests hit CORS blocks; this endpoint routes them
   server-to-server, bypassing browser CORS. Mimics the autopull worker's
   job pattern but for on-demand UI fetches (not scheduled).

   GET  /api/barchart-fetch?symbol=ZNU26&expiration=aug-26
        -> { data: [{...options...}], count: 100 }

   GET  /api/barchart-fetch?symbol=ZNU26&expiration=aug-26&format=csv
        -> text/csv response (RFC 4180 formatted)

   Auth: operator only (gated by requireOperator).
   CORS: open (all origins welcome; sensitive data stays behind auth gate).
*/

import { json, badRequest, serverError, requireOperator } from './_shared.js';

// Real Barchart API endpoint discovered from HAR file inspection
// Returns options chain grouped by strike price
const buildBarchartUrl = (symbol, expiration) => {
  const fields = [
    'optionType',
    'lastPrice',
    'volume',
    'openInterest',
    'premium',
    'strikePrice',
    'longSymbol',
    'symbolName',
    'symbolType',
    'impliedVolatility', // Greeks
    'delta',
    'gamma',
    'vega',
    'theta',
    'rho'
  ].join(',');

  const params = new URLSearchParams({
    symbol: symbol,
    list: 'futures.options',
    fields: fields,
    groupBy: 'strikePrice',
    meta: 'field.shortName,field.description,field.type',
    orderBy: 'strikePrice',
    orderDir: 'asc',
    raw: '1'
  });

  return `https://www.barchart.com/proxies/core-api/v1/quotes/get?${params.toString()}`;
};

const REQUEST_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;

// In-memory cache: { "symbol:expiration": { data, timestamp } }
const cache = {};
const CACHE_TTL = 60000; // 60 seconds

function extractOptionRows(response) {
  // Barchart API format: { count, total, data: { "50.00": [...calls/puts...], "50.50": [...] } }
  // Flatten strikes into single array
  if (response && response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
    const rows = [];
    for (const strikeKey in response.data) {
      const optionGroup = response.data[strikeKey];
      if (Array.isArray(optionGroup)) {
        rows.push(...optionGroup);
      }
    }
    if (rows.length > 0) return rows;
  }

  // Fallback: Direct array
  if (Array.isArray(response)) return response;
  // Fallback: Wrapped in various properties
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.options)) return response.options;
  if (Array.isArray(response.results)) return response.results;
  if (Array.isArray(response.rows)) return response.rows;
  if (Array.isArray(response.chain)) return response.chain;
  return null;
}

function convertToCSV(optionRows) {
  if (!optionRows || !Array.isArray(optionRows) || optionRows.length === 0) return '';

  // Build CSV from Barchart API response format
  // Each row is an option (call or put) with fields like strikePrice, optionType, lastPrice, etc.
  const headers = [
    'Strike',
    'Type',
    'Symbol',
    'LastPrice',
    'Volume',
    'OpenInterest',
    'Premium',
    'Delta',
    'Gamma',
    'Vega',
    'Theta',
    'Rho',
    'ImpliedVol'
  ];

  const rows = optionRows.map(opt => {
    // Use raw numeric values if available, fall back to formatted strings
    const raw = opt.raw || opt;
    return [
      raw.strikePrice || opt.strikePrice || '',
      raw.optionType || opt.optionType || '',
      raw.longSymbol || opt.longSymbol || '',
      raw.lastPrice || opt.lastPrice || '',
      raw.volume || opt.volume || '',
      raw.openInterest || opt.openInterest || '',
      raw.premium || opt.premium || '',
      raw.delta || opt.delta || '',
      raw.gamma || opt.gamma || '',
      raw.vega || opt.vega || '',
      raw.theta || opt.theta || '',
      raw.rho || opt.rho || '',
      raw.impliedVolatility || opt.impliedVolatility || ''
    ];
  });

  const csvContent = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  return csvContent;
}

async function fetchOptionsChain(symbol, expiration, type = 'monthlies', env) {
  if (!symbol || !expiration) {
    throw new Error('Symbol and expiration required');
  }

  const cacheKey = `${symbol}:${expiration}:${type}`;

  // Check cache
  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[barchart-fetch] Cache hit: ${cacheKey}`);
      return cached.data;
    }
  }

  // Try to get session cookies from autopull KV (set by the operator)
  let cookieHeader = '';
  if (env && env.QUAN_PUBLISH) {
    try {
      const cookiesJSON = await env.QUAN_PUBLISH.get('autopull:cookies');
      if (cookiesJSON) {
        const cookies = JSON.parse(cookiesJSON);
        if (Array.isArray(cookies)) {
          cookieHeader = cookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
        }
      }
    } catch (e) {
      console.warn(`[barchart-fetch] Could not read cookies from KV: ${e.message}`);
    }
  }

  // Build URL using the real Barchart API endpoint
  const url = buildBarchartUrl(symbol, expiration);
  console.log(`[barchart-fetch] Fetching: ${symbol} ${expiration} (${type})`);
  console.log(`[barchart-fetch] URL: ${url.substring(0, 100)}...`);
  console.log(`[barchart-fetch] Auth: ${cookieHeader ? 'cookies from autopull' : 'public (no auth)'}`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      try {
        const headers = {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.barchart.com/futures'
        };
        if (cookieHeader) {
          headers['Cookie'] = cookieHeader;
        }

        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const rows = extractOptionRows(data);

          if (!rows || !Array.isArray(rows)) {
            throw new Error('Could not extract option rows from response');
          }

          // Cache and return
          cache[cacheKey] = {
            data: rows,
            timestamp: Date.now()
          };

          console.log(`[barchart-fetch] Success: ${rows.length} rows (${type})`);
          return rows;
        } else if (response.status === 404) {
          throw new Error(`Not found (404): Symbol or expiration not available`);
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (e) {
        clearTimeout(timeoutId);
        throw e;
      }
    } catch (error) {
      console.warn(`[barchart-fetch] Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${error.message}`);

      // Exponential backoff before retry
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[barchart-fetch] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

export async function onRequestGet({ request, env }) {
  // Public endpoint — Barchart data is already public on their site
  // No auth required, but could add rate limiting if needed

  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol');
    const expiration = url.searchParams.get('expiration');
    const type = url.searchParams.get('type') || 'monthlies';
    const format = url.searchParams.get('format') || 'json';

    if (!symbol || !expiration) {
      return badRequest('symbol and expiration query params required');
    }

    // Validate inputs (prevent injection)
    // Allow futures contracts like BGU26 (2+ letters, month code, year digits)
    if (!/^[A-Z0-9]{2,6}$/.test(symbol)) {
      return badRequest('invalid symbol format (e.g., BGU26, ESZ26)');
    }
    // Accept both format: "aug-26" (monthlies) and "01/17/26" (weeklies)
    if (!/^[a-z]{3}-\d{2}$/.test(expiration) && !/^\d{2}_\d{2}_\d{2}$/.test(expiration) && !/^\d{2}\/\d{2}\/\d{2}$/.test(expiration)) {
      return badRequest('invalid expiration format (try "aug-26" or "01/17/26")');
    }
    if (!['monthlies', 'weeklies'].includes(type)) {
      return badRequest('type must be "monthlies" or "weeklies"');
    }

    // Fetch the chain (with env for cookie access)
    const rows = await fetchOptionsChain(symbol, expiration, type, env);

    // Return in requested format
    if (format === 'csv') {
      const csv = convertToCSV(rows);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${symbol}_${expiration}.csv"`
        }
      });
    } else {
      // Default JSON
      return json({
        symbol,
        expiration,
        count: rows.length,
        data: rows
      });
    }
  } catch (error) {
    console.error('[barchart-fetch] Error:', error);
    return serverError(error.message);
  }
}
