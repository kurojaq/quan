/* GET /api/view?token=X
   Public — no Supabase auth. The token itself is the secret (see client-tokens.js).

   Returns the last 3 published days for every instrument the token is scoped to:
     { label, instruments, snapshots: { <inst>: [{date, publishedAt, report, heatmap}, ...] } }
   Snapshots are newest-first. Publishing keys carry a 4-day KV TTL (see publish.js)
   as a backstop, but the real "3 days back" limit is enforced here.
*/
import { json, badRequest } from './_shared.js';

const MAX_DAYS = 3;

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return badRequest('token query param is required');

  const raw = await env.QUAN_PUBLISH.get(`token:${token}`);
  if (!raw) return json({ error: 'unknown or revoked link' }, 404);
  const { label, instruments } = JSON.parse(raw);

  const snapshots = {};
  for (const inst of instruments) {
    const { keys } = await env.QUAN_PUBLISH.list({ prefix: `pub:${inst}:` });
    const dates = keys.map((k) => k.name.slice(`pub:${inst}:`.length)).sort().reverse().slice(0, MAX_DAYS);
    const rows = await Promise.all(dates.map(async (d) => {
      const v = await env.QUAN_PUBLISH.get(`pub:${inst}:${d}`);
      return v ? JSON.parse(v) : null;
    }));
    snapshots[inst] = rows.filter(Boolean);
  }

  return json({ label, instruments, snapshots });
}
