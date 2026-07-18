---
type: Metric
title: Difference Sum (DS)
description: One of the three shipped Field Study sheets — the base derivative signal computed alongside Dual Phase and SWF.
tags: [analytics, ds, difference-sum, field-study]
timestamp: 2026-07-18T00:00:00Z
resource: js/sop-polar.js
---

# Definition

**Difference Sum (DS)** is doctrinally **D/S** — DIPLTR/SOP — from
columns 26–30 of the [Time State Compass](/analytics/time-state-compass.md)'s
ratio suite (the reciprocal pairing to S/D = SOP/DIPLTR). When S/D≈−1,
the sum and difference are in exact phase opposition — the source calls
a three-consecutive-position S/D=−1 band "the definitive structural
signature of the pre-reality arc," maximum directional tension with no
energy excess to resolve it. It is one of three shipped analytical
sheets rendered together on the [Field Study tab](/terminal/tabs/field-study.md),
alongside [Dual Phase](/analytics/dual-phase.md) and the
[Statewave Fingerprint](/analytics/statewave-fingerprint.md). In the
codebase it is labeled "DS (Difference/Sum)".

# Data source

Computed in `js/sop-polar.js` from the session's loaded option chain (via
the [client warehouse](/architecture/client-warehouse.md)); rendered as
one of three overlaid series in the "Field Study: DS / Dual Phase / SWF"
visualization, which also detects **crossing and intersection times**
between the three series.

# Interpretation

The three sheets are read together, not in isolation — the
[Rolling Analysis Engine's planned integration](/roadmap/rolling-analysis-full-vision.md)
and the [Chronometric Heatmap's planned full vision](/roadmap/chronometric-heatmap-full-vision.md)
both name DS as part of the "Difference Sum (DS) hierarchy" of higher-order
derivatives (gradient, velocity, curvature, jerk, snap, crackle, pop) —
that fuller hierarchy is **not yet shipped**; only the base DS series
renders today.

# Citations

[1] Qu'an repo — `js/sop-polar.js` (search "DS (Difference/Sum)", "Field Study: DS / Dual Phase / SWF").
[2] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Cols 26–30 — Sum/Difference, D/S" (line 2518).
[3] Vault raw source — `raw/Claude Implementation Prompt - Chronometric Heatmap Engine.pdf` (Difference Sum (DS) Sheet, derivative hierarchy).
