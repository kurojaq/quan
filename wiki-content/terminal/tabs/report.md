---
type: Execution Playbook
title: Report — Chronometric Field Brief
description: The computed brief; auto-archived, publishable to client links or the blog. Now also surfaces the Deep Strike Scorecard, Fibonacci architecture, and the five-dimension Risq read.
tags: [terminal, report, brief, publish]
timestamp: 2026-07-19T00:00:00Z
---

# Trigger

Operator wants the Chronometric Field Brief for the current session, or
wants to ship it to clients.

# Steps

1. On the [Detector](/terminal/tabs/detector.md) pane, flip the **View**
   dropdown to **Report**. The [Pyodide report engine](/architecture/pyodide-engines.md)
   (`engine/report/`) computes the brief.
2. Each computed brief auto-archives to `/api/archive`; the **🕘 History**
   browser replays past briefs read-only (`js/brief-archive.js`,
   `js/view-report.js`).
3. To ship it: **📤 Publish** (header hub) → `/api/publish` mints a
   snapshot, `/api/client-tokens` gates access, clients open it in
   `view.html`. **→ Blog** publishes to the public blog (permanent until
   deleted).

# What the brief includes (shipped 2026-07-19)

Beyond the original field-classification / cascade / greeks / IV /
risk-engine groups, the operator brief now surfaces three doctrine layers
that the engine already computed but never rendered (commit `8112d86`):

- **Deep Strike Scorecard** — the ranked PDSL/DSC candidates with their
  0–10 scores, tier, gradient, Mass, and DR3, as a table
  (`engine/report/quan_scorecard.py`). See
  [Deep Strike Analysis](/analytics/deep-strike-analysis.md).
- **Fibonacci Strike Architecture** — the PDSL-to-PDSL level table with
  anchors, range, and price fraction, when a defended bracket exists
  (`engine/report/quan_fib.py`); shows an explicit "unbracketed" note
  otherwise. See [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md).
- **Risq — Structural Risk** — the five-dimension read (ℛ_F/ℛ_T/ℛ_I/ℛ_C/ℛ_Ω)
  plus the Risq Ratio and tier, computed for the top-scored candidate
  (`engine/report/quan_risq.py`). See [Risq framework](/analytics/risq-framework.md).

The **published client view** (`js/view-report.js`) deliberately trims to
the **Risq Ratio + Tier** only — the raw dimensions and the Deep Strike /
Fibonacci execution tables stay operator-side, matching how that view
already trims the Risk Engine and Jarque-Bera detail. These are
**structural** reads (dealer-field risk geometry), not trade signals —
the brief's standing "direction stays paper-only" discipline is unchanged.

# Failure modes

- **Blank/null brief** → almost always a `NaN`/`Infinity` leaking through
  Python `json.dumps`. See [Pyodide NaN/JSON nulling](/incidents/pyodide-nan-json.md).
- Report is **not on the tab strip** — only reachable via the Detector
  View selector or split view. Looking for a "Report tab" is a dead end.
- **Fibonacci block shows "unbracketed"** → not a bug. The Fib table only
  renders when an ATT floor and a REP ceiling bracket price; the
  golden-reference sample chain has no 4-of-4 PDSL, so it takes that path.

# Related

* [Detector](/terminal/tabs/detector.md) — the paired pane.
* [Deep Strike Analysis](/analytics/deep-strike-analysis.md) · [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md) · [Risq framework](/analytics/risq-framework.md) — the doctrine behind the three new brief sections.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-walkthrough.md` §5.
[2] Qu'an repo — `app.html`, `js/report.js`, `js/brief-archive.js`, `js/payload-panel.js`, `engine/report/quan_scorecard.py`, `engine/report/quan_fib.py`, `engine/report/quan_risq.py` (commit `8112d86`).
