---
type: Execution Playbook
title: Doctrine Tab
description: The Deep Strike + Risq precision console — the wiki's execution doctrine computed live over engine outputs, ending in an advisory three-layer order plan.
tags: [terminal, tab, doctrine, deep-strike, risq, execution]
timestamp: 2026-07-19T00:00:00Z
---

# Trigger

Pre-session (or on any re-read): the operator wants the doctrine's
mechanical gates — Deep Strike scorecard, five-dimension Risq, entropy
budget, order architecture — computed from the loaded session instead of
worked by hand from the manuals.

# Steps

1. Open the Doctrine tab (data tab id `doctrine`, Operator tier). Load a
   chain + anchor in the header hub first — the tab reads, it never loads.
2. `js/doctrine-engine.js` computes, as pure functions over engine
   *outputs* (invariant #1 — no engine math is duplicated):
   * **Close reading / inherited prior** from `__sopData()`'s 11-row fold
     ([Deep Strike Part I](/analytics/deep-strike-analysis.md)) —
     DIPLTR residual, ZC count + final-ZC wing, entropy grade, SOP latent
     orientation → Strong / Moderate / No Prior.
   * **Deep Strike scan** from the Heat Map iframe's per-strike rows
     (`quanGetHeatmap` bridge): the 4-criteria PDSL/DSC classification,
     Force-gradient read, dealer temporal position, and the 0–10
     scorecard with tiers.
   * **Risq** ([five dimensions + ℛₓ](/analytics/risq-framework.md)) per
     selected strike, with the mechanical allocation formula and
     structural vetoes; **coherence patterns 1–3** and the
     **[entropy budget](/analytics/risq-operational-protocol.md)** as a
     per-(instrument, date) ledger that closes the session at zero.
   * **Order architecture**: the
     [three-layer build](/analytics/three-layer-execution-model.md) on the
     [PDSL-to-PDSL Fibonacci grid](/analytics/fibonacci-strike-architecture.md)
     with quarter-level stops — emitted as a copyable advisory ticket.
3. Operator inputs: **condFactor** (manual four-value select until the
   Tick Engine supplies Packet Timing), **CW position** slider for
   intra-session ℛ_T re-reads, and base allocation.

# Derivation notes (labeled in the tab footer)

A = `netoipcr` (Net OI / PC Ratio(OI)); LR = `liqratio`; DR3, II, TI are
book-percentile ranks of |`riskreal`|, |`invdist`|, |`invtxn`|; DIDK…DR3S
are kurt/skew aggregates of those same three dealer-tier columns. The
ICF Time Density trend needs a prior-session scan (cached per
instrument+date) and grants its +1 only when one exists.

# Failure modes

- "Heat engine rows unavailable" — the Heat Map iframe hasn't computed
  this session yet; load a chain in the header hub, then Recompute.
- Order plans are **advisory text only**: nothing routes from this tab.
  Routing stays manual in the [Execution tab](/terminal/tabs/execution.md)
  (invariant #7).
- The scorecard's +2 prior-alignment and the demote-on-conflict rule are
  applied exactly as written — a conflicting prior demotes to watch-only,
  it never reverses a gradient read.

# Related

* [Deep Strike Analysis](/analytics/deep-strike-analysis.md),
  [Risq framework](/analytics/risq-framework.md),
  [Risq operational protocol](/analytics/risq-operational-protocol.md),
  [Fibonacci Strike Architecture](/analytics/fibonacci-strike-architecture.md),
  [Three-Layer Execution Model](/analytics/three-layer-execution-model.md),
  [Stop Architecture](/analytics/stop-architecture-loss-management.md) —
  the doctrine this tab mechanizes.
* [Report tab](/terminal/tabs/report.md) — the report engine's parallel
  Python implementation of the same layers (top-candidate snapshot);
  this tab is the interactive, whole-ladder JS counterpart.

# Citations

[1] Qu'an repo — `js/doctrine-engine.js`, `js/doctrine-tab.js`, `app.html` (commit `0a4f458`).
