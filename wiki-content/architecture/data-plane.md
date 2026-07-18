---
type: Reference
title: Data Plane (Cloudflare)
description: Pages Functions plus standalone Workers, backed by R2, D1, KV, and Supabase.
tags: [architecture, cloudflare, backend, workers]
timestamp: 2026-07-18T00:00:00Z
---

# Summary

The server side is **Cloudflare Pages Functions** (`functions/api/*`) for
same-origin request/response work, plus **standalone Workers**
(`workers/*`) for anything Pages can't do: cron, Durable Objects, Browser
Rendering.

# Pages Functions

| Group | Files | Role |
|-------|-------|------|
| Stripe | `checkout`, `webhook`, `portal`, `subscription` | Subscriptions / [tiers](/saas/tiers-and-gating.md) |
| Market data (gated) | `quote`, `history` | Same-origin quote/history; edge-cached, rate-limited |
| Workspace state | `state` | Roaming workspace (Supabase + R2) |
| Brief archive | `archive` | Durable [Report](/terminal/tabs/report.md) history |
| Publishing | `publish`, `view`, `client-tokens` | Client read-only links |
| Ingest read | `ingest-list`, `ingest-file` | Operator-gated warehouse reads |
| Auto-pull control | `autopull` | Operator-only Barchart control plane |
| Misc | `admin/`, `blog`, `fund`, `execution`, `_shared` | Ops / marketing / exec |

# Standalone Workers

| Worker | Why standalone | Role |
|--------|----------------|------|
| `ingest-worker` | cron 15m | Drive → classify → validate → R2 + D1 index |
| `barchart-fetch` | cron + Browser Rendering | Auto-download chain CSVs → R2 `autopull/` |
| `realtime` | Durable Objects | `PriceRoom` fan-out, `DeskRoom` relay; inert until `realtime-config.js` has a URL |
| `cron-warm` | cron | Pre-warm EOD price history into KV |
| `execution` | runtime | Tradovate [execution](/terminal/tabs/execution.md) |
| `yahoo-proxy` | — | Superseded by `/api/quote`+`/api/history`; kept for reference |

# Stores

- **R2** `QUAN_INGEST_BUCKET` — keys `INST/EXP/SESSION_DATE/dataType.csv`.
- **D1** `ingest_files` — the warehouse index.
- **KV** — price cache.
- **Supabase** — auth + roaming state.

# Related

* [Ingest lifecycle](/pipelines/ingest-lifecycle.md) — how these pieces chain.
* [Client warehouse](/architecture/client-warehouse.md) — the consumer of the read path.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §5.3.
[2] Qu'an repo — `ARCHITECTURE.md` §1.3; `README.md`.
