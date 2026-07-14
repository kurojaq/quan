/* GET /api/admin/users  — owner-only user roster for the admin dashboard.
   Auth: Authorization: Bearer <supabase access token>  (must be OPERATOR_EMAIL)

   Returns every registered account joined to its subscription row so the
   dashboard can show, and change, each user's access tier. Read-only; the
   actual privilege change happens in POST /api/admin/grant.

   Shape: { operator, count, trial_plan, users: [{
     id, email, created_at, last_sign_in_at,
     plan, status, source, active, effective_plan, current_period_end
   }] }
   - plan/status/source describe the DB row ('manual' = an admin grant,
     'stripe' = a real subscription, 'none' = never subscribed).
   - effective_plan is what the user actually gets right now: their active
     plan, or the standing trial tier when they have no active paid plan.
*/
import { json, serverError, requireOperator, supaAdmin, TRIAL_PLAN } from '../_shared.js';

const ACTIVE = new Set(['trialing', 'active']);

// Supabase Auth admin API (all auth.users, regardless of a profiles row).
async function listAuthUsers(env) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.msg || data.message)) || `Supabase auth ${res.status}`);
  // the endpoint returns { users: [...] } (or, on some versions, a bare array)
  return Array.isArray(data) ? data : (data && data.users) || [];
}

export async function onRequestGet({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const [authUsers, subs] = await Promise.all([
      listAuthUsers(env),
      supaAdmin(env, 'subscriptions?select=user_id,plan,status,stripe_subscription_id,current_period_end,cancel_at_period_end')
        .catch(() => [])
    ]);

    const byUser = {};
    for (const s of (subs || [])) if (s.user_id) byUser[s.user_id] = s;

    const users = authUsers.map(function (u) {
      const s = byUser[u.id] || null;
      const active = !!(s && ACTIVE.has(s.status));
      const manual = !!(s && s.stripe_subscription_id === 'manual');
      return {
        id: u.id,
        email: u.email || (s && s.email) || null,
        created_at: u.created_at || null,
        last_sign_in_at: u.last_sign_in_at || null,
        plan: s ? s.plan : null,
        status: s ? s.status : 'none',
        source: manual ? 'manual' : (s ? 'stripe' : 'none'),
        active: active,
        effective_plan: active ? s.plan : TRIAL_PLAN,   // standing trial when no active paid plan
        current_period_end: s ? s.current_period_end : null
      };
    });

    // newest accounts first
    users.sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });

    return json({ operator: gate.email, count: users.length, trial_plan: TRIAL_PLAN, users: users });
  } catch (err) {
    return serverError(err.message);
  }
}

export const onRequestPost = () => json({ error: 'GET only' }, 405);
