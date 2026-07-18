---
type: Market Concept
title: Chirality — The Arc's Handedness
description: Whether the CW arc's preparation (negative) and execution (positive) surfaces are mirror-symmetric or dominant one way — right-handed, left-handed, or achiral sessions, and the three-session reversal sequence.
tags: [analytics, doctrine, chirality, dipltr, time-state-compass]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# What it is

A property borrowed from physics/chemistry: a system is chiral if it cannot be superimposed on its mirror image. The CW arc's negative (preparation) and positive (execution) halves are structurally symmetric in form but not necessarily in character — **DIPLTR is the direct measurement of whether they are mirror images (achiral) or one dominates (chiral)**. This is a deeper, more execution-oriented treatment of the same signal covered more briefly in [TSC interior structure](/analytics/tsc-interior-structure.md) Chapter III.

# How it works

`DIPLTR(n) = P(CW=+n/10) − P(CW=−n/10)`, paired position by position; the global (summed/mean) DIPLTR is the session's net chirality.

- **Right-handed** (DIPLTR > 0): the execution surface dominates. Structural moves tend to occur *later*, after CW=0 — the preparation arc can look quiet even when the session has real character. This is the more common configuration and the one that best rewards pre-session pending orders, since the energy releases into the window where those orders wait.
- **Left-handed** (DIPLTR < 0): the preparation surface dominates. The biggest moves are front-loaded into the early positive arc (CW 0 to +0.3) — practitioners waiting for intraday tick-chart confirmation frequently miss the primary move entirely. The strongest argument for placing pre-session orders *deeper* into the execution window (0.382–0.500 Fibonacci) rather than at the PDSL itself, since departure from the PDSL will be rapid.
- **Achiral** (DIPLTR ≈ 0): no dominant handedness — the rarest configuration, and (counter to intuition) one of the *hardest* to trade: energy is present on both surfaces without a resolved direction, which is exactly the condition for whipsaw. Correct protocol: observation only, no pre-session orders, wait for DIPLTR to develop before any reduced-conviction entry.

# Multi-session patterns

- **Persistence**: consecutive sessions tend to share handedness, because dealer inventory doesn't change dramatically overnight — the prior session's handedness is a structural prior, not a guarantee.
- **Reversal**: the most structurally significant single event DIPLTR can generate. Mechanically: a right-handed session's execution-phase hedging flows partially roll into the next session's structural inventory (DID) — what was execution-phase expression becomes the next session's preparation-phase loading. This is framed as **the arc completing one full toroidal rotation**, not a regime break.
- **Three-session sequence** (Right→Left→Right or the mirror): Session 1 loads (persistent same-handed), Session 2 is the reversal that expresses what Session 1 loaded (the highest-magnitude opportunities in the framework tend to sit here), Session 3 consolidates. Track global DIPLTR sign after every close; size the Session-2 position proportional to the magnitude of the reversal, not just its presence.

# Related

* [SOP (Superposition of Pressure)](/analytics/sop-superposition-of-pressure.md) — the "interior" arc-dynamics reading that combines with chirality.
* [SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md) — the four combined configurations and their Risq/position-sizing consequences.
* [TSC interior structure](/analytics/tsc-interior-structure.md) Chapter III — the shorter, earlier-ingested treatment of the same DIPLTR signal.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "SOP & Chirality" Parts IV–V (lines 3207–3256).
