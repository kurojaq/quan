# Wiring Stripe subscriptions

The Qu'an sells three plans. **Scout** is free (no Stripe object). **Operator**
and **Desk** are Stripe subscriptions with a 14-day trial. The server never
trusts a price sent from the browser — the client sends `{ plan, cycle }` and the
Pages Function maps that to a price id from environment variables.

Do everything in **Test mode** first (toggle top-right in the Stripe dashboard),
then repeat in Live mode.

---

## 1. Create the products & prices

Stripe dashboard → **Product catalog → Add product**. Create two products, each
with a monthly and an annual recurring price:

| Product | Price | Interval | Env var to hold the price id |
|---|---|---|---|
| Operator | $49.00 | Monthly | `STRIPE_PRICE_OPERATOR_MONTHLY` |
| Operator | $490.00 | Yearly | `STRIPE_PRICE_OPERATOR_ANNUAL` |
| Desk | $149.00 | Monthly | `STRIPE_PRICE_DESK_MONTHLY` |
| Desk | $1,490.00 | Yearly | `STRIPE_PRICE_DESK_ANNUAL` |

Each saved price has an id like `price_1QabcXYZ…`. Copy each into the matching
Cloudflare Pages environment variable (see [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md)).

> The displayed prices/copy live in [`js/pricing.js`](js/pricing.js) (`PLANS`).
> Keep them in sync with what you configure in Stripe. The annual figures shown on
> the card are the *equivalent monthly* rate (billed yearly) — "2 months free".

---

## 2. API keys

Stripe → **Developers → API keys**. Copy the **Secret key** into
`STRIPE_SECRET_KEY` (a Pages secret). The publishable key is not needed — checkout
is created server-side and the browser is simply redirected to Stripe.

---

## 3. Webhook

1. Stripe → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://<your-domain>/api/webhook`
3. Subscribe to these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Save, then reveal the **Signing secret** (`whsec_…`) and put it in
   `STRIPE_WEBHOOK_SECRET` (a Pages secret).

The webhook handler ([`functions/api/webhook.js`](functions/api/webhook.js))
verifies the signature with Web Crypto and upserts the row into Supabase
`subscriptions` using the service-role key.

### Testing the webhook locally
```
npx stripe login
npx stripe listen --forward-to http://localhost:8788/api/webhook
```
(with `npx wrangler pages dev .` running on 8788). `stripe listen` prints a
`whsec_…` to use for local runs. Then `npx stripe trigger checkout.session.completed`.

---

## 4. Billing portal

Stripe → **Settings → Billing → Customer portal** → activate it and enable "cancel
subscription" and "update payment method". No code needed — `/api/portal` creates
portal sessions on demand from the in-app **Manage** button.

---

## 5. The end-to-end flow

```
Landing (/) ──click plan──▶ /api/checkout needs auth
   │  anonymous → 401 → client redirects to /app#plan=operator&cycle=monthly
   ▼
/app  ── user signs in (Supabase) ──▶ subscription-gate.js sees #plan=…
   │                                    → POST /api/checkout (with bearer token)
   ▼
Stripe Checkout ──pays / starts trial──▶ back to /app?checkout=success
   │
   ▼
Stripe ──webhook──▶ /api/webhook ──▶ Supabase subscriptions row (status=trialing/active)
   │
   ▼
/api/subscription ──▶ app unlocks features per window.__quanSub / __quanCan(feature)
```

Signed-in users can also upgrade directly from the in-app bar, and manage/cancel
through the Stripe portal via **Manage**.

---

## 6. Going live

1. Flip Stripe to **Live mode** and recreate products/prices/webhook there.
2. Replace every `STRIPE_*` value in Cloudflare Pages **Production** with the live
   equivalents (live secret key, live price ids, live webhook secret).
3. Do one real (or `100% off` promo-code) end-to-end purchase to confirm the row
   lands in `subscriptions` and the app unlocks.
