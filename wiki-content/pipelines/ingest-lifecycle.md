---
type: Execution Playbook
title: Ingest Lifecycle
description: The canonical path from Barchart CSVs in Google Drive to a published client brief.
tags: [pipeline, ingest, data, lifecycle]
timestamp: 2026-07-18T00:00:00Z
---

# Trigger

An operator has (or wants) option-chain data in the terminal for a given
instrument and session.

# Steps

```
Drive (operator uploads Barchart CSVs, one subfolder per instrument)
  → ingest-worker (cron 15m): classifyName → sessionDateFor → R2 put + D1 index
  → /api/ingest-list (D1) + /api/ingest-file (R2)        [operator-gated]
  → warehouse.js autoLoadFromIngest → __qLoadChain/__qLoadGreeks
  → tabs (SOP/Strike/Compass) + heatmap iframe (quanFeed postMessage)
  → Pyodide engines (brief, heatmap bridge, payload)
  → Report brief → /api/archive (durable history) → publish → view.html
```

**Three roads into the [warehouse](/architecture/client-warehouse.md):**

1. Auto-load from the cloud warehouse (normal path, above).
2. **⛃ Auto-pull** — the `barchart-fetch` Worker downloads toggled
   contracts daily to R2 `autopull/` for on-load ingest.
3. Manual CSV upload in the header hub (`js/barchart-parse.js`).

# Session-date classification

Rule 1 / Rule 2 live **only** in the `ingest-worker`. Rule 1 maps download
date → the next *trading* day (weekend-skip on write; the read path still
accepts legacy weekend-dated rows). The client never re-derives session
dates from filenames when index metadata exists — an
[invariant](/doctrine/invariants.md).

# Failure modes

- **"Historical datasets missing" on Mondays** → the weekend-skip fix
  (audit [D3](/incidents/audit-ledger-d1-d12.md)); Friday chains index
  under Monday, not Saturday.
- **Poisoned warehouse** → the worker validates CSVs before R2 put; bad
  files are indexed `status='invalid'` with a reason (D8).
- **Silent no-data** → check `__qPipe` stages; list failures are no longer
  indistinguishable from "no data" (D5).

# Related

* [Data plane](/architecture/data-plane.md) · [Client warehouse](/architecture/client-warehouse.md) · [Instrument registry](/architecture/instrument-registry.md).

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §6; `raw/qu-an-terminal-walkthrough.md` §2, §7.
[2] Qu'an repo — `ARCHITECTURE.md` §2, §3 (D3, D8); `workers/ingest-worker.js`.
