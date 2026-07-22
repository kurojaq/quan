/**
 * Ingest Execution Mastery Performance CSV (Tradovate export)
 *
 * CSV Format:
 *   symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,
 *   buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration
 *
 * Flow:
 *   1. Parse CSV rows
 *   2. Query morphology classifier @ buyTimestamp
 *   3. Query Greeks @ buyTimestamp
 *   4. Calculate derived metrics
 *   5. Insert into execution_ledger (immutable)
 *   6. Record prediction (if model available)
 *   7. Trigger aggregation into morphology_performance
 */

import { v4 as uuid } from 'uuid';

interface PerformanceCSVRow {
  symbol: string;
  priceFormat: number;
  priceFormatType: number;
  tickSize: number;
  buyFillId: string;
  sellFillId: string;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  pnl: number;
  boughtTimestamp: string;  // "07/22/2026 08:48:01"
  soldTimestamp: string;    // "07/21/2026 14:19:06"
  duration: string;         // "18h 28min 55sec"
}

interface ExecutionRecord {
  tradeId: string;
  userId: string;
  symbol: string;
  tickSize: number;
  qty: number;

  // Entry (immutable)
  buyTimestamp: Date;
  buyPrice: number;
  buyGreeks: Record<string, number>;
  buyMorphology: string;
  buyIV: number;
  buyFillId: string;

  // Exit
  sellTimestamp: Date;
  sellPrice: number;
  sellGreeks?: Record<string, number>;
  sellFillId: string;

  // P&L
  pnl: number;
  profitTicks: number;
  holdMinutes: number;
  roi: number;

  // Feedback
  prediction: number;  // 0-1 (model prediction @ entry)
  outcome: number;     // 1=win, 0=loss
  brierScore: number;  // (prediction - outcome)^2
  modelVersion: string;

  createdAt: Date;
}

/**
 * Parse Tradovate Performance CSV
 */
function parseCSV(csvText: string): PerformanceCSVRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have header + data rows');

  const header = lines[0].split(',');
  const rows: PerformanceCSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length < 13) continue;  // Skip incomplete rows

    const row: PerformanceCSVRow = {
      symbol: values[0].trim(),
      priceFormat: parseInt(values[1]),
      priceFormatType: parseInt(values[2]),
      tickSize: parseFloat(values[3]),
      buyFillId: values[4].trim(),
      sellFillId: values[5].trim(),
      qty: parseInt(values[6]),
      buyPrice: parseFloat(values[7]),
      sellPrice: parseFloat(values[8]),
      pnl: parsePnL(values[9]),  // Handle "$124,200.00" format
      boughtTimestamp: values[10].trim(),
      soldTimestamp: values[11].trim(),
      duration: values[12].trim(),
    };

    rows.push(row);
  }

  return rows;
}

/**
 * Parse P&L string ($124,200.00 format)
 */
function parsePnL(pnlStr: string): number {
  return parseFloat(pnlStr.replace(/[$,]/g, ''));
}

/**
 * Parse timestamp (07/22/2026 08:48:01)
 */
function parseTimestamp(tsStr: string): Date {
  const [date, time] = tsStr.split(' ');
  const [month, day, year] = date.split('/').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);

  return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * Parse duration (18h 28min 55sec)
 */
function parseDuration(durStr: string): number {
  let minutes = 0;

  const hourMatch = durStr.match(/(\d+)h/);
  if (hourMatch) minutes += parseInt(hourMatch[1]) * 60;

  const minMatch = durStr.match(/(\d+)min/);
  if (minMatch) minutes += parseInt(minMatch[1]);

  const secMatch = durStr.match(/(\d+)sec/);
  if (secMatch) minutes += Math.ceil(parseInt(secMatch[1]) / 60);

  return minutes;
}

/**
 * Calculate profit in ticks
 */
function calculateProfitTicks(buyPrice: number, sellPrice: number, tickSize: number): number {
  return Math.round((sellPrice - buyPrice) / tickSize);
}

/**
 * Transform CSV row to execution record
 */
