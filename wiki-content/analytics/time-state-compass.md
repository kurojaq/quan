---
type: Reference
title: Time State Compass — Conductance Derivative Architecture
description: The toroidal-fold column architecture (Conductance, Pairs Multiplied/Divided, Sum of Pairs, DIPLTR, ratio suite, Dual Phase) that Field Study's shipped DS/Dual Phase/SWF visualization is drawn from.
tags: [analytics, doctrine, time-state-compass, dual-phase, conductance]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Summary

The Time State Compass unfolds the full 21-position Chronometer Watch
(CW) domain [−1.0, +1.0] and performs one structural operation on it:
the **negation arc** (CW −1.0 → 0.0, the pre-session temporal domain) is
paired against its mirror in the **position arc** (PT 0.0 → 1.0, the
live session) — CW = −N pairs with PT = 1−|N|. This is the **toroidal
fold**. All gradient/curvature/ratio operations are computed on the
negation arc, because it is the information-bearing half; the position
arc carries conductance values but is the arc being predicted, not the
arc doing the computing.

This is the doctrine layer behind the shipped code: `js/sop-polar.js`'s
"DS (Difference/Sum)", "Dual Phase", and "SWF (DIPLTRPD/SOPPM)" series —
see [Difference Sum](/analytics/difference-sum.md),
[Dual Phase](/analytics/dual-phase.md),
[Statewave Fingerprint](/analytics/statewave-fingerprint.md) — are three
named outputs of the column architecture below.

# Column architecture

| Col | Name | Formula | Reading |
|---|---|---|---|
| 1 | Chronometric Conductance | G(cw) | Raw conductance at each CW position — the base observable. G(0), the **reality line**, is the most negative (most evanescent) value in the session — a chronometric singularity of maximum temporal impedance. |
| 3 | Pairs Multiplied (PM) | G(cw_neg) × G(pair_PT) | Joint temporal energy. Positive = phase-coherent (both arcs constructive or both evanescent, execute with higher conviction); negative = phase-opposed (reduce conviction). |
| 4–5 | PM Gradient / Curvature | ∂PM/∂CW, ∂²PM/∂CW² | Rate and concavity of joint-energy change; negative gradient approaching CW=0 is the "pre-reality-line decompression" that produces the reality-line singularity. |
| 6 | Pairs Divided (PD) | G(cw_neg) / G(pair_PT) | Temporal **dominance**. \|PD\|>1 = pre-session dominates (past has more information density than future at this pairing); \|PD\|<1 = position arc self-generating. |
| 7 | PM/PD | = G_pos² | The pure position-arc energy, stripped of pre-session influence. |
| 10 | PD/PM | = 1/G_neg | Pure pre-session temporal impedance (reciprocal framing of Col 7). |
| 11 | PM×PD | = G_neg² | Pure pre-session encoding strength, independent of the position arc. |
| 12–15 | Sum of Pairs (SOP) + gradient/curvature/tension | G_neg + G_pos | Total arc energy at each pairing. SOP>0 = field constructive; SOP<0 = net evanescent. High-magnitude SOP Curvature confirms the field is a multi-mode temporal waveform, not monotonic (why 6th-order polynomial fits are needed — see the [Compass Architecture / Polynomial Skew section](#open-extraction), not yet ingested). |
| 16–17 | DIPLTR (+ Tension) | G_neg − G_pos | Arc asymmetry / **chirality**. DIPLTR>0 = negation-arc dominant (latent energy not yet released — the "bullish temporal condition"); DIPLTR<0 = position-arc dominant (session generating new structure). See [interior structure](/analytics/tsc-interior-structure.md) Chapter III for the full chirality reading. |
| 19 | SOP/PM | = 1/G_pos + 1/G_neg | Harmonic-mean reciprocal — how evenly total energy is split between the two arcs. |
| 20 | DIPLTR/PD | = G_pos − G_pos²/G_neg | "Session self-determination coefficient" — how much the position arc is building its own energy vs. inheriting pre-session structure. |
| 22–25 | SDD, SDD_inv, SMD | SOPPM/DIPLTRPD, its reciprocal, SOPPM/DIPLTR | The **shipped SWF series is SDD_inv** = DIPLTRPD/SOPPM. SDD=1 at CW=−1.0 (perfect symmetric pairing); SDD=0 at the null positions (CW −0.8 to −0.4). |
| 26–30 | S/D, D/S (+ gradient/curvature) | SOP/DIPLTR, DIPLTR/SOP | **The shipped DS series is D/S** = DIPLTR/SOP. S/D=−1 for three consecutive CW positions (−0.3 to −0.1) is called out as the definitive signature of maximum pre-session indeterminacy. |
| 31 | S×D | = G_neg² − G_pos² | Differential arc energy — sign flip marks "temporal parity" (session has fully matched pre-session encoding). |
| 32 | Sum/Sum-Diff | = 1/DIPLTR | Arc-asymmetry reciprocal; large values = near-balanced arcs. |
| 33 | **Dual Phase (DP)** | synthesizes PM, PD, SOP, DIPLTR, S/D and their derivatives into a phase angle | The capstone discriminant. DP=0 = perfect phase alignment (by definition at CW=−1.0); DP>0 = session leading its pre-session encoding (temporal excess); DP<0 = session lagging (structural "temporal debt" still owed, to be paid in the position arc). This is the **shipped Dual Phase series**. |

# Execution framework

- **Pre-session protocol** (before CW=0): find the CW of maximum negative DP (max phase lag — weakest structural expression point); as CW advances toward 0, the DP zero-crossing marks the start of "debt settlement." Longs entered before that crossing get the structural tailwind.
- **Reality-line execution** (CW=0): PD≈241× typical in the cited example — the session direction is pre-determined at the midpoint, but conductance is maximally evanescent there, so **execution exactly at CW=0 is contraindicated**; enter 0.1 CW units before or after.
- **Position-arc read** (CW>0): compare each G(CW_pos) to its paired G(CW_neg) — G_pos>G_neg = momentum-continuation posture; G_pos<G_neg = mean-reversion posture toward the pre-session encoded level.
- **Conductance gate**: evanescent + DP negative → 0.35× alpha; constructive + DP approaching zero from negative (debt settling) → 1.10× alpha expansion.

# Open extraction

The **Compass Architecture Overview / Polynomial Skew Framework / SOP,
PG (Pressure Gradient), PC (Pressure Curvature) synthesis** section
(roughly lines 2799–3987 of the source) and the full **worked case-study**
walking every observable against a live NQM26 04/10 dataset (lines
3988–5499) have **not yet been ingested** — this pass stopped after the
Part I/II base architecture and the "interior structure" essay (see
[TSC interior structure](/analytics/tsc-interior-structure.md)). Continue
extraction from `raw/Qu'an Reference Manual - extracted text.txt` line
2799 onward in a follow-up pass.

# Related

* [Difference Sum](/analytics/difference-sum.md), [Dual Phase](/analytics/dual-phase.md), [Statewave Fingerprint](/analytics/statewave-fingerprint.md) — the three shipped code outputs this architecture defines.
* [TSC interior structure](/analytics/tsc-interior-structure.md) — the deeper topological/risk reading of this same column set.
* [Strike Observable Manifold](/analytics/strike-observable-manifold.md) — the companion spatial (strike-axis) manifold, Part I of the same source document.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "PART II — Time State Compass" (lines 2399–2792).
