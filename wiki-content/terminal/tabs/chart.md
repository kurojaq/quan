---
type: Market Concept
title: Chart Tab
description: Live price chart with Bookmap-style scalar/spectral and chronometric layers.
tags: [terminal, tab, chart, bookmap]
timestamp: 2026-07-18T00:00:00Z
---

# What it is

The live price chart, carrying the [Bookmap-style layers](/satellites/bookmap.md):
scalar/spectral heatmap views, the Chronometric temporal-field selector,
and session-time Gaussian event-highlight bands.

# Behavior

- Data tab id `chart`.
- Price is anchored via the [live anchor](/architecture/data-plane.md)
  when `/api/quote` is available.
- The former Compass "Price" control now just deep-links here.
- Modules: `js/chart-tab.js`, `js/chart-draw.js`, `js/chart-controls.js`,
  `js/chart-zoom.js`, `js/chart-heat.js`.

# Open questions

Live screenshots (`raw/Screenshot 2026-07-18 05*.png`) show price-axis
structural labels — `gwall1`–`gwall5`, `dfloor`, `sfloor`, `target`, plus
`Day High`/`Day Low`. Two are now resolved by the doctrine manual:
**`gwall` = "gamma wall"**, explicitly defined as Strike Kurt K>6 (see
[Strike Observable Manifold](/analytics/strike-observable-manifold.md)
and [Dealer Field Architecture](/analytics/dealer-field-architecture.md)'s
signal table); **`dfloor`** is very likely "dealer floor" — the doctrine's
Puts-Minus-Calls table names "FLOOR" as the direct consequence of
Net OI>0 (dealers short puts → long delta → buy dips). `sfloor` and the
exact per-level computation (which `gwall1`...`gwall5` strike each
number picks) remain unconfirmed against code — check `js/detector.js`,
`js/breach-chart.js`.

# Related

* [Bookmap layers](/satellites/bookmap.md) — the chronometric/heat overlays in detail.
* [Strike Observable Manifold](/analytics/strike-observable-manifold.md) — the doctrine the Bookmap's metric dropdown renders (Strike Kurt, ICF, Speed, Accel confirmed live).

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §3, §10.
[2] Qu'an repo — `app.html`, `js/chart-tab.js`.
[3] Vault raw source — `raw/Screenshot 2026-07-18 050611.png` through `050836.png` (Chart/Bookmap, live renders, 2026-07-17 session).
