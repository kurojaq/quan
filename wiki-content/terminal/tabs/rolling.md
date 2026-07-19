---
type: Market Concept
title: Rolling Tab
description: The Rolling Analysis Engine — forward dealer-interest term structure across expirations.
tags: [terminal, tab, rolling, term-structure]
timestamp: 2026-07-18T00:00:00Z
---

# What it is

The Rolling Analysis Engine: it aggregates forward dealer-interest term
structure across expirations, weighting and applying heuristics to build a
term-structure view.

# Behavior

- Data tab id `rolling`.
- Modules: `js/rolling-engine.js` (core aggregation + weighting +
  heuristics), `js/rolling-viz.js` (visualization/overlays).
- Slice 1 (core aggregation) shipped; viz, overlays, and reporting are
  ongoing — see Rolling Analysis Engine — full vision
  for the complete 12-objective spec and exactly which pieces remain.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §3.
[2] Qu'an repo — `app.html`, `js/rolling-engine.js`, `js/rolling-viz.js`.
