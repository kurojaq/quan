---
type: Metric
title: Statewave Fingerprint (SWF)
description: The DIPLTRPD/SOPPM ratio series — one of the three shipped Field Study sheets, read as an evolving temporal signature.
tags: [analytics, swf, statewave, field-study]
timestamp: 2026-07-18T00:00:00Z
resource: js/sop-polar.js
---

# Definition

**Statewave Fingerprint (SWF)** is the ratio series `DIPLTRPD/SOPPM` —
doctrinally, **SDD_inv** (columns 22–25 of the
[Time State Compass](/analytics/time-state-compass.md)'s "composite
ratio suite"), the reciprocal of SDD (SOPPM/DIPLTRPD). SDD_inv expresses
dominance excess relative to joint energy: a small SDD_inv at the
reality line (CW=0) means the session there is overwhelmingly
constrained by pre-session encoding (SDD≫1 in the source's example).
It is one of the three sheets shown together on the
[Field Study tab](/terminal/tabs/field-study.md), alongside
[Difference Sum](/analytics/difference-sum.md) and
[Dual Phase](/analytics/dual-phase.md), labeled "SWF (DIPLTRPD/SOPPM)"
in the codebase.

# Data source

`js/sop-polar.js`: `swf = soppm.map((s,i)=> s!==0 ? diplTRpd[i]/s : 0)`,
guarded against division by zero. Source values (`diplTRpd`, `soppm`)
derive from the session's option chain in the
[client warehouse](/architecture/client-warehouse.md).

# Interpretation

The intended reading (per the planned
[Chronometric Heatmap full vision](/roadmap/chronometric-heatmap-full-vision.md))
is as an **evolving temporal signature** across the session rather than
an isolated point value — the spec describes SWF as revealing "evolving
temporal signatures throughout the session rather than isolated
measurements." Today it renders as a static overlaid series with
crossing/intersection detection against DS and Dual Phase; the fuller
per-normalized-session-time heatmap visualization described in that spec
is not yet shipped.

# Citations

[1] Qu'an repo — `js/sop-polar.js` (search "swf:", "SWF (DIPLTRPD/SOPPM)").
[2] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "SDD_inv (DIPLTRPD/SOPPM)" (line 2516).
[3] Vault raw source — `raw/Claude Implementation Prompt - Chronometric Heatmap Engine.pdf` (Statewave Fingerprint (SWF) section).
