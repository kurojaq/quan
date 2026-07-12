/* POST /api/publish
   Auth: Authorization: Bearer <supabase access token>  (must be the operator — see OPERATOR_EMAIL)
   Body: { inst, date, report, heatmap }

   Writes the operator's already-computed Report + Heat Map output for one
   instrument/date to KV so the client-facing view (view.html, via /api/view)
   can read it without ever touching a raw chain or running the engine itself.
   Keys expire after 4 days, which is the actual server-side enforcement of the
   "3 days back" limit — /api/view additionally only ever returns the 3 newest.
*/
import { json, badRequest, serverError, requireOperator } from './_shared.js';

const TTL_SEC = 4 * 86400;

export async function onRequestPost({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const { inst, date, report, heatmap } = await request.json().catch(() => ({}));
    if (!inst || !date) return badRequest('inst and date are required');
    if (String(inst).length > 32 || String(date).length > 32) return badRequest('inst/date too long');

    const key = `pub:${inst}:${date}`;
    const value = { inst, date, publishedAt: new Date().toISOString(), report: report || null, heatmap: heatmap || null };
    const serialized = JSON.stringify(value);
    if (serialized.length > 2 * 1024 * 1024) return badRequest('published payload exceeds 2 MB');
    await env.QUAN_PUBLISH.put(key, serialized, { expirationTtl: TTL_SEC });

    return json({ ok: true, key });
  } catch (err) {
    return serverError(err.message);
  }
}

export const onRequestGet = () => badRequest('POST only');
