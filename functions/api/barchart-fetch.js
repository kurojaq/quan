/* /api/barchart-fetch — Barchart CSV fetching via browser rendering.

   Routes through the BARCHART Worker service binding (workers/barchart-fetch.js)
   which uses Puppeteer Browser Rendering to bypass bot detection. Renders the page
   in a real browser context, so no cookies/headers struggles.

   GET  /api/barchart-fetch?symbol=ZNU26&expiration=aug-26&dataType=prices&format=csv
        -> CSV response with options data

   GET  /api/barchart-fetch?symbol=ZNU26&expiration=aug-26&dataType=prices&format=json
        -> JSON response { data: [...], count: N }
*/

import { json, badRequest, serverError } from './_shared.js';

// Map dataType to tab name for Barchart URL
const getTab = (dataType) => {
  return dataType === 'greeks' ? 'volatility-greeks' : 'options';
};

// Build Barchart page URL (the Worker will render this and extract data)
const buildBarchartPageUrl = (symbol, expiration, dataType = 'prices') => {
  const tab = getTab(dataType);
  // Include expiration in URL path (works for both monthly mmm-yy and weekly MM/DD/YY formats)
  const expirationPath = expiration ? `/${expiration}` : '';
  return `https://www.barchart.com/futures/quotes/${symbol}/${tab}${expirationPath}?moneyness=allRows&futuresOptionsView=split`;
};

