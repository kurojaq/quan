---
type: Execution Playbook
title: Risq Operational Protocol
description: The Risq Surface (risk as CW×Fibonacci geometry), the Entropy Budget (session information capital), the temporal risk profile across the CW arc, coherence misalignment detection, the three inertia risks, and the pre-/intra-session Risq Protocol.
tags: [analytics, doctrine, risq, execution]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Trigger

Applied around every session, on top of the base
[Risq framework](/analytics/risq-framework.md) formulas — this is how
the five dimensions get read as a map rather than five isolated numbers.

# The Risq Surface — risk as geometry

A mental (not software-generated) two-axis map: horizontal = CW arc
(−1 to +1), vertical = Fibonacci spatial arc (0.000 anchor to 1.618+
extension). Four quadrants:

- **I — CW negative, Fib 0.382–0.618 (Preparation Zone)**: lowest-risk zone in the whole surface — ℛ_F<1.5, ℛ_T<0.2, ℛ_C<1.0, ℛ_Ω<2.0. Where pre-session pending orders are optimally placed.
- **II — CW positive, Fib 0.382–0.618 (Execution Zone)**: the primary active-trading zone; Layer B/C fill here. Monitor `ΔDR3/ΔCW > 0.15 per step` → compress targets immediately.
- **III — CW positive, Fib <0.236 or >0.786 (Structural Boundary Zone)**: high Field Risk near Mass barriers; either not-yet-confirmed or over-extended — neither is an optimal active-exposure location.
- **IV — CW negative, Fib <0.236 or >0.786 (Information Loading Zone)**: the rarest zone to hold exposure in; only valid for a multi-session overnight hold at a Watermark-level (LR>30) PDSL, and even then at 50% size with an extended stop.

# The Entropy Budget — session information capital

`EB₀ = 10 − (ZC_count_prev_session × 1.5) − (ℛ_I_at_close × 2)` — the
session's starting information reserve, estimated from the prior
session's close.

| EB₀ | Budget | Permitted |
|---|---|---|
| 8–10 | High | Full allocation |
| 5–7 | Moderate | Tiers 1–2 only, no Layer C |
| 3–4 | Low | Layer A only, at the highest-scoring PDSL |
| 0–2 | Minimal | Observe only |

Each completed trade consumes `EB_cost = (ℛ_C + ℛ_I) × Layer_multiplier`
(Layer A only ×0.5, A+B ×1.0, A+B+C ×1.8). When the running budget hits
zero, **the session is closed to new initiations regardless of setup
quality** — this is a structural information limit, not a position
limit. No intra-session recovery; it resets only at the next close.

# Temporal Risk across the CW arc

| Zone | Character | What to watch |
|---|---|---|
| CW [−1.0, −0.5] Loading | Epistemological — driven by ℛ_I, not DR3 | Signal maturity, not time |
| CW [−0.5, 0.0] Transition | Highest-vigilance segment — ZC flags fire here | A sudden ℛ_C rise here is the most dangerous signal in the arc |
| CW [0.0, +0.5] Confirmation | Temporal Risk begins its primary rise | `ΔDR3/ΔCW > 0.10/step` → activate temporal compression |
| CW [+0.5, +1.0] Management | Terminal — pre-specified actions only, no discretion | No new initiations; trail, partial, or close only |

The source's own framing: *"the positive arc feels active... structurally
it is the most information-depleted segment. The negative arc feels
empty... structurally it is the most information-rich. Your attention
should be highest when the market feels quietest."*

# Coherence misalignment patterns (DID/DIT/DR3 divergence)

| Pattern | Detection | Response |
|---|---|---|
| 1 — Intent/Transaction split | `DIDK>5.0 AND DITK<2.5` | Structure without flow (inertia). Layer A only until DITK>3.5 |
| 2 — Transaction/Realization split | `DITK>4.0 AND DR3K<2.0` | Flow not landing at the PDSL. Close all layers, re-scan — PDSL may have shifted |
| 3 — Directional reversal | `sign(DIDS)≠sign(DITS)` OR `sign(DIDS)≠sign(DR3S)` | The most serious break. No entries; cancel all pending; observe only |

# The Three Inertia Risks (as risk factors, not just measurements)

- **Intentional Inertia (II)** high + Force<1.0 at the PDSL: structurally sticky — price struggles to *leave* a well-defended level. Mitigation: accept 0.382 Fib partial target only, trail stop to entry, cancel B/C.
- **Transactional Inertia (TI)** low (`<0.15` at open): flow has no conviction — Layer A may fill validly but nothing drives the μ-Wave-3 departure. Require a deep μ-Wave-2 retrace (beyond 61.8% of Wave 1) before committing Layer B.
- **Realization Inertia (RI)** high (`>0.7` with CW>+0.4): price approaches target but can't close through it. Treat 0.500 as the effective target instead of 0.618; close 75%, trail the residual 25%.

# Loss as structural information (post-stop protocol)

A fired stop is read as the field's most credible signal about the
structural claim, not a failure to be processed emotionally. After every
stop: (1) record the CW position it fired at — expected vs. unexpected
zone; (2) re-measure all five dimensions at the fired level; (3)
classify the breach as impulsive (genuine break) vs. corrective (stop
hunt, reverses within one CW increment); (4) update the entropy budget
(+0.5 for a stop hunt, +1.5 for a genuine structural break, on top of
the trade's own EB_cost); (5) write one sentence naming what the stop
revealed about the field. A PDSL breached once has its Mass claim
reduced for the rest of the session — any second attempt should score at
least 2 points lower than the Tier-1 reading.

# The Risq Protocol — operational sequence

**Pre-session** (after Deep Strike Analysis): compute EB₀ → compute
ℛ_F/ℛ_I/ℛ_C/ℛ_Ω for each PDSL candidate (ℛ_T starts near zero) → compute
ℛₓ per candidate and apply its tier → derive exact micro-allocation per
layer from the ℛₓ formula → apply the dimensional veto (ℛ_F>4.0 or
Pattern 3 active → cancel pending orders there) → write a one-sentence
session Risq summary (EB₀, best/worst ℛₓ candidate, active vetoes).

**Intra-session** (every CW increment): re-measure ℛ_T from current
CW/DR3 → check for newly-active coherence patterns → subtract completed
trades' EB_cost from the running budget → if it hits zero, all remaining
pending orders go to observe-only → at CW=0, run a full five-dimension
re-read and reassess if any dimension rose >50% since pre-session.

**Post-loss**: run the full loss-as-information protocol; if the
running budget falls below 2.0 after the deduction, session observation
activates immediately regardless of remaining CW arc.

**Session close**: record EB_start/EB_end/consumed, trade/stop/target
counts, the dominant risk dimension, and whether any coherence pattern
activated — feeds directly into the next session's EB₀.

# Related

* [Risq framework](/analytics/risq-framework.md) — the base five-dimension formulas and the Risq Ratio this protocol operationalizes.
* [Observational Flow Frames](/analytics/observational-flow-frames.md) — the parallel, less formal Apex Dealer Logic Book checklist this protocol runs alongside.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "RISQ," Parts III–X (lines 1584–1767).
