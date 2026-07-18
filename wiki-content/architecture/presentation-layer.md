---
type: Reference
title: Presentation Layer
description: Static Pages app — one classic script per feature, wired only by window globals and CustomEvents.
tags: [architecture, frontend, static]
timestamp: 2026-07-18T00:00:00Z
---

# Summary

The terminal is a static Cloudflare Pages app with **no build step**. Each
feature area is one classic `js/` script, loaded `defer` in dependency
order from `app.html`. There is no module system.

# Detail

**Load order** (`app.html`): pipeline-status → parsers → gates → warehouse
→ tabs → report.

**Cross-module wiring** — everything communicates two ways:

- `window.__*` globals (e.g. `__polarLoadChain`, `__qPipe`, `__qLoadChain`).
- `quan:*` CustomEvents.

**Pages** are plain HTML documents (`index`, `app`, `view`, `heatmap`,
`timestate`, `cboe`, plus marketing satellites). The
[Heat Map](/terminal/tabs/heat-map.md) is unique: a standalone document
loaded in an iframe.

**Styling**: `css/theme.css` (monochrome default + light variant),
`css/landing.css` (landing, reuses the app palette).

# Related

* [Client warehouse](/architecture/client-warehouse.md) — the state layer most modules read.
* [Data plane](/architecture/data-plane.md) — the server side these modules call.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §5.1.
[2] Qu'an repo — `ARCHITECTURE.md` §1.1, `README.md`.
