---
type: Execution Playbook
title: Visual Corpus & Reference-Text Ingestion
description: How the wiki abstracts trading and risk methodology from daily Bookmap/Heat Map/Field Study screenshots plus reference text, rather than from code alone.
tags: [pipeline, ingestion, visual-corpus, doctrine, methodology]
timestamp: 2026-07-18T00:00:00Z
---

# Trigger

The operator drops a batch of dated screenshots (Chart/Bookmap, Heat Map,
Field Study/Chronometric, Rolling, Report views) — and/or reference text
like the Qu'an doctrine manual — into `raw/`, and asks for an enrichment
pass. This is a **second raw-material channel** alongside the markdown/
PDF documents the rest of the bundle is built from: images and reports
carry information text alone doesn't — exact shipped UI option names,
in-app tooltip definitions, and confirmation of what's actually rendering
versus what a spec merely proposed.

# Why this channel matters (evidence from the first pass)

Cross-checking the 2026-07-18 screenshot batch against the doctrine text
and against code greps caught things a text-only or code-only pass
missed:

- The Chart tab's Bookmap metric dropdown literally offers "Strike Kurt,"
  "Strike ICF," "Strike Speed," "Strike Accel" — confirming the
  [Strike Observable Manifold](/analytics/strike-observable-manifold.md)
  doctrine is a **live, selectable rendering surface**, not just
  background theory.
- The Heat Map's "Dealer Watermark" panel tooltip gave an exact, citable
  definition of **PDSL** — see [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md)
  — that does not appear verbatim anywhere in the reference manual text
  read so far.
- A screenshot of the Rolling tab showed a working density/spectral
  term-structure render that a `grep` for "Bookmap"/"heatmap" in
  `js/rolling-viz.js` completely missed, because the code names it
  `density`/`spectral` instead — correcting the
  [Rolling Analysis Engine roadmap](/roadmap/rolling-analysis-full-vision.md)'s
  shipped/unshipped split. **Grep for behavior, not just for the words
  you expect** — screenshots are the check against that blind spot.

# Steps

1. **Capture** — screenshots land in `raw/` with their natural
   timestamped filename (`Screenshot YYYY-MM-DD HHMMSS.png`); no rename
   needed, the date is the provenance.
2. **Catalog** — on ingestion, identify which tab/view each image shows
   and what's rendered (metric selected, panel labels, any in-UI
   definitions/tooltips) before drawing conclusions from it.
3. **Cross-check, don't just add** — compare each image against existing
   wiki concepts: does it confirm a "planned" item is actually shipped
   (see the Rolling correction above)? Does it contradict a citation?
   Update in place rather than duplicating.
4. **Extract only what's textually grounded** — an in-UI tooltip with an
   explicit definition (like the PDSL panel) can be cited directly and
   turned into a [Metric](/analytics/index.md) concept. A bare label with
   no definition anywhere in the ingested text (e.g. `gwall`, `dfloor`,
   `sfloor` on the Chart tab — see [Chart tab open questions](/terminal/tabs/chart.md))
   must **not** be assigned a fabricated meaning — log it as an open
   question and point at the likely source module instead.
5. **Don't generalize from one instance** — a single session's specific
   price levels, wall counts, or breach readings are not doctrine; they
   are one data point. A pattern only earns a durable
   [Market Concept](/analytics/index.md) or [Risk Model](/doctrine/invariants.md)
   entry once it recurs across multiple independently-dated batches, each
   cited. Until then, keep the observation scoped to its source image's
   citation.
6. **Log the pass** — record what was ingested and what it changed in
   [`log.md`](/log.md), the same as any other enrichment pass.

# Failure modes

- **Fabricating a rule from a single chart.** The invariant against
  fabricating market data ([doctrine/invariants.md](/doctrine/invariants.md)
  rule 6) applies just as much to "this screenshot shows X, therefore the
  framework does Y" as it does to text — a chart is evidence of what
  rendered, not proof of a causal trading rule.
- **Losing the citation trail.** Every claim grounded in an image must
  cite the specific filename (and ideally what's visible in it), the same
  discipline as citing a line range in a text source — "the screenshots"
  is not a citation.
- **Treating a code-silence as shipped-silence.** As the Rolling Analysis
  correction shows, absence of an expected keyword in source doesn't mean
  the feature is unbuilt — verify against a live render before asserting
  "not shipped."

# Related

* [Ingest lifecycle](/pipelines/ingest-lifecycle.md) — the analogous market-data ingestion pipeline (CSV → warehouse), a useful structural parallel.
* [analytics/](/analytics/index.md) — where durable, multi-instance-confirmed doctrine ends up living.

# Citations

[1] Vault raw source — `raw/Screenshot 2026-07-18 050611.png` through `051110.png` (11 images, Chart/Field Study/Heat Map/Rolling, 2026-07-17 GC session).
[2] Vault raw source — `raw/Qu'an Reference Manual - extracted text.txt` (the accompanying reference-text batch, partially ingested — see [Time State Compass](/analytics/time-state-compass.md) "Open extraction").
