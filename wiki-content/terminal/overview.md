---
type: Market Concept
title: Qu'an Terminal — Overview
description: A static, in-browser dealer-positioning options/futures terminal with a header hub and a tab strip.
tags: [terminal, overview, architecture]
timestamp: 2026-07-18T00:00:00Z
---

# What it is

**Qu'an** derives structural levels from option chains and presents dealer
positioning through several views: an intermarket breach detector, a
polar/SOP field, a strike-field heat map, a live price chart, a compass, a
rolling term-structure engine, and account/risk simulation.

Defining properties:

- **Static** — no build step; one classic `js/` script per feature area,
  loaded `defer` in dependency order.
- **In-browser Python** — analysis runs via Pyodide.
- **Cloud-hosted** — hosted on managed infrastructure.
- **Subscription SaaS** — hard paywall, tiered access.

# Pages

| Page | Role |
|------|------|
| `index.html` | Public landing / marketing page |
| `app.html` | Terminal app shell; served at `/app` |
| `heatmap.html` | Heat Map tab; standalone doc loaded in an iframe |
| `view.html` | Read-only client view of a published brief |
| `timestate.html` | [ZN Timestate](/satellites/timestate.md) |
| `cboe.html` | [CBOE adapter](/satellites/cboe.md) |

# The shell

A **header hub** of global controls (instrument / session date / session
kind, Publish, Auto-pull, manual upload, live anchor, theme, lock) sits
above a **tab strip**. All tabs re-render off the shared global selection,
so a header change propagates everywhere.

Tab strip order: [Detector](/terminal/tabs/detector.md) (default) ·
[Field Study](/terminal/tabs/field-study.md) ·
[Strike Field](/terminal/tabs/strike-field.md) ·
[Heat Map](/terminal/tabs/heat-map.md) ·
[Chart](/terminal/tabs/chart.md) ·
[Compass](/terminal/tabs/compass.md) ·
[Rolling](/terminal/tabs/rolling.md) ·
[Account Sim](/terminal/tabs/account-sim.md) ·
[Execution](/terminal/tabs/execution.md) · **+** (split view).

**[Report](/terminal/tabs/report.md)** is *not* on the strip — it is
reached from the Detector's View selector or as a split-view pane.

# Related

* [Ingest lifecycle](/pipelines/ingest-lifecycle.md) — how data reaches the tabs.
* [Invariants](/doctrine/invariants.md) — the frozen constraints.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §1–§4.
[2] Qu'an repo — `README.md`, `app.html` (tab strip), `ARCHITECTURE.md` §1.
