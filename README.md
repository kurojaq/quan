# Qu'an — Intermarket Breach Detector + Polar Disk

An options/futures dealer-positioning terminal: chain-derived structural levels, an intermarket breach detector, a polar/SOP field view, a strike-field heat map, a live price chart, and account/risk simulation — all static, no build step, running Python analysis in-browser via [Pyodide](https://pyodide.org/).

## Structure

- `index.html` — the app shell (DOM + stylesheet/script references)
- `heatmap.html` — the Heat Map tab, a standalone document loaded in an iframe
- `css/theme.css` — global theme (monochrome by default, with a light-mode variant)
- `js/` — one file per feature area (Detector, SOP Field, Strike Field, Breach chart, Report, Account Sim, Chart tab, theme toggle, live anchor, etc.)
- `payload/` — the Payload Generator's shadow-DOM style/markup/script
- `engine/report/`, `engine/payload/`, `engine/heatmap/` — three independently-maintained copies of the Python analysis engine (one per consumer above). They've diverged over time and are **not** interchangeable — don't merge them.
- `assets/` — images
- `yahoo_proxy.py` — optional local CORS proxy for live quotes/history from Yahoo Finance, used by the Live anchor toggle and the Chart tab

## Running locally

Any static file server works, e.g.:

```
python -m http.server 8000
```

then open `http://localhost:8000/index.html`.

For live quotes/candles, also run the proxy in a separate terminal:

```
python yahoo_proxy.py
```

It listens on `localhost:8791` and is only used by the "Live" toggle and the Chart tab — everything else works without it.

## Deployment

Pushing to `main` deploys the repo root to GitHub Pages via `.github/workflows/pages.yml` (no build step).
