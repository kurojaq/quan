---
type: Metric
title: Dual Phase
description: PG/PC and PC/PG dual-phase tension — one of the three shipped Field Study sheets, also used by ZN Timestate.
tags: [analytics, dual-phase, field-study, timestate]
timestamp: 2026-07-18T00:00:00Z
resource: js/sop-polar.js
---

# Definition

**Dual Phase (DP)** is Column 33 of the
[Time State Compass](/analytics/time-state-compass.md) — the capstone
discriminant that synthesizes Pairs Multiplied, Pairs Divided, Sum of
Pairs, DIPLTR, and their derivatives into a single phase-angle value.
DP=0 is perfect phase alignment (by definition at CW=−1.0, session open);
DP>0 means the session arc is leading its pre-session encoding (temporal
excess); DP<0 means the session is lagging — a structural "temporal
debt" still owed, to be paid in the position arc (CW>0). Per the
[interior-structure reading](/analytics/tsc-interior-structure.md)
Chapter II, DP is geometrically the tangent of the rotation angle between
adjacent CW positions, not simply "gradient dominates curvature."

In the shipped terminal it surfaces as two ratio-direction columns,
`PG/PC Dual Phase Tension` and `PC/PG Dual Phase Tension` (`CL`/`CM` in
the underlying sheet). It is computed in two places: as one of the three
overlaid series on the [Field Study tab](/terminal/tabs/field-study.md)
(alongside [DS](/analytics/difference-sum.md) and
[SWF](/analytics/statewave-fingerprint.md)), and independently within
[ZN Timestate](/satellites/timestate.md)'s golden-reference derivative
stack (`js/timestate-core.js`), where it is one of the observables
tracked against the Chronometer Watch.

# Data source

`js/sop-polar.js` (`dphase(cc,cd)` → `dualPhase` array, "the 'Dual Phase'
sheet") and `js/timestate-core.js` (`COL_M`/`COL_S` = `PG/PC Dual Phase
Tension` / `PC/PG Dual Phase Tension`), both derived from the session's
option chain in the client warehouse.

# Interpretation

Two independent implementations exist (Field Study vs. Timestate) — when
investigating a discrepancy, check both, since they are **not** the same
code path despite sharing the name and underlying concept. Doctrinally,
DP's own skewness is reported as negative (session structurally biased
toward phase-lag) — the highest-conviction entries are described as
occurring when DP transitions from its most negative values toward zero,
i.e. the session settling its temporal debt.

# Citations

[1] Qu'an repo — `js/sop-polar.js`, `js/timestate-core.js` (`COL_M`, `COL_S`).
[2] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Col 33 — Dual Phase DP" (line 2528) and Chapter II (line 2635).
[3] Vault raw source — `raw/Claude Implementation Prompt - Rolling Analysis Engine.pdf` (Objective 12, lists "Dual Phase" as an existing framework component).
