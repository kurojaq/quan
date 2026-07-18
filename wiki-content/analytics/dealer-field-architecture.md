---
type: Reference
title: Dealer Field Architecture (Apex Dealer Logic Book, Sections I–II)
description: The Intent/Transaction/Realization three-tier structure, the Puts-Minus-Calls sign convention, unified signal thresholds, the Liquidity Ratio trapped-dealer table, and the temporal/relativistic field vocabulary (SoI/SoT/SoR, Lorentz factor, Tachyonic flag).
tags: [analytics, doctrine, dealer-basis, liquidity-ratio, apex-dealer-logic]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Summary

A condensed "field manual" restating the framework as a dealer-centric physical model: *"The dealer does not predict markets. The dealer is the market."* Grounded in "the Golden Reference Workbook — FundGrade Options Analytics v3.0," ZN weekly options, daily expiry cycle.

# Section I — Spatial/dealer-basis architecture

**Three-tier temporal structure** — not accounting labels, but distinct physical states of dealer commitment:

| Mode | Temporal locus | Key metric | Inertia |
|---|---|---|---|
| **INTENT (DID)** | Structural OI, accumulated positioning (CW=−1) | A = Net OI / PC Ratio(OI) | High — structural, slow to move; dealers trapped |
| **TRANSACTION (DIT)** | Today's volume flow, live repositioning (CW=0) | B = Net Vol / PC Ratio(Vol) | Low — fluid, intraday repositioning |
| **REALIZATION (DR3)** | Hedged outcome, delta-realized positions (CW=+1) | Dealer Risk Realization Ratio (DR3) | Variable — depends on gamma regime |

**Puts Minus Calls — the core sign convention**, non-negotiable: `Net OI = Put OI − Call OI`, `Net Vol = Put Vol − Call Vol`.

| Condition | Public positioning | Dealer consequence |
|---|---|---|
| Net OI > 0 | More puts held (bearish hedging dominant) | Dealers SHORT puts → LONG delta → buy dips → **FLOOR** |
| Net OI < 0 | More calls held (bullish speculation dominant) | Dealers SHORT calls → SHORT delta → sell rallies → **CEILING** |
| Net OI ≈ 0 | Balanced — rare, structurally significant | No net dealer delta — neutral/transition zone |
| \|Net OI\| > 1000 | Heavy structural commitment | Dealers trapped — cannot exit without market impact |

**Unified field signal thresholds** (companion, condensed version of the [Strike Observable Manifold](/analytics/strike-observable-manifold.md)):

| Observable | Formula | Signal |
|---|---|---|
| Strike Mass | f(Net OI, Skew, Kurt) | +2.5: strong pin · −2.0: active barrier |
| Strike Force | d(Mass)/d(Strike) | >+5: launch pad · <−5: cascade zone |
| Strike Speed | √(\|Force\|/\|Mass\|) | <0.5: pin zone · >3.0: trend corridor |
| Strike Lag | \|Mass\|/\|Force\| | <1: instant · >50: crisis/frozen |
| Strike Kurt (K) | 4th moment of Net OI | K>6: explosive (**gamma wall**) · K<1: smooth · K<0: forbidden |
| Strike Skew (S) | 3rd moment of Net OI | >+2: upside tail · <−2: crash tail |
| Strike Jerk | d(Accel)/dt | <1: trade freely · >1000: do not trade |

**Liquidity Ratio and the Trapped Dealer** — resolves the [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md)'s exact threshold: `A = Net OI/PC Ratio(OI)`, `B = Net Vol/PC Ratio(Vol)`, `LR = A/B` (structure : flow).

| LR range | Field state | Dealer condition | Strategy |
|---|---|---|---|
| < 1 | Flow dominates — fluid | Actively repositioning, can exit | Buy volatility, breakout plays |
| 1–10 | Balanced | Normal, healthy turnover | Context-dependent |
| 10–20 | Structure dominates — sticky | Committed, reluctant to exit | Sell vol at strike, fade extremes |
| **20–55** | **Maximum commitment — Watermark level** | **TRAPPED — must defend at all costs** | Strong mean reversion, pin trade |
| < 0 | Conflict — flow vs. structure opposed | Book in contradiction | Buy vol, expect whipsaw/regime shift |

At LR ≈ 55.6 (the source's ZN example, strike 110.50, Net OI +2,097) the dealer is described as "56× more committed to this level than they are actively adding to it... the last line of defense."

# Section II — Temporal field observables

| Metric | Definition | Operational signal |
|---|---|---|
| Chronometer Watch (CW) | Toroidal −1 (Intent) → 0 (Reality Line) → +1 (Realization) coordinate | Near 0 = active transition; near +1 = position time active |
| Chronometric Conductance (G) | How easily the temporal cycle conducts; G ∝ 1/Z | High G: trade freely with momentum; low G: wait |
| Chronometric Impedance (Z) | Resistance to temporal flow — the temporal equivalent of Lag | High Z: frozen regime, spatial signals distorted, do not force |
| Chronometric Field C(f) | ticks × tempo baseline | Threshold crossing signals a temporal-frame regime transition |
| Lorentz Factor (γ_T) | Relativistic dilation of decision-time at high execution intensity | γ_T ≫ 1: near-singularity execution, <150ms window |
| Tachyonic Flag (TII) | "Sub-luminal" (normal) vs. "Tachyonic" (execution speed exceeded temporal stability) | Tachyonic: reduce size, confirm signals |
| Speed of Intent (SoI) | Rate structural OI positions form relative to the arc | SoI > SoT: intent leading — structural conviction forming |
| Speed of Transaction (SoT) | Rate of intraday flow relative to the arc | SoT > SoI: transactional urgency, new positioning overwhelming structure |
| Speed of Realization (SoR) | Rate hedged positions are realized/closed | SoR spike near expiry: pinning collapse imminent, gamma release |

**Hessian analysis** (`H11` = curvature of PM, `H22` = curvature of SOP, `Det(H) = H11·H22 − H12²`, `Tr(H) = H11+H22`):

| Hessian state | Temporal surface | Trading implication |
|---|---|---|
| Det(H)>0, Tr(H)>0 | Positive definite — temporal minimum, compression convergence | Approaching a temporal floor; expansion imminent, prepare for breakout |
| Det(H)>0, Tr(H)<0 | Negative definite — temporal maximum, compression at ceiling | Overextended temporally; reversion expected, fade |
| Det(H)<0 | Indefinite — saddle point, temporal divergence | Unstable field; avoid directional bias, vol expansion likely, reduce exposure |
| Det(H)≈0 | Degenerate — flat curvature | No temporal signal; insufficient data or balanced regime, observe |

**Dual Phase reading**: when PG and PC share sign, the field is coherent (reinforcing); when they diverge, it's a dual-phase conflict — the temporal equivalent of an overextended trend preparing to revert.

# Related

* [Strike Observable Manifold](/analytics/strike-observable-manifold.md) — the fuller W–AM column reference this section's table condenses.
* [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md) — now grounded with the exact LR threshold (20–55).
* [Information Field & Risk Engine](/analytics/information-field-risk-engine.md), [Observational Flow Frames](/analytics/observational-flow-frames.md) — the next two sections of the same field manual.
* [Chart tab](/terminal/tabs/chart.md) — `gwall` label now confirmed as "gamma wall" (Kurt > 6).

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Apex Dealer Logic Book," Sections I–II (lines 3416–3608).
