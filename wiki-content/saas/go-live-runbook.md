---
type: Execution Playbook
title: Go-Live Runbook (Trial Seats)
description: The ordered external-configuration checklist to take the terminal from code-ready to a paid trial a stranger can sign up for.
tags: [saas, ops, runbook, go-live]
timestamp: 2026-07-18T00:00:00Z
resource: GO_LIVE.md
---

# Trigger

Everything in the repo (pricing, auth, paywall, security headers, DB
migration) is already wired — what remains is external configuration
requiring the operator's own accounts and keys.

# Steps

1. **Supabase auth config** — enable Confirm-email (trade-off: more
   secure but breaks the seamless `/app#plan=prime` checkout hand-off
   across the email round-trip; OFF gives a seamless funnel since Stripe
   already requires a card); set min password length 8 + leaked-password
   protection; set Site URL / redirect URLs to `app.husrihtlaefan.org`;
   configure real SMTP (the default mailer is rate-limited and lands in
   spam).
2. **Stripe** — create Operator/Prime/Desk products + prices in test mode
   first (see `STRIPE_SETUP.md`), wire `STRIPE_PRICE_*` env vars, set
   `STRIPE_SECRET_KEY` + webhook (`checkout.session.completed`,
   `customer.subscription.*`) with its signing secret, activate the
   Customer Portal (powers the in-app Manage button).
3. **Cloudflare Pages env vars & bindings** — Supabase URL/anon/service-
   role keys, `OPERATOR_EMAIL` (grants owner/desk access), `APP_BASE_URL`,
   the Stripe secret/webhook/price vars, confirm KV `QUAN_PUBLISH` is
   bound (rate-limits, plan cache, publish/client tokens all use it); R2
   `QUAN_STATE` is optional (falls back to inline Supabase when absent).
4. **Deploy & smoke-test** — push, confirm deploy; sign-up lands a new
   user as **Scout** (only Detector + Chart unlocked, everything else
   shows 🔒); a Stripe test-card purchase (`4242 4242 4242 4242`) from the
   upgrade sheet should produce a `subscriptions` row (`trialing`, plan
   `prime`) and unlock Prime tabs; confirm CSP/HSTS/X-Frame headers are
   present and no CSP console violations.
5. **Execution engine multi-tenant deploy** — see "Execution engine
   design" below; set `EXEC_ENC_KEY`, deploy the Worker, confirm the
   `EXECUTION` service binding, then smoke-test both the operator path
   (Demo + Live) and subscriber isolation (Demo only, independent queue).
6. **Flip to Live** — recreate Stripe products/prices/webhook in Live
   mode, swap all `STRIPE_*` values, run one real (or 100%-off promo)
   end-to-end purchase to confirm the live path.

# Execution engine design (per-user, demo-clamped)

The [Execution](/terminal/tabs/execution.md) runtime is **per-user**: each
Prime/Desk subscriber gets their own encrypted Tradovate session
(`exec:token:<uid>`) and their own launch-queue Durable Object (`u:<uid>`).
**Subscribers are demo-clamped — only the operator can route live**, via
the single seam `userMayGoLive()` in `workers/execution.js`. Subscriber
isolation must be verified: a second account's Execution → Connect shows
"Demo only" and its queue/book are empty and independent of the
operator's — a subscriber can never reach the live host. This is the
operational half of [Tick Engine constraints](/doctrine/tick-engine-constraints.md)'s
demo-first cost discipline, extended to order routing.

# Deferred (not blocking trial launch)

- Per-user "live enabled" flag — needs a compliance/liability review
  before any subscriber routes real money.
- Realtime Worker deploy (optional; paywall/analytics don't need it).
- Nonce-based CSP (drop `unsafe-inline`/`unsafe-eval`) — larger refactor;
  current CSP is a pragmatic interim.

# Failure modes

- Confirm-email ON without adjusting the checkout hand-off silently
  breaks the plan-selection funnel (user has to re-click their plan after
  confirming) — a UX regression, not a crash.
- Skipping `EXEC_ENC_KEY` still works but stores Tradovate tokens
  plaintext — not fund-grade.

# Related

* [Tiers and gating](/saas/tiers-and-gating.md) — the tier/paywall system this runbook activates.
* [Execution tab](/terminal/tabs/execution.md) — the per-user execution design detailed above.

# Citations

[1] Vault raw source — `raw/GO_LIVE.md` §0–§6.
[2] Qu'an repo — `STRIPE_SETUP.md`, `CLOUDFLARE_SETUP.md`, `workers/execution.js`.
