---
type: Reference
title: SOP — Superposition of Pressure
description: The wave-mechanics-derived reading of how Pressure Gradient and Pressure Curvature interact — SOPG/SOPC, dominance ratios, Product Tension, Latent Motion, and the live-session checkpoint protocol.
tags: [analytics, doctrine, sop, time-state-compass]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Summary

PG (Pressure Gradient) and PC (Pressure Curvature) are powerful individually but miss what only their *interaction* reveals: whether directional momentum is being amplified or resisted by curvature. **SOP** reads this interaction, borrowing "superposition" from wave mechanics — where PG and PC constructively interfere (reinforcing) the field is amplified toward a sustained move; where they destructively interfere (opposing) the field is approaching an inflection.

# Derivation chain

1. **SOPG / SOPC** — `SOPG = d(PG)/d(CW)` (the arc's momentum signal), `SOPC = d(SOPG)/d(CW)` (a 3rd-order quantity — the shape of that acceleration).
2. **Dominance ratios** — `SOPG/SOPC > 1` = momentum-dominant (moves sustain/extend); `SOPC/SOPG > 1` = curvature-dominant (moves pause/consolidate/reverse). The ratio crossing 1.0 is the SOP layer's primary inflection signal.
3. **Product Tension** — `Product = SOPG × SOPC`; `Product Tension = d(Product)/d(CW)`. Rising tension = constructive superposition intensifying (self-feeding move); a **product-tension zero-cross is the most precise inflection signal the SOP layer generates**.
4. **Latent Motion Paths** — `SOPG_Latent = SOPG − (realized component)`, likewise for SOPC. The latent component is structural tension the arc has loaded but not yet discharged into price — not a prediction of direction, but a statement that the field *will* express what it has loaded, in the direction the latent sign indicates.
5. **Zero-Cross structure** — a ZC flag fires when `sign(SOPG × SOPC)` flips across a CW boundary; the running count is the session's topological winding number (low = stable persistent character, high ≥4 = turbulent). *Position* within the arc matters as much as count: a ZC in the deep negative arc is a preparation-phase inversion; a ZC in the positive arc is happening while trades are live.

# Live-session reading protocol

- **Pre-session**: read SOPG_Latent/SOPC_Latent at the previous session's final three CW positions (+0.7, +0.8, +0.9) for inherited momentum direction; identify the final ZC's quadrant (early-absorbed vs. late/carry-forward); compare negative-vs-positive-arc ZC counts for front-loaded (favorable) vs. back-loaded (reduce conviction) entropy.
- **CW = −0.5 (Preparation Midpoint Gate)**: the most critical intra-session checkpoint. `SOPG/SOPC > 1` and rising product tension → proceed with full conviction; `< 1` or falling tension → no new pre-session orders, require live confirmation.
- **CW = 0 (Reality Line)**: the only position where the terminal preparation-arc state and initial execution-arc state are both available — continuous SOP character across it means a smooth transition; a discontinuity means a structural break requiring immediate reassessment of all open positions.
- **CW = +0.5 (Execution midpoint)**: ratio declining toward 1.0 from above → begin trailing stops, compress targets to the nearest Fibonacci level; ratio still comfortably >1 with rising tension → let OCO brackets run to original targets.

# Execution consequences

- **Entry timing**: fill orders at a latent-path peak that is just beginning to decline — maximum stored structural potential, about to convert to price motion (the source's own metaphor: a coiled spring at maximum compression).
- **Exit timing**: a product-tension zero-cross is treated as the arc's own declaration that its structural character has inverted — the disciplined protocol holds through arc-internal noise but **exits at market on a tension zero-cross regardless of current profit**.

# Related

* [Time State Compass](/analytics/time-state-compass.md), [Polynomial Skew Framework](/analytics/polynomial-skew-framework.md) — the column architecture SOP is built from.
* [Chirality](/analytics/chirality.md) — the companion "outside" reading of the same arc; the two combine in the [SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md).

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "SOP & Chirality" Parts I–III (lines 3106–3206).
