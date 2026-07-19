# Update Log

## 2026-07-19

* **Mission console shipped**: the Doctrine tab gains Mission/Archive
  views implementing [PRAQ mission discipline](/analytics/praq-mission-discipline.md)
  — auto-answered PSIS, five-paragraph OPORD with freeze-on-close role
  switching, enforced No-Brief-No-Trade, verbatim AAR with A/B/C gap
  causes, per-session archive — plus the
  [Risq Surface](/analytics/risq-operational-protocol.md) rendered live
  as a CW×Fib quadrant map. Concept updated:
  [Doctrine tab](/terminal/tabs/doctrine.md); shipped-consumer note added
  to PRAQ.
* **Doctrine tab shipped** (repo commit `0a4f458`): the interactive JS
  counterpart to the report engine's doctrine layers — close-reading
  prior, whole-ladder Deep Strike scan + scorecard, five-dimension Risq
  with ℛₓ and mechanical allocation, coherence patterns, entropy-budget
  ledger, and the three-layer advisory order plan. New concept:
  [Doctrine tab](/terminal/tabs/doctrine.md); tab strip and indexes
  updated.

* **Doctrine → shipped**: the report engine already implemented three
  doctrine layers faithfully but never surfaced them; a report-refinement
  pass (repo commit `8112d86`) wired them into the live brief. Marked the
  affected concepts as shipped:
  * [Report tab](/terminal/tabs/report.md) — added a "What the brief
    includes" section covering the three new groups + the published-view
    trim + the "unbracketed Fibonacci" non-bug.
  * [Risq framework](/analytics/risq-framework.md) — added a "Shipped in
    the report engine" section documenting `quan_risq.py` and its three
    scope divergences (top-candidate-only, snapshot CW, continuous
    conductance).
  * [Deep Strike Analysis](/analytics/deep-strike-analysis.md) and
    [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md)
    — added shipped callouts (`quan_scorecard.py`, `quan_fib.py`), noting
    the snapshot max score of 8 and the unbracketed path.
* **Deploy mirror**: synced the four edited pages into `wiki-content/`
  and regenerated its `manifest.json` (2 descriptions refreshed). The
  mirror remains the deliberately-curated Desk subset — `architecture/`,
  `roadmap/`, and `saas/` stay excluded from the subscriber-facing wiki.

## 2026-07-18

* **Initialization**: Established the OKF bundle from two raw-inbox source
  documents (`raw/qu-an-terminal-knowledge-dump.md`,
  `raw/qu-an-terminal-walkthrough.md`), themselves distilled from the
  repo's `README.md`, `ARCHITECTURE.md`, and `app.html`.
* **Creation**: Terminal tree — [overview](/terminal/overview.md) plus one
  concept per tab under [terminal/tabs/](/terminal/tabs/) (Detector, Field
  Study, Strike Field, Heat Map, Chart, Compass, Rolling, Account Sim,
  Execution, Report).
* **Creation**: Architecture tree — [presentation](/architecture/presentation-layer.md),
  [Pyodide engines](/architecture/pyodide-engines.md),
  [data plane](/architecture/data-plane.md),
  [client warehouse](/architecture/client-warehouse.md),
  [instrument registry](/architecture/instrument-registry.md).
* **Creation**: [Ingest lifecycle](/pipelines/ingest-lifecycle.md) playbook.
* **Creation**: [Invariants](/doctrine/invariants.md) doctrine concept.
* **Creation**: Incidents — [audit ledger D1–D12](/incidents/audit-ledger-d1-d12.md),
  [Pyodide NaN/JSON nulling](/incidents/pyodide-nan-json.md).
* **Creation**: [SaaS tiers and gating](/saas/tiers-and-gating.md).
* **Creation**: Satellites — [Timestate](/satellites/timestate.md),
  [CBOE](/satellites/cboe.md), [Bookmap](/satellites/bookmap.md),
  [Payload](/satellites/payload.md).
* **Creation**: Directory `index.md` files at each level for progressive
  disclosure; `templates/` skeletons for every concept `type` in use.

## 2026-07-18 (second pass)

* **Update**: Promoted two more root docs into `raw/` —
  `TICK_ENGINE_RESEARCH.md` (Phase-0 Tradovate market-data capability
  research) and `GO_LIVE.md` (the trial-launch ops runbook) — and
  enriched the bundle from them.
* **Creation**: [Tick Engine (planned)](/architecture/tick-engine.md) —
  the not-yet-built canonical market-data subsystem, its planned data
  flow, and storage split.
