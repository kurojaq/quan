---
type: Market Concept
title: Compass Tab
description: Compass view of the selected session's dealer structure.
tags: [terminal, tab, compass]
timestamp: 2026-07-18T00:00:00Z
---

# What it is

The compass view of session structure.

# Behavior

- Data tab id `compass`.
- Fed via `__compassLoadChain` from the [warehouse](/architecture/client-warehouse.md).
- Price now lives on the [Chart tab](/terminal/tabs/chart.md); the Compass's
  old Price control deep-links there.
- Module: `js/compass.js`.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §3.
[2] Qu'an repo — `app.html`, `js/compass.js`.