async function transformRow(
  row: PerformanceCSVRow,
  userId: string,
  env: Env,
  currentModelVersion: string
): Promise<ExecutionRecord> {
  const buyTimestamp = parseTimestamp(row.boughtTimestamp);
  const sellTimestamp = parseTimestamp(row.soldTimestamp);
  const holdMinutes = parseDuration(row.duration);
  const profitTicks = calculateProfitTicks(row.buyPrice, row.sellPrice, row.tickSize);
  const roi = (row.pnl / (row.buyPrice * row.qty * 100)) * 100;  // Contracts are 100x
  const outcome = row.pnl > 0 ? 1 : 0;

  // Get morphology @ buy time (from classifier)
  const buyMorphology = await getMorphologyAtTime(
    row.symbol,
    buyTimestamp,
    env
  );

  // Get Greeks @ buy time
  const buyGreeks = await getGreeksAtTime(
    row.symbol,
    buyTimestamp,
    env
  );

  // Get model prediction @ entry time
  const prediction = await getModelPrediction(buyMorphology, currentModelVersion, env);
  const brierScore = Math.pow(prediction - outcome, 2);

  return {
    tradeId: uuid(),
    userId,
    symbol: row.symbol,
    tickSize: row.tickSize,
    qty: row.qty,

    // Entry (immutable)
    buyTimestamp,
    buyPrice: row.buyPrice,
    buyGreeks,
    buyMorphology,
    buyIV: buyGreeks.iv || 0,
    buyFillId: row.buyFillId,

    // Exit
    sellTimestamp,
    sellPrice: row.sellPrice,
    sellGreeks: {},  // Optional: fetch if needed
    sellFillId: row.sellFillId,

    // P&L
    pnl: row.pnl,
    profitTicks,
    holdMinutes,
    roi,

    // Feedback
    prediction,
    outcome,
    brierScore,
    modelVersion: currentModelVersion,

    createdAt: new Date(),
  };
}

/**
 * Get morphology classification @ specific timestamp
 * Falls back to current if historical lookup unavailable
 */
async function getMorphologyAtTime(
  symbol: string,
  timestamp: Date,
  env: Env
): Promise<string> {
  try {
    // Query morphology classifier @ historical time
    const classifierUrl = `${env.CLASSIFIER_API}/classify?symbol=${symbol}&timestamp=${timestamp.toISOString()}`;
    const response = await fetch(classifierUrl, {
      headers: { 'Authorization': `Bearer ${env.CLASSIFIER_TOKEN}` }
    });

    if (!response.ok) throw new Error('Classifier API failed');

    const data = await response.json() as { morphology: string };
    return data.morphology;
  } catch (e) {
    console.warn(`Failed to get morphology for ${symbol} @ ${timestamp}:`, e);
    // Fallback: return 'unknown' (don't guess)
    return 'unknown';
  }
}

/**
 * Get Greeks @ specific timestamp
 */
async function getGreeksAtTime(
  symbol: string,
  timestamp: Date,
  env: Env
): Promise<Record<string, number>> {
  try {
    const greeksUrl = `${env.GREEKS_API}/compute?symbol=${symbol}&timestamp=${timestamp.toISOString()}`;
    const response = await fetch(greeksUrl, {
      headers: { 'Authorization': `Bearer ${env.GREEKS_TOKEN}` }
    });

    if (!response.ok) throw new Error('Greeks API failed');

    const data = await response.json() as Record<string, number>;
    return {
      delta: data.delta || 0,
      gamma: data.gamma || 0,
      vega: data.vega || 0,
      theta: data.theta || 0,
      iv: data.iv || 0,
    };
  } catch (e) {
    console.warn(`Failed to get Greeks for ${symbol} @ ${timestamp}:`, e);
    return { delta: 0, gamma: 0, vega: 0, theta: 0, iv: 0 };
  }
}

/**
 * Get model prediction for morphology
 */
