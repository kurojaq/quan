---
type: Reference
title: SaaS Tiers & Gating
description: Cloudflare Pages + Stripe + Supabase; four subscription tiers behind a hard paywall.
tags: [saas, stripe, supabase, auth, tiers]
timestamp: 2026-07-18T00:00:00Z
---

# Summary

Qu'an is a subscription SaaS on **Cloudflare Pages + Stripe + Supabase**
with a **hard paywall** and self-serve auth. Four tiers gate feature
entitlements: **Scout ($0) / Operator ($99) / Prime ($249) / Desk
($699)**.

# Detail

**Tier gating in practice** — a new Scout sign-up only unlocks Detector +
Chart; every other tab shows 🔒 and pops an upgrade sheet. An **operator
override** in `/api/subscription` ensures the account owner is never
locked out of their own terminal regardless of subscription state.

**Gating modules:**

- `js/subscription-gate.js` — in-app subscription state, upgrade bar,
  checkout/portal hand-off.
- `js/entitlement-gate.js` — per-feature entitlement checks.
- `js/auth.js` / `js/auth-config.js` — Supabase auth.
- `functions/_middleware.js` — security headers.
- `js/pricing.js` — pricing cards, billing toggle, Stripe checkout hand-off.

**Server side** — the Stripe [Pages Functions](/architecture/data-plane.md)
(`checkout`, `webhook`, `portal`, `subscription`).

**Roaming** — a paid workspace follows the user across devices via
`js/cloud-storage.js` → `/api/state` (Supabase + R2).

**Durable history** — a `brief_history` table (RLS on) is applied to the
live Supabase project, backing the [Report](/terminal/tabs/report.md)
archive.

**Runbooks** — [Go-Live runbook](/saas/go-live-runbook.md) (the ordered
activation checklist), `CLOUDFLARE_SETUP.md`, `STRIPE_SETUP.md`.

# Related

* [Data plane](/architecture/data-plane.md) — the Stripe/auth endpoints.
* [Go-Live runbook](/saas/go-live-runbook.md) — how this system gets activated end to end.
* [Execution tab](/terminal/tabs/execution.md) — the per-user demo-clamped tier this gate protects.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §9; `raw/GO_LIVE.md` §0.
[2] Qu'an repo — `README.md`; `STRIPE_SETUP.md`; `CLOUDFLARE_SETUP.md`.
