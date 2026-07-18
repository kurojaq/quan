---
type: Reference
title: Pyodide Engines
description: Four intentionally-diverged in-browser Python engine copies, one per consumer; do not merge.
tags: [architecture, pyodide, python, engine]
timestamp: 2026-07-18T00:00:00Z
---

# Summary

Python analysis runs in the browser via **Pyodide** (CDN pyodide 0.26.2 +
numpy + pandas). There are **four intentionally-diverged copies** of the
engine, one per consumer. They have drifted over time and are **not
interchangeable** — an [invariant](/doctrine/invariants.md) forbids merging
them.

# Detail

| Copy | Consumer |
|------|----------|
| `engine/heatmap/` | [Heat Map tab](/terminal/tabs/heat-map.md) |
| `engine/report/` | [Report brief](/terminal/tabs/report.md) |
| `engine/payload/` | [Payload Generator](/satellites/payload.md) |
| `engine/compass/` | [Compass tab](/terminal/tabs/compass.md) |

Each copy carries a `manifest.json` (`MODULES`, `ENGINE_HASH`) and a baked
**golden-reference self-test** (`REF_B64` → `REF_EXPECTED`) that must
reproduce at boot before the engine is trusted.

**Boot path (heatmap):** `ensureEngine()` → CDN Pyodide → numpy + pandas →
mount `/eng` from manifest → self-test → `quan_heatmap_bridge`.

**Known hazard:** Python `json.dumps` emits bare `NaN`/`Infinity`, which JS
`JSON.parse` rejects — nulling the whole brief. Sanitize before dumping.
See [Pyodide NaN/JSON nulling](/incidents/pyodide-nan-json.md).

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §5.2.
[2] Qu'an repo — `ARCHITECTURE.md` §1.2, §4; `README.md`.
