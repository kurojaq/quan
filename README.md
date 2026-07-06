# Qu'an — Intermarket Breach Detector + Polar Disk

An options/futures dealer-positioning terminal: chain-derived structural levels, an intermarket breach detector, a polar/SOP field view, a strike-field heat map, a live price chart, and account/risk simulation — all static, no build step, running Python analysis in-browser via [Pyodide](https://pyodide.org/).

## Structure

- `index.html` — the public **landing / marketing page** (hero, features, pricing, FAQ)
- `app.html` — the terminal app shell (DOM + stylesheet/script references); served at `/app`
- `css/landing.css` — landing-page styles (self-contained; reuses the app's palette)
- `js/pricing.js` — pricing cards, billing toggle, Stripe checkout hand-off
- `js/subscription-gate.js` — in-app subscription state, upgrade bar, checkout/portal
- `functions/api/*` — Cloudflare **Pages Functions**: Stripe (checkout, webhook, portal, subscription), client-view publishing (publish, view, client-tokens), the **gated market-data plane** (`quote`, `history`), and **roaming workspace state** (`state` — Supabase + R2)
- `js/cloud-storage.js` — cloud-backed `window.storage`: mirrors the terminal's localStorage keyspace to `/api/state` so a workspace (chains, greeks, layout, theme) follows the user across devices
- `heatmap.html` — the Heat Map tab, a standalone document loaded in an iframe
- `css/theme.css` — global theme (monochrome by default, with a light-mode variant)
- `js/` — one file per feature area (Detector, SOP Field, Strike Field, Breach chart, Report, Account Sim, Chart tab, theme toggle, live anchor, etc.)
- `payload/` — the Payload Generator's shadow-DOM style/markup/script
- `engine/report/`, `engine/payload/`, `engine/heatmap/` — three independently-maintained copies of the Python analysis engine (one per consumer above). They've diverged over time and are **not** interchangeable — don't merge them.
- `assets/` — images
- `workers/yahoo-proxy.js` — the **original** standalone Yahoo proxy Worker (`quanyahoo.jqnboggan.workers.dev`). **Superseded** by the gated, edge-cached, rate-limited `functions/api/quote.js` + `history.js`; kept for reference. The deployed Worker should be deleted or have `AUTH_REQUIRED=1` set so it isn't left open (see `CLOUDFLARE_SETUP.md` §5).
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
