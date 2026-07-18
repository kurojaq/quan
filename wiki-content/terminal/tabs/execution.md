---
type: Execution Playbook
title: Execution Tab
description: Per-user Tradovate execution cockpit; subscribers are demo-clamped, only the operator can route live.
tags: [terminal, tab, execution, tradovate]
timestamp: 2026-07-18T00:00:00Z
---

# Trigger

A user (operator or a Prime/Desk subscriber) wants to route orders from
the terminal.

# Steps

1. Open the Execution tab (data tab id `exec`).
2. The cockpit (`js/execution.js`) drives the runtime Worker
   (`workers/execution.js`), which talks to Tradovate.
3. **Per-user isolation**: each Prime/Desk subscriber gets their own
   encrypted Tradovate session (`exec:token:<uid>`) and their own
   launch-queue Durable Object (`u:<uid>`) — independent of every other
   user's book.
4. **Subscribers are demo-clamped**; only the operator can route live,
   gated by the single seam `userMayGoLive()` in `workers/execution.js`.
   A subscriber's Connect panel shows "Demo only"; the operator's shows
   "Demo + Live".

# Failure modes

- Runtime Worker unreachable → orders can't route; check the execution
  Worker deployment (`workers/wrangler-execution.toml`) and the
  `EXECUTION` service binding on the Pages project.
- `EXEC_ENC_KEY` unset → Tradovate tokens store plaintext (works, not
  fund-grade).
- Never execute trades or move funds on the user's behalf outside the
  operator's own action — this is a standing safety rule, not a terminal
  limitation. See [invariant](/doctrine/invariants.md) #7.

# Related

* [Tick Engine](/architecture/tick-engine.md) — the planned market-data feed for the activation engine's `getPrice()` seam.
* [Go-Live runbook](/saas/go-live-runbook.md) — the multi-tenant deploy + smoke-test steps.
* [Tiers and gating](/saas/tiers-and-gating.md) — which tiers unlock this tab.

# Citations

[1] Vault raw source — `raw/qu-an-terminal-knowledge-dump.md` §3; `raw/GO_LIVE.md` §5.
[2] Qu'an repo — `app.html`, `js/execution.js`, `workers/execution.js`.
