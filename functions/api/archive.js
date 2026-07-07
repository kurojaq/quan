/* /api/archive — durable brief history (Phase 3).
   Auth: Authorization: Bearer <supabase access token>  (required)

   Stores one snapshot per user/instrument/trading-date so past Report + Heat Map
   reads can be browsed and re-published. Metadata (classification, summary) is
   kept inline in Supabase brief_history for cheap listing; the full {report,
   heatmap} payload goes to the QUAN_STATE R2 bucket (brief/ prefix), or inline in
   brief_history.payload when R2 isn't bound. All Supabase access is with the
   caller's own token, so RLS (auth.uid() = user_id) is the isolation.

     GET    /api/archive                 -> { items:[{inst,date,classification,summary,has_heatmap,updated_at}] }
     GET    /api/archive?inst=&limit=    -> same, filtered to one instrument
     GET    /api/archive?inst=&date=     -> { inst,date,report,heatmap,classification,summary }
     POST   /api/archive                 body { inst,date,report,heatmap,classification,summary }
     DELETE /api/archive?inst=&date=
*/
import { json, badRequest, unauthorized, serverError,
         getUserFromRequest, bearerToken, supaAsUser } from './_shared.js';

const R2_THRESHOLD = 32 * 1024;
const MAX_PAYLOAD  = 8 * 1024 * 1024;
const r2Key = (u, inst, date) => `brief/${u}/${encodeURIComponent(inst)}/${encodeURIComponent(date)}.json`;

// ---- GET: list, or one full snapshot ------------------------------------
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();
    const token = bearerToken(request);
    const url = new URL(request.url);
    const inst = url.searchParams.get('inst');
    const date = url.searchParams.get('date');

    if (inst && date) {
      const rows = await supaAsUser(env, token,
        `brief_history?inst=eq.${encodeURIComponent(inst)}&date=eq.${encodeURIComponent(date)}` +
        `&select=inst,date,classification,summary,in_r2,payload,has_heatmap&limit=1`);
      const row = Array.isArray(rows) && rows[0];
      if (!row) return json({ inst, date, report: null, heatmap: null });
      let payloadStr = row.payload;
      if (row.in_r2) {
        if (!env.QUAN_STATE) return serverError('snapshot in R2 but bucket not bound');
        const obj = await env.QUAN_STATE.get(r2Key(user.id, inst, date));
        payloadStr = obj ? await obj.text() : null;
      }
      let payload = {};
      try { payload = payloadStr ? JSON.parse(payloadStr) : {}; } catch (_) {}
      return json({
        inst, date,
        classification: row.classification || null,
        summary: row.summary || null,
        report: payload.report || null,
        heatmap: payload.heatmap || null
      });
    }

    // list (optionally scoped to one instrument), newest first
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 500);
    let path = 'brief_history?select=inst,date,classification,summary,has_heatmap,updated_at' +
               `&order=date.desc&limit=${limit}`;
    if (inst) path += `&inst=eq.${encodeURIComponent(inst)}`;
    const items = await supaAsUser(env, token, path);
    return json({ items: items || [] });
  } catch (err) {
    return serverError(err.message);
  }
}

// ---- POST: upsert one snapshot ------------------------------------------
export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();
    const token = bearerToken(request);

    const { inst, date, report, heatmap, classification, summary } = await request.json().catch(() => ({}));
    if (!inst || !date) return badRequest('inst and date are required');
    if (!report && !heatmap) return badRequest('nothing to archive');

    const payloadStr = JSON.stringify({ report: report || null, heatmap: heatmap || null });
    const size = new TextEncoder().encode(payloadStr).length;
    if (size > MAX_PAYLOAD) return badRequest(`snapshot exceeds ${MAX_PAYLOAD} bytes`);

    const useR2 = !!(env.QUAN_STATE && size > R2_THRESHOLD);
    if (useR2) await env.QUAN_STATE.put(r2Key(user.id, inst, date), payloadStr);

    await supaAsUser(env, token, 'brief_history?on_conflict=user_id,inst,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: {
        user_id: user.id, inst, date,
        classification: classification || null,
        summary: summary || null,
        in_r2: useR2,
        payload: useR2 ? null : payloadStr,
        has_heatmap: !!heatmap,
        updated_at: new Date().toISOString()
      }
    });
    return json({ ok: true });
  } catch (err) {
    return serverError(err.message);
  }
}

// ---- DELETE -------------------------------------------------------------
export async function onRequestDelete({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();
    const token = bearerToken(request);
    const url = new URL(request.url);
    const inst = url.searchParams.get('inst'), date = url.searchParams.get('date');
    if (!inst || !date) return badRequest('inst and date are required');

    await supaAsUser(env, token,
      `brief_history?inst=eq.${encodeURIComponent(inst)}&date=eq.${encodeURIComponent(date)}`,
      { method: 'DELETE' });
    if (env.QUAN_STATE) { try { await env.QUAN_STATE.delete(r2Key(user.id, inst, date)); } catch (_) {} }
    return json({ ok: true });
  } catch (err) {
    return serverError(err.message);
  }
}
