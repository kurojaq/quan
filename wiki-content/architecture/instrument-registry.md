---
type: Reference
title: Instrument Registry
description: Single source of truth for instrument symbol knowledge — roots, contract parsing, multipliers, families.
tags: [architecture, instruments, registry]
timestamp: 2026-07-18T00:00:00Z
resource: js/instrument-registry.js
---

# Summary

`js/instrument-registry.js` is the **single source of truth** for
instrument symbol knowledge: roots, contract-code parsing, multipliers,
and family classification. Ingest worker, detector, heatmap, adapter, and
auto-pull all derive from it.

# Detail

It replaced **six independently drifting symbol tables** (audit defect
[D1](/incidents/audit-ledger-d1-d12.md)) — the ingest worker's `ROOT_MAP`,
the detector's `INSTRUMENT_GROUPS`, the heatmap `INSTR` multiplier table,
the adapter's `FAMILY` regexes, auto-pull's `frontSymbol`, and heatmap's
`instFromName`. Those drifts caused currencies and metals to fall through
gaps (FX filenames like `e6u26…` never matched the all-letter root regex —
defect D2/D9).

**Consumers must derive, not re-implement.** Name/selection remain the
primary classification signal; family roots now come from the registry so
detection covers FX, metals, energy, and ags.

# Related

* [Ingest lifecycle](/pipelines/ingest-lifecycle.md) — classification uses the registry.
* [Audit ledger](/incidents/audit-ledger-d1-d12.md) — D1, D2, D9, D10.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §5.5.
[2] Qu'an repo — `ARCHITECTURE.md` §3 (D1, D2, D9); `js/instrument-registry.js`.
