---
type: Market Concept
title: Heat Map Tab
description: Strike-field heat map; a standalone iframe document with its own Pyodide engine.
tags: [terminal, tab, heatmap, iframe, pyodide]
timestamp: 2026-07-18T00:00:00Z
---

# What it is

The strike-field heat map — the largest single module. It is a
**standalone document (`heatmap.html`) loaded in an iframe**, not an
in-page tab section.

# Behavior

- Receives its data from the parent frame via `postMessage` (`quanFeed`) —
  it never sources data itself.
- **Auth comes from the parent** — it must run inside the iframe; this is
  an [invariant](/doctrine/invariants.md).
- Boots its own copy of the Pyodide engine
  (`engine/heatmap/`) and must pass the golden-reference self-test before
  rendering. First load pays the Pyodide download; later loads are warm.
- A failed data fetch no longer blocks retries — the dedupe key latches on
  success only (see [audit ledger](/incidents/audit-ledger-d1-d12.md), D7).
- Modules: `js/heatmap-loader.js`, `heatmap.html`, `js/chart-heat.js`.
- The **Binary Wave** panel renders one selected observable field (e.g.
  "Strike Skew" — column X of the
  [Strike Observable Manifold](/analytics/strike-observable-manifold.md))
  as a flip-density strip across the strike ladder, alongside a per-strike
  table (Skew, Mass, Net Premium, Inverse Vol Density, Risk).
- The **Dealer Watermark** side panel ranks latent resistance/support
  levels — see [Dealer Watermark (PDSL)](/analytics/dealer-watermark-pdsl.md)
  for the exact definition, taken directly from its in-app tooltip.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §2–§3, §7.
[2] Qu'an repo — `ARCHITECTURE.md` §1.1–§1.2, §4.
[3] Vault raw source — `raw/Screenshot 2026-07-18 051039.png` (Binary Wave + Dealer Watermark, live render).
