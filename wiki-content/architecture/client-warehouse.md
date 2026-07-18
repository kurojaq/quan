---
type: Reference
title: Client Warehouse
description: The STORE[inst].sess[date] cache that feeds every tab and the heatmap iframe.
tags: [architecture, warehouse, state, warehouse.js]
timestamp: 2026-07-18T00:00:00Z
---

# Summary

`js/warehouse.js` holds the client's data cache. Cells are keyed
`STORE[inst].sess[date]` and shaped:

```
{ anchor, locked, active,
  exp: { Daily | EOM : { chain, greeks, … } } }
```

Persisted as meta + blob keys through `window.storage` → localStorage →
memory (cloud-mirrored by `js/cloud-storage.js` to `/api/state`).

# Detail

**Fan-out** — feeds every tab (`__polarLoadChain`, `__strikeLoadChain`,
`__compassLoadChain`) and the [Heat Map](/terminal/tabs/heat-map.md) iframe
via `postMessage` (`quanFeed`).

**Auto-load** — on date/instrument selection, if the cell is empty the
warehouse queries `/api/ingest-list` and pulls `/api/ingest-file`
(`autoLoadFromIngest` → `__qLoadChain` / `__qLoadGreeks`).

**Observability** — every stage reports through `__qPipe`
(list → match → fetch → load) with instrument/session context; no stage
may silently fail (an [invariant](/doctrine/invariants.md)). The ingest
cache has a TTL so mid-session cron additions appear without reload.

# Related

* [Data plane](/architecture/data-plane.md) — the read-path endpoints.
* [Ingest lifecycle](/pipelines/ingest-lifecycle.md) — how cells get filled.
* [Audit ledger](/incidents/audit-ledger-d1-d12.md) — D4/D5/D6 fixes live here.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §5.4.
[2] Qu'an repo — `ARCHITECTURE.md` §1.4; `js/warehouse.js`.
