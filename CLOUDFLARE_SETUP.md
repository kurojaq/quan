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
It adds the `subscriptions` table, the `user_state` table (roaming workspaces,
Phase 2) **and** the `brief_history` table (brief archive, Phase 3) with their RLS
policies, on top of the existing profiles/teams tables. Re-running it is safe
(everything is `if not exists` / `drop policy … create policy`).

> The `brief_history` snapshot payloads reuse the same `QUAN_STATE` R2 bucket as
> Phase 2 (under a `brief/` prefix), so no extra bucket is needed — just §3c.

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

## 6. Brief history / archive (`/api/archive`)

`/api/archive` durably stores one Report snapshot per user/instrument/trading-date
so past field reads can be browsed (the **🕘 History** button on the Report tab)
and re-published. It reuses the `QUAN_STATE` R2 bucket (`brief/` prefix) for the
full payload and the `brief_history` Supabase table for the listing metadata — so
**no new binding beyond §3c**. The client half (`js/brief-archive.js`) auto-saves
each computed brief in the background; nothing to configure.

---

## 7. EOD warm cron (optional — instant first load)

Pages projects can't run scheduled functions, so the end-of-day price warmer is a
**separate Worker**, [`workers/cron-warm.js`](workers/cron-warm.js). It pre-fetches
common chart/compass timeframes for a configured instrument set into the shared
`QUAN_PUBLISH` KV (`warm:hist:*`); `/api/history` reads that warm layer before
hitting Yahoo, so the first chart load of the day is instant.

Deploy (dashboard, no build — same flow as the old proxy Worker):
1. **Workers & Pages → Create → Worker → Quick edit** → paste `workers/cron-warm.js` → Deploy.
2. **Settings → Variables → KV Namespace Bindings** → add `QUAN_PUBLISH` (the same namespace the Pages project uses).
3. *(optional)* **Settings → Variables** → `WARM_SYMBOLS` = comma-separated Yahoo symbols (defaults to a core futures set).
4. **Settings → Triggers → Cron Triggers** → add e.g. `0 22 * * 1-5` (weekdays, 22:00 UTC).

A plain `GET` to the Worker runs the warm pass on demand for testing. Skip this
section entirely and everything still works — it's a latency optimization only.

---

## 8. Realtime (WebSockets via Durable Objects — optional)

Real-time replaces the Live-anchor polling with a **WebSocket price fan-out**
(one upstream fetch per symbol serves every seat, sub-second push) and enables
**Desk shared sessions** (a Desk-tier team watches the same instrument/date/anchor).
Durable Objects can't live in a Pages project, so this is a separate Worker,
[`workers/realtime.js`](workers/realtime.js), and — like auth — the client stays
**inert until you point it at the Worker**, so shipping it changes nothing until
you opt in.

DO migrations mean this one is deployed with **wrangler**, not dashboard paste:

```
npx wrangler deploy -c workers/wrangler-realtime.toml
npx wrangler secret put SUPABASE_JWT_SECRET -c workers/wrangler-realtime.toml
```

- `SUPABASE_JWT_SECRET` = Supabase → Settings → API → **JWT Secret**. The Worker
  verifies the Supabase token (passed as `?token=` since browsers can't set
  WebSocket headers). With it unset, every connection is rejected — closed by default.
- Then set the deployed URL in [`js/realtime-config.js`](js/realtime-config.js):
  `base: 'wss://quan-realtime.<your-subdomain>.workers.dev'`. Empty = disabled
  (Live anchor keeps polling `/api/quote`; no Desk sessions).

Behavior once configured:
- **Live anchor** ([`js/live-anchor.js`](js/live-anchor.js)) prefers the WebSocket
  feed and falls back to polling automatically if the socket can't connect.
- **Desk sessions** ([`js/desk-session.js`](js/desk-session.js)) show a **⇄ Desk**
  control **only** for Desk-plan users; joining a room name relays selections to
  the other seats. The room name is the shared secret (like a client-view token).

---

## 9. Barchart auto-pull (daily option-chain downloads — optional)

Automates the manual Barchart CSV downloads. A scheduled Worker,
[`workers/barchart-fetch.js`](workers/barchart-fetch.js), logs into barchart.com
on Cloudflare's **Browser Rendering** platform, downloads a CSV for every
contract you've toggled ON in the terminal's **⛃ Auto-pull** panel, stores each
in R2 under `autopull/`, and records a run status. The terminal
([`js/auto-pull.js`](js/auto-pull.js)) ingests new files on load through the same
hooks a manual upload uses — no upload step. The panel is **operator-only**
(`/api/autopull` is gated by `requireOperator`), so it stays hidden for everyone else.

**Auth model — full cloud login.** Credentials live as Worker secrets; the Worker
caches the session cookie in KV after a successful login and reuses it, only
re-logging in when the session is dead. This keeps Barchart's bot-protection from
seeing a fresh login every run — the one thing datacenter IPs get challenged on.

Browser Rendering needs a build + a browser binding (no dashboard paste), so:

```
npm i -D wrangler @cloudflare/puppeteer
npx wrangler deploy   -c workers/wrangler-barchart.toml
npx wrangler secret put BARCHART_USER -c workers/wrangler-barchart.toml
npx wrangler secret put BARCHART_PASS -c workers/wrangler-barchart.toml
```