* **Creation**: [Tradovate Market Data API](/architecture/tradovate-market-data-api.md) —
  the connectivity/endpoint/rate-limit capability inventory the Tick
  Engine design is grounded on, with open empirical questions preserved.
* **Creation**: [Tick Engine constraints](/doctrine/tick-engine-constraints.md) —
  the cost/licensing/rate-limit rules (demo-first build, one-socket-per-
  contract, own-the-archive) as a Risk Model concept.
* **Creation**: [Go-Live runbook](/saas/go-live-runbook.md) — the ordered
  Supabase/Stripe/Cloudflare activation checklist, including the
  per-user demo-clamped Execution engine design.
* **Update**: [Tiers and gating](/saas/tiers-and-gating.md) — added
  actual tier pricing ($0/$99/$249/$699), the operator override, and the
  `brief_history` durable-archive table.
* **Update**: [Execution tab](/terminal/tabs/execution.md) — corrected
  from a generic "demo-first" description to the actual per-user,
  demo-clamped multi-tenant design (`exec:token:<uid>`, `u:<uid>`
  launch queue, `userMayGoLive()` seam).
* **Update**: [Invariants](/doctrine/invariants.md) — added rule 7, no
  subscriber may route live orders without per-user opt-in and a
  compliance review.
* **Note**: `Bookmap Work/` (4 implementation-prompt PDFs + a dev plan)
  and `Debugging/` (3 implementation-prompt PDFs) were surveyed but not
  yet ingested — flagged as a follow-up pass once it's confirmed how much
  of that history is superseded by shipped code vs. still-open design.

## 2026-07-18 (third pass — Bookmap/Debugging PDFs + doctrine manual + visual corpus)

* **Update**: Ingested the six `Bookmap Work/`/`Debugging/` implementation-
  prompt PDFs flagged in the prior pass (copied into `raw/` with clearer
  names), cross-checked each against `js/` to separate shipped from
  planned.
* **Creation**: [Roadmap](/roadmap/index.md) — five planned-but-unbuilt
  specs: [Bookmap research environment](/roadmap/bookmap-research-environment.md),
  [Price tab annotation framework](/roadmap/price-tab-annotation-framework.md),
  [Rolling Analysis Engine — full vision](/roadmap/rolling-analysis-full-vision.md),
  [Chronometric Heatmap — full vision](/roadmap/chronometric-heatmap-full-vision.md),
  [Universal screenshot capture](/roadmap/universal-screenshot-capture.md).
  The reporting-debug half of the sixth spec was superseded — folded into
  a citation on [audit ledger D1–D12](/incidents/audit-ledger-d1-d12.md)
  instead of a new concept.
* **Creation**: The user supplied the full Qu'an doctrine manual
  (`拳thquan.docx`, 3.2M chars / ~944K chars of plain text, 106 headings)
  plus 11 dated screenshots of the live terminal, asking for a
  methodology to abstract trading/risk doctrine from images and reports
  over time, not just code. Extracted the docx to
  `raw/Qu'an Reference Manual - extracted text.txt` (kept for future
  passes) and read roughly the first half (Part I + Part II base + the
  10-chapter "interior structure" essay, ~2800 of 5499 lines).
* **Creation**: [analytics/](/analytics/index.md) — new top-level section
  for proprietary doctrine, distinct from software architecture:
  [Strike Observable Manifold (W–AM)](/analytics/strike-observable-manifold.md)
  (13-column spatial manifold: Kurt, Skew, ICF, Mass, Force, Speed, Lag,
  Acceleration, Jerk, with the Integrated Spot-Adjacency Execution
  Protocol), [Time State Compass](/analytics/time-state-compass.md) (the
  toroidal-fold column architecture — Conductance, PM/PD/SOP/DIPLTR,
  Dual Phase), [TSC interior structure](/analytics/tsc-interior-structure.md)
  (topology, chirality, entropy-loading, pilot-wave, Jensen's-Gap, and
  the Risq risk-framework revisions), and
  [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md) (defined
  verbatim from a Heat Map in-app tooltip).
* **Update**: [Difference Sum](/analytics/difference-sum.md),
  [Dual Phase](/analytics/dual-phase.md), and
  [Statewave Fingerprint](/analytics/statewave-fingerprint.md) — the
  three concepts created in the prior pass from code alone — now carry
  precise formulas from the doctrine manual (D/S = DIPLTR/SOP; DP = Col
  33 capstone phase angle; SWF = SDD_inv = DIPLTRPD/SOPPM).
