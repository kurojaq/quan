# Deploying The Qu'an to Cloudflare Pages

The app is a static site with a small serverless API (`functions/`). Cloudflare
Pages serves the static files and runs the API as **Pages Functions** — no build
step, no server to manage.

Site map after the restructure:

| Path            | Serves                                   |
|-----------------|------------------------------------------|
| `/`             | `index.html` — the marketing landing page |
| `/app`          | `app.html` — the terminal (clean URL)     |
| `/view.html?token=...` | the limited client-facing view (Heat Map + Chart + Report, 3 days back) |
| `/api/*`        | Pages Functions (`functions/api/*.js`)    |

> Cloudflare Pages serves `app.html` at `/app` automatically (clean URLs), so the
> `/app` links throughout the site just work — no redirects needed.

---

## 1. Connect the repo (recommended)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick this repository.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
4. Deploy. Because Git integration deploys the committed tree, the large
   `*.backup-*.html` files and `golden_reference.xlsx` (both `.gitignore`d) are
   never uploaded.

Every push to `main` now redeploys automatically. (The old GitHub Pages workflow
has been removed so you don't end up with a second, checkout-broken copy of the
site at the `github.io` URL.)

### Manual alternative
```
npx wrangler pages deploy .
```
Use only for a one-off — this uploads the working directory, including any
untracked backups, so Git integration is preferred.

---

## 2. Environment variables & secrets

Set these under **Pages project → Settings → Environment variables** (add them to
**Production**, and to **Preview** if you use preview deployments). Mark the
`*_KEY` / `*_SECRET` ones as **encrypted**.

| Variable | Type | Where it comes from |
|---|---|---|
| `SUPABASE_URL` | plain | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | plain | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | Supabase → Settings → API → service_role key |
| `STRIPE_SECRET_KEY` | **secret** | Stripe → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | **secret** | created in [STRIPE_SETUP.md](STRIPE_SETUP.md) |
| `STRIPE_PRICE_OPERATOR_MONTHLY` | plain | Stripe price id (see STRIPE_SETUP.md) |
| `STRIPE_PRICE_OPERATOR_ANNUAL`  | plain | Stripe price id |
| `STRIPE_PRICE_DESK_MONTHLY`     | plain | Stripe price id |
| `STRIPE_PRICE_DESK_ANNUAL`      | plain | Stripe price id |
| `OPERATOR_EMAIL` | plain | your own Supabase login email — gates `/api/publish` and `/api/client-tokens` to you only |
| `APP_BASE_URL` *(optional)* | plain | e.g. `https://quan.app` — otherwise the request origin is used |

The **service role key bypasses Row-Level Security** — it lives only in Pages
secrets and is used exclusively by the webhook to write subscription rows. Never
put it in client code.

---

## 3. Database

Run [`supabase/schema.sql`](supabase/schema.sql) once in the Supabase SQL editor.
It adds the `subscriptions` table **and** the `user_state` table (roaming
workspaces, Phase 2) with their RLS policies, on top of the existing
profiles/teams tables. Re-running it is safe (everything is `if not exists` /
`drop policy … create policy`).

---

## 3b. KV namespace (client-view publishing)

The operator's "Publish" button (in the terminal) and the client-facing
`view.html` page both read/write a KV namespace called `QUAN_PUBLISH`
(`wrangler.toml` already has the binding + namespace id). Because Git-integration
Pages deploys don't reliably pick up `[[kv_namespaces]]` from `wrangler.toml`,
add the same binding by hand once:

**Pages project → Settings → Functions → KV namespace bindings → Add binding.**
Variable name: `QUAN_PUBLISH`. KV namespace: `QUAN_PUBLISH`.

---

## 3c. R2 bucket (roaming workspaces — optional but recommended)

`/api/state` stores each user's workspace so it follows them across devices.
Small values live inline in the Supabase `user_state` table; **large** ones
(option-chain CSVs) go to an R2 bucket named `quan-state`.

This is **optional** — with no bucket bound, `/api/state` stores everything inline
in Supabase (capped at 8 MB per value). To enable R2 (cheaper for big blobs, keeps
the DB lean):

1. **R2 → Create bucket** → name it `quan-state`.
2. **Pages project → Settings → Functions → R2 bucket bindings → Add binding.**
   Variable name: `QUAN_STATE`. Bucket: `quan-state`.

(`wrangler.toml` already declares the `[[r2_buckets]]` binding; as with KV, the
dashboard binding is what actually applies to Git-integration deploys.)

---

## 4. Custom domain

Pages project → **Custom domains → Set up a domain**. Point your domain at the
Pages project; Cloudflare provisions TLS automatically. Then set `APP_BASE_URL`
to that domain so Stripe success/cancel URLs are absolute and correct.

---

## 5. Market data plane (`/api/quote`, `/api/history`)

The live quote / chart history feed is now a pair of **Pages Functions**
(`functions/api/quote.js`, `functions/api/history.js`) that replace the old open
`quanyahoo.jqnboggan.workers.dev` Worker. They add three things the open proxy
lacked:

- **Access control.** Every request must come from either a signed-in Supabase
  user *or* a valid client-view publish token (`X-Quan-Token`, set automatically
  by `view.html`). Anonymous requests get `401` — the proxy is no longer open.
- **Edge caching** via `caches.default`: quotes cache 8–30 s (fresher for paid
  tiers), history 60 s. Fewer Yahoo hits, faster loads, resilience to throttling.
- **Per-tier rate limiting** (requests/minute): Desk 240, Operator/trial 120,
  Scout 20, client-view 40. Over-limit returns `429`. The app owner
  (`OPERATOR_EMAIL`) is treated as Desk.

**No new bindings needed** — the limiter and a short-lived plan cache reuse the
existing `QUAN_PUBLISH` KV namespace (prefixes `rl:` and `plan:`). Yahoo fetches
fail over from `query1` to `query2`.

> **Turn down the old Worker.** Nothing references
> `quanyahoo.jqnboggan.workers.dev` anymore. In the Cloudflare dashboard either
> **delete that Worker** or set its `AUTH_REQUIRED=1` env var, so the open proxy
> stops being an abuse surface.

Tiers/limits are edited in one place: the `RATE_LIMITS` / `QUOTE_TTL` /
`HISTORY_TTL` maps in [`functions/api/_shared.js`](functions/api/_shared.js).

---

## Local preview

Pages Functions need the Workers runtime to execute. To run the whole thing
(static + `/api/*`) locally:

```
npx wrangler pages dev .
```

Plain `python -m http.server` still serves the static landing/app, but `/api/*`
calls will 404 — the client degrades gracefully (paid checkout falls back to
`/app`; the Chart / Live anchor show "proxy unreachable" since quotes now route
through `/api/quote` and `/api/history` instead of the old public Worker). Use
`wrangler pages dev .` when you need live data locally.
