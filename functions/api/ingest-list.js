/* GET /api/ingest-list?inst=ZN
   Auth: operator only. Lists every successfully-ingested file (from the Drive
   auto-pull, see workers/ingest-worker.js) for one instrument, newest first —
   the terminal calendar uses this to know which session dates have data. */
import { json, badRequest, serverError, requireOperator } from './_shared.js';

export async function onRequestGet({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const inst = new URL(request.url).searchParams.get('inst');
    if (!inst) return badRequest('inst is required');
    if (!env.QUAN_INGEST_DB) return serverError('QUAN_INGEST_DB binding missing — bind the quan-ingest D1 database in the Pages dashboard');

    const { results } = await env.QUAN_INGEST_DB.prepare(
      `SELECT session_date, expiration, data_type, storage_key, processed_ts
       FROM ingest_files WHERE instrument = ? AND status = 'ok' ORDER BY session_date DESC`
    ).bind(inst).all();

    return json({ inst, files: results || [] });
  } catch (err) {
    return serverError(err.message);
  }
}