* **Update**: [Field Study tab](/terminal/tabs/field-study.md) — added
  the SOP Headline view and header doctrine parameters (`coherence
  breaks CW`, `RIPN`); [Rolling tab](/terminal/tabs/rolling.md),
  [Bookmap layers](/satellites/bookmap.md), [Heat Map tab](/terminal/tabs/heat-map.md),
  [Chart tab](/terminal/tabs/chart.md) — linked to the new roadmap/
  analytics concepts, and corrected the Rolling Analysis Engine's
  shipped/unshipped split after a screenshot showed a working
  density/spectral term-structure render that a code grep had missed.
* **Creation**: [Visual corpus & reference-text ingestion](/pipelines/visual-corpus-ingestion.md)
  — the actual methodology requested: how daily Bookmap/Heat Map/Field
  Study screenshots plus reference text feed the wiki, why this channel
  catches things text/code-only passes miss (with concrete examples from
  this pass), and the discipline for not fabricating doctrine from a
  single session's chart (recurrence across independently-dated batches
  is required before a Market Concept/Risk Model is warranted).
* **Update**: resolved the "open — not yet ingested" note above.
  Continued extraction of `raw/Qu'an Reference Manual - extracted text.txt`
  from line 2799 through 3987 (Compass Architecture Overview /
  Polynomial Skew Framework, "SOP & Chirality," "Field Notes," the full
  "Apex Dealer Logic Book"), then discovered ~2244 lines of front-matter
  (a systematic term glossary, the complete "RISQ" risk document, and
  the "Qu'an Execution Playbook") had been skipped entirely on the first
  pass — read that too.
* **Creation**: five new doctrine-architecture concepts —
  [Polynomial Skew Framework](/analytics/polynomial-skew-framework.md),
  [SOP — Superposition of Pressure](/analytics/sop-superposition-of-pressure.md),
  [Chirality](/analytics/chirality.md) (a deeper treatment superseding
  the brief version in TSC interior structure),
  [SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md),
  [Field Notes observations](/analytics/field-notes-observations.md)
  (ten practitioner "lenses").
* **Creation**: three "Apex Dealer Logic Book" field-manual concepts —
  [Dealer Field Architecture](/analytics/dealer-field-architecture.md),
  [Information Field & Risk Engine](/analytics/information-field-risk-engine.md)
  (a dealer-basis VaR system, confirmed distinct from Risq),
  [Observational Flow Frames & Quick Reference](/analytics/observational-flow-frames.md)
  (25 daily questions, regime matrix, Twelve Axioms).
* **Creation — the base Risq formulas, finally located**:
  [Risq framework](/analytics/risq-framework.md) (the five-dimension
  formulas + thresholds + the Risq Ratio driving position sizing) and
  [Risq operational protocol](/analytics/risq-operational-protocol.md)
  (Risq Surface, Entropy Budget, coherence-misalignment detection, the
  three inertia risks, pre-/intra-session protocol) — resolving the
  "base formulas not located" caveat left open in both
  [TSC interior structure](/analytics/tsc-interior-structure.md) and
  [SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md)
  across two prior passes.
* **Creation — the Deep Strike execution playbook**, resolving PDSL,
  Layer A/B/C, and μ-Wave (used pervasively elsewhere without a fixed
  definition until now):
  [Deep Strike Analysis](/analytics/deep-strike-analysis.md),
  [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md),
  [Three-Layer Execution Model](/analytics/three-layer-execution-model.md),
  [Stop Architecture & Loss Management](/analytics/stop-architecture-loss-management.md),
  [Pre-Session Checklist](/analytics/pre-session-checklist.md).
* **Update**: [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md)
  — reconciled three distinct, non-identical formal "PDSL"/"Watermark"
  definitions found across different layers of the source (the Heat
  Map's own tooltip formula, the LR-20–55 Watermark rule, and the
  four-criteria Primary Deep Strike Level test) rather than conflating
  them.
* **Update**: [Strike Observable Manifold](/analytics/strike-observable-manifold.md)
  — added a "Shipped consumer" section citing the Chart tab Bookmap
  dropdown and Heat Map Binary Wave selector as live renderers of these
  columns; [Chart tab](/terminal/tabs/chart.md) and
  [Heat Map tab](/terminal/tabs/heat-map.md) updated to match.
* **Open — genuinely deferred this time**: glossary lines 650–1480
  (Sections VI–XII of the front-matter term reference — skimmed, judged
  largely redundant with material already captured, not fully read). The
  NQM26 worked case study's generalizable pieces (Regime Classification
  Matrix: ATT_X/REP_X/ATT/REP/COMP/BND; TRW = Temporal Resolution Window
  amplification) were captured in
  [Strike Observable Manifold](/analytics/strike-observable-manifold.md);
  its per-strike numeric walkthrough was deliberately not transcribed as
  doctrine, per the single-instance discipline in
  [visual-corpus-ingestion.md](/pipelines/visual-corpus-ingestion.md).

