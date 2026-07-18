---
type: Reference
title: Fibonacci Strike Architecture
description: Fibonacci levels drawn PDSL-to-PDSL rather than swing-high-to-low — the level table, quarter-level microstructure, and the cascading extension rule.
tags: [analytics, doctrine, fibonacci, pdsl, execution]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Summary

Fibonacci ratios here are drawn strike-to-strike — from one PDSL to the
next (see [Deep Strike Analysis](/analytics/deep-strike-analysis.md)) —
not from traditional swing highs/lows. The strike chain is the scaffold;
Fibonacci describes the subdivisions of the structural space *between
dealer obligations*.

# Construction

1. **Anchor selection**: Anchor Low (AL) = the lower PDSL with Mass>+2.0; Anchor High (AH) = the upper PDSL with Mass>+2.0. `F_range = AH − AL`. With only one PDSL, extend to the nearest DSC for the second anchor; with more than two PDSLs, use the two highest-scoring.
2. **Directional orientation** (not a free choice — set by the Force gradient at the anchors): ascending gradient → Fib drawn upward from AL to AH; descending → drawn downward from AH to AL; phase boundary → drawn both ways from that strike as the origin.
3. **Extension to the next zone**: once price clears AH on an ascending gradient, the completed Fib's AH becomes the new AL, and the next PDSL/DSC above becomes the new AH — re-run gradient classification and TSC overlay for the new range. This creates an objective, cascading Fibonacci chain across sessions; no swing points are chosen subjectively.

# Level table

| Level | Structural role | Entry/stop action |
|---|---|---|
| 0.000 | Anchor Low — dealer floor, maximum Mass | Buy here on ascending gradient; stop below |
| 0.236 | Near-base retrace, high-velocity transit (Speed>3) | Scale-in zone for strong continuation, not a stop level |
| 0.382 | First quarter retracement | **Primary entry** — ascending gradient. Stop at AL. Target 0.618–0.786 |
| 0.500 | Midpoint, structural equilibrium, often the phase boundary | Phase-boundary entry, both directions valid, requires ZC confirmation |
| 0.618 | Golden ratio — resistance (ascending) / support (descending) | Partial profit from a 0.382 entry; trail stop to 0.500 |
| 0.786 | Deep retrace, last defense before AH is tested | Final add-on point for high-conviction trend; stop at 0.500 |
| 1.000 | Anchor High — dealer ceiling / upper watermark | Sell here on descending gradient; stop above |
| 1.272 | First extension — next session's likely PDSL candidate | Extension target for a strong ascending breakout |
| 1.618 | Second extension — measured-move target | Full target for a confirmed breakout above the AH watermark |

# Quarter levels — execution precision

Each major band subdivides into 4 quarter-levels (16 total across
AL–AH): e.g. 0.382–0.500 → 0.412/0.441/0.471/0.500. Three uses: **entry
refinement** (enter at the quarter level nearest a confirmed Elliott Wave
structure — see the μ-Wave vocabulary in [Three-Layer Execution Model](/analytics/three-layer-execution-model.md));
**stop placement** (stops go at quarter levels *against* the trade, never
at round Fib levels — round levels attract stop-hunting); **partial
exits** (scale out 25–33% per quarter level as the trade develops).

# Related

* [Deep Strike Analysis](/analytics/deep-strike-analysis.md) — produces the PDSLs this Fibonacci is built from.
* [Three-Layer Execution Model](/analytics/three-layer-execution-model.md) — the Layer A/B/C order structure placed on these levels.
* [Stop Architecture & Loss Management](/analytics/stop-architecture-loss-management.md) — the quarter-level stop-placement discipline in full.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Qu'an Execution Playbook," Part III (lines 1878–1977).
