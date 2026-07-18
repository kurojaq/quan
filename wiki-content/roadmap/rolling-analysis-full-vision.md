---
type: Reference
title: Rolling Analysis Engine — Full Vision (partially shipped)
description: The complete forward dealer-interest term-structure spec — core aggregation/weighting/heuristics are shipped; Bookmap integration, expiration-curve visualization, rolling reporting, and historical replay are not.
tags: [roadmap, planned, rolling, term-structure]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Claude Implementation Prompt - Rolling Analysis Engine.pdf
---

# Summary

**Status: partially shipped — more than a code grep alone suggests.**
`js/rolling-engine.js` (254 lines) directly implements this spec's core
— its own comments cite "Objective 7" verbatim for the configurable
temporal weighting model, and it computes per-strike term structure with
weighted/raw dealer-interest accumulation. A live screenshot of the
[Rolling tab](/terminal/tabs/rolling.md) (`raw/Screenshot 2026-07-18 051110.png`)
shows a working **"ROLLING - Forward Dealer Interest" density/spectral
render** across 4 expirations and 219 strikes with a `Weight: ttx`
selector — i.e. Objective 6 (expiration curve visualization) is
**partially shipped** too, even though `js/rolling-viz.js` has no literal
"Bookmap"/"heatmap" string matches (it names things `density`/`spectral`
instead). This is a concrete case for verifying shipped-vs-planned status
against screenshots, not just source-text greps.

# Shipped

- Objective 1 (dedicated aggregation engine), Objective 2 (multi-
  expiration aggregation), Objective 3 (dealer-interest-through-time
  characteristics), Objective 7 (configurable, transparent temporal
  weighting) — all present in `rolling-engine.js`.
- Objective 6 (expiration curve visualization) — **partially**: a
  density/spectral term-structure render exists (`js/rolling-viz.js`),
  confirmed live in `raw/Screenshot 2026-07-18 051110.png`; the timeline,
  cumulative-interest-profile, and strike-persistence-map presentations
  from the full spec are not confirmed.

# Not yet shipped

- **Objective 4 — Strike lifecycle analysis**: track each strike's first
  appearance, cumulative interest, OI/volume/IV changes, migration toward
  or away from price, through expiration.
- **Objective 5 — Rolling Bookmap integration**: overlay forward dealer
  concentration, cumulative strike significance, persistence weighting,
  expiration density onto the [Bookmap](/satellites/bookmap.md) so
  intraday liquidity can be compared against longer-term commitments in
  one workspace — the Rolling density render is currently its own tab,
  not overlaid on the Chart tab's Bookmap.
- **Objective 8 — Monthly contract integration**: continuous inclusion of
  monthly expirations into every analytical subsystem, not just the
  nearest contract.
- **Objective 9 — Rolling reporting**: automatic report sections
  (cumulative dealer interest, dominant future expirations, structural
  strike concentrations, positioning migration, persistence analysis)
  extending the [Report brief](/terminal/tabs/report.md).
- **Objective 10 — Historical evolution / replay**: reconstruct how
  positioning developed across multiple sessions.
- **Objective 11 — Heuristic layer**: persistence scoring, structural
  significance, stability indices, migration vectors, concentration
  gradients, term-structure balance, forward positioning asymmetry.
- **Objective 12 — Framework integration**: native integration with
  Bookmap, Chronometer, and — per this spec — "Time-State Curvature,"
  "Statewave Fingerprint (SWF)," "Dual Phase," "Difference Sum (DS)."
  The latter three are **real and shipped** — see
  [analytics/](/analytics/index.md) — confirming this spec was written
  with knowledge of the existing Field Study primitives. "Time-State
  Curvature" as a distinct named sheet was not independently confirmed in
  code; it may refer to the broader
  [Time State Compass](/analytics/time-state-compass.md) doctrine.

# Related

* [Rolling tab](/terminal/tabs/rolling.md) — the shipped slice.
* [Time State Compass](/analytics/time-state-compass.md), [analytics/](/analytics/index.md) — the primitives Objective 12 asks this engine to integrate with.

# Citations

[1] Vault raw source — `raw/Claude Implementation Prompt - Rolling Analysis Engine.pdf` (full document).
[2] Qu'an repo — `js/rolling-engine.js`, `js/rolling-viz.js`.