async function getModelPrediction(
  morphology: string,
  modelVersion: string,
  env: Env
): Promise<number> {
  try {
    const modelUrl = `${env.MODEL_API}/predict?morphology=${morphology}&version=${modelVersion}`;
    const response = await fetch(modelUrl, {
      headers: { 'Authorization': `Bearer ${env.MODEL_TOKEN}` }
    });

    if (!response.ok) throw new Error('Model API failed');

    const data = await response.json() as { prediction: number };
    return Math.max(0, Math.min(1, data.prediction));  // Clamp to [0, 1]
  } catch (e) {
    console.warn(`Failed to get model prediction for ${morphology}:`, e);
    // Fallback: 50% (uninformed)
    return 0.5;
  }
}

/**
 * Insert record into D1
 */
async function insertExecutionRecord(
  record: ExecutionRecord,
  db: D1Database
): Promise<void> {
  await db.prepare(`
    INSERT INTO execution_ledger (
      tradeId, userId, symbol, tickSize, qty,
      buyTimestamp, buyPrice, buyGreeks, buyMorphology, buyIV, buyFillId,
      sellTimestamp, sellPrice, sellFillId,
      pnl, profitTicks, holdMinutes, roi,
      prediction, outcome, brierScore, modelVersion,
      createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    record.tradeId,
    record.userId,
    record.symbol,
    record.tickSize,
    record.qty,
    record.buyTimestamp.toISOString(),
    record.buyPrice,
    JSON.stringify(record.buyGreeks),
    record.buyMorphology,
    record.buyIV,
    record.buyFillId,
    record.sellTimestamp.toISOString(),
    record.sellPrice,
    record.sellFillId,
    record.pnl,
    record.profitTicks,
    record.holdMinutes,
    record.roi,
    record.prediction,
    record.outcome,
    record.brierScore,
    record.modelVersion,
    record.createdAt.toISOString()
  ).run();
}

/**
 * Main ingestion handler
 */
export async function handleIngestExecutionCSV(
  csvText: string,
  userId: string,
  env: Env
): Promise<{ inserted: number; failed: number; errors: string[] }> {
  const results = { inserted: 0, failed: 0, errors: [] as string[] };

  try {
    // Parse CSV
    const rows = parseCSV(csvText);
    console.log(`Parsed ${rows.length} execution records`);

    // Get current model version (from D1)
    const modelRow = await env.DB.prepare(
      'SELECT modelVersion FROM learning_loop_feedback ORDER BY feedbackTimestamp DESC LIMIT 1'
    ).first<{ modelVersion: string }>();
    const currentModelVersion = modelRow?.modelVersion || 'v1.0-baseline';

    // Transform and insert each row
    for (const row of rows) {
      try {
        const record = await transformRow(row, userId, env, currentModelVersion);
        await insertExecutionRecord(record, env.DB);
        results.inserted++;
      } catch (e) {
        results.failed++;
        results.errors.push(`Row ${row.symbol}: ${String(e)}`);
      }
    }

    console.log(`Ingestion complete: ${results.inserted} inserted, ${results.failed} failed`);

    return results;
  } catch (e) {
    results.errors.push(`Fatal: ${String(e)}`);
    throw e;
  }
}

/**
 * Cloudflare Pages API endpoint
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Auth check
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get user from token (stub; replace with real auth)
    const token = auth.slice(7);
    const userId = await verifyToken(token, env);
    if (!userId) {
      return new Response('Invalid token', { status: 401 });
    }

    // Parse CSV body
    const csvText = await request.text();

    try {
      const results = await handleIngestExecutionCSV(csvText, userId, env);

      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Verify JWT token (stub)
 */
async function verifyToken(token: string, env: Env): Promise<string | null> {
  // TODO: implement JWT verification
  // For now, just check if token exists in session store
  return 'user-123';  // Stub
}

// Environment bindings
interface Env {
  DB: D1Database;
  CLASSIFIER_API: string;
  CLASSIFIER_TOKEN: string;
  GREEKS_API: string;
  GREEKS_TOKEN: string;
  MODEL_API: string;
  MODEL_TOKEN: string;
}
