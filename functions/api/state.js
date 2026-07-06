/* /api/state — roaming per-user key/value store (Phase 2: stateful workspaces).
   Auth: Authorization: Bearer <supabase access token>  (required)

   The client's cloud-storage layer (js/cloud-storage.js) mirrors the terminal's
   localStorage keyspace here so a workspace follows the user across devices.

     GET    /api/state              -> { keys: { "<key>": <updated_at_ms>, ... } }   (manifest)
     GET    /api/state?key=K        -> { key, value, updated_at }                     (one value)
     PUT    /api/state              body { items:[{key,value,updated_at}] } | {key,value,updated_at}
     DELETE /api/state?key=K        -> { ok: true }

   Storage routing: small values live inline in Supabase user_state.value; values
   over ~48 KB (option-chain CSVs) go to the QUAN_STATE R2 bucket when it's bound,
   otherwise they fall back to inline (subject to MAX_VALUE). All Supabase access
   uses the caller's own token, so RLS (auth.uid() = user_id) is the isolation.
*/
import { json, badRequest, unauthorized, serverError,
         getUserFromRequest, bearerToken, supaAsUser } from './_shared.js';

const R2_THRESHOLD = 48 * 1024;         // above this, prefer R2
const MAX_VALUE   = 8 * 1024 * 1024;    // hard cap per value (reject beyond)

const byteLen = (s) => (s ? new TextEncoder().encode(s).length : 0);
const r2Key = (userId, key) => `state/${userId}/${encodeURIComponent(key)}`;

// ---- GET ----------------------------------------------------------------
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();
    const token = bearerToken(request);
    const key = new URL(request.url).searchParams.get('key');

    if (!key) {
      // manifest: every key + its updated_at (as epoch ms) for LWW comparison
      const rows = await supaAsUser(env, token, 'user_state?select=key,updated_at');
      const keys = {};
      for (const r of rows || []) keys[r.key] = Date.parse(r.updated_at) || 0;
      return json({ keys });
    }

    const rows = await supaAsUser(env, token,
      `user_state?key=eq.${encodeURIComponent(key)}&select=key,value,in_r2,updated_at&limit=1`);
    const row = Array.isArray(rows) && rows[0];
    if (!row) return json({ key, value: null, updated_at: null });

    let value = row.value;
    if (row.in_r2) {
      if (!env.QUAN_STATE) return serverError('value stored in R2 but bucket not bound');
      const obj = await env.QUAN_STATE.get(r2Key(user.id, key));
      value = obj ? await obj.text() : null;
    }
    return json({ key, value, updated_at: Date.parse(row.updated_at) || 0 });
  } catch (err) {
    return serverError(err.message);
  }
}

// ---- PUT (single or batch) ---------------------------------------------
export async function onRequestPut({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();
    const token = bearerToken(request);

    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items
                : (body.key ? [body] : null);
    if (!items || !items.length) return badRequest('key/value or items[] required');

    const rows = [];
    for (const it of items) {
      if (!it || typeof it.key !== 'string') return badRequest('each item needs a string key');
      const value = it.value == null ? null : String(it.value);
      const size = byteLen(value);
      if (size > MAX_VALUE) return badRequest(`value for "${it.key}" exceeds ${MAX_VALUE} bytes`);
      const when = it.updated_at ? new Date(Number(it.updated_at)).toISOString() : new Date().toISOString();

      // >48 KB goes to R2 when bound; otherwise it falls back to inline Supabase
      // (already capped at MAX_VALUE above).
      const useR2 = !!(env.QUAN_STATE && value != null && size > R2_THRESHOLD);
      if (useR2) await env.QUAN_STATE.put(r2Key(user.id, it.key), value);
      rows.push({
        user_id: user.id,
        key: it.key,
        value: useR2 ? null : value,
        in_r2: useR2,
        size,
        updated_at: when
      });
    }

    // single upsert for the whole batch (conflict target = PK user_id,key)
    await supaAsUser(env, token, 'user_state?on_conflict=user_id,key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rows
    });

    return json({ ok: true, count: rows.length });
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
    const key = new URL(request.url).searchParams.get('key');
    if (!key) return badRequest('key query param required');

    await supaAsUser(env, token, `user_state?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (env.QUAN_STATE) { try { await env.QUAN_STATE.delete(r2Key(user.id, key)); } catch (_) {} }
    return json({ ok: true });
  } catch (err) {
    return serverError(err.message);
  }
}