* **Creation — PRAQ (mission discipline)**: continued extraction through
  the "PRAQ — Practitioner" document (lines 4644–5168), the military-
  doctrine-derived operational layer: Strategist/Ground-Lead role
  separation, Intelligence Preparation of the Session, the five-paragraph
  OPORD Mission Brief, After-Action Review, the Field Intelligence Log
  ([PRAQ — Mission Discipline](/analytics/praq-mission-discipline.md)),
  and the Three-Body Stability Protocol, Daily Selection Audit, battle
  rhythm, and eight-document Practitioner's Dossier
  ([PRAQ — Stability & Rhythm](/analytics/praq-stability-and-rhythm.md)).
* **Open**: at line 5169 a further, unread document begins —
  "INTENTUM," a phenomenology-of-intent extension of something called
  "Psyq" (referenced constantly throughout PRAQ as the psychological
  layer but never itself located in this file). This is the next
  continuation point for the doctrine manual.
* **Pivot**: 71-file wiki now considered a stable base; next work is
  deploying it as a gated in-app page (Desk-tier access only) rather than
  continuing pure extraction — see the SaaS/architecture sections below
  once that work lands.

## 2026-07-18 (fourth pass — doctrine manual lines 2799–3987)

* **Update**: continued extraction of the doctrine manual from line 2799
  (the "open extraction" boundary from the prior pass) through line
  3987, covering five more distinct bodies of doctrine. Only the final
  NQM26 04/10 worked case study (lines 3988–5499, a single dated
  example) remains unread.
* **Creation**: [Polynomial Skew Framework](/analytics/polynomial-skew-framework.md)
  — fitting a 2nd–6th order polynomial to Pressure Curvature; each order
  mapped to a market-structural phenomenon (convexity basin, directional
  skew, kurtosis regime, quintic tail coupling, sextic entropy cascade).
* **Creation**: [SOP — Superposition of Pressure](/analytics/sop-superposition-of-pressure.md)
  (the SOPG/SOPC derivation chain, dominance ratios, Product Tension,
  Latent Motion Paths, and the CW=−0.5/0/+0.5 live-session checkpoint
  protocol) and [Chirality](/analytics/chirality.md) (a deeper,
  independently-derived right/left-handed/achiral treatment superseding
  the brief version in the prior pass's interior-structure essay, plus
  the three-session reversal sequence) — two distinct concepts from a
  dedicated "SOP & Chirality" section of the source.
