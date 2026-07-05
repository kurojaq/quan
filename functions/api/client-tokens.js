/* /api/client-tokens — manage the shareable links clients use to reach view.html.
   Auth: Authorization: Bearer <supabase access token>  (operator only)

   POST   { label, instruments:[...] }  -> creates a token, returns { token, url }
   GET    (no body)                     -> lists all existing links
   DELETE ?token=X                      -> revokes a link
*/
import { json, badRequest, serverError, requireOperator, siteOrigin } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const { label, instruments } = await request.json().catch(() => ({}));
    if (!label || !Array.isArray(instruments) || !instruments.length) {
      return badRequest('label and a non-empty instruments array are required');
    }

    const token = crypto.randomUUID();
    const row = { label, instruments, createdAt: new Date().toISOString() };
    await env.QUAN_PUBLISH.put(`token:${token}`, JSON.stringify(row));

    return json({ token, url: `${siteOrigin(env, request)}/view.html?token=${token}`, ...row });
  } catch (err) {
    return serverError(err.message);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const { keys } = await env.QUAN_PUBLISH.list({ prefix: 'token:' });
    const rows = await Promise.all(keys.map(async (k) => {
      const raw = await env.QUAN_PUBLISH.get(k.name);
      const data = raw ? JSON.parse(raw) : {};
      return { token: k.name.slice('token:'.length), ...data };
    }));
    return json({ tokens: rows });
  } catch (err) {
    return serverError(err.message);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const token = new URL(request.url).searchParams.get('token');
    if (!token) return badRequest('token query param is required');
    await env.QUAN_PUBLISH.delete(`token:${token}`);
    return json({ ok: true });
  } catch (err) {
    return serverError(err.message);
  }
}
