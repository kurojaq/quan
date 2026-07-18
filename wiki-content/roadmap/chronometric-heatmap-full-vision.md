---
type: Reference
title: Chronometric Heatmap Engine — Full Vision (partially shipped)
description: The complete temporal-field visualization spec for the Bookmap — a multi-sheet dropdown, event/intersection detection, cross-sheet correlation, and publication integration. Only the event-highlight bands are shipped.
tags: [roadmap, planned, chronometric, chart]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Claude Implementation Prompt - Chronometric Heatmap Engine.pdf
---

# Summary

**Status: partially shipped.** `js/chart-tab.js` implements `VertBand`
(confirmed in code) — session-time Gaussian event-highlight bands on the
Chart tab, matching this spec's Objective 7 (temporal marker overlay) in
miniature. The much larger vision below — a full metric-selection
dropdown across every chronometric sheet, automatic event/intersection
detection, cross-sheet correlation views, and inspection panels — is
**not shipped**. See [Bookmap layers](/satellites/bookmap.md) for what's
live.

# Vision

- **Chronometric Heatmap layer**: a dedicated layer visualizing the
  evolution of chronometric metrics across the session, synchronized with
  instrument/expiration/session/normalized-session-time/Bookmap cursor/
  replay/publication.
- **Chronometric visualization dropdown**, analogous to the existing
  strike-metric Heatmap dropdown, exposing: **Book Sheet** observables
  (gradients, inflection points, transitions, extrema); **Time-State
  Curvature Sheet** derivatives as continuous temporal fields; complete
  **Statewave Fingerprint (SWF)** visualization as an evolving temporal
  signature (SWF itself is shipped — see
  [Statewave Fingerprint](/analytics/statewave-fingerprint.md) — but not
  this heatmap presentation of it); **Dual Phase Sheet** temporal
  structure; the **Difference Sum (DS)** derivative hierarchy — gradient,
  velocity, curvature, jerk, snap, crackle, pop (only the base DS series
  is shipped, see [Difference Sum](/analytics/difference-sum.md)).
- **Temporal event detection**: automatic flagging of zero crossings,
  local extrema, gradient/curvature reversals, sign changes, derivative
  inflections, high-magnitude excursions, temporal compression/expansion,
  resonance events, synchronized derivative convergence — each a
  first-class inspectable object.
- **Intersection detection**: identify normalized-session-time points
  where multiple chronometric metrics converge (multiple zero crossings
  together, synchronized extrema, cross-sheet agreement) as potentially
  significant structures — the shipped Field Study "crossing + intersection
  times" detection between DS/Dual Phase/SWF is a narrow instance of this.
- **Magnitude highlighting**: configurable thresholds (absolute magnitude,
  percentile, z-score) to distinguish significant events from noise.
- **Spectral rendering, temporal marker overlay, cross-sheet correlation**
  (overlay/stacked/synchronized-panel/agreement/divergence views),
  **chronometric inspection panels**, and **publication integration** —
  all mirroring the equivalent asks in the
  [Bookmap research environment](/roadmap/bookmap-research-environment.md)
  and [Price tab annotation framework](/roadmap/price-tab-annotation-framework.md),
  applied to the temporal axis specifically.

# Related

* [Bookmap layers](/satellites/bookmap.md) — the shipped event-highlight bands this spec's Objective 7 partially matches.
* [Time State Compass](/analytics/time-state-compass.md), [TSC interior structure](/analytics/tsc-interior-structure.md) — the doctrine layer several of these sheets (Dual Phase, DS/SWF) are drawn from.

# Citations

[1] Vault raw source — `raw/Claude Implementation Prompt - Chronometric Heatmap Engine.pdf` (full document).
[2] Qu'an repo — `js/chart-tab.js` (`VertBand`, confirmed shipped).
