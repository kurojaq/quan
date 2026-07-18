---
type: Incident
title: Production-Hardening Audit Ledger (D1–D12)
description: The twelve defects found in the hardening audit, with root causes and dispositions.
tags: [incident, audit, hardening, ledger]
timestamp: 2026-07-18T00:00:00Z
---

# Symptom

A production-hardening pass audited the engine before modifying it and
catalogued twelve defects, several of which had user-visible effects
("historical datasets missing", missing currencies, stale data).

# Root cause & disposition

| # | Defect | Where | Disposition |
|---|--------|-------|-------------|
| D1 | Instrument symbol knowledge duplicated in ≥6 places; drifts independently, currencies/metals fall through gaps | workers + js | **Fixed**: single [instrument registry](/architecture/instrument-registry.md) |
| D2 | `frontSymbol()` regex matches only all-letter roots — FX (`e6u26…`) never matches | `js/auto-pull.js` | **Fixed** via registry parsing |
| D3 | Session date = download date +1 calendar day → Friday chains index under Saturday; Mondays "missing" | `workers/ingest-worker.js` | **Fixed**: weekend-skip on write; read accepts legacy weekend rows |
| D4 | `WH_KEY` ReferenceError in hydrate purge, swallowed by `catch` → purge never ran | `js/warehouse.js` | **Fixed** |
| D5 | Auto-load fully silent: list failures indistinguishable from "no data" | `js/warehouse.js` | **Fixed**: staged `__qPipe` reporting |
| D6 | `_ingestCache[inst]` never invalidated → mid-session cron files invisible until reload | `js/warehouse.js` | **Fixed**: TTL |
| D7 | `fetchDayRange` latches dedupe key before fetching → failed fetch blocks retry | `heatmap.html` | **Fixed**: latch on success only |
| D8 | Worker stores whatever Drive returns; truncated/HTML body poisons warehouse | `workers/ingest-worker.js` | **Fixed**: validation stage; invalid rows `status='invalid'` + reason |
| D9 | `instFromName` assumes alpha-only roots → flags FX feeds as mismatched | `heatmap.html` | **Fixed** via registry parse |
| D10 | Adapter data-heuristic misclassifies gold/copper | `js/instrument-adapter.js` | Name/selection remain primary; family roots from registry |
| D11 | Three localStorage KV shims with identical fallback logic | js/ | Left in place; candidate for shared util |
| D12 | ~35 MB of dead `Quan Terminal Baseline.backup-*.html` | root | Flagged; operator's call (git history retains) |

# Fix / disposition

Most defects are fixed. The [instrument registry](/architecture/instrument-registry.md)
resolved the D1/D2/D9 symbol-drift cluster; the [ingest lifecycle](/pipelines/ingest-lifecycle.md)
carries the D3/D8 classification fixes; the [client warehouse](/architecture/client-warehouse.md)
carries D4/D5/D6. D11 and D12 remain open by choice.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §8.
[2] Qu'an repo — `ARCHITECTURE.md` §3.
