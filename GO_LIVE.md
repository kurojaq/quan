# Qu'an — Go-Live Runbook (trial seats)

The single ordered checklist to take the terminal from "code is ready" to "a
stranger can start a paid trial." Everything in the repo (pricing, auth, paywall,
security headers, DB migration) is already wired — what remains is external
configuration that needs **your** accounts and keys.

Legend: 🔑 = needs your keys/dashboard (only you can do) · ✅ = already done in the
repo/DB · 🧪 = a test to run before trusting it.

---

## 0. What's already done ✅
- 4-tier pricing (Scout $0 / Operator $99 / Prime $249 / Desk $699) in `js/pricing.js`,
  `index.html`, entitlement map in `js/subscription-gate.js`.
- Self-serve sign-up / password-reset / recovery in `js/auth.js`.
- Hard paywall (`js/entitlement-gate.js`) — locked tabs refuse to open, show an upgrade sheet.
- Operator override in `/api/subscription` so you're never locked out of your own terminal.
- Security: `whoami` diagnostic removed, `_headers` (HSTS/CSP/clickjacking/permissions),
  execution-action allowlist, input caps on operator KV writes.
- `brief_history` table applied to the live Supabase project (RLS on).

---

## 1. Supabase — Auth config 🔑
Dashboard → project `guyscjcqvgffitsxuzxx` → **Authentication**:
1. **Providers → Email**: enable **Confirm email** (recommended for fund-grade) — see the trade-off note below.
2. **Policies → Password**: set **minimum length 8** (matches `MIN_PW` in `js/auth.js`) and
   enable **Leaked password protection** (this clears the one outstanding security advisor). 🧪 re-run advisors after.
3. **URL Configuration**: set **Site URL** to `https://app.husrihtlaefan.org` and add these to
   **Redirect URLs**: `https://app.husrihtlaefan.org/app`, `https://app.husrihtlaefan.org/**`
   (the sign-up confirm + password-reset links redirect here).
4. **SMTP**: configure a real sender (Auth → Emails → SMTP). The default Supabase mailer is
   rate-limited and lands in spam — required for confirm/reset emails to actually arrive.

> **Trade-off — Confirm email ON vs OFF.** ON is more secure but the pricing hand-off
> (`/app#plan=prime`) is lost across the email round-trip, so a new user finishes signup,
> confirms, signs in, then has to click the plan again. OFF gives a seamless trial funnel
> (signup → immediate session → auto-checkout) and abuse is already gated by the card
> required at Stripe checkout. Pick per your risk appetite; both work.

## 2. Stripe — products, keys, webhook 🔑
Do it all in **Test mode** first. Full detail in [STRIPE_SETUP.md](STRIPE_SETUP.md).
1. Create **Operator / Prime / Desk** products with the 6 prices from the table in STRIPE_SETUP.md §1.
2. Copy the 6 `price_…` ids into the matching `STRIPE_PRICE_*` Pages env vars (step 3).
3. `STRIPE_SECRET_KEY` = your secret key (Pages **secret**).
4. Webhook → endpoint `https://app.husrihtlaefan.org/api/webhook`, events:
   `checkout.session.completed`, `customer.subscription.created/updated/deleted`.
   Put the signing secret in `STRIPE_WEBHOOK_SECRET` (Pages **secret**).
5. **Billing → Customer portal**: activate + allow cancel/update-payment (powers the in-app **Manage** button).

## 3. Cloudflare Pages — env vars & bindings 🔑
Project **quan** → Settings → **Environment variables** (set for **Production**; repeat for Preview if used):

