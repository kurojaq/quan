---
type: Reference
title: Polynomial Skew Framework
description: Fitting a 2nd-6th order polynomial to Pressure Curvature across the Chronometer Watch axis — each order maps to a distinct market-structural phenomenon.
tags: [analytics, doctrine, time-state-compass, polynomial-skew]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Summary

The Time State Compass is described as "the curvature-field engine" operating on the Chronometer Watch (CW ∈ [−1,+1], step 0.1). Fitting `P(CW) = a₂·CW² + a₃·CW³ + a₄·CW⁴ + a₅·CW⁵ + a₆·CW⁶ + …` to Pressure Curvature decomposes the field into orthogonal orders — the local moment expansion of the implied-vol surface projected onto the temporal curvature axis. Lower orders describe bulk regime; higher orders reveal fine distributional structure.

# Core fields

| Abbr. | Name | Definition |
|---|---|---|
| PG | Pressure Gradient | 1st derivative of Pressure across CW — direction/rate of dealer pressure change |
| PC | Pressure Curvature | 2nd derivative — the foundational curvature quantity |
| PM | Pairs Multiplied | Left × Right across the symmetric axis |
| PD | Pairs Divided | Left / Right — ratio asymmetry |
| SOP | Sum of Pairs | Left + Right — primary curvature aggregation |
| DIPLTR | Diff In Pairs L-to-R | SOP − PM — residual between additive/multiplicative interaction |
| SDD | SOPPM / DIPLTRPD | 5th-order interaction between sum-product and difference-ratio dynamics |
| SMD | SOPPM / DIPLTR | SDD variant using raw DIPLTR; SDD/SMD divergence flags 5th-order asymmetry |

# Order-by-order table

| Order | Name | Primary fields | Market-structural meaning |
|---|---|---|---|
| 2nd | Quadratic | PC, Hessian H11/H22 | Convexity/concavity of curvature — equilibrium basin (mean-reverting) vs. diverging hill |
| 3rd | Cubic | DIPLTR, SOP Tension | Curvature asymmetry — directional dealer bias, put/call skew |
| 4th | Quartic | Hessian eigenvalue ratio, Dual Phase | Kurtosis of curvature — tail-risk regime, directionality index (the temporal analogue of a butterfly spread) |
| 5th | Quintic | SDD, SMD, DS Curvature | Skew-kurtosis interaction — asymmetric fat-tail loading; whether the two tails have different kurtosis profiles |
| 6th | Sextic | Folding Entropy, ZC count | Curvature-of-curvature — entropy cascade, latent-path tension (the temporal analogue of a Vol-of-Vol surface) |

# Reading each order (generic, order-independent of the specific worked example)

- **2nd (foundation)**: both Hessian diagonals (H11, H22) positive + Det(H)>0 + Tr(H)>0 confirms a stable, mean-reverting elliptic well — the structural floor that contains higher-order oscillation. Eigenvalues quantify anisotropy of that well (which axis resolves faster).
- **3rd (directional driver)**: a persistent negative DIPLTR = put-side/downside structural loading (the temporal analogue of put skew); positive = upside loading. The largest-magnitude DIPLTR reading is the primary directional signal.
- **4th (regime identifier)**: the Hessian eigenvalue ratio |λ₁/λ₂| classifies the regime — near 1 is circular/non-directional, growing ratio (e.g. ~6–15) is "moderately directional," >10–15 crosses into fully trending. High Dual Phase values mark amplified kurtosis interaction — a pin-risk-prone, multi-stable zone.
- **5th (coupling)**: a non-zero off-diagonal Hessian element (H12) means PM and SOP curvature are coupled — a shock to one induces a correlated response in the other; SDD vs. SMD divergence is the practical tell.
- **6th (entropy state)**: Total Folding Entropy (0 to ~1) measures how much curvature information-capacity the session has consumed; running Zero-Cross count is the topological winding number of the folded path (see [TSC interior structure](/analytics/tsc-interior-structure.md) Chapter VI for the deeper treatment). High entropy + CW=0 maximum Product-Curvature loading flags an imminent entropy-release event once CW>0 data populates.

# Practical integration

The source ties the cascade into two named downstream models — the **Implied Spot Forecasting Model (ISF)** and the **Scalar Decay-Weighted Greek Model (SDWGM)** — neither of which has been independently confirmed elsewhere in this extraction pass. 2nd-order equilibrium bands are the ISF mean-reversion target; 3rd-order DIPLTR magnitude sets a put-side Greek skew scalar; 4th-order eigenvalue asymmetry weights gamma exposure by strike; the 6th-order CW=0 entropy-loaded pivot is treated as the "trigger" event in a named **TDR (Trigger, Distribution, Reversion) framework** — also not independently confirmed.

# Related

* [Time State Compass](/analytics/time-state-compass.md) — the base column architecture this polynomial fit decomposes.
* [SOP (Superposition of Pressure)](/analytics/sop-superposition-of-pressure.md) — the derivation chain built on PG/PC directly.
* [TSC interior structure](/analytics/tsc-interior-structure.md) — the topological reading of the same 6th-order entropy/ZC machinery.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "PART II §1–§5, Appendix: Polynomial Skew Quick Reference" (lines 2799–3105). Note: the specific NQM26 04-20-2026 numeric readings cited in the source are a single worked example — not generalized here.
