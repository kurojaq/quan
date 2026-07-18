---
type: Execution Playbook
title: PRAQ — Mission Discipline (IPS, OPORD, AAR, Field Intelligence Log)
description: The military-derived operational discipline layer — Strategist/Ground-Lead role separation, the four-layer Intelligence Preparation of the Session, the five-paragraph Mission Brief (OPORD), After-Action Review, and the Field Intelligence Log.
tags: [analytics, doctrine, praq, opord, aar, discipline]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Qu'an Reference Manual - extracted text.txt
---

# Trigger

PRAQ ("what the practitioner does and records") is the third pillar
alongside [Risq](/analytics/risq-framework.md) ("what the practitioner is
carrying") and the Deep Strike / Three-Layer execution doctrine ("Exeqt"
— "how the practitioner acts at the structural moment"). It applies
around every session, modeled explicitly on US Army Special Forces
doctrine (IPB, OPORD, AAR) rather than invented trading vocabulary.

# The Operator-Strategist duality

Two cognitive modes that cannot run simultaneously and must switch on a
hard signal:

| | Strategist | Ground Lead |
|---|---|---|
| Window | Session close → Mission Brief complete | Mission Brief complete → position exit + AAR |
| Function | Intelligence + planning | Execution + management |
| Relation to plan | Builds it; can revise before execution begins | Executes it; can only abort, not revise |
| Cognitive mode | Expansive, patient, analytical | Compressed, decisive, reflexive |
| Valid response to surprise | Update the plan before execution begins | Execute or abort — no in-between |

**Switch signal**: the moment the Mission Brief document is explicitly
closed (not minimized) — strategist mode ends, nothing in the Brief may
be revised after this point during execution.

# Steps — Intelligence Preparation of the Session (IPS), 4 layers

1. **Observable Field Scan** — full Book-sheet read, classify DSCs (3-of-4 [Deep Strike criteria](/analytics/deep-strike-analysis.md)) and gradients → output: the PDSL map.
2. **TSC Temporal Inheritance** — the close-reading protocol (DIPLTR residual, ZC count/quadrant, entropy residual, SOP Latent Path orientation) → output: the Inherited Tension Vector.
3. **Risq Surface Assessment** — compute the five [Risq](/analytics/risq-framework.md) dimensions per PDSL, flag any with ℛ_F>4.0 for structural veto → output: the Risq-filtered PDSL list.
4. **Entropy Budget** — `EB₀ = 10 − (ZC_count×1.5) − (ℛ_I_at_close×2)` → output: the session's allocation capacity.

Layers are strictly sequential, not parallel — each constrains the next.
Output is the **Pre-Session Intelligence Summary (PSIS)**, answering five
fixed questions in order: Field State, Inherited Tension, Temporal
Position (entropy budget), Named Areas of Interest (3 confirm/deny
observation points — PDSL approach, ZC quadrant signal, entropy spike,
watermark test), and Operational Constraints (active Risq vetoes). A
PSIS with unresolved internal contradictions is downgraded to Moderate
Prior regardless of directional signal strength. **No Mission Brief may
be opened until the PSIS is complete.**

# Steps — the Mission Brief (OPORD, 5 paragraphs)

Modeled directly on the Army's five-paragraph Operations Order:

1. **Situation** — declarative-only report of the observable field state (PDSL map, Inherited Tension Vector, current CW, Risq surface). No directional opinion, no hedging language.
2. **Mission** — exactly one sentence: the structural claim, the position, the strike, the rationale.
3. **Execution** — every mechanical action the ground lead is authorized to take (Layer A/B/C entry conditions, stop architecture, target architecture, and an explicit abort-condition list) — and by exclusion, everything *not* listed is prohibited.
4. **Administration** — position sizing per layer, `EB_cost = (ℛ_C+ℛ_I)×1.8` and confirmation `EB₀−EB_cost≥0`, the session's maximum acceptable loss, and the CW checkpoints at which Risq dimensions get re-read.
5. **Command & Signal** — what new information would require the plan to be reconsidered, and how. **There is no in-mission plan revision** — only abort-and-replan (return to strategist mode) or execute-as-planned.

**The No-Brief-No-Trade rule**: no position may be initiated without all
five paragraphs completed in writing and the document explicitly closed
before execution.

# Steps — After-Action Review (4 questions)

1. What was planned? (verbatim from the Mission Brief — an unwritten Brief makes the AAR unperformable, itself a doctrine-breach finding)
2. What actually happened? (facts only: fill vs. plan, layer fills/non-fills and why, MAE/MFE, exit CW/price — no interpretation)
3. Why did they differ? — classify each gap into exactly one of three causes:

| Cause | Definition | Corrective action | Common misdiagnosis |
|---|---|---|---|
| A: Intelligence failure | The PSIS misread or incompletely read the field | Update the relevant IPS Layer's procedure | Blamed on "bad luck" instead of IPS quality |
| B: Planning failure | The Mission Brief's parameters were inconsistent with the correctly-read field | Update the Mission Brief template for that PDSL/gradient type | Blamed on execution because the plan "looked right" |
| C: Execution failure | The plan was sound; the ground lead deviated live | Update the psychological/discipline protocol for that state | Blamed on "trusting instinct" instead of recognized as a protocol breach |

4. What changes to doctrine? — exactly **one** change, written into the relevant document before the next session.

The **Weekly Aggregate AAR** (fixed for Sunday) asks whether failures
cluster by IPS Layer, by trade type/Risq dimension, or correlate with a
measurable psychological state at open — one paragraph per question.

# The Field Intelligence Log (FIL)

An ongoing personal-observation record (Montaigne/Wittgenstein/Marcus
Aurelius framing) — not a performance record. Four categories: Structural
Observations (unexpected field behavior vs. PSIS prediction), Framework
Observations (situations the formal protocol has no answer for),
Self-Observations (how internal state affected the reading — the
bridge to the psychological layer), Prospective Notes (developing but
not-yet-confirmed patterns). Discipline: minimum 3 dated entries/week; a
monthly rereading of the prior 3 months (read first, annotate after)
producing three notes — an unseen pattern, a confirmed/disconfirmed
prospective note, and a recurring self-observation requiring a doctrine
response.

# Related

* [Deep Strike Analysis](/analytics/deep-strike-analysis.md), [Risq framework](/analytics/risq-framework.md) — the analytical inputs IPS and the Mission Brief consume.
* [PRAQ — Stability & Rhythm](/analytics/praq-stability-and-rhythm.md) — the Three-Body Protocol, Selection Standard, Battle Rhythm, and Dossier this discipline sits inside.
* [Pre-Session Checklist](/analytics/pre-session-checklist.md) — the shorter Exeqt-side pre-session sequence this IPS/OPORD process runs parallel to.

# Citations

[1] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "PRAQ — Practitioner," Sections I–V (lines 4688–4953).
