# Qu'an — Intermarket Breach Detector + Polar Disk

An options/futures dealer-positioning terminal: chain-derived structural levels, an intermarket breach detector, a polar/SOP field view, a strike-field heat map, a live price chart, and account/risk simulation — all static, no build step, running Python analysis in-browser via [Pyodide](https://pyodide.org/).

## Structure

- `index.html` — the public **landing / marketing page** (hero, features, pricing, FAQ)
- `app.html` — the terminal app shell (DOM + stylesheet/script references); served at `/app`
- `css/landing.css` — landing-page styles (self-contained; reuses the app's palette)
- `js/pricing.js` — pricing cards, billing toggle, Stripe checkout hand-off
- `js/subscription-gate.js` — in-app subscription state, upgrade bar, checkout/portal
- `functions/api/*` — Cloudflare **Pages Functions**: Stripe checkout, webhook, portal, subscription status
- `heatmap.html` — the Heat Map tab, a standalone document loaded in an iframe
- `css/theme.css` — global theme (monochrome by default, with a light-mode variant)
- `js/` — one file per feature area (Detector, SOP Field, Strike Field, Breach chart, Report, Account Sim, Chart tab, theme toggle, live anchor, etc.)
- `payload/` — the Payload Generator's shadow-DOM style/markup/script
- `engine/report/`, `engine/payload/`, `engine/heatmap/` — three independently-maintained copies of the Python analysis engine (one per consumer above). They've diverged over time and are **not** interchangeable — don't merge them.
- `assets/` — images
- `workers/yahoo-proxy.js` — Cloudflare Worker that proxies Yahoo Finance quotes/history with CORS headers (Yahoo's own endpoint doesn't send any). Deployed at `quanyahoo.jqnboggan.workers.dev` and used by the Live anchor toggle and the Chart tab from any device, mobile included — no local process required.
- `yahoo_proxy.py` — the same proxy as a local Python script, kept for offline dev / running your own instance instead of the shared Worker

## Running locally

Any static file server works, e.g.:

```
python -m http.server 8000
```

then open `http://localhost:8000/index.html`. The Live toggle and Chart tab work out of the box against the deployed Worker — no extra setup needed.

If you'd rather point at your own proxy instance (e.g. while editing `workers/yahoo-proxy.js`), run the local Python equivalent:

```
python yahoo_proxy.py
```

it listens on `localhost:8791` — then temporarily swap `PROXY_BASE` in `js/chart-tab.js` and `js/live-anchor.js` back to `http://localhost:8791`.

## Deployment

Deployed to **Cloudflare Pages** (static site + `functions/` as Pages Functions,
no build step). Connect the repo in the Cloudflare dashboard; every push to `main`
redeploys. See [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md) for the full setup and
[`STRIPE_SETUP.md`](STRIPE_SETUP.md) for wiring subscriptions.

> Local `python -m http.server` still serves the landing + app; only the `/api/*`
> functions need the Workers runtime (`npx wrangler pages dev .`).
