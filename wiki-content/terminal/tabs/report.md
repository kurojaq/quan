---
type: Execution Playbook
title: Report — Chronometric Field Brief
description: The computed brief; auto-archived, publishable to client links or the blog.
tags: [terminal, report, brief, publish]
timestamp: 2026-07-18T00:00:00Z
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

# Failure modes

- **Blank/null brief** → almost always a `NaN`/`Infinity` leaking through
  Python `json.dumps`. See [Pyodide NaN/JSON nulling](/incidents/pyodide-nan-json.md).
- Report is **not on the tab strip** — only reachable via the Detector
  View selector or split view. Looking for a "Report tab" is a dead end.

# Related

* [Detector](/terminal/tabs/detector.md) — the paired pane.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-walkthrough.md` §5.
[2] Qu'an repo — `app.html`, `js/report.js`, `js/brief-archive.js`.
