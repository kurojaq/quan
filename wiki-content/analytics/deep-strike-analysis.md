---
type: Execution Playbook
title: Deep Strike Analysis — Close Reading & Pre-Session Blueprint
description: The four-signal Time State Compass close-reading protocol and the five-layer Deep Strike Analysis that formally defines PDSL/DSC and produces the 0–10 Deep Strike Scorecard.
tags: [analytics, doctrine, deep-strike, pdsl, execution-playbook]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Trigger

Run once per session, before the market opens, using the prior session's
close data. This is Parts I–II of the "Qu'an Execution Playbook" — the
document that formally defines **PDSL**, a term used throughout the rest
of this doctrine without a fixed definition until now.

# Steps — Part I: session-close reading (four signals)

Read at CW→+1 (the close) — this is framed as a *forward*-reading act,
producing the next session's inherited priors, not a backward summary.

1. **DIPLTR residual** at CW +0.9/+1.0: >0 = bullish inheritance, <0 = bearish, ≈0 = indeterminate (weight other signals).
2. **Zero-cross count + final ZC quadrant**: a final ZC in CW[+0.5,+1] is the most potent close signal — carries forward as the mirror phase for the next session's open.
3. **Entropy residual**: 0–2 ZC events = high carry-forward conviction; 5+ = reduce next session's size by 30%; entropy rising sharply near CW+1 = no pending orders overnight.
4. **SOP Latent Path orientation** at CW +0.7/+0.8/+0.9: both SOPG_Latent and SOPC_Latent positive = open with bullish bias; both negative = bearish; diverging = wait until CW −0.5 before committing.

**Synthesis**: 3-of-4 signals aligned = Strong Prior (hunt the dominant Deep Strike level in that direction); 2-of-4 = Moderate Prior (require two Deep Strike confirmations); fewer = No Prior (no pre-session orders, wait for live TSC at CW −0.5).

# Steps — Part II: Deep Strike Analysis (five layers)

**Layer 1 — Observable Field Scan.** From the prior close's Book sheet, a strike qualifies on each of four criteria: `Mass > +2.0 OR Mass < −2.0`, `Kurt > 4.5`, `LR > 8.0`, `|A| > 20`. **A strike meeting 3 of 4 is a Deep Strike Candidate (DSC); meeting all 4 is a Primary Deep Strike Level (PDSL).** Typically 2–4 PDSLs per session. Hierarchy: PDSL (4/4) > DSC (3/4) > Background (2/4) — only PDSLs get full size, DSCs get 50%, background levels are never anchors.

*Note: this PDSL definition (4 joint criteria) is distinct from, though related to, the "Dealer Watermark" concept — see [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md) for how the two are used across different parts of the source and the shipped Heat Map panel.*

**Layer 2 — Directional Gradient Classification.** By Strike Force and its neighbor differential: `Force(K)>0 rising` = ascending gradient (bullish pressure building toward K, buy dips from below); `Force(K)<0 falling` = descending gradient (sell rallies from above); `Force(K)≈0` = phase boundary, the highest-value reversal zone and the entry itself.

**Layer 3 — TSC Inheritance Overlay.** Overlay Part I's prior onto the PDSL map: a Strong Prior elevates same-direction PDSLs to Tier 1; a prior *conflicting* with a PDSL's gradient (e.g. bullish prior on a descending-gradient PDSL) demotes it to watch-only pending live confirmation. The prior weights the observable field — it never overrides it.

**Layer 4 — Dealer Temporal Position.** Per PDSL, read Dealer Premium Time (DPT), DR3 (<0.3 = fresh, >0.7 = terminal/spent), and ICF Time Density trend (rising = accelerating, falling = decelerating). **Only PDSLs with DR3<0.3 and rising ICF Time Density are LIVE** (eligible for overnight pending orders) — spent levels require live confirmation only.

**Layer 5 — Deep Strike Scorecard (0–10).** `+3` all 4 observable-field criteria met, `+2` gradient unambiguous, `+2` TSC prior aligned, `+2` live dealer position (low DR3), `+1` ICF Time Density rising. **8–10 = Tier 1** (full pending order, full allocation); **6–7 = Tier 2** (reduced size, require tick-chart confirmation); **4–5 = Tier 3** (watch only); **<4 = discard**.

# Failure modes

- Treating the TSC prior as an override rather than a weight on the observable field is the most common misapplication — Layer 3 is explicit that a conflicting prior demotes, it doesn't reverse, the gradient read.
- Anchoring a trade to a DSC or background level at full size defeats the entire point of the hierarchy.

# Related

* [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md) — how the identified PDSLs become the Fibonacci anchors.
* [Three-Layer Execution Model](/analytics/three-layer-execution-model.md) — how a Tier 1 PDSL becomes an actual order structure.
* [Pre-Session Checklist](/analytics/pre-session-checklist.md) — the full 8-phase sequence this feeds into.
* [Risq framework](/analytics/risq-framework.md) — the parallel risk-sizing check this scorecard doesn't replace.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Qu'an Execution Playbook," Parts I–II (lines 1782–1877).
