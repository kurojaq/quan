/* GET /api/whoami — temporary diagnostic endpoint.
   Calls Supabase's /auth/v1/user directly (bypassing getUserFromRequest's
   null-swallowing) and returns the RAW status + body, so a 401 caused by a bad
   SUPABASE_ANON_KEY can be told apart from a genuinely bad/expired token.
   Safe to delete once the auth issue is resolved -- it doesn't touch any data.
*/
import { json } from './_shared.js';

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return json({
    hasToken: !!token,
    hasSupabaseUrl: !!env.SUPABASE_URL,
    hasAnonKey: !!env.SUPABASE_ANON_KEY,
    supabaseUrl: env.SUPABASE_URL || null,
    anonKeyLen: env.SUPABASE_ANON_KEY ? env.SUPABASE_ANON_KEY.length : 0,
    anonKeyTail: env.SUPABASE_ANON_KEY ? env.SUPABASE_ANON_KEY.slice(-12) : null,
    result: await (async () => {
      if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { skipped: true };
      try {
        const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
        });
        const body = await res.text();
        return { status: res.status, ok: res.ok, body: body.slice(0, 500) };
      } catch (e) {
        return { threw: String((e && e.message) || e) };
      }
    })()
  });
}
