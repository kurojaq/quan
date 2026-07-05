/* POST /api/checkout
   Body: { plan: "operator" | "desk", cycle: "monthly" | "annual" }
   Auth: Authorization: Bearer <supabase access token>  (required)

   Finds or creates the Stripe customer for the signed-in user, then returns a
   Stripe Checkout Session URL for a 14-day-trial subscription. The client
   redirects the browser to { url }. Anonymous callers get 401 so the landing
   page can bounce them to /app to sign in first.
*/
import {
  json, badRequest, unauthorized, serverError,
  priceIdFor, stripe, getUserFromRequest, supaAdmin, siteOrigin
} from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();

    const { plan, cycle } = await request.json().catch(() => ({}));
    if (plan === 'scout') return badRequest('scout is free — no checkout needed');
    const price = priceIdFor(env, plan, cycle);
    if (!price) return badRequest('unknown plan or cycle');

    // reuse an existing Stripe customer id if we've stored one, else create it
    let customerId = null;
    const rows = await supaAdmin(env,
      `subscriptions?user_id=eq.${user.id}&select=stripe_customer_id&limit=1`);
    if (Array.isArray(rows) && rows[0] && rows[0].stripe_customer_id) {
      customerId = rows[0].stripe_customer_id;
    }
    if (!customerId) {
      const customer = await stripe(env, 'customers', {
        email: user.email,
        metadata: { supabase_user_id: user.id }
      });
      customerId = customer.id;
      // stash it immediately so we never create a duplicate customer
      await supaAdmin(env, 'subscriptions?on_conflict=user_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { user_id: user.id, email: user.email, stripe_customer_id: customerId, status: 'incomplete' }
      });
    }

    const origin = siteOrigin(env, request);
    const session = await stripe(env, 'checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { supabase_user_id: user.id, plan }
      },
      allow_promotion_codes: true,
      success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#pricing`
    });

    return json({ url: session.url });
  } catch (err) {
    return serverError(err.message);
  }
}

// Reject non-POST verbs cleanly.
export const onRequestGet = () => badRequest('POST only');
