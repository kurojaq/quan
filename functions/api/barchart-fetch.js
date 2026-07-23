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

// API patterns for standard monthly options
const MONTHLY_PATTERNS = [
  (symbol, expiration) => `https://www.barchart.com/api/quotes/options/futures/${symbol}/${expiration}`,
  (symbol, expiration) => `https://www.barchart.com/v1/futures/${symbol}/options?expiration=${expiration}`,
  (symbol, expiration) => `https://www.barchart.com/ajax/options/futures/${symbol}?expiration=${expiration}`
];

// API patterns for weekly options (expire every Friday)
// Weeklies often use different URL structure or parameters
const WEEKLY_PATTERNS = [
  (symbol, expiration) => `https://www.barchart.com/api/quotes/options/futures/${symbol}/${expiration}?weekly=true`,
  (symbol, expiration) => `https://www.barchart.com/v1/futures/${symbol}/options?expiration=${expiration}&weekly=true`,
  (symbol, expiration) => `https://www.barchart.com/ajax/options/futures/${symbol}?expiration=${expiration}&weekly=true`,
  // Fallback: try same patterns as monthlies in case Barchart handles both
  (symbol, expiration) => `https://www.barchart.com/api/quotes/options/futures/${symbol}/${expiration}`,
  (symbol, expiration) => `https://www.barchart.com/v1/futures/${symbol}/options?expiration=${expiration}`,
  (symbol, expiration) => `https://www.barchart.com/ajax/options/futures/${symbol}?expiration=${expiration}`
];

const REQUEST_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;

// In-memory cache: { "symbol:expiration": { data, timestamp } }
const cache = {};
const CACHE_TTL = 60000; // 60 seconds

function extractOptionRows(response) {
  // Format 1: Direct array
  if (Array.isArray(response)) return response;
  // Format 2: Wrapped in various properties
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.options)) return response.options;
  if (Array.isArray(response.results)) return response.results;
  if (Array.isArray(response.rows)) return response.rows;
  if (Array.isArray(response.chain)) return response.chain;
  // Format 3: Deeply nested
  if (response.options && Array.isArray(response.options.chain)) return response.options.chain;
  return null;
}

function convertToCSV(optionRows) {
  if (!optionRows || !Array.isArray(optionRows) || optionRows.length === 0) return '';

  const headers = [
    'Strike',
    'CallSymbol', 'CallBid', 'CallAsk', 'CallLast', 'CallBidSize', 'CallAskSize',
    'CallVolume', 'CallOpenInterest', 'CallIV', 'CallDelta', 'CallGamma',
    'CallVega', 'CallTheta', 'CallRho',
    'PutSymbol', 'PutBid', 'PutAsk', 'PutLast', 'PutBidSize', 'PutAskSize',
    'PutVolume', 'PutOpenInterest', 'PutIV', 'PutDelta', 'PutGamma',
    'PutVega', 'PutTheta', 'PutRho'
  ];

  const rows = optionRows.map(opt => {
    const call = opt.call || {};
    const put = opt.put || {};
    return [
      opt.strike || '',
      call.symbol || '', call.bid || '', call.ask || '', call.last || '',
      call.bid_size || call.bidSize || '', call.ask_size || call.askSize || '',
      call.volume || '', call.open_interest || call.openInterest || '',
      call.iv || '', call.delta || '', call.gamma || '',
      call.vega || '', call.theta || '', call.rho || '',
      put.symbol || '', put.bid || '', put.ask || '', put.last || '',
      put.bid_size || put.bidSize || '', put.ask_size || put.askSize || '',
      put.volume || '', put.open_interest || put.openInterest || '',
      put.iv || '', put.delta || '', put.gamma || '',
      put.vega || '', put.theta || '', put.rho || ''
    ];
  });

  const csvContent = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  return csvContent;
}

async function fetchOptionsChain(symbol, expiration, type = 'monthlies') {
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

  // Choose patterns based on option type
  const patterns = type === 'weeklies' ? WEEKLY_PATTERNS : MONTHLY_PATTERNS;

  // Try patterns with exponential backoff
  let lastError = null;
  let patternIndex = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const url = patterns[patternIndex % patterns.length](symbol, expiration);
      console.log(`[barchart-fetch] Attempt ${attempt + 1}/${MAX_RETRIES} (${type}): ${url.substring(0, 80)}...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
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
          throw new Error(`Not found (404): ${url}`);
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (e) {
        clearTimeout(timeoutId);
        throw e;
      }
    } catch (error) {
      lastError = error;
      console.warn(`[barchart-fetch] Attempt ${attempt + 1} failed: ${error.message}`);

      // Try next pattern
      patternIndex++;

      // Exponential backoff before retry
      if (attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed to fetch after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

export async function onRequestGet({ request, env }) {
  // Gate to operator only
  const gate = await requireOperator(env, request);
  if (gate instanceof Response) return gate;

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
    if (!/^[A-Z0-9]{2,4}$/.test(symbol)) {
      return badRequest('invalid symbol format');
    }
    // Accept both format: "aug-26" (monthlies) and "01/17/26" (weeklies)
    if (!/^[a-z]{3}-\d{2}$/.test(expiration) && !/^\d{2}_\d{2}_\d{2}$/.test(expiration) && !/^\d{2}\/\d{2}\/\d{2}$/.test(expiration)) {
      return badRequest('invalid expiration format (try "aug-26" or "01/17/26")');
    }
    if (!['monthlies', 'weeklies'].includes(type)) {
      return badRequest('type must be "monthlies" or "weeklies"');
    }

    // Fetch the chain
    const rows = await fetchOptionsChain(symbol, expiration, type);

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
