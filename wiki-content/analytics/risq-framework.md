---
type: Risk Model
title: Risq — The Five-Dimension Risk Framework (base formulas)
description: The authoritative Risq ontology, the five risk dimensions with formulas and thresholds, and the Risq Ratio — the unified structural edge-to-risk measure that drives position sizing. Now computed live in the report engine.
tags: [analytics, doctrine, risq, risk-model]
timestamp: 2026-07-19T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Rules

**This is the base Risq framework** — the formulas that
[TSC interior structure](/analytics/tsc-interior-structure.md) and
[SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md)
each independently found only the *revisions* to, across two prior
extraction passes. It is distinct from the
[dealer-basis VaR engine](/analytics/information-field-risk-engine.md) —
two separate risk systems live in this source.

**Ontology** (Risq's own framing): risk is not variance, drawdown, or
ruin probability — it is *"the degree of misalignment between what the
field's observable structure asserts and what the position requires to
be profitable."* Five axioms: risk is five orthogonal dimensions (R1);
risk is re-read at every CW increment, not fixed at entry (R2); the stop
is a falsification boundary, not a risk limit (R3); every loss is
information about the field, not a financial event (R4); a session's
total risk capacity is finite, measured in entropy units, not dollars
(R5).

# The five dimensions

| Dimension | Symbol | Formula | Elevated when | Thresholds |
|---|---|---|---|---|
| Field Risk | ℛ_F | `log(1 + Jerk) × (1 / max(Mass, 0.01))` | Jerk>100 OR Mass<0.5 | **>4.0 = structural veto, no entry** |
| Temporal Risk | ℛ_T | `CW_position × DR3 × (1 + \|DIPLTR_residual\|)` | CW>+0.5 AND DR3>0.5 | >0.6: cut Layer B/C to 50%; >0.8: Layer A management only, no new entries |
| Information Risk | ℛ_I | `(1/condFactor) × log(1 + ZC_count)` | condFactor<0.50 OR ZC>4 | >2.0: require live TSC confirmation; >4.0: no pre-session orders, observe only |
| Coherence Risk | ℛ_C | `\|DIDK/DITK−1\| + \|DIDS/DITS−1\| + \|DR3K/(DIDK/DITK)−1\|` | DIDK/DITK divergence >2.5× | >1.5: reduce all layers 30%; >3.0: close all layers, reassess from scratch |
| Inertia Risk | ℛ_Ω | `max(II, 0.01) / max(TI, 0.01)` | II>0.8 AND TI<0.2 | >3.0: partial target only (0.382→0.500); >6.0: Layer A only, cancel B/C |

Field Risk is the only dimension that can **unilaterally veto** a trade
regardless of how favorable the other four read.

# The Risq Ratio ℛₓ — the unified edge/risk measure

The framework's answer to the Sharpe Ratio, built entirely from
structural observables rather than historical returns — a **pre-trade**
quantity computed before entry, not from outcomes:

```
ℛₓ = [|A| × |Force| × condFactor] / [max(ℛ_F,0.1) × max(ℛ_T,0.1) × max(ℛ_C,0.1) × max(ℛ_Ω,0.1)]
```

Numerator = structural edge (intent commitment × hedging pressure ×
signal-quality gate). Denominator = structural risk, as a **product** of
four dimensions — so any single dimension at a critical level dominates
and suppresses the ratio even if the others are favorable. (Information
Risk is folded into the numerator via condFactor, not the denominator.)

| ℛₓ range | Tier | Action |
|---|---|---|
| > 15.0 | Tier 1 | Full allocation, all three layers, maximum size |
| 8–15 | Tier 2 | Standard allocation, Layers A and B only |
| 4–8 | Tier 3 | Reduced allocation, Layer A only |
| 1–4 | Tier 4 | Observe only — no entry |
| < 1 | Veto | Structural edge insufficient for any exposure |

**Position sizing is mechanically derived from ℛₓ**, not discretionary:

```
Micro_allocation = Base_allocation × min(ℛₓ / 15.0, 1.0) × condFactor
```

This caps allocation at the base level for ℛₓ≥15 and scales proportionally
below it — it is structurally impossible to over-allocate relative to
the edge using this formula.

# Shipped in the report engine (2026-07-19)

`engine/report/quan_risq.py` (commit `8112d86`) computes all five
dimensions and the Risq Ratio, surfaced as a group on the
[Report tab](/terminal/tabs/report.md). It is a pure synthesis layer —
every input already existed in the engine (Jerk/Mass from the scorecard,
DR3/CW/ZC from the realization fold, Conductance and II/TI from the
relativistic block, the cascade moments for ℛ_C). Three scope decisions
diverge from the doctrine's live-intraday framing and are documented in
the module docstring:

- **Top-candidate only** — the snapshot brief reports Risq for the single
  highest-scored [PDSL/DSC](/analytics/deep-strike-analysis.md), not
  per-strike as the live-position doctrine implies.
- **CW position** uses the last covered value from the realization fold
  (the most session-complete read a snapshot allows), not a live clock.
- **Conductance** is kept as the engine's continuous DB35 value rather
  than bucketed into the doctrine's four discrete `condFactor` tiers
  (1.10/1.00/0.50/0.35), which the source doesn't specify precisely
  enough to port faithfully.

Thresholds and tier bands render exactly as the tables above; the
published client view exposes only the Risq Ratio + tier (see
[Report tab](/terminal/tabs/report.md)).

# Related

* [TSC interior structure](/analytics/tsc-interior-structure.md), [SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md) — the two independent *revision* sets to these same five dimensions, found in earlier passes before the base formulas were located.
* [Risq operational protocol](/analytics/risq-operational-protocol.md) — the Risq Surface (CW×Fibonacci risk geometry), the Entropy Budget, and the pre-/intra-session Risq Protocol built on these formulas.
* [Information Field & Risk Engine](/analytics/information-field-risk-engine.md) — the separate dealer-basis VaR system; do not conflate with Risq.
* [Report tab](/terminal/tabs/report.md) — where this now renders.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "RISQ — A Derivative Risk Framework from the Qu'an," Parts I–II, VII (lines 1480–1526, 1672–1692).
[2] Qu'an repo — `engine/report/quan_risq.py`, `js/payload-panel.js`, `js/report.js` (commit `8112d86`).
