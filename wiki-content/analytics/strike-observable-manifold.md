---
type: Reference
title: Strike Observable Manifold (Columns W–AM)
description: The 13-column spatial observable set — Kurt, Skew, ICF, vol-surface derivatives, Mass, Force, Speed, Lag, Acceleration, Jerk — read relationally across the strike ladder.
tags: [analytics, doctrine, strike-observables, dealer-positioning]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Summary

Columns W through AM are the complete **spatial observable manifold** of
the Qu'an framework: they map dealer positioning, hedging pressure,
temporal density, and dynamic character across every active strike on
the chain. The framework's own governing rule: **their power is not
individual — it is relational.** No column is read in isolation; each is
read as a gradient across the strike ladder approaching spot, and the
regime classification from Kurt (W) and Skew (X) sets the interpretive
frame for every downstream column.

# Column reference

| Col | Name | Symbol | Formal definition | Read as |
|---|---|---|---|---|
| W | Strike Kurt | T(k) | 4th standardized moment of net OI distribution — tail-thickness of dealer gamma concentration | T>0 fat-tailed (gamma concentrated); T<0 compressive/forbidden (bounded, no gamma backstop); T=3 = Gaussian baseline |
| X | Strike Skew | V(k) | 3rd standardized moment; directional potential energy surface. Force F(k) = −dV/dk | **Inverse discretion**: V<0 = upward (bullish) force, V>0 = downward (bearish) force |
| Y | Strike ICF | sCF(k) | Strike-level instantaneous chronometric field vs. session ICF | Positive = constructive (temporal attractor); negative = evanescent (temporal void) — the primary entry-validity gate |
| Z | Strike ICF Time Density | sCFt(k) | sICF ÷ session temporal basis | Cross-validates sign with Y; divergence marks a strike still structurally forming |
| AA | STD Gradient | ∇σ(k) | Spatial slope of implied-vol surface, dσ/dk | <0 = standard put-skew; >0 = call-wing rich (unusual); ≈0 = vol-surface inflection |
| AB | STD Curvature | σ″(k) | 2nd derivative of vol surface | >0 = convex smile (both wings expensive); <0 = concave smile (ATM expensive, pin priced) |
| AC | Strike-to-Global ICF | s2g(k) | sICF ÷ session total ICF | Ranks temporal significance — see tier table below |
| AD | Strike Mass | G(k) | Weighted composite of OI, Kurt, Skew | G>0 = attracts price; G<0 = repels. Anomalous Mass with no temporal support is a spatial artefact, not a real level |
| AE | Strike Mass % | G%(k) | G(k) normalized to global mass | G%>0.20 = tier-1 gravitational node; G%>0.35 at a COMP strike = maximum structural instability |
| AF | Strike Force | F(k) | Gradient of Mass, dG/dk | The actual hedging-pressure mechanism — dealer rehedging is real futures buying/selling, not a probabilistic signal |
| AG | Strike Force % | F%(k) | F(k) normalized to global force | The most sensitive concentration indicator; see singularity table below |
| AH | Strike Speed | v(k) | √(\|F\|/\|G\|) | High Speed with near-zero Mass = Force-singularity chaos, not momentum transit — Mass must always be checked alongside Speed |
| AI | Strike Speed % | v%(k) | v(k) normalized to global speed | Regime (T, V sign) must be read before Speed magnitude — floor and ceiling nodes can show near-identical Speed |
| AJ | Strike Lag | λ(k) | \|G\|/\|F\| (inverse of Speed) | λ<0.15 = algorithmic defense zone (fast, tight, reliable); λ>1.0 = dealers hesitant/overwhelmed; λ>100 = structural artefact |
| AK | Strike Lag % | λ%(k) | λ(k) normalized to global lag | Cross-validation for absolute Lag; sparsely populated |
| AL | Strike Acceleration | a(k) | Rate of change of Speed | High Acceleration at a floor node = momentum builds progressively (grace period exists); Acceleration >500 at an anomaly node = zero-dampening tension, gap-opening signature |
| AM | Strike Jerk | J(k) | 3rd derivative of position | The definitive smoothness/chaos discriminator — see execution-rule table below |

# s2g temporal-tier table

| s2g range | Tier | Conviction | Role |
|---|---|---|---|
| > 0.06 | Tier 1 — primary node | Highest | Session organizer, peak-conviction entry/exit |
| 0.03 – 0.06 | Tier 2 — secondary | High | Key reference level |
| 0.01 – 0.03 | Tier 3 — tertiary | Moderate | Context / partial-position reference |
| 0 – 0.01 | Weak constructive | Low | Minimal anchor, use with caution |
| < 0 | Evanescent drain | None | Avoid — no structural support |

# F% singularity table

| F/Gf range | Character | Execution implication |
|---|---|---|
| > 100× | Force singularity | Traversal barrier; gap formation on the way through; contrarian hold at the singularity |
| 20–100× | High-concentration hedging | Secondary barrier/accelerator; do not fade inside this band |
| 5–20× | Active hedging zone | Reliable entry/exit anchor |
| 1–5× | Normal hedging density | Standard execution |
| < 1× | Thin hedging zone | Low structural integrity; avoid as primary reference |
| sign-reversed vs. spot direction | Opposing force singularity | Max acceleration if above spot; max braking if below |

