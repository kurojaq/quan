---
okf_version: "0.1"
---

# Qu'an Knowledge Base

The OKF bundle behind the **Qu'an Terminal** — a dealer-positioning
options/futures terminal. This index is the entry point for progressive
disclosure: skim it to see what exists before opening concepts.

# Terminal

* [Terminal overview](terminal/overview.md) - what Qu'an is, its pages, and its tab strip.
* [Tabs](terminal/) - one concept per terminal tab (Detector, Field Study, Heat Map, …).

# Analytics

* [Analytics index](analytics/index.md) - shipped Field Study primitives (DS/Dual Phase/SWF), the Strike Observable Manifold, the Time State Compass, SOP & Chirality, and the Apex Dealer Logic Book field manual.

# Pipelines

* [Ingest lifecycle](pipelines/ingest-lifecycle.md) - Drive → warehouse → brief, end to end.
* [Visual corpus & reference-text ingestion](pipelines/visual-corpus-ingestion.md) - daily screenshots + reference text as a second doctrine-abstraction channel.

# Doctrine

* [Invariants](doctrine/invariants.md) - constraints that must never be violated.
* [Tick Engine constraints](doctrine/tick-engine-constraints.md) - cost/licensing/rate-limit rules for the planned Tick Engine.

# Incidents

* [Audit ledger D1–D12](incidents/audit-ledger-d1-d12.md) - the production-hardening defect ledger.
* [Pyodide NaN/JSON nulling](incidents/pyodide-nan-json.md) - how bare NaN nulls the whole brief.

# Satellites

* [ZN Timestate](satellites/timestate.md) - standalone Promissory Notes terminal.
* [CBOE proxy](satellites/cboe.md) - CBOE quotedata adapter.
* [Bookmap layers](satellites/bookmap.md) - Chart-tab scalar/spectral + chronometric layers.
* [Payload Generator](satellites/payload.md) - shadow-DOM payload generation.
