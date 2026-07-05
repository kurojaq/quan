/* POST /api/webhook  — Stripe webhook receiver.
   Verifies the Stripe-Signature header, then mirrors subscription state into the
   Supabase `subscriptions` table (service-role, bypasses RLS).

   Point a Stripe webhook endpoint at https://<your-site>/api/webhook and
   subscribe to at least:
     checkout.session.completed
     customer.subscription.created
     customer.subscription.updated
     customer.subscription.deleted
*/
import { verifyStripeSignature, supaAdmin } from './_shared.js';

// Map a Stripe price id back to our plan name via env, so the DB records "operator"/"desk".
function planFromPrice(env, priceId) {
  const table = {
    [env.STRIPE_PRICE_OPERATOR_MONTHLY]: 'operator',
    [env.STRIPE_PRICE_OPERATOR_ANNUAL]: 'operator',
    [env.STRIPE_PRICE_DESK_MONTHLY]: 'desk',
    [env.STRIPE_PRICE_DESK_ANNUAL]: 'desk'
  };
  return table[priceId] || null;
}

async function upsertFromSubscription(env, sub, userIdHint) {
  const userId = userIdHint || (sub.metadata && sub.metadata.supabase_user_id) || null;
  const item = sub.items && sub.items.data && sub.items.data[0];
  const priceId = item && item.price && item.price.id;
  const row = {
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    status: sub.status,                                   // trialing | active | past_due | canceled | …
    plan: planFromPrice(env, priceId),
    price_id: priceId || null,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString()
  };
  if (userId) row.user_id = userId;

  // merge on stripe_customer_id (our unique key) so repeated events stay idempotent
  await supaAdmin(env, 'subscriptions?on_conflict=stripe_customer_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: row
  });
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const sig = request.headers.get('Stripe-Signature');
  const ok = await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('invalid signature', { status: 400 });

  let event;
  try { event = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }

  try {
    const obj = event.data && event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        // session has client_reference_id (our supabase user id) + subscription id
        const userId = obj.client_reference_id || null;
        if (obj.subscription) {
          const sub = await fetchSubscription(env, obj.subscription);
          await upsertFromSubscription(env, sub, userId);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await upsertFromSubscription(env, obj, null);
        break;
      default:
        break; // ignore everything else
    }
  } catch (err) {
    // 500 tells Stripe to retry later rather than silently dropping the event
    return new Response(`handler error: ${err.message}`, { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

// small helper: pull the full subscription (checkout.session only carries its id)
async function fetchSubscription(env, id) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${id}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  if (!res.ok) throw new Error(`fetch subscription ${res.status}`);
  return res.json();
}
