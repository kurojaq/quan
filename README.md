# Qu'an — Intermarket Breach Detector + Polar Disk

An options/futures dealer-positioning terminal: chain-derived structural levels, an intermarket breach detector, a polar/SOP field view, a strike-field heat map, a live price chart, and account/risk simulation — all static, no build step, running Python analysis in-browser via [Pyodide](https://pyodide.org/).

## Structure

- `index.html` — the public **landing / marketing page** (hero, features, pricing, FAQ)
- `app.html` — the terminal app shell (DOM + stylesheet/script references); served at `/app`
- `css/landing.css` — landing-page styles (self-contained; reuses the app's palette)
- `js/pricing.js` — pricing cards, billing toggle, Stripe checkout hand-off
- `js/subscription-gate.js` — in-app subscription state, upgrade bar, checkout/portal
- `functions/api/*` — Cloudflare **Pages Functions**: Stripe (checkout, webhook, portal, subscription), client-view publishing (publish, view, client-tokens), the **gated market-data plane** (`quote`, `history`), **roaming workspace state** (`state` — Supabase + R2), and the **brief archive** (`archive` — durable Report/Heat Map history)
- `js/cloud-storage.js` — cloud-backed `window.storage`: mirrors the terminal's localStorage keyspace to `/api/state` so a workspace (chains, greeks, layout, theme) follows the user across devices
- `js/brief-archive.js` — auto-archives each computed brief to `/api/archive` and adds the Report tab's **🕘 History** browser (reuses `js/view-report.js` to render past snapshots read-only)
- `heatmap.html` — the Heat Map tab, a standalone document loaded in an iframe
- `css/theme.css` — global theme (monochrome by default, with a light-mode variant)
- `js/` — one file per feature area (Detector, SOP Field, Strike Field, Breach chart, Report, Account Sim, Chart tab, theme toggle, live anchor, etc.)
- `payload/` — the Payload Generator's shadow-DOM style/markup/script
- `engine/report/`, `engine/payload/`, `engine/heatmap/` — three independently-maintained copies of the Python analysis engine (one per consumer above). They've diverged over time and are **not** interchangeable — don't merge them.
- `assets/` — images
- `workers/yahoo-proxy.js` — the **original** standalone Yahoo proxy Worker (`quanyahoo.jqnboggan.workers.dev`). **Superseded** by the gated, edge-cached, rate-limited `functions/api/quote.js` + `history.js`; kept for reference. The deployed Worker should be deleted or have `AUTH_REQUIRED=1` set so it isn't left open (see `CLOUDFLARE_SETUP.md` §5).
- `workers/cron-warm.js` — standalone **scheduled** Worker (Pages can't cron) that pre-warms end-of-day price history into the shared KV so the first chart/compass load of the day is instant. Optional; deploy per `CLOUDFLARE_SETUP.md` §7.
- `workers/realtime.js` — standalone **Durable Objects** Worker (Pages can't host DOs): `PriceRoom` fans a single upstream quote out to all seats over WebSockets; `DeskRoom` relays a Desk team's instrument/date/anchor. Drives `js/realtime.js` + `js/desk-session.js`; **inert until `js/realtime-config.js` has a URL**. Optional; §8.
- `workers/barchart-fetch.js` — standalone **Browser Rendering** Worker (Pages can't run cron or bind a headless browser) that logs into Barchart on a schedule and auto-downloads the option-chain CSVs for the contracts toggled on in the terminal's **⛃ Auto-pull** panel, storing them in R2 (`autopull/`) for on-load ingest. Control plane is `functions/api/archive.js`'s sibling `functions/api/autopull.js` (operator-only) + `js/auto-pull.js`. Optional; deploy per `CLOUDFLARE_SETUP.md` §9.
- `yahoo_proxy.py` — the same proxy as a local Python script, kept for offline dev

## Running locally

Any static file server works, e.g.:

```
python -m http.server 8000
```

then open `http://localhost:8000/index.html`. The static landing + app render fine,
but **live data now routes through same-origin Pages Functions** (`/api/quote`,
`/api/history`), which a plain static server doesn't run — so the Live toggle and
Chart show "proxy unreachable" under `python -m http.server`. To exercise live data
locally, run the Workers runtime instead:

```
npx wrangler pages dev .
```

## Deployment

Deployed to **Cloudflare Pages** (static site + `functions/` as Pages Functions,
no build step). Connect the repo in the Cloudflare dashboard; every push to `main`
redeploys. See [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md) for the full setup and
[`STRIPE_SETUP.md`](STRIPE_SETUP.md) for wiring subscriptions.

> Local `python -m http.server` still serves the landing + app; only the `/api/*`
> functions need the Workers runtime (`npx wrangler pages dev .`).
