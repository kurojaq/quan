---
type: Reference
title: Price Tab Annotation & Drawing Framework (planned)
description: Persistent annotations, drawing tools, cursor modes, and a layer manager for the Chart tab — not yet built.
tags: [roadmap, planned, chart, annotations]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Claude Implementation Prompt - Price Tab Annotation Framework.pdf
---

# Summary

**Status: not built.** No annotation, drawing-tool, or cursor-mode code
was found in `js/chart-tab.js` or elsewhere. This document (saved twice
in the source material — once under Bookmap Work, once under Debugging —
is a single spec) targets transforming the
[Chart tab](/terminal/tabs/chart.md) from a display surface into a
persistent research workspace.

# Vision

- **Persistent annotation layer**: freehand, arrows, trend lines,
  horizontal/vertical markers, measurement tools, text notes, shapes —
  stored separately from rendered market data, restored per instrument/
  expiration/session, surviving refresh and browser restart, optionally
  included in published reports.
- **Advanced scalar-field visualization**: a continuous scalar field view
  (vs. discrete cells), a time-evolving scalar field synced to the
  Chronometer, and richer intensity mapping (gradient strength, local
  density, curvature, temporal persistence, rate of change) beyond linear
  color interpolation.
- **Spectral visualization modes**: spectral density, continuous gradient,
  contour, isocontour, band-pass, intensity isolines, layered opacity —
  all interchangeable renderers over one dataset.
- **Integrated drawing toolkit**: trend lines, rays, horizontal levels,
  vertical markers, channels, Fibonacci tools, rectangles, ellipses, text.
- **Cursor behavior fix**: the current cursor has an unwanted snap-to-price/
  magnet behavior; the spec calls for Free/Magnet/Precision cursor modes
  with Free as the default for annotation accuracy — worth checking
  whether this originates in the charting library or custom logic.
- **Tick bubble inspection**: hover tooltip as a full analytical panel
  (timestamp, price, volume, bid/ask volume, delta, dealer-inventory
  metrics), not a simple label.
- **Structural line overlay**: an optional synchronized line chart
  (price, VWAP, settlement, session high/low, custom curves) inside the
  heatmap view itself, toggleable per-overlay.
- **Layer manager**: independent visibility control resembling a
  visualization stack (heatmap, scalar field, spectral, contours, price
  line, annotations, tick/bubble labels, curvature overlays, future layers).
- **Extensible architecture**: rendering strategies as registered,
  interchangeable modules; data model independent of the rendering engine.

# Related

* [Chart tab](/terminal/tabs/chart.md) — the tab this targets.
* [Bookmap research environment](/roadmap/bookmap-research-environment.md) — the companion liquidity/event-detection vision for the same module.

# Citations

[1] Vault raw source — `raw/Claude Implementation Prompt - Price Tab Annotation Framework.pdf` (full document; duplicated verbatim as `Claude Implementation Prompt (3).pdf` in the original Debugging folder).
