---
type: Market Concept
title: Time State Compass — Interior Structure
description: The toroidal topology, chirality, entropy-loading, pilot-wave, and Jensen's-Gap readings of the Compass, and how each revises the five-dimension Risq risk framework.
tags: [analytics, doctrine, time-state-compass, risq, topology, chirality]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# What it is

A ten-chapter "navigation" of structural implications the
[Time State Compass](/analytics/time-state-compass.md) contains but does
not surface at the column level. The source explicitly frames these as
interior rooms of the existing framework, not new additions to it.

# How it works

**I. The arc is a torus, not a line.** CW=−1 and CW=+1 are the same
point on a torus, reached by one full revolution — a session's close and
the next session's open are not cause-and-effect across time, they are
the *same geometric state* viewed from opposite sides. The negation arc
(CW [−1,0]) is the torus's concave inner surface (convergent — information
folding inward, "reliable but quiet" signals); the position arc (CW [0,+1])
is the convex outer surface (divergent — "louder but noisier" signals).
CW=0 is a **saddle point** — curvature inverts there, so a zero-cross
near CW=0 is topologically mandated, not new information. Weight
CW=−0.1/+0.1 over CW=0 itself.

**II. The pairing structure is a rotation group.** Pairs Multiplied/
Divided (multiplicative pair) and Sum of Pairs/DIPLTR (additive pair)
are not four independent metrics — together they generate a
representation of SO(2), rotations in the plane. This yields an internal
consistency check, **Arc Coherence**: expect `PM × PD = 1` and
`Sum² − DIPLTR² = 4 × P(n) × P(n+1)`. Where these identities break, the
arc has a "phase crack" — a structural discontinuity. [Dual Phase](/analytics/dual-phase.md)
reinterpreted geometrically: it is the tangent of the rotation angle
between adjacent CW positions, not simply "gradient dominates curvature."

**III. Chirality of the arc.** DIPLTR sign is the session's handedness.
DIPLTR>0 = right-handed (positive/execution arc dominant — the session
"tells its story" late); DIPLTR<0 = left-handed (negative/preparation arc
dominant — the biggest moves happen early, before most practitioners have
assessed the setup; DIPLTR<−0.5 argues for pre-session pending orders over
live intraday entry). A **Right→Left→Right** three-session sequence
(load → express aggressively → consolidate) is called the framework's
most powerful structural pattern.

**IV. Kurtosis of the pairs** is a named but previously uninterpreted
second-order density field: kPM (amplitude-coupling hotspots), kPD (the
Compass's own discontinuity detector — should coincide with an Arc
Coherence failure), kSP (directional-concentration hotspots), kDIPLTR
(localized vs. distributed chirality — localized chirality is more
volatile since handedness can flip mid-session).

**V. Entropy distribution — front-loaded vs. back-loaded sessions.**
Compare negation-arc entropy to position-arc entropy: ratio >1.5 =
front-loaded (favorable — disorder resolves before execution, negative
arc feels chaotic but execution is clean; do **not** cancel pending
orders during the noisy negative arc); ratio <0.7 = back-loaded
(dangerous — entropy discharges *during* execution, producing stop
hunts and whipsaw around structural levels).

**VI. The zero-cross count is a topological winding number**, not a
statistical turbulence measure — stable under small perturbations.
ZC=0: one persistent phase, clean but potentially low-information.
ZC=2: one "structural island" between the two crossings — cleanest
entries fill inside it. ZC=4: two islands, first tends to be a false
start, second the genuine move ("first move deceives, second delivers").
ZC≥6: unstable, no third-layer entries regardless of other metrics.

**VII. The Latent Path as pilot wave.** Modeled on Bohm's hidden-variable
QM interpretation: the SOPG/SOPC Latent Path is a real structural
template that exists ahead of price, independent of it — price does not
create the move, it follows a template already laid down. Consequence:
adverse price movement against an ascending Latent Path is *not*
invalidation, it means price hasn't yet reached the arc coordinate where
the template's influence peaks. The path **collapses** when DR3 rises
rapidly to meet DIDK (dealer realization catching up to intent) — after
that, price is "unguided" and the framework has no further edge for the
remainder of the session.

