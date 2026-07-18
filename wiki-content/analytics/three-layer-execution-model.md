---
type: Execution Playbook
title: Three-Layer Execution Model — Layers A/B/C, μ-Wave, and Order Sequencing
description: The market-maker-emulation position build (Layer A/B/C), the micro Elliott Wave confirmation vocabulary that triggers Layer B, and the CW-indexed pending-order sequencing protocol.
tags: [analytics, doctrine, layer-a-b-c, mu-wave, pending-orders, execution-playbook]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Trigger

Applied to each Tier 1/2 PDSL from [Deep Strike Analysis](/analytics/deep-strike-analysis.md),
using the levels from [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md).
This resolves **Layer A/B/C** and **μ-Wave**, terms used pervasively
elsewhere in this doctrine without a fixed definition until now.

# The three-layer build (micro contracts, emulating dealer inventory-building)

| Layer | Size | Entry | Stop | Target |
|---|---|---|---|---|
| **A — Structural Anchor** | 30% | LIMIT at the PDSL / nearest Fib (0.382 or 0.618) | Quarter level beyond the PDSL | None — this is the build's base |
| **B — Confirmation Add** | 40% | LIMIT at the first quarter-level retrace, only after price reaches Layer A **and** a confirming μ-Wave forms | Trailed to the Layer A stop | 0.618 Fib from the entry zone |
| **C — Momentum Extension** | 30% | STOP order at 0.618 Fib (breakout confirmation) | Trailed to 0.500 Fib | 0.786 or 1.000 Fib |

If Layer A fills but no Elliott Wave confirmation occurs within 2 CW
increments, **Layer B is cancelled** and A is managed alone at reduced
size. The conductance gate scales all three: `condFactor=1.10` → full
allocation all layers; `1.00` → full A+B, Layer C at 50%; `0.50` → Layer
A only, B/C cancelled; `0.35` → no pre-session orders, live confirmation
required even for A.

Positions are framed as **inventory, not directional bets**: long
inventory below an ascending-gradient PDSL is accumulated because the
field will bid it up to you; short inventory above a descending-gradient
PDSL is accumulated because the field will offer it down to you. Adverse
movement against inventory (before the stop) is not a reason to panic —
it's the same discipline a dealer applies to their own book.

# μ-Wave — the microstructural confirmation vocabulary

Read on a 5-tick or 10-tick **line chart** (not candlestick — see
[Field Notes observation 7](/analytics/field-notes-observations.md#7))
near a PDSL, at the fractal scale below primary Elliott Wave degree:

- **Micro Impulse (μ-1‑2‑3‑4‑5)**: μ-1 = initial departure (short, low volume); μ-2 = first retrace, must hold above the PDSL, typically 38.2–61.8% of μ-1; μ-3 = the extension leg (Force>5, volume expands, longest wave); μ-4 = consolidation, must not overlap μ-1; μ-5 = terminal thrust, often diverges on a momentum oscillator. **Entry rule: Layer B fires at the end of μ-2** — lowest-risk entry, μ-3 about to launch, stop just below the PDSL.
- **Micro Correction (μ-A‑B‑C)**: a 3-wave counter-trend move near the PDSL — not a new-direction signal, but confirmation the correction has finished and the primary structure resumes. μ-A = counter-trend move at a high-Speed strike; μ-B = partial retrace (50–78.6% of A); μ-C = terminal leg, ending at a Fibonacci quarter level. **Entry rule: Layer B fires once μ-C terminates at a quarter level.**

**Invalidation** (cancels all pending orders at that PDSL): μ-2 retraces
more than 100% of μ-1; μ-4 overlaps the μ-1 high; or price closes below
the PDSL on a 10-tick bar. Invalidation is read as information (the
field's obligation was absorbed or broken), not failure — escalate to
the next Deep Strike level.

**Reading protocol**: approach (5-tick, impulsive vs. corrective) → PDSL
touch (count the touching wave — a μ-5 touch is a reversal setup, a μ-3
touch is a continuation setup) → departure (count μ-1/μ-2) → μ-2
completion (place Layer B, set its stop and 0.618 target) → μ-3 launch
(arm Layer C's stop order at 0.618, trail A to breakeven, trail B to the
μ-4 low once it forms).

# Order types and CW-indexed sequencing

- **Limit order** — the "gravity trap," placed at/near a PDSL for Layers A and B; cancel if a live ZC flag fires in the wrong CW quadrant before fill.
- **Stop(-limit) order** — the "breakout confirmation trap," 1–2 ticks beyond the PDSL, used for Layer C; always stop-*limit* in liquid instruments, never stop-market (slippage control).
- **OCO bracket** — attached to every filled layer; target leg at the layer's Fib target, stop leg at the quarter-level stop; trail to breakeven once price reaches the 0.382 extension. Never widen a stop leg after entry — only tighten or trail.

| CW checkpoint | Action |
|---|---|
| Pre-session | Place Layer A limits at all Tier 1 PDSLs; apply the conductance gate (cancel all if condFactor<0.50); attach GTC OCO brackets; write the specific cancel condition for each order |
| Open / CW≈−0.9 | If live DIPLTR contradicts the close reading, cut Layer A size 50%; a ZC in CW[−1,−0.8] forces reassessment before CW=−0.5; no new orders added on the open |
| CW=−0.5 (live TSC gate) | Prior confirmed → hold; prior reversed → cancel all pre-session limits, live-only re-entry; prior neutral → cancel Layer A, wait for tick confirmation |
| CW=0 (reality line) | All Layer B orders must be filled or cancelled by now; Layer C stop-orders armed if 0.618 has cleared; tighten Layer A's stop if unrealized loss exceeds 50% of planned stop distance |
| CW=+0.5 to +1 | Manage only, no new orders; trail Layer C to 0.618 if untouched by CW=+0.8; if all targets hit before CW=+0.7, stop for the day |

# Related

* [Deep Strike Analysis](/analytics/deep-strike-analysis.md), [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md) — the blueprint and levels this model executes against.
* [Stop Architecture & Loss Management](/analytics/stop-architecture-loss-management.md) — the full stop-placement and loss-escalation rules referenced above.
* [Execution tab](/terminal/tabs/execution.md) — the shipped terminal surface an operator would place these orders through (Tradovate; this doctrine's order architecture is not itself confirmed as automated in code).

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Qu'an Execution Playbook," Parts IV–VI (lines 1978–2133).
