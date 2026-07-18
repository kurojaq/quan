---
type: Risk Model
title: Information Field & Dealer-Basis Risk Engine (Apex Dealer Logic Book, Section III)
description: Distributional observables across Intent/Transaction/Realization, the Composite Dealer Score, Trigger Pull gate, and the dealer-basis VaR engine — a separate risk system from the five-dimension Risq framework.
tags: [analytics, doctrine, risk-engine, var, apex-dealer-logic]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Rules

**This is a distinct risk system from [Risq](/analytics/tsc-interior-structure.md)'s five-dimension ℛ_F/ℛ_I/ℛ_C/ℛ_T/ℛ_Ω framework** — different naming, different formulas, both present in the same source document. Do not conflate them; cross-reference both before assuming either is "the" risk engine.

**Distributional observables** — kurtosis/skewness computed separately for each of the three [temporal modes](/analytics/dealer-field-architecture.md), because their *divergence* is as diagnostic as their absolute values:

| Observable | Measures | Signal |
|---|---|---|
| Intent Kurt (DIDK) | Tail concentration in long-term dealer commitment | DIDK>6: pin expected, high compression |
| Transaction Kurt (DITK) | Tail risk in intraday flow | DITK ≫ DIDK: breakout risk building |
| Realization Kurt (DR3K) | Tail risk in realized dealer exposure | DR3K spike: gamma cascade possible |
| Intent Skew (DIDS) | Directional bias in structural OI | +: bullish structure · −: bearish structure |
| Transaction Skew (DITS) | Directional bias in today's flow | Divergence from DIDS = regime conflict, buy vol |
| Realization Skew (DR3S) | Actual tail behavior of realized hedging; feeds Cornish-Fisher VaR | DR3S<−1 with DR3K>5: tail hedge critically priced |
| LIQ Kurtosis (LIQK) | Concentration of dealer entrapment across strikes | LIQK>6: Watermark identification reliable |
| DIDAVG/DITAVG | Ratio of mean Intent to mean Transaction | >10: structural epoch, reversions reliable |

**Composite Dealer Score (CDS) and Trigger Pull (TP)** — the synthesis metric:

```
CDS = w₁·Intent_Score + w₂·Transaction_Score + w₃·Realization_Score
default weights: w₁ = w₂ = w₃ = 1/3 (adjustable)
Trigger Pull (TP): binary, from CDS threshold × P-Score floor
```

A positive CDS with DIDS/DITS/DR3S all confirming the same direction is the framework's highest-confidence three-layer convergent signal; any divergence (e.g. DIDS positive, DITS negative) requires resolution before execution.

**Dealer-basis VaR** — computed such that positive delta exposure from the dealer's perspective creates bearish market pressure when unwound:

| VaR type | Formula/basis | When to use |
|---|---|---|
| Parametric Delta VaR | `Z × DDE × F × σ × √T` (normal-distribution assumption) | Quick structural check; underestimates tail risk when DR3K>3 |
| Gamma-Adjusted VaR | `Delta VaR + ½ × GEX × (Z×σ×F)²` | When net GEX is large — captures 2nd-order re-hedging cost |
| Cornish-Fisher VaR | `Z_CF = Z + (Z²−1)·S/6 + (Z³−3Z)·K/24 − (2Z³−5Z)·S²/36` using DR3S/DR3K_excess | Primary VaR for fund-grade reporting — uses actual distributional shape |
| Stress VaR | F ±1/2/5/10% scenario P&L | Regime-transition testing; when Kurt>6 and Force>5, the stress scenario becomes the base-case probability |

# Rationale

The three-tier kurtosis/skew split exists because dealer positioning has genuinely different shapes at different time horizons (structural OI vs. today's flow vs. realized hedging) — collapsing them into one statistic would hide exactly the divergence that signals a regime change forming. The VaR ladder escalates in sophistication (parametric → gamma-adjusted → Cornish-Fisher → stress) precisely so a practitioner isn't stuck using a normal-distribution assumption once Realization Kurtosis shows the tail is fat.

# Related

* [Dealer Field Architecture](/analytics/dealer-field-architecture.md) — the Intent/Transaction/Realization triad these statistics are computed over.
* [TSC interior structure](/analytics/tsc-interior-structure.md), [SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md) — the separate Risq (ℛ_F/ℛ_I/ℛ_C/ℛ_T/ℛ_Ω) risk system, still only partially extracted.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Apex Dealer Logic Book," Section III (lines 3609–3672).