| Name | Kind | Value |
|---|---|---|
| `SUPABASE_URL` | var | `https://guyscjcqvgffitsxuzxx.supabase.co` |
| `SUPABASE_ANON_KEY` | var | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | service-role key (webhook writes only) |
| `OPERATOR_EMAIL` | var | your account email (grants owner/desk access) |
| `APP_BASE_URL` | var | `https://app.husrihtlaefan.org` |
| `STRIPE_SECRET_KEY` | **secret** | `sk_…` |
| `STRIPE_WEBHOOK_SECRET` | **secret** | `whsec_…` |
| `STRIPE_PRICE_OPERATOR_MONTHLY` / `_ANNUAL` | var | the two Operator price ids |
| `STRIPE_PRICE_PRIME_MONTHLY` / `_ANNUAL` | var | the two Prime price ids |
| `STRIPE_PRICE_DESK_MONTHLY` / `_ANNUAL` | var | the two Desk price ids |

**Bindings** (Settings → Functions → Bindings): confirm **KV namespace `QUAN_PUBLISH`** is bound
(rate-limits, plan cache, publish/client tokens all use it). R2 `QUAN_STATE` is optional
(state/archive fall back to inline Supabase when absent).

## 4. Deploy & smoke-test 🧪
1. Push to the branch Cloudflare Pages builds. Confirm the deploy succeeds.
2. Open `https://app.husrihtlaefan.org/app` → the lock screen shows **Sign in / Create account / Forgot password**.
3. Create a test account → you should land in the terminal as **Scout** (only Detector + Chart unlocked;
   every other tab shows 🔒 and pops the upgrade sheet).
4. **Stripe test purchase** (test card `4242 4242 4242 4242`, any future date/CVC):
   from the upgrade sheet start a **Prime** trial → Stripe Checkout → back to `/app?checkout=success`.
   - 🧪 Confirm a row appears: Supabase → Table editor → `subscriptions` (status `trialing`, plan `prime`).
   - 🧪 Confirm the Prime tabs (incl. Execution) unlock and the trial banner reads "Prime free trial".
5. **Security headers**: `curl -sI https://app.husrihtlaefan.org/app | grep -i -E 'content-security|strict-transport|x-frame'`
   → all three present. Load `/app` in a browser and confirm **no CSP violations** in the console
   (if Pyodide/charts are blocked, widen the offending origin in `_headers`).

## 5. Execution engine (Prime) — multi-tenant deploy 🔑🧪
The Execution runtime is now per-user: each Prime/Desk subscriber gets their own encrypted Tradovate
session (`exec:token:<uid>`) + their own launch-queue Durable Object (`u:<uid>`). Subscribers are
**demo-clamped**; only the operator can route live.
1. **Encryption key**: `npx wrangler secret put EXEC_ENC_KEY -c workers/wrangler-execution.toml`
   with `openssl rand -base64 32`. (If skipped, tokens store plaintext — works, but not fund-grade.)
2. **Deploy the Worker** (DO + dispatch changed): `npm run deploy:execution`.
   Confirm the **EXECUTION** service binding is set on the Pages project (Settings → Bindings).
3. 🧪 **Operator**: open Execution → Connect offers **Demo + Live**; connect demo, route a demo order.
4. 🧪 **Subscriber isolation**: sign in as a second Prime/trial account → Execution → Connect shows
   **Demo only** (the "operator-only during beta" note appears); its launch queue + book are empty and
   independent of the operator's. A subscriber can never reach the live host.
5. **Migration note**: the old singleton DO (`operator`) and shared `exec:token` key orphan harmlessly —
   after this deploy, re-stage any orders that were pending under the old singleton.

## 6. Flip to Live 🔑
1. Stripe → **Live mode**; recreate products/prices/webhook; swap all `STRIPE_*` Pages values to live.
2. Turn off any test/whoami tooling (already removed).
3. One real (or 100%-off promo) end-to-end purchase to confirm the live path.

---

## Deferred (not blocking trial launch)
- **Per-user "live enabled" flag** — subscribers are demo-only at launch (`userMayGoLive()` in
  `workers/execution.js` is the single seam). Add per-user opt-in + the compliance/liability review
  before letting any subscriber route real money.
- Realtime Worker deploy (optional; the analytics terminal + paywall don't need it).
- Nonce-based CSP (drop `'unsafe-inline'`/`'unsafe-eval'`) — larger refactor; current CSP is pragmatic.
