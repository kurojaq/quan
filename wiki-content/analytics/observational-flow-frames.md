---
type: Execution Playbook
title: Observational Flow Frames & Quick Reference (Apex Dealer Logic Book, Sections IV–VII)
description: The structured pre-session/intraday/execution checklists, the 25 essential analytical questions, the regime classification matrix, and the Twelve Axioms of Dealer Logic.
tags: [analytics, doctrine, execution, checklist, apex-dealer-logic]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Trigger

Applied daily, in three sequential frames — "an observational flow is not a checklist, it is a structured sequence of attention... each step gates the next; if a gate fails, the analysis stops at that step."

# Steps

**Pre-Session Flow Frame (morning, no directional bias formed yet — topology only):**
1. Conductance Gate — read CW position, Conductance/Impedance; high Z flags all downstream spatial signals as distorted (a frozen field near a Watermark is the highest-conviction scenario, not a reason to skip).
2. Temporal Surface — run the Hessian; is Det(H) positive or negative (compressing toward minimum vs. at a maximum)?
3. Distributional Snapshot — read DIDK/DITK/DR3K and DIDS/DITS/DR3S; convergent = high conviction, divergent = reduce expectations.
4. Spatial Landscape — map Mass across all strikes: maximum-Mass centers, negative-Mass barriers, singularity candidates (LR>20 and Kurt>6 simultaneously).
5. Liquidity Ratio Topology — classify each high-Mass strike (Watermark / Active Defense / Normal / Fluid); draw the defended terrain.
6. Force Field Orientation — identify launch pads (F>+5, low Mass), cascade zones (F<−5), equilibrium/pinning bands (F≈0, high Mass).
7. Expiry Context — T<1 day: maximum gamma, near-certain pinning at Watermarks; T>3: structural field dominates over temporal.
8. Mission Brief — synthesize into one written sentence naming the field state, the primary attractor, the dealer floor, the Force regime, and the temporal-surface direction. **Do not trade until you can write this sentence.**

**Intraday Observation Frame (every 15 minutes):**
- Price vs. Mass Vector — approaching / at / departing the primary attractor.
- Net Volume Evolution (B vs. A) — B growing toward A = momentum confirmed; B opposing A = whipsaw warning.
- Temporal Arc Check — has CW progressed toward/past 0, or past +0.8 (realization phase)?
- Jerk Monitor — elevated Jerk in a previously-smooth zone = do not trade there until it settles.
- Status Matrix — Market / Personal / Temporal status, each rated; any degraded rating = reduce size or stand down.

**Execution Flow Frame (signal to entry):**
- Intent Complete (pre-write) — write entry/stop/target/RR *before* touching the order ticket; if you can't write it in one sentence without hesitation, the setup isn't ready.
- Transaction Gate — four checks must ALL clear: P-score threshold met, LR above the regime floor, all Status Matrix green, not in a Jerk>1000 zone. Any failure = no execution, return to Intent.
- Execution (3-Second Rule) — for P-score>85% setups: Signal → Verify → Execute within 3 seconds, no second-guessing; adapt only at the next Intent cycle, never mid-transaction.

# Daily questions (Section VI, 25 total — condensed to the gating ones)

- **Temporal**: CW position + conductive/impeded? Hessian converging or diverging? Are Intent/Transaction/Realization convergent? Lorentz factor sub-luminal or tachyonic? Has SoI crossed SoT?
- **Spatial**: primary Mass attractor, inside or outside its basin? Negative-Mass barrier cost? Which strikes are in Watermark territory? Launch Pad location? Jerk below or above 1.0?
- **Positioning**: A vs. B relationship at the key strike? Is today's Net Volume reinforcing or eroding Net OI? DIDAVG/DITAVG epoch vs. active-repositioning read? Is the Watermark approached, held, or breached? Is LIQK elevated (concentration confirmed)?
- **Directional**: DIDS/DITS aligned? Where's the skew phase-transition strike, has price crossed it? DR3S+DR3K tail read? Extreme-skew strikes breakout candidates or LR-suppressed?
- **Execution**: Intent phase complete before market interaction? P-score at/above the regime threshold? RR at/above regime minimum? All four Status Matrix dimensions green?
- **Synthesis (the mastery test)**: can you state the dealer's structural position, their point of maximum entrapment, the force direction their hedging will produce, and the temporal arc state — in one sentence, without notes?

# Quick reference — regime classification

| Regime | \|Flux/Mass\| | LR range | Kurt | Jerk | Primary strategy | P-score floor | RR floor |
|---|---|---|---|---|---|---|---|
| SCALP | <10 | <5 | <3 | Low | High-frequency, tight stops, fade extremes in equilibrium | >55% | 2:1 |
| INTRADAY | 10–100 | 5–15 | 3–6 | — | Directional with structure; trend within the Mass attractor | >65% | 3:1 |
| SWING | 100–500 | 15–25 | >6 | Low | Geodesic transit; enter at Force zones, exit at attractor | >75% | 5:1 |
| SINGULARITY | >500 | >25 | >6 | Very low | Reversal at the exact singularity; aggressive alpha, max RR | >85% | 10:1 |
| CONFLICT | any | <0 | any | High | Buy vol, reduce directional exposure, wait for resolution | — | — |
| CRISIS | any | any | any | >1000 | EVACUATE — Lag approaching infinity, chaos dominant | — | — |

# The Twelve Axioms of Dealer Logic

1. The dealer does not take views. The dealer manages risk — every observable is the trace of risk management, not speculation.
2. Puts Minus Calls is the only correct basis; skipping the sign inversion reads noise as signal.
3. Conductance gates everything — read CW before reading Mass.
4. Mass is gravity, Force is its gradient — price follows geodesics, never assume straight-line motion.
5. The Liquidity Ratio is the dealer's trap depth — LR>20 is a *mandatory* defense, not a likely one.
6. Kurtosis compresses before it explodes — Kurt>6 is a compression signal, not a volatility signal; position before the explosion, not during it.
7. The Watermark is the last line of dealer defense — cascade below it, profit above it; know exactly where it is.
8. Flow (B) becomes structure (A) — today's Net Volume is tomorrow's Net OI.
9. Jerk>1000 is a chaotic zone — no observable there carries predictive value; exit, don't trade in it.
10. The three temporal layers must converge for maximum conviction — aligned DIDS/DITS/DR3S is a three-body confirmation; divergence is a warning.
11. Intent precedes Transaction — the plan written at CW=−1 governs execution at CW=0; a plan formed during transaction is a reaction, not a plan.
12. The tongue is guided by the hand — execute in silence, debrief in language.

# Related

* [Dealer Field Architecture](/analytics/dealer-field-architecture.md), [Information Field & Risk Engine](/analytics/information-field-risk-engine.md) — the observable vocabulary these frames apply.
* [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md) — the shipped Heat Map implementation of "the Watermark."

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Apex Dealer Logic Book," Sections IV, VI, VII (lines 3673–3987). Section V (blank note-taking templates) was skipped as non-doctrinal.
