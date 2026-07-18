---
type: Incident
title: Pyodide NaN/JSON Nulling
description: Bare NaN/Infinity from Python json.dumps makes JS JSON.parse reject the whole brief.
tags: [incident, pyodide, json, nan]
timestamp: 2026-07-18T00:00:00Z
---

# Symptom

A computed brief comes back blank/null. Historically this took out **all
currencies** at once.

# Root cause

Python's `json.dumps` emits bare `NaN` and `Infinity` tokens. JavaScript's
`JSON.parse` treats those as invalid JSON and rejects the **entire**
payload — so one non-finite value nulls the whole brief, not just its own
field.

# Fix / disposition

**Sanitize before dumping** — replace non-finite values on the Python side
before `json.dumps`, across all four [Pyodide engine copies](/architecture/pyodide-engines.md).
This is now [invariant](/doctrine/invariants.md) #5: no bare NaN/Infinity
may cross the Python↔JS boundary.

When triaging a blank [Report](/terminal/tabs/report.md), check this first.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §7.5.
[2] Qu'an repo — `ARCHITECTURE.md` §1.2 (known gotcha).