- In [`workers/wrangler-barchart.toml`](workers/wrangler-barchart.toml), set the
  `QUAN_PUBLISH` KV `id` to the **same** namespace the Pages project uses (§3b)
  and confirm the `QUAN_STATE` R2 `bucket_name` matches §3c — the terminal reads
  `autopull:selection` / `:status` / `:index` from that KV and the CSVs from that bucket.
- The cron default is `15 22 * * 1-5` (≈ after the US cash close). Adjust to your
  settlement time (Settings → Triggers, or the toml).
- **Quota:** Barchart caps CSV downloads per day (~5 free, ~100 Premier). The
  per-contract toggle is also your quota guard — only toggle on what you need.

**One-time calibration (required).** Barchart's DOM/URLs drift and the login form,
download button, and CSV response can't be verified from the repo. They're isolated
in the `BC` config block at the top of `barchart-fetch.js`. After the first deploy,
do one watched run to confirm them, then adjust `BC.*` and redeploy:

```
npx wrangler browser create --keepAlive 600 -c workers/wrangler-barchart.toml
npx wrangler browser view    # watch the login + a download live
```

Trigger a pass on demand any time by opening the Worker's URL (GET runs one pass
and returns the JSON status). If a run shows `login submitted but session not
established`, Barchart challenged the datacenter IP or wants 2FA — see the header
of `barchart-fetch.js` for the fallback (seed a cookie from a real login).

**Adding contracts.** In the terminal's **⛃ Auto-pull** panel, add a row per
contract: the Barchart **symbol** (e.g. `ESM25` — it becomes the downloaded
filename's prefix, which is how `parseChain()` recovers the instrument), the
**expiry** as `MM_DD_YY`, **Chain** or **Greeks**, and the contract's Barchart
options-page **URL**. Toggle rows on/off and **Save selection**.

### One-click "Pull today" (day-of-week resolver)

The panel's **➓ Pull today** button skips the saved list and pulls exactly two
contracts, computed from the calendar for the **active instrument**:

- **Chain** → *today's* session date, from Barchart's **Options & Prices** tab.
- **Greeks** → the *next trading day* (weekends/holidays skipped via the
  terminal's own calendar, `js/detector.js`), from the **Vol & Greeks** tab.

So a Monday click grabs Monday's chain and Tuesday's greeks, then ingests both
on the spot. The client sends only the **future** (e.g. `ZNU26`, taken from the
loaded chain's filename or computed as the front quarterly month H/M/U/Z) plus
the **target date** and tab. On Barchart's page the expiry is driven by two
dropdowns — **Options Type** (which *is* the day-of-week: "Monday Weekly Options")
and **Week N**. These are Barchart's **custom (non-`<select>`) widgets**, so
`resolveExpiryPage()` in [`workers/barchart-fetch.js`](workers/barchart-fetch.js)
drives them by clicking the trigger open and clicking the option row (located by
visible text, no fixed class names), then confirms the page's printed "expiration
on MM/DD/YY" matches the target (stepping the Week dropdown if the date rolls into
a later week). The opaque per-expiry symbol (e.g. `BG6N26`) is never computed and
the button survives weekly/monthly rolls. `openTrigger`/`clickOption`/`setWeekByIndex`
are the calibration surface if Barchart restructures those widgets.

**Debug mode (no interactive session needed).** To see the exact dropdown markup
after a failed pull, run in debug: it dumps the toolbar HTML into the failed job's
status (`jobs[].toolbarHtml`). Turn it on any of three ways — tick **debug** next
to *Pull today* in the panel (the captured markup appears in a box there and in the
browser console), append `?debug=1` to the Worker's GET URL, or set the
`AUTOPULL_DEBUG=1` var on the Worker to make every run capture. Paste that markup
back and the `openTrigger`/`clickOption` text-matching can be pinned to real
selectors. (Watching live with `wrangler browser view` still works too.)

This path routes through the operator-gated `/api/autopull` (POST `action:"pull"`).

### Wiring the Worker into the terminal (Service binding)

The browser automation can't live in a Pages Function (Pages Functions don't
support a Browser Rendering binding, and Pages can't cron), so it stays a Worker —
but bind it to the Pages project so the terminal calls it **privately**, with no
public URL and nothing over the Internet:

1. Deploy the Worker (`npx wrangler deploy -c workers/wrangler-barchart.toml`).
   It has no `routes`, so it's reachable only via the binding + its cron trigger.
2. **Pages** project → Settings → **Bindings** → Add → **Service binding**:
   Variable name `BARCHART`, Service `quan-barchart-fetch`. Redeploy Pages.

That's it — `/api/autopull` prefers `env.BARCHART.fetch()` and needs **no
`BARCHART_WORKER_URL` and no `AUTOPULL_KEY`**. (Because the Worker is route-less,
it's only callable through the binding.) If you instead keep a public route on the
Worker, set `AUTOPULL_KEY` as both a Worker secret and a Pages var so the call is
authenticated; the code sends the key only when it's set. The legacy
`BARCHART_WORKER_URL` + `AUTOPULL_KEY` public-URL path still works as a fallback
when the binding is absent.

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
