/* POST /api/portal
   Auth: Authorization: Bearer <supabase access token>

   Returns a Stripe Billing Portal URL so the user can change plan, update card,
   or cancel. The client redirects the browser to { url }.
*/
import { json, unauthorized, serverError, badRequest,
         stripe, getUserFromRequest, supaAdmin, siteOrigin } from './_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(env, request);
    if (!user) return unauthorized();

    const rows = await supaAdmin(env,
      `subscriptions?user_id=eq.${user.id}&select=stripe_customer_id&limit=1`);
    const customerId = Array.isArray(rows) && rows[0] ? rows[0].stripe_customer_id : null;
    if (!customerId) return badRequest('no billing account yet');

    const origin = siteOrigin(env, request);
    const session = await stripe(env, 'billing_portal/sessions', {
      customer: customerId,
      return_url: `${origin}/app`
    });
    return json({ url: session.url });
  } catch (err) {
    return serverError(err.message);
  }
}

export const onRequestGet = () => badRequest('POST only');
