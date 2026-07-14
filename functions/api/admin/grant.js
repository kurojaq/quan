/* POST /api/admin/grant  — owner-only privilege control for the admin dashboard.
   Auth: Authorization: Bearer <supabase access token>  (must be OPERATOR_EMAIL)
   Body: { user_id, plan, status? }
     plan:   'operator' | 'prime' | 'desk'   → grant that tier
             'revoke' | 'none' | 'scout'      → drop the manual grant (back to the standing trial)
     status: 'active' (default) | 'trialing'  → how the grant reads to the gates

   This writes the same `subscriptions` row that every access gate already reads
   (planForUser / /api/subscription / execution.js), so a change takes effect on
   the user's next request — no new read path. Manual grants are flagged with
   stripe_subscription_id = 'manual' so they are distinguishable from, and never
   overwrite, a real Stripe subscription.
*/
import { json, badRequest, serverError, requireOperator, supaAdmin } from '../_shared.js';

const PLANS = new Set(['operator', 'prime', 'desk']);
const REVOKE = new Set(['revoke', 'none', 'scout', '']);
const STATUSES = new Set(['active', 'trialing']);
const MANUAL = 'manual';

async function clearPlanCache(env, userId) {
  try { if (env.QUAN_PUBLISH) await env.QUAN_PUBLISH.delete(`plan:${userId}`); } catch (_) {}
}

export async function onRequestPost({ request, env }) {
  try {
    const gate = await requireOperator(env, request);
    if (gate instanceof Response) return gate;

    const body = await request.json().catch(() => ({}));
    const userId = String(body.user_id || '').trim();
    const plan = String(body.plan || '').trim().toLowerCase();
    if (!/^[0-9a-f-]{10,}$/i.test(userId)) return badRequest('valid user_id required');

    // Look at any existing row first so we never stomp a live Stripe subscription.
    const rows = await supaAdmin(env,
      `subscriptions?user_id=eq.${userId}&select=stripe_subscription_id`);
    const cur = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const isStripe = !!(cur && cur.stripe_subscription_id && cur.stripe_subscription_id !== MANUAL);
    if (isStripe) {
      return json({ error: 'This user has a live Stripe subscription — manage it in Stripe, not here.' }, 409);
    }

    // Revoke → remove the manual override; the user falls back to the standing trial.
    if (REVOKE.has(plan)) {
      if (cur) {
        await supaAdmin(env,
          `subscriptions?user_id=eq.${userId}&stripe_subscription_id=eq.${MANUAL}`,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      }
      await clearPlanCache(env, userId);
      return json({ ok: true, user_id: userId, action: 'revoked' });
    }

    if (!PLANS.has(plan)) return badRequest('plan must be one of operator, prime, desk, or revoke');
    const status = STATUSES.has(body.status) ? body.status : 'active';

    // Upsert on user_id (unique) — merge so we only touch the columns we send,
    // leaving stripe_customer_id null for a comp account.
    await supaAdmin(env, 'subscriptions?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: {
        user_id: userId,
        plan: plan,
        status: status,
        stripe_subscription_id: MANUAL,
        current_period_end: null,
        cancel_at_period_end: false,
        updated_at: new Date().toISOString()
      }
    });

    await clearPlanCache(env, userId);
    return json({ ok: true, user_id: userId, plan: plan, status: status, source: MANUAL });
  } catch (err) {
    return serverError(err.message);
  }
}

export const onRequestGet = () => json({ error: 'POST only' }, 405);
