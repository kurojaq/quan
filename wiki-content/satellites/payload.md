---
type: Reference
title: Payload Generator
description: Shadow-DOM payload generation with its own diverged Pyodide engine copy.
tags: [satellite, payload, shadow-dom]
timestamp: 2026-07-18T00:00:00Z
---

# Summary

The Payload Generator produces payloads through a **shadow-DOM**
style/markup/script bundle (`payload/`), driven by
`js/payload-generator-host.js` and `js/payload-panel.js`.

# Detail

- Uses its own diverged Pyodide engine copy
  (`engine/payload/`) — one of the four that must not be merged.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §10; `README.md`.
[2] Qu'an repo — `payload/`, `js/payload-generator-host.js`.
