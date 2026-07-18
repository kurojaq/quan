---
type: Reference
title: Bookmap Layers
description: Chart-tab multi-view scalar/spectral heatmap plus chronometric temporal-field overlays.
tags: [satellite, bookmap, chart, chronometric]
timestamp: 2026-07-18T00:00:00Z
---

# Summary

The Bookmap layers render on the [Chart tab](/terminal/tabs/chart.md):
multi-view scalar/spectral heatmap rendering, a **Chronometric Heatmap**
temporal-field selector, and session-time **Gaussian event-highlight
bands** (σ=0.025) drawn via `VertBand`.

# Detail

- Primary module: `js/chart-tab.js` (with `js/chart-heat.js`,
  `js/chart-draw.js`).
- Source specs live in the repo's `Bookmap Work/` folder (four specs;
  spec #4 = the session-time event bands, confirmed shipped as `VertBand`
  in `js/chart-tab.js`).
- The other three specs describe a much larger vision than what's
  shipped — see [Bookmap research environment](/roadmap/bookmap-research-environment.md),
  [Chronometric Heatmap — full vision](/roadmap/chronometric-heatmap-full-vision.md),
  and [Price tab annotation framework](/roadmap/price-tab-annotation-framework.md)
  for what remains unbuilt.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §10.
[2] Qu'an repo — `Bookmap Work/`, `js/chart-tab.js`.
