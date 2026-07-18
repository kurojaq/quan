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

# Architecture

* [Presentation layer](architecture/presentation-layer.md) - static pages + `js/` modules wired by globals and events.
* [Pyodide engines](architecture/pyodide-engines.md) - four diverged in-browser Python engine copies.
* [Data plane](architecture/data-plane.md) - Cloudflare Pages Functions, Workers, and stores.
* [Client warehouse](architecture/client-warehouse.md) - the `STORE[inst].sess[date]` cache that feeds every tab.
* [Instrument registry](architecture/instrument-registry.md) - single source of truth for instrument symbol knowledge.
* [Tick Engine (planned)](architecture/tick-engine.md) - planned canonical market-data subsystem, one MD subscription per contract.
* [Tradovate Market Data API](architecture/tradovate-market-data-api.md) - capability inventory behind the Tick Engine design.

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

# SaaS

* [Tiers and gating](saas/tiers-and-gating.md) - Stripe + Supabase, four subscription tiers, the paywall.
* [Go-Live runbook](saas/go-live-runbook.md) - ordered checklist from code-ready to a paid trial.

# Satellites

* [ZN Timestate](satellites/timestate.md) - standalone Promissory Notes terminal.
* [CBOE proxy](satellites/cboe.md) - CBOE quotedata adapter.
* [Bookmap layers](satellites/bookmap.md) - Chart-tab scalar/spectral + chronometric layers.
* [Payload Generator](satellites/payload.md) - shadow-DOM payload generation.

# Roadmap

* [Roadmap index](roadmap/index.md) - planned-but-unbuilt specs: Bookmap research environment, annotation framework, Rolling/Chronometric full visions, screenshot capture.
