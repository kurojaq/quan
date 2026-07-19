---
type: Market Concept
title: Detector Tab
description: The default tab — intermarket breach detection over the loaded option chains.
tags: [terminal, tab, detector]
timestamp: 2026-07-18T00:00:00Z
---

# What it is

The home tab. It runs intermarket breach detection over the chains loaded
into the client warehouse for the
selected session, and renders the breach chart.

# Behavior

- Default tab on load.
- A **View** dropdown flips this pane between the Detector and the
  [Report](/terminal/tabs/report.md) (Chronometric Field Brief) and back —
  this is the only route to the Report view besides split view.
- Modules: `js/detector.js`, `js/breach-chart.js`.

# Related

* [Report](/terminal/tabs/report.md) — the paired brief view.
* [Overview](/terminal/overview.md) — the tab strip.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-walkthrough.md` §4.
[2] Qu'an repo — `app.html` (View selector `detViewSel`/`rptViewSel`).
