---
type: Reference
title: CBOE Proxy
description: Adapts CBOE quotedata into the golden-reference frame via put-call (no-premium) logic.
tags: [satellite, cboe, adapter]
timestamp: 2026-07-18T00:00:00Z
resource: cboe.html
---

# Summary

`quan_cboe.py` (with `cboe.html` and `js/cboe-*.js`) adapts CBOE
`quotedata` into the golden-reference frame the engines
expect, using P−C (no-premium) logic.

# Detail

- Front end: `cboe.html`, `js/cboe-app.js`, `js/cboe-portfolio.js`.
- Purpose: let CBOE-sourced chains flow into the same analytical frame as
  the Barchart-sourced warehouse data.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §10.
[2] Qu'an repo — `cboe.html`, `js/cboe-app.js`.