// Parse options table from rendered HTML
function parseOptionsFromHTML(html) {
  try {
    const rows = [];

    // Look for data in script tags or table rows
    // Barchart embeds data in various ways; extract all option-like data
    const patterns = [
      // Angular data
      /["'](?:strikePrice|strike)["']\s*[:=]\s*([0-9.]+)/g,
      // Table cells with strike prices
      /<td[^>]*>\s*([0-9.]+)\s*<\/td>/g
    ];

    // This is a simplified parse; the Worker does the full rendering
    // Return empty to trigger fallback to Worker's internal extraction
    return [];
  } catch (e) {
    console.error('[barchart-fetch] Parse error:', e);
    return [];
  }
}

function convertToCSV(optionRows, dataType = 'prices') {
  if (!optionRows || optionRows.length === 0) return '';

  let headers, buildRow;

  if (dataType === 'greeks') {
    headers = [
      'Strike', 'Type', 'Symbol', 'LastPrice', 'ImpliedVol', 'Delta',
      'Gamma', 'Vega', 'Theta', 'IVSkew', 'TradeTime', 'DaysToExp', 'AvgVolatility'
    ];
    buildRow = (opt) => {
      const raw = opt.raw || opt;
      return [
        raw.strikePrice || opt.strikePrice || '',
        raw.optionType || opt.optionType || '',
        raw.longSymbol || opt.longSymbol || '',
        raw.lastPrice || opt.lastPrice || '',
        raw.optImpliedVolatility || opt.optImpliedVolatility || '',
        raw.delta || opt.delta || '',
        raw.gamma || opt.gamma || '',
        raw.vega || opt.vega || '',
        raw.theta || opt.theta || '',
        raw.impliedVolatilitySkew || opt.impliedVolatilitySkew || '',
        raw.tradeTime || opt.tradeTime || '',
        raw.daysToExpiration || opt.daysToExpiration || '',
        raw.averageVolatility || opt.averageVolatility || ''
      ];
    };
  } else {
    headers = [
      'Strike', 'Type', 'Symbol', 'LastPrice', 'Volume', 'OpenInterest', 'Premium'
    ];
    buildRow = (opt) => {
      const raw = opt.raw || opt;
      return [
        raw.strikePrice || opt.strikePrice || '',
        raw.optionType || opt.optionType || '',
        raw.longSymbol || opt.longSymbol || '',
        raw.lastPrice || opt.lastPrice || '',
        raw.volume || opt.volume || '',
        raw.openInterest || opt.openInterest || '',
        raw.premium || opt.premium || ''
      ];
    };
  }

  const rows = optionRows.map(buildRow);
  const csvContent = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  return csvContent;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol');
    const action = url.searchParams.get('action');

    // Fetch available weekly codes for a symbol
    if (action === 'get-weekly-codes' && symbol) {
      if (!env.BARCHART) {
        return serverError('BARCHART Worker binding not configured');
      }

      try {
        const workerResponse = await env.BARCHART.fetch(
          new Request('https://barchart-fetch.internal/get-weekly-codes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol })
          })
        );

        if (!workerResponse.ok) {
          const errText = await workerResponse.text().catch(() => '');
          return serverError(`Failed to fetch weekly codes: ${errText.substring(0, 100)}`);
        }

        return workerResponse;
      } catch (err) {
        return serverError(`Weekly codes error: ${err.message}`);
      }
    }

    const expiration = url.searchParams.get('expiration');
    const type = url.searchParams.get('type') || 'monthlies';
    const dataType = url.searchParams.get('dataType') || 'prices';
    const format = url.searchParams.get('format') || 'json';

    if (!symbol) {
      return badRequest('symbol query param required');
    }

    // Both monthlies and weeklies require expiration
    if (!expiration) {
      return badRequest(`expiration required for ${type} (e.g., ${type === 'monthlies' ? 'aug-26' : 'BNIN26'})`);
    }

    // Validate weekly symbol codes (e.g., BNIN26)
    if (type === 'weeklies' && !/^[A-Z0-9]{6}$/.test(expiration)) {
      return badRequest(`invalid weekly code format: ${expiration} (e.g., BNIN26)`);
    }

    if (!/^[A-Z0-9]{2,6}$/.test(symbol)) {
      return badRequest('invalid symbol format (e.g., BGU26, ESZ26, BNIN26)');
    }

    // Normalize expiration: accept both "AUG-26" and "aug-26" (for monthlies only)
    let normalizedExpiration = expiration;
    if (type === 'monthlies' && expiration) {
      normalizedExpiration = expiration.toLowerCase();
      if (!/^[a-z]{3}-\d{2}$/.test(normalizedExpiration)) {
        return badRequest('invalid expiration format (e.g., aug-26, sep-26)');
      }
    }

    if (!['prices', 'greeks'].includes(dataType)) {
      return badRequest('dataType must be "prices" or "greeks"');
    }

    console.log(`[barchart-fetch] Fetching ${symbol} ${type}${normalizedExpiration ? ' ' + normalizedExpiration : ''} (${dataType}) via browser render`);

    // Call BARCHART Worker via service binding to do browser rendering
    if (!env.BARCHART) {
      return serverError(
        'BARCHART Worker service binding not configured. ' +
        'This requires workers/barchart-fetch.js to be deployed separately.'
      );
    }

    const pageUrl = buildBarchartPageUrl(symbol, normalizedExpiration || 'current', dataType);
    console.log(`[barchart-fetch] Page URL: ${pageUrl}`);

    // Call the Worker to render the page and extract data
    const workerResponse = await env.BARCHART.fetch(
      new Request('https://barchart-fetch.internal/fetch-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          expiration: normalizedExpiration,
          type,
          dataType,
          pageUrl
        })
      })
    );

    if (!workerResponse.ok) {
      const errText = await workerResponse.text().catch(() => '');
      console.error(`[barchart-fetch] Worker error: ${workerResponse.status} ${errText.substring(0, 200)}`);
      return serverError(`Browser rendering failed: ${workerResponse.status} ${errText.substring(0, 100)}`);
    }

    const result = await workerResponse.json().catch(() => ({ data: [] }));
    const rows = result.data || [];

    console.log(`[barchart-fetch] Got ${rows.length} rows from Worker`);

    // Return in requested format
    if (format === 'csv') {
      const csv = convertToCSV(rows, dataType);
      const filename = normalizedExpiration
        ? `${symbol}_${normalizedExpiration}_${dataType}.csv`
        : `${symbol}_${dataType}.csv`;
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    } else {
      // Default JSON
      return json({
        symbol,
        type,
        expiration: normalizedExpiration,
        dataType,
        count: rows.length,
        data: rows
      });
    }
  } catch (error) {
    console.error('[barchart-fetch] Error:', error);
    return serverError(error.message);
  }
}

export async function onRequestPost({ request, env }) {
  // Legacy cookie endpoints (for reference; not used with browser rendering)
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'seed-cookies' || action === 'clear-cookies') {
      return json({
        ok: true,
        note: 'Browser rendering approach does not require seeding cookies. Fetches work directly.'
      });
    }

    return badRequest('unknown action');
  } catch (error) {
    return serverError(error.message);
  }
}
