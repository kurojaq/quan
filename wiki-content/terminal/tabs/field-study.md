---
type: Market Concept
title: Field Study Tab
description: Polar / SOP field view of dealer structure for the selected session.
tags: [terminal, tab, polar, sop]
timestamp: 2026-07-18T00:00:00Z
---

# What it is

The polar / SOP (structure-of-positioning) field view. Renders dealer
structure for the current session as a polar field, and hosts the
terminal's shipped **Time State Compass** visualization: three overlaid
series — [Difference Sum (DS)](/analytics/difference-sum.md),
[Dual Phase](/analytics/dual-phase.md), and the
[Statewave Fingerprint (SWF)](/analytics/statewave-fingerprint.md) —
plotted against the Chronometer Watch axis [0,1], with automatic
crossing and intersection-time detection between the three series. This
is the terminal's primary window onto the
[Time State Compass doctrine](/analytics/time-state-compass.md).

# Behavior

- Data tab id `polar`; label "Field Study".
- Fed via `__polarLoadChain` from the [warehouse](/architecture/client-warehouse.md).
- Module: `js/sop-polar.js` — search "DS (Difference/Sum)", "Dual Phase",
  "SWF (DIPLTRPD/SOPPM)" to locate the three series.
- Honors the header **session kind** override (Auto / Full / Early / Closed).
- Header also surfaces `engine`, `golden`, `anchor`, strike count,
  `coherence breaks CW`, and `RIPN` — the operator-facing doctrine
  parameters this tab is reading against.
- A second **View: SOP Headline** mode renders the "SOP wave field
  (headline) — product = fold/coherence wave": four series (product,
  curvature, gradient, tension/envelope) plotted against the same
  normalized Chronometer Watch axis, with **coherence-break** annotations
  (product/tension/gradient/curvature values at the flagged time) — this
  maps to [Time State Compass](/analytics/time-state-compass.md) columns
  12–15 (Sum of Pairs + gradient/curvature/tension).

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §3.
[2] Qu'an repo — `app.html`, `js/sop-polar.js`.
[3] Vault raw source — `raw/Screenshot 2026-07-18 050914.png`, `050853.png` (Field Study, live renders — Field Study and SOP Headline views).
