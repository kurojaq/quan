---
type: Risk Model
title: Terminal Invariants
description: The frozen constraints that must hold across any change to the terminal.
tags: [doctrine, invariants, safety]
timestamp: 2026-07-18T00:00:00Z
---

# Rules

1. **Doctrine is frozen.** Analytical doctrine, normalized time systems,
   and outputs do not change; the four [Pyodide engine copies](/architecture/pyodide-engines.md)
   stay diverged — never merge them.
2. **Heat Map runs only in its iframe.** `heatmap.html` always runs inside
   an iframe; auth comes from the parent frame. See [Heat Map](/terminal/tabs/heat-map.md).
3. **Observability is never a hard dependency.** Every `__qPipe`
   call-site guards with `window.__qPipe &&`.
4. **Classification lives in the ingest worker.** The client never
   re-derives session dates from filenames when index metadata exists.
   See [ingest lifecycle](/pipelines/ingest-lifecycle.md).
5. **No bare NaN/Infinity across the Python↔JS boundary.** Sanitize before
   `json.dumps`, or the whole brief nulls. See [Pyodide NaN/JSON nulling](/incidents/pyodide-nan-json.md).
6. **Never fabricate market data.** Backtest results, performance numbers,
   or market values in a concept must be cited or marked as open questions
   (vault ground rule).
7. **No subscriber may route live orders without explicit per-user
   opt-in and a compliance/liability review.** Subscribers are
   demo-clamped by default; only the operator can go live, gated by the
   single `userMayGoLive()` seam. See [Execution tab](/terminal/tabs/execution.md)
   and the [Go-Live runbook](/saas/go-live-runbook.md).

# Rationale

Each rule encodes a failure that already happened or a boundary that keeps
the system analyzable. Rules 1–4 come from the `ARCHITECTURE.md` §4
invariant list; rule 5 from a production incident that broke all
currencies; rule 6 from the vault's authoring ground rules; rule 7 from
the Go-Live runbook's explicit "deferred, needs compliance review" note —
it is a business/legal boundary, not a technical limitation, so it must
not be relaxed casually.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §7; `raw/GO_LIVE.md` §5, "Deferred".
[2] Qu'an repo — `ARCHITECTURE.md` §4; vault `CLAUDE.txt` ground rules; `workers/execution.js`.
