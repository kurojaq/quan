---
type: Reference
title: Bookmap Research Environment (planned)
description: The full vision for the Bookmap module as an institutional research environment — session isolation, liquidity layering, event detection, inspection tools. Mostly not yet built.
tags: [roadmap, planned, bookmap, liquidity]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Bookmap Development Plan.pdf
---

# Summary

**Status: mostly planned, not built.** No liquidity-layering, event-
detection, or lifecycle-tracking code was found in `js/` — this document
is the target vision, not a description of current behavior, aside from
the scalar/spectral rendering and Chronometric layer already covered in
[Bookmap layers](/satellites/bookmap.md).

# Vision (by area)

- **Strict session isolation**: every visualization layer (heatmaps,
  scalar fields, spectral rendering, liquidity layers, tick bubbles,
  overlays, annotations) must derive from exactly one selected session,
  with zero bleed from adjacent sessions — this needs an audit of current
  rendering logic, not just new code.
- **Automatic historical loading**: selecting a dated session with data
  should reconstruct it with no manual interaction, and show an explicit
  "no data" state rather than stale information.
- **Advanced liquidity layering**: independently toggleable layers for
  resting/added/cancelled/executed liquidity, inferred replenishment,
  iceberg probability, hidden-liquidity probability, liquidity age,
  persistence, and migration — composable with each other.
- **Liquidity lifecycle analysis**: treat each significant liquidity
  region as an object with an inspectable lifecycle (creation →
  modification → reinforcement → execution → decay → cancellation).
- **Multi-engine rendering**: scalar fields, spectral intensity maps,
  contour surfaces, gradient fields, isocontours, density maps, temporal
  field evolution — all interchangeable over the same dataset without
  recomputation.
- **Integrated analytical context**: overlay dealer inventory, gamma
  exposure, volatility regime, chronometric fields, curvature fields,
  pressure gradients — see [analytics/](/analytics/index.md) for the
  primitives already available to draw on.
- **Automated event detection**: identify and annotate absorption,
  exhaustion, liquidity sweeps, spoofing candidates, failed auctions,
  trapped participants, liquidity vacuums, structural transitions —
  searchable/filterable/exportable.
- **Rich inspection tools**: hover/selection panels summarizing every
  analytical attribute of a tick or liquidity region.
- **Advanced navigation**: synchronized zoom, cursor modes, measurement
  tools, bookmarking, replay, timeline scrubbing, comparative multi-session
  analysis.
- **Architecture**: visualization layers as independent components
  registered in a unified framework, so new analytical views don't
  require architectural changes — incremental updates, caching, GPU
  acceleration where appropriate.

# Related

* [Bookmap layers](/satellites/bookmap.md) — what's actually shipped on the Chart tab today.
* [Chronometric Heatmap — full vision](/roadmap/chronometric-heatmap-full-vision.md) — the temporal-axis counterpart to this spatial vision.
* [Price tab annotation framework](/roadmap/price-tab-annotation-framework.md) — the companion annotation/drawing-tools spec.

# Citations

[1] Vault raw source — `raw/Bookmap Development Plan.pdf` (full document).
