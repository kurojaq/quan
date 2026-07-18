---
type: Risk Model
title: Stop Architecture & Loss Management
description: Quarter-level stop placement by layer type, the three-stage loss escalation protocol, and the single-re-entry-per-PDSL rule.
tags: [analytics, doctrine, stops, loss-management, risk]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Rules

**A stop is a structural invalidation boundary, not a loss limit** — it
fires where the observable-field evidence for the trade (the PDSL's
gravitational claim) is demonstrably broken, reframing it as an
information event rather than a financial one. Two governing rules:
never place a stop at a round Fibonacci level (0.382/0.500/0.618 attract
stop-hunting — use the quarter level just beyond instead); and the
**structural stop distance determines position size**, never the
reverse — if the honest stop is wider than your risk tolerance, size
down, don't move the stop.

**Stop placement by layer** (see [Three-Layer Execution Model](/analytics/three-layer-execution-model.md)):

- **Layer A**: `AL − 1.5×(avg tick range, last 5 micro bars)`, expressed as the −0.059 quarter level below AL — but never inside the nearest negative-Mass strike. Mirrored above AH for descending entries. Does not move until Layer B is confirmed and filled.
- **Layer B**: the quarter level one notch beyond its entry — 0.345 for an ascending 0.382 entry, 0.655 for a descending 0.618 entry. Once μ-Wave 3 is confirmed (μ-1 high broken on the 5-tick chart), trail to 0.309 (net risk: ¼ of the original Layer B stop).
- **Layer C**: 0.500 (the midpoint) regardless of ascending/descending direction; trail to 0.618 once price reaches 0.786 — at that point the trade is at minimum breakeven, with only position-time exposure remaining.

# The three-stage loss protocol

1. **Layer A fills but stalls** (no μ-Wave departure after 3 CW increments): close half of Layer A at market, hold the stop at its original level (never widen), cancel the Layer B pre-session order (require live μ-2 confirmation instead), and close the remainder if DIPLTR flips sign on the next CW read.
2. **Layer A stop is hit**: do not immediately re-enter; log the violation; cancel all remaining pending layers for that PDSL; re-run the Deep Strike Scorecard — if it now scores <6, abandon the strike for the session; if it still scores ≥6, **exactly one re-entry is permitted**, at 50% size, only after a full micro-corrective structure completes below the invalidated PDSL. A second stop-out on that PDSL closes it for the session with no further attempts.
3. **Two or more Layer A stops in one session**: cancel all remaining pending orders; cut the *next* session's total allocation by 50%; require a Strong Prior close reading before any pre-session orders the following day. **Three consecutive sessions with a Layer A stop** triggers a mandatory one-session pause — paper trade the next session, resume live only if that paper session is positive.

A loss is never a reason to increase size "to recover" — size returns
only after three consecutive sessions without a Stage 2 or Stage 3 event.
See [Risq — Loss as structural information](/analytics/risq-operational-protocol.md)
for the parallel, more formal post-loss information protocol from the
Risq document.

# The asymmetric stop exception (descending gradient only)

Descending-gradient (short) setups have a documented higher rate of
false breaks — a stop hunt above resistance before the real move down.
For those setups only, one ATR of expansion beyond the standard 1.059
stop level is permitted, **and only if all three hold simultaneously**:
DR3<0.3, DIPLTR negative, and ICF Time Density rising. If any condition
fails, the standard stop applies without exception.

# Related

* [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md) — the quarter-level grid these stops are placed on.
* [Three-Layer Execution Model](/analytics/three-layer-execution-model.md) — the layer structure these stops protect.
* [Risq operational protocol](/analytics/risq-operational-protocol.md) — the entropy-budget consequences of a fired stop.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Qu'an Execution Playbook," Part VII (lines 2134–2196).
