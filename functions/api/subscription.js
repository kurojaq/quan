/* GET /api/subscription
   Auth: Authorization: Bearer <supabase access token>

   Returns the signed-in user's subscription state so the app can decide what to
   unlock:  { authenticated, active, plan, status, current_period_end, cancel_at_period_end }
   "active" is true for trialing or active subscriptions.
*/
import { json, unauthorized, serverError, getUserFromRequest, supaAdmin, TRIAL_PLAN } from './_shared.js';

const ACTIVE = new Set(['trialing', 'active']);

export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();

    // The app owner has no subscription row — grant full (desk) access so the
    // client-side entitlement gate never locks the operator out of their own
    // terminal. Mirrors resolveIdentity()'s operator handling in _shared.js.
    if (env.OPERATOR_EMAIL && user.email === env.OPERATOR_EMAIL) {
      return json({
        authenticated: true, active: true, plan: 'desk', status: 'active',
        current_period_end: null, cancel_at_period_end: false, operator: true
      });
    }

    const rows = await supaAdmin(env,
      `subscriptions?user_id=eq.${user.id}` +
      `&select=plan,status,current_period_end,cancel_at_period_end&limit=1`);
    const sub = Array.isArray(rows) && rows[0] ? rows[0] : null;

    // Never-subscribed account → standing full-terminal trial so every
    // registered login can evaluate the whole analytical terminal (Operator
    // tier). Paid checkout upgrades past this to unlock Prime (Execution) /
    // Desk (team + export); an existing sub row keeps its real status so the
    // billing-fix prompt still shows when a plan lapses.
    if (!sub) {
      return json({
        authenticated: true, active: true, plan: TRIAL_PLAN, status: 'trialing',
        current_period_end: null, cancel_at_period_end: false, trial: true
      });
    }

    return json({
      authenticated: true,
      active: !!ACTIVE.has(sub.status),
      plan: sub.plan,
      status: sub.status,
      current_period_end: sub.current_period_end,
      cancel_at_period_end: !!sub.cancel_at_period_end
    });
  } catch (err) {
    return serverError(err.message);
  }
}
