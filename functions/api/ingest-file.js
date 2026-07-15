/* GET /api/ingest-file?key=INST/EXP/SESSION_DATE/dataType.csv
   Auth: operator only. Streams one ingested CSV out of R2 (see
   workers/ingest-worker.js, which writes keys in exactly this shape). */
import { badRequest, serverError, requireOperator } from './_shared.js';

const KEY_RE = /^[A-Za-z0-9]{1,8}\/[^/]+\/\d{4}-\d{2}-\d{2}\/(optionPrices|volatility|greeks)\.csv$/;

export async function onRequestGet({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const key = new URL(request.url).searchParams.get('key');
    if (!key || !KEY_RE.test(key)) return badRequest('invalid or missing key');
    if (!env.QUAN_INGEST_BUCKET) return serverError('QUAN_INGEST_BUCKET binding missing — bind the quan-ingest R2 bucket in the Pages dashboard');

    const obj = await env.QUAN_INGEST_BUCKET.get(key);
    if (!obj) return new Response('not found', { status: 404 });
    return new Response(obj.body, { headers: { 'Content-Type': 'text/csv', 'Cache-Control': 'private, max-age=300' } });
  } catch (err) {
    return serverError(err.message);
  }
}
