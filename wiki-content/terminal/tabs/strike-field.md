---
type: Market Concept
title: Strike Field Tab
description: Strike-field scalar view; hosts the Strike Compass.
tags: [terminal, tab, strike]
timestamp: 2026-07-18T00:00:00Z
---

# What it is

The strike-field scalar view — dealer structure resolved across strikes.
The Strike Compass lives here.

# Behavior

- Data tab id `strike`.
- Fed via `__strikeLoadChain` from the [warehouse](/architecture/client-warehouse.md).
- Modules: `js/strike-compass.js`, `js/scalar-field.js`.

# Related

* [Heat Map](/terminal/tabs/heat-map.md) — the same strike field as a heat map.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §3.
[2] Qu'an repo — `app.html`, `js/strike-compass.js`, `js/scalar-field.js`.
