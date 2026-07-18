---
type: Metric
title: Dealer Watermark (PDSL)
description: Focal dealer strikes — peak Inventory Distribution × Dealer Premium Time, weighted by adjacency to spot — shown as latent resistance/support levels on the Heat Map.
tags: [analytics, pdsl, dealer-watermark, heat-map]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Screenshot 2026-07-18 051039.png
---

# Definition

**PDSL** ("Dealer Watermark") ranks focal dealer strikes by: **peak
Inventory Distribution** (concentration → convexity trap / pinning
behavior) **× Dealer Premium Time** (a proxy for time), then weights the
result by **adjacency to spot** (each side reaches roughly 60 points).
Each side (resistance above spot, support below) ranks independently by
its own active concentration. This exact definition is rendered in-app as
the Heat Map's "Dealer Watermark — PDSL" side panel tooltip.

# Data source

[Heat Map tab](/terminal/tabs/heat-map.md), right-hand "Dealer Watermark"
panel — Resistance / Support tabs list levels (e.g. "+156", "+216" point
offsets) each tagged **latent** vs. **active**, per the note: "Levels
re-rank live with spot; near concentration reads as active, far as
latent. PDSL prerequisite reconstructed from the book's dealer layer —
adjust scans/reach once the exact rule is locked" — i.e. the rule is
explicitly flagged **in-app** as provisional/reconstructed, not finalized.

# Interpretation

PDSL levels are one of the recurring reference points across the
terminal's other views — the [Time State Compass interior structure](/analytics/tsc-interior-structure.md)
essay repeatedly frames execution quality and risk in terms of proximity
to "PDSL levels" (e.g. "reliable structure at comparable PDSL levels,"
Layer B/C entries near PDSLs). This metric is the concrete, shipped
implementation of that recurring reference — but per the in-app caveat
above, treat the exact reach/scan parameters as provisional until the
rule is confirmed locked.

**"PDSL" turns out to name (at least) three related-but-distinct formal
constructs across different layers of the source** — worth keeping
straight rather than treating as one metric:

1. **The Heat Map's shipped "Dealer Watermark — PDSL" panel** (this
   concept's primary subject): Inventory Distribution × Dealer Premium
   Time × spot-adjacency, per its own in-app tooltip, explicitly flagged
   as provisional/reconstructed.
2. **"Watermark"** in [Dealer Field Architecture](/analytics/dealer-field-architecture.md):
   Liquidity Ratio 20–55 — "maximum commitment," dealers trapped, "must
   defend at all costs" (LR≈55.6 in the source's own worked example).
3. **"PDSL" = Primary Deep Strike Level** in [Deep Strike Analysis](/analytics/deep-strike-analysis.md)
   (the Qu'an Execution Playbook's own formal usage): a strike meeting
   **all four** of `Mass>+2.0 OR <−2.0`, `Kurt>4.5`, `LR>8.0`, `|A|>20`
   jointly — distinct from a Deep Strike Candidate (3 of 4) or a
   Watermark-tier LR reading alone.

These clearly describe the same underlying phenomenon (a strike where
dealer commitment is maximal and structurally locked-in) but are **not
algebraically the same formula** — the source was evidently assembled
from multiple passes/documents that converged on the concept without
fully reconciling notation. Do not assume the Heat Map panel computes
either the LR-20–55 rule or the four-criteria PDSL test internally; only
its own tooltip formula is confirmed shipped.

# Citations

[1] Vault raw source — `raw/Screenshot 2026-07-18 051039.png` (Heat Map, Dealer Watermark panel, live render 2026-07-17 session).
[2] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt`, "Apex Dealer Logic Book" §1.5 "The Watermark Concept" (line 3536); "Qu'an Execution Playbook" Part II, Layer 1 (line 1838, formal PDSL/DSC criteria).