**VIII. Jensen's Gap** — the information created by pairing that neither
signal alone contains, from Jensen's inequality (`f(E[X]) ≤ E[f(X)]`
for convex f). A large gap at a CW pair = non-linear "structural
resonance" (adjacent states amplifying each other). Qualitative check:
scan Pairs Multiplied for values disproportionately large relative to
neighboring Sum-of-Pairs values — those coordinates are the
highest-confidence execution windows.

# Risq revisions (Chapter IX)

The five-dimension risk framework this document assumes as background
(ℛ_F Field, ℛ_I Information, ℛ_C Coherence, ℛ_T Temporal, ℛ_Ω Inertia
Risk) — **base formulas not yet located in this extraction pass**, see
Open extraction below — is revised by the interior structure:

| Dimension | Revision |
|---|---|
| ℛ_F (Field) | `ℛ_F × (1 + 0.3 × CW_position)` — inner-surface (negative-arc) readings are damped 30% at CW=−1; outer-surface readings amplified 30% at CW=+1 |
| ℛ_I (Information) | `+= 1.5` if Arc Coherence fails at the CW nearest the pending order's fill zone |
| ℛ_C (Coherence) | `× 0.7` when a chirality reversal is in progress (counterintuitively *reduces* risk — the field commits with unusual conviction) |
| ℛ_T (Temporal) | ZC=2: `× 0.8` inside the island; ZC=4: `× 1.3` first island / `× 0.8` second island |
| ℛ_Ω (Inertia) | `× 0.6` when a Jensen's-Gap resonance point coincides with the order's expected fill coordinate |

# Execution permissions & prohibitions (Chapter X)

**Permitted:** pre-session orders targeting the inner-surface window
CW[−0.6,−0.2] may carry 20% larger allocation than the standard Risq
Ratio suggests; Layer B fills inside a confirmed ZC=4 session's second
island carry zero Temporal Risk penalty; full three-layer allocation is
permitted in confirmed chirality-reversal sessions (subject to Risq
Ratio ≥ 12).

**Forbidden:** a Layer A fill at an Arc-Coherence phase-crack must be cut
to 50% size with a 25% tighter stop, and Layer B/C are cancelled for that
coordinate; no new entries after a confirmed pilot-wave collapse
(DR3→DIDK convergence by CW=+0.3) — this overrides all other metrics,
including an otherwise-clean setup; the third trade of a confirmed
back-loaded session is forbidden regardless of remaining entropy budget.

**The temporal centre of gravity**: the CW coordinate where highest kPM,
lowest Arc-Coherence deviation, and highest Jensen's-Gap coincide — every
Risq dimension is simultaneously at its best there. Identifying it is
described as the most advanced application of this layer.

# Open extraction

The base Risq five-dimension formulas (referenced here only via their
*revisions*) are now documented at [Risq framework](/analytics/risq-framework.md)
— found in the document's front-matter "RISQ" section (lines 1480–1767),
which sits well before this "Navigation" essay in the source file despite
being read after it. The ["Field Notes" document](/analytics/field-notes-observations.md)
this text cross-references has also since been found and ingested. The
Compass Architecture/Polynomial Skew section and "SOP & Chirality"
document have also since been ingested — see
[Polynomial Skew Framework](/analytics/polynomial-skew-framework.md),
[SOP](/analytics/sop-superposition-of-pressure.md), and
[Chirality](/analytics/chirality.md) for the deeper, more execution-
oriented treatment of chirality than this document's Chapter III.

# Related

* [Time State Compass](/analytics/time-state-compass.md) — the base column architecture this essay reinterprets.
* [Risq framework](/analytics/risq-framework.md) — the base five-dimension formulas this chapter's Risq revisions apply to.
* [SOP](/analytics/sop-superposition-of-pressure.md), [Chirality](/analytics/chirality.md), [SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md) — a later, deeper, independently-derived treatment of the same arc-dynamics and chirality concepts, with its own Risq-revision set.
* [Field Notes observations](/analytics/field-notes-observations.md) — the practitioner-lens document this essay's "Field Notes" cross-reference pointed to.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Navigation of the Time State Compass," Chapters I–X (lines 2584–2792).