# Jerk execution-rule table

| J range | Embedding dim. d_E | Character | Execution rule |
|---|---|---|---|
| < 0.02 | < −5 (super-stable) | Crystallised, perfectly smooth | Maximum conviction; tight stops |
| 0.02–0.1 | −5 to −3 | Highly stable | Trade with conviction; normal sizing |
| 0.1–1.0 | −3 to 0 | Stable, minor turbulence | Standard execution |
| 1–10 | 0 to 3 | Low-complexity chaos | Reduce size 25%; widen stops |
| 10–100 | 3 to 7 | Moderate complexity | Reduce size 50%; defined risk only |
| 100–1000 | 7 to 10 | High complexity, chaotic | Minimal size, options only; stop immediately on adverse move |
| > 10,000 | > 13 | Extreme chaos — structural artefact | Do not trade; evacuate if in position |

# Regime classification (Kurt × Skew)

Every column reading is interpreted through the strike's regime — the
composite classification from Kurt (W) and Skew (X) that all other
columns are filtered through:

| Regime | Kurt (T) | Skew (V) | Character | Execution posture |
|---|---|---|---|---|
| **ATT_X** | > +6 | > 0 | Crystallised attractor — max gravity | Highest-conviction floor: long on test |
| **REP_X** | > +6 | < −2 | Crystallised repeller — max resistance (the sICF paradox strike, see below) | Highest-conviction ceiling: short on approach |
| **ATT** | 0 to +6 | > 0 | Moderate attractor | Floor: long with standard stop |
| **REP** | 0 to +6 | < 0 | Moderate repeller | Ceiling: short with standard stop |
| **COMP** | < 0 | any | Compressive / evanescent / forbidden | Transit or void — no structural support |
| **BND** | any | ≈ 0 | Boundary / equilibrium | Phase transition — watch for breakout |

**The sICF paradox**: REP_X nodes can show some of the *highest* positive
sICF values in a session — this is not a contradiction. sICF measures
temporal concentration, not direction; direction comes from Skew and
Mass. High sICF at a ceiling means the reversal, when it fires, will be
maximally sharp and information-rich — the cleanest reversal trade
available, not a floor signal.

# TRW — Temporal Resolution Window

A near-expiry compression factor (e.g. TRW=0.018 in the source's worked
example) that amplifies every observable's typical range: Kurt readings
that would normally run ±3 can reach ±9, sICF that normally caps near ±3
can reach ±13, Mass anomalies that would be ±1.5 mid-cycle can reach ±6.
**Extreme-looking values near expiry are not necessarily anomalous** —
check TRW before treating an extreme reading as structurally unusual.
The intensity decreases as the week progresses and new OI accumulates;
a Friday-close structural read is most valid for the immediate next
session and should be reassessed against fresh data as TRW relaxes.

# Integrated Spot-Adjacency Execution Protocol

1. **Regime map** — map the 200-handle zone around spot by regime (Kurt+Skew); identify all attractor/repulsor/anomaly nodes; mark the nearest positive-sICF nodes both sides.
2. **s2g ranking** — rank attractor nodes below spot and repulsor nodes above spot by s2g (AC); the top of each is the tier-1 long/short reference.
3. **Force gradient check** — read the F% gradient from current price toward each target; a Force shock >20× the approach zone marks a traversal-barrier node (expect stall/compression/reversal, not clean continuation).
4. **Conductance gate** — read CW from the live clock (see [Time State Compass](/analytics/time-state-compass.md)); apply an alpha multiplier: evanescent zone = 0.35×, zero crossing = 0.50×, constructive zone = 1.0×.
5. **Jerk confirmation** — at the planned entry strike, check J (AM): J<0.10 → full size; J>100 → reduce 50%; J>10,000 → abort. Jerk is the final safety gate — no amount of Force/Mass/ICF alignment compensates for extreme chaos at the execution node.

# Shipped consumer

The [Chart tab](/terminal/tabs/chart.md) Bookmap's heatmap-metric dropdown
directly exposes several of these columns by name — confirmed live via
screenshots dated 2026-07-17/18: "Strike Kurt" (W), "Strike ICF" (Y),
"Strike Speed" (AH), "Strike Accel" (AL), alongside standard "OI (C+P)",
"Volume (C+P)", and "Net Premium" views. A tooltip on the Strike Accel
render reads `4035 strike · Strike Accel 66.28 · Δ anchor 16.2` — i.e.
the live UI surfaces the exact per-strike values this table defines. The
[Heat Map tab](/terminal/tabs/heat-map.md)'s "Binary Wave" field selector
similarly renders "Strike Skew" (X) live. See also
[Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md), the Heat
Map's separate latent-level ranking.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "PART I — Strike Observable Columns W through AM" (lines 2245–2398); Regime Classification Matrix and TRW (lines 4100–4143, 4640–4643).
[2] Vault raw source — `raw/Screenshot 2026-07-18 050715.png`, `050753.png`, `050806.png`, `050836.png` (Chart/Bookmap dropdown, live renders).
