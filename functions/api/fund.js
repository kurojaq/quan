/* /api/fund — server-side persistence for the Fund Portal (fund.html).
   Auth: operator only (Authorization: Bearer <supabase access token>).

   GET  -> { state, savedAt } | { state:null }   the whole fund state blob
   PUT  { state } -> { ok, savedAt }              overwrite the fund state blob

   Stored as a single JSON value in the QUAN_PUBLISH KV namespace under one key.
   The fund state (entries, client profiles, trades, settings, activity) is small,
   so a single blob is the simplest durable store; the browser keeps a localStorage
   copy as an offline fallback and pushes here on every change. */
import { json, badRequest, serverError, requireOperator } from './_shared.js';

const KEY = 'fund:main:state';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB guard — fund blobs are tiny; this is abuse protection

export async function onRequestGet({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;
    if (!env.QUAN_PUBLISH) return serverError('QUAN_PUBLISH KV binding missing');
    const raw = await env.QUAN_PUBLISH.get(KEY);
    if (!raw) return json({ state: null });
    let parsed; try { parsed = JSON.parse(raw); } catch { parsed = { state: null }; }
    return json(parsed);
  } catch (err) {
    return serverError(err.message);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;
    if (!env.QUAN_PUBLISH) return serverError('QUAN_PUBLISH KV binding missing');
    const body = await request.json().catch(() => null);
    if (!body || typeof body.state !== 'object' || body.state === null) {
      return badRequest('body must be { state: {...} }');
    }
    const savedAt = new Date().toISOString();
    const serialized = JSON.stringify({ state: body.state, savedAt });
    if (serialized.length > MAX_BYTES) return badRequest('fund state exceeds size limit');
    await env.QUAN_PUBLISH.put(KEY, serialized);
    return json({ ok: true, savedAt });
  } catch (err) {
    return serverError(err.message);
  }
}

export const onRequestPost = ({ request, env }) => onRequestPut({ request, env });
