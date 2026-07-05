/* GET /api/subscription
   Auth: Authorization: Bearer <supabase access token>

   Returns the signed-in user's subscription state so the app can decide what to
   unlock:  { authenticated, active, plan, status, current_period_end, cancel_at_period_end }
   "active" is true for trialing or active subscriptions.
*/
import { json, unauthorized, serverError, getUserFromRequest, supaAdmin } from './_shared.js';

const ACTIVE = new Set(['trialing', 'active']);

export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();

    const rows = await supaAdmin(env,
      `subscriptions?user_id=eq.${user.id}` +
      `&select=plan,status,current_period_end,cancel_at_period_end&limit=1`);
    const sub = Array.isArray(rows) && rows[0] ? rows[0] : null;

    return json({
      authenticated: true,
      active: !!(sub && ACTIVE.has(sub.status)),
      plan: sub ? sub.plan : null,
      status: sub ? sub.status : 'none',
      current_period_end: sub ? sub.current_period_end : null,
      cancel_at_period_end: sub ? !!sub.cancel_at_period_end : false
    });
  } catch (err) {
    return serverError(err.message);
  }
}