* **Creation**: [SOP-Chirality execution protocol](/analytics/sop-chirality-execution-protocol.md)
  (Risk Model) — the four combined SOP×Chirality configurations, position
  sizing and stop architecture by handedness, and a **second, independent**
  Risq revision set (cross-referenced against the first from the prior
  pass — the base five-dimension Risq formulas still haven't turned up).
* **Creation**: [Field Notes observations](/analytics/field-notes-observations.md)
  — ten practitioner "lenses" explicitly framed as observations rather
  than procedures: the Mass-Jerk smoothness coupling, the
  forward-reading (not backward) negative CW arc, entropy as an honest
  signal (high-entropy sessions predict *cleaner* next sessions), the
  pending order as a structural claim with explicit invalidation
  conditions, the SoI/SoT/SoR predictive window, the stop as a
  structural statement, line-vs-candlestick chart complementarity, and
  more.
* **Creation**: a four-file "Apex Dealer Logic Book" cluster —
  [Dealer Field Architecture](/analytics/dealer-field-architecture.md)
  (Intent/Transaction/Realization, the Puts-Minus-Calls sign convention,
  condensed signal thresholds, and the Liquidity Ratio trapped-dealer
  table that **resolves the exact PDSL/Watermark threshold, LR 20–55**),
  [Information Field & Risk Engine](/analytics/information-field-risk-engine.md)
  (Risk Model — distributional Intent/Transaction/Realization statistics,
  Composite Dealer Score, and a dealer-basis VaR ladder confirmed as a
  **separate risk system from Risq**, not the same framework), and
  [Observational Flow Frames & Quick Reference](/analytics/observational-flow-frames.md)
  (Execution Playbook — the pre-session/intraday/execution checklists,
  25 daily analytical questions, the regime classification matrix, and
  the Twelve Axioms of Dealer Logic).
* **Update**: [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md)
  — grounded against the newly-found LR 20–55 "Watermark" definition.
  [Chart tab](/terminal/tabs/chart.md) — resolved two of the three open
  UI labels: `gwall` = "gamma wall" (Kurt>6), `dfloor` likely "dealer
  floor" (Net OI>0 → FLOOR in the Puts-Minus-Calls table); `sfloor`
  remains unconfirmed. [TSC interior structure](/analytics/tsc-interior-structure.md)
  — cross-linked to the newer, deeper SOP/Chirality treatment and noted
  the now-two independent unlocated Risq base-formula references.
* **Remaining open**: the NQM26 worked case study (lines 3988–5499); the
  base Risq five-dimension formulas (two independent revision sets found,
  neither with the base); `sfloor`'s exact meaning; the "Implied Spot
  Forecasting Model," "Scalar Decay-Weighted Greek Model," and "TDR
  (Trigger, Distribution, Reversion) framework" named in the Polynomial
  Skew section but not independently confirmed elsewhere.

* **Creation — the base Risq formulas, located**: continued reading the
  front-matter block that was skipped on the first pass (the reference
  manual's actual opening — a 12-section term glossary, lines 1–2244) and
  found the complete "RISQ" document embedded inside it (lines 1480–1767):
  [Risq framework](/analytics/risq-framework.md) (the five base
  dimension formulas + thresholds + the Risq Ratio) and
  [Risq operational protocol](/analytics/risq-operational-protocol.md)
  (Risq Surface, Entropy Budget, coherence-misalignment patterns, the
  three inertia risks, the pre-/intra-session protocol) — resolving the
  open item above. Both prior Risq-revision concepts updated to link to
  these instead of flagging the base formulas as missing.
* **Creation — the Deep Strike execution playbook, resolving PDSL, Layer
  A/B/C, and μ-Wave** (used pervasively elsewhere without a fixed
  definition until now), found immediately after RISQ in the same
  front-matter block ("Qu'an Execution Playbook," lines 1782–2240):
  [Deep Strike Analysis](/analytics/deep-strike-analysis.md),
  [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md),
  [Three-Layer Execution Model](/analytics/three-layer-execution-model.md),
  [Stop Architecture & Loss Management](/analytics/stop-architecture-loss-management.md),
  [Pre-Session Checklist](/analytics/pre-session-checklist.md).
* **Update**: [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md)
  reconciled against a third, formally-different PDSL definition (the
  Execution Playbook's four-joint-criteria Deep Strike test) found
  alongside the Heat Map panel's own formula and the LR-20–55 Watermark
  rule — three related but non-identical constructs, now documented as
  such. [Strike Observable Manifold](/analytics/strike-observable-manifold.md)
  gained the Regime Classification Matrix (ATT_X/REP_X/ATT/REP/COMP/BND)
  and TRW (Temporal Resolution Window).
* **Creation — PRAQ (mission discipline, stability & rhythm)**:
  [PRAQ — Mission Discipline](/analytics/praq-mission-discipline.md)
  (Strategist/Ground-Lead role separation, Intelligence Preparation of
  the Session, the five-paragraph OPORD Mission Brief, After-Action
  Review, the Field Intelligence Log) and
  [PRAQ — Stability & Rhythm](/analytics/praq-stability-and-rhythm.md)
  (Three-Body Stability Protocol, the four-domain Daily Selection Audit,
  the daily/weekly/monthly battle rhythm, the eight-document
  Practitioner's Dossier), from "PRAQ — Practitioner" (lines 4644–5168).
* **Creation — INTENTUM, the closing document**:
  [INTENTUM — The Phenomenology of Will](/analytics/intentum-phenomenology-of-intent.md)
  (lines 5169–5499, document end) — fifteen philosophers (Brentano
  through Whitehead) mapped onto the CW arc, culminating in a four-grade
  scale for how genuinely a Mission Brief was actually intended. Notes
  explicitly that "Psyq," referenced constantly throughout PRAQ and
  INTENTUM as the psychological-architecture pillar, was never located
  as a standalone document in this source file.
* **The doctrine manual extraction is now complete** — all 5499 lines
  read. Two intentionally-unresolved gaps remain, both flagged in place
  rather than guessed at: `sfloor`'s exact meaning ([Chart tab](/terminal/tabs/chart.md)),
  and the "Psyq" document itself. Both would need a new source, not
  further reading of this file, to resolve.
* **Deployment**: the wiki was shipped as a gated in-app "Desk Wiki" tab
  in the Qu'an terminal (Desk tier only, $699/mo) — see
  `js/wiki-viewer.js` and the `wiki-content/` static mirror of this
  bundle in the main QBT repo. Verified working in a local preview
  (gating, navigation, table rendering) and pushed to `main`
  (commit `241ef8e`). `wiki-content/` should be kept in sync with this
  `wiki/` source on future enrichment passes.
