/* /api/barchart-api — Direct Barchart API proxy and CSV formatter

   Calls Barchart's /proxies/core-api endpoint directly (no browser rendering).
   Converts JSON response to CSV format.

   GET  /api/barchart-api?symbol=BNIN26&dataType=prices&view=split&moneyness=allRows
        -> CSV response

   GET  /api/barchart-api?symbol=BNIN26&dataType=greeks&format=json
        -> JSON response from Barchart
*/

import { json, badRequest, serverError } from './_shared.js';

const BARCHART_API = 'https://www.barchart.com/proxies/core-api/v1/quotes/get';

// Field mappings for each data type
const FIELD_MAPS = {
  prices: {
    fields: 'optionType,lastPrice,volume,openInterest,premium,strikePrice,longSymbol,symbolName,symbolType',
    csvHeaders: ['Strike', 'Type', 'Symbol', 'LastPrice', 'Volume', 'OpenInterest', 'Premium'],
    dataMap: (row) => ({
      Strike: row.strikePrice,
      Type: row.optionType,
      Symbol: row.longSymbol,
      LastPrice: row.lastPrice,
      Volume: row.volume,
      OpenInterest: row.openInterest,
      Premium: row.premium
    })
  },
  greeks: {
    fields: 'strikePrice,symbolName,baseSymbol,lastPrice,optImpliedVolatility,delta,gamma,theta,vega,impliedVolatilitySkew,optionType,tradeTime,longSymbol,daysToExpiration,expirationDate,averageVolatility',
    csvHeaders: ['Strike', 'Type', 'Symbol', 'LastPrice', 'ImpliedVol', 'Delta', 'Gamma', 'Vega', 'Theta', 'IVSkew', 'TradeTime', 'DaysToExp', 'AvgVolatility'],
    dataMap: (row) => ({
      Strike: row.strikePrice,
      Type: row.optionType,
      Symbol: row.longSymbol,
      LastPrice: row.lastPrice,
      ImpliedVol: row.optImpliedVolatility,
      Delta: row.delta,
      Gamma: row.gamma,
      Vega: row.vega,
      Theta: row.theta,
      IVSkew: row.impliedVolatilitySkew,
      TradeTime: row.tradeTime,
      DaysToExp: row.daysToExpiration,
      AvgVolatility: row.averageVolatility
    })
  }
};

function convertToCSV(data, headers) {
  if (!data || data.length === 0) {
    return headers.map(h => `"${h}"`).join(',') + '\n';
  }

  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h] ?? '';
      // Escape quotes and wrap in quotes
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  );

  return [
    headers.map(h => `"${h}"`).join(','),
    ...rows
  ].join('\n');
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol');
    const dataType = url.searchParams.get('dataType') || 'prices';
    const format = url.searchParams.get('format') || 'csv';
    const moneyness = url.searchParams.get('moneyness') || 'allRows';

    if (!symbol) {
      return badRequest('symbol required (e.g., BNIN26, ZNU26)');
    }

    if (!FIELD_MAPS[dataType]) {
      return badRequest(`dataType must be 'prices' or 'greeks', got: ${dataType}`);
    }

    console.log(`[barchart-api] Fetching ${symbol} (${dataType})`);

    // Call Barchart API directly
    const fieldMap = FIELD_MAPS[dataType];
    const barchartUrl = new URL(BARCHART_API);
    barchartUrl.searchParams.set('symbol', symbol);
    barchartUrl.searchParams.set('list', 'futures.options');
    barchartUrl.searchParams.set('fields', fieldMap.fields);
    barchartUrl.searchParams.set('groupBy', 'strikePrice');
    barchartUrl.searchParams.set('meta', 'field.shortName,field.description,field.type');
    barchartUrl.searchParams.set('orderBy', 'strikePrice');
    barchartUrl.searchParams.set('orderDir', 'asc');
    barchartUrl.searchParams.set('raw', '1');

    const barchartResponse = await fetch(barchartUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!barchartResponse.ok) {
      console.error(`[barchart-api] Barchart error: ${barchartResponse.status}`);
      return serverError(`Barchart API error: ${barchartResponse.status}`);
    }

    const barchartData = await barchartResponse.json().catch(() => null);
    if (!barchartData || !barchartData.data) {
      console.error('[barchart-api] No data in Barchart response');
      return serverError('No data returned from Barchart');
    }

    console.log(`[barchart-api] Got ${barchartData.data.length} rows from Barchart`);

    // Return as requested format
    if (format === 'json') {
      return json({
        symbol,
        dataType,
        count: barchartData.data.length,
        data: barchartData.data
      });
    }

    // Convert to CSV
    const rows = barchartData.data.map(fieldMap.dataMap);
    const csv = convertToCSV(rows, fieldMap.csvHeaders);
    const filename = `${symbol}_${dataType}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    console.error('[barchart-api] Error:', error.message);
    return serverError(error.message);
  }
}
