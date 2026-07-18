---
type: Risk Model
title: SOP-Chirality Combined Execution Protocol
description: The four SOP×Chirality configurations and how each modifies position sizing, stop architecture, and the five-dimension Risq weighting.
tags: [analytics, doctrine, risq, chirality, sop, execution]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Rules

[SOP](/analytics/sop-superposition-of-pressure.md) reads the arc from inside (moment-to-moment gradient/curvature interaction); [Chirality](/analytics/chirality.md) reads it from outside (global preparation-vs-execution orientation). Their four combinations:

| Configuration                          | Reading                                                                                                                                           | Protocol                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Right-handed + constructive SOP** | Most favorable — global orientation directs energy toward execution, and execution-arc dynamics amplify it coherently                             | Full three-layer execution; pending orders at the PDSL with full conviction; standard (uncompressed) Fibonacci targets                                                     |
| **2. Right-handed + destructive SOP**  | The most dangerous *false* setup — arc orientation is correct but curvature resistance is blocking the release; entries fill correctly then stall | Layer A only; Layer B requires explicit confirmation (SOPG/SOPC crossing above 1.0) within two CW increments of the Layer A fill, else close and treat as observation-only |
| **3. Left-handed + constructive SOP**  | The left-handed session "at its most potent" — energy is front-loaded *and* coherently amplified                                                  | Pre-session orders placed deeper into the execution window (0.382–0.500 Fib) rather than at the PDSL, since departure will be rapid                                        |
| **4. Left-handed + destructive SOP**   | Most structurally uncertain — handedness exists but the dominant surface's internal dynamics are incoherent, fighting itself                      | Observation-only protocol; no pre-session orders; wait for SOP to resolve constructive before any engagement                                                               |

# Position sizing by handedness

- Right-handed + confirmed constructive SOP: standard three-layer allocation.
- Left-handed + confirmed constructive SOP: front-load — Layer A sized at 40% (vs. standard 30%), since Layer B timing may be compressed by the rapid early-arc release.
- Chirality-reversal session: increase the total allocation ceiling by one tier — framed as the highest-conviction setup type in the framework.
- Achiral or Configuration 4: zero allocation.

# Stop architecture by handedness

- **Right-handed**: adverse movement in the *preparation* arc is expected noise — hold firmly. Adverse movement in the *execution* arc is more significant: under constructive SOP it may signal the thesis is wrong; under destructive SOP it confirms Configuration 2's "Layer A only" protocol.
- **Left-handed**: adverse movement in the *early positive arc* is the critical tell — that's where the loaded energy was supposed to release. If it moves against the latent-path direction there, the expected release failed to occur; exit quickly rather than holding against it.

# Risq prior (modifies, does not replace, the five-dimension weighting)

| Configuration | Risq modifier |
|---|---|
| 1 (Right + Constructive) | Standard weight, all five dimensions |
| 2 (Right + Destructive) | Elevate ℛ_Ω (Inertia Risk) by 50% |
| 3 (Left + Constructive) | Elevate ℛ_T (Temporal Risk) sensitivity — rises faster than standard |
| 4 (Left + Destructive) | Risq assessment suspended — observation only |
| Chirality reversal + any constructive | Reduce ℛ_C (Coherence Risk) by 30% — reversals tend to show high domain coherence |

The base five-dimension Risq formulas these modifiers apply to are now
documented at [Risq framework](/analytics/risq-framework.md).

# Related

* [SOP (Superposition of Pressure)](/analytics/sop-superposition-of-pressure.md), [Chirality](/analytics/chirality.md) — the two inputs this protocol combines.
* [TSC interior structure](/analytics/tsc-interior-structure.md) — the earlier, independently-derived Risq revision set (Chapters IX–X) — cross-check both before treating either as complete.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "SOP & Chirality" Part VII (lines 3279–3309).
