---
type: Reference
title: Universal Screenshot Capture (planned)
description: A reusable "capture current visualization" service every analytical tab can register with, for publication-quality exports — not yet built.
tags: [roadmap, planned, publishing, screenshot]
timestamp: 2026-07-18T00:00:00Z
resource: raw/Claude Implementation Prompt - Reporting Debug and Screenshot Capture.pdf
---

# Summary

**Status: not built.** No `screenshot`, `html2canvas`, or
`captureVisualization` references exist in the codebase. This is
Objective 2 of a two-part spec whose Objective 1 (reporting-pipeline
debugging: silent failures, ZN-specific parsing issues) is already
**shipped and superseded** — it matches the observability work recorded
in [D5 and D8 of the audit ledger](/incidents/audit-ledger-d1-d12.md)
(staged `__qPipe` reporting, CSV validation with `status='invalid'`).

# Vision

- A **publishing toggle** ("Include Visualization Screenshot") that
  captures whatever the user currently sees — starting with the
  [Heat Map tab](/terminal/tabs/heat-map.md) — including axes, labels,
  scaling, selected expiration/session, legends, and overlays, at
  publication quality.
- A **reusable screenshot service** every visualization tab registers
  with, rather than a Heatmap-only implementation — Dealer Inventory,
  Surface Charts, Volatility, Greeks, Chronometer, Curvature, Time-State
  Compass, Distribution Views, Breach Detector, and future tabs should
  all expose a `Capture Current Visualization()` call returning a
  publication-ready image.
- Requirements: high resolution, deterministic, responsive, free of UI
  artifacts, correctly cropped, consistent across browsers.
- **Publishing pipeline shape**: Generate Report → Generate Analytics →
  Capture Visualization (optional) → Assemble Publication → Export,
  feeding into the existing [publish/client-token flow](/terminal/tabs/report.md).
- Future export targets named in the spec: PDF reports, weekly reports,
  Discord publications, a "Qu'an Almanac," client reports, institutional
  presentations, research archives.

# Related

* [Report tab](/terminal/tabs/report.md) — the publishing flow this would extend.
* [Audit ledger D1–D12](/incidents/audit-ledger-d1-d12.md) — where this spec's Objective 1 (reporting debug) was actually resolved.

# Citations

[1] Vault raw source — `raw/Claude Implementation Prompt - Reporting Debug and Screenshot Capture.pdf`, "Objective 2 — Universal Screenshot Capture."
