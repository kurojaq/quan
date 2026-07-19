---
type: Market Concept
title: Account Sim Tab
description: Illustrative order-report simulation off the brief, plus the live demo broker — a paper account that proxies the Execution engine's order lifecycle against the anchor/live price.
tags: [terminal, tab, simulation, risk, demo-broker]
timestamp: 2026-07-19T00:00:00Z
---

# What it is

Two layers on one tab (data tab id `sim`):

1. **Order-report simulation** (`js/account-sim.js`) — the original
   illustrative projection off the Report tab's computed brief: Kelly/tier
   sized entries, stop, scale-out targets, VaR/stress, futures or CFD
   facility, driven by the Account $ / Leverage controls.
2. **Demo broker** (`js/sim-broker.js`) — a live paper-trading engine that
   **proxies the [Execution tab](/terminal/tabs/execution.md)'s order
   lifecycle entirely in-terminal**: BUY/SELL × MKT/LMT/STP/STP-LMT,
   OCO brackets, working orders, netted positions, fills, realized +
   unrealized P&L, equity curve, and live per-position MAE/MFE (the
   Mission AAR's fact inputs). Nothing routes externally — invariant #7
   is untouched.

# The price wire

Every fill happens against the **shared anchor price**: when the header
hub's Live feed is on (`js/live-anchor.js`), the anchor is the streaming
market price and the demo broker fills in real time; hand-moving the
anchor ticks the tape manually. Marks, order sweeps, and MAE/MFE update
on every `quan:cell` tick for the selected instrument.

# Behavior

- Point values from the shared CME table (`__INSTR_MULT` /
  `QuanInstruments.mult`); sizing rejects orders whose notional exceeds
  the Account $ × Leverage cap.
- **Doctrine staging**: the [Doctrine tab](/terminal/tabs/doctrine.md)'s
  compiled three-layer plan stages straight into the demo broker
  ("Stage to Account Sim") — Layer A/B as resting limits, Layer C as a
  stop-limit, each with its OCO bracket. Doctrine → Sim is the demo of
  the Doctrine → Execution path.
- Account state persists at `localStorage qsim:broker:v1`; Reset restarts
  at the Account $ value.
- **Chart overlay**: open positions and working orders are drawn on the
  [Chart tab](/terminal/tabs/chart.md) price axis for the charted
  instrument (`js/chart-sim-overlay.js`), so the demo book is visible on
  the tape it fills against.

# Related

* [Execution](/terminal/tabs/execution.md) — the live cockpit this demo proxies.
* [Doctrine](/terminal/tabs/doctrine.md) — compiled order plans stage here first.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §3.
[2] Qu'an repo — `app.html`, `js/account-sim.js`, `js/sim-broker.js`.
