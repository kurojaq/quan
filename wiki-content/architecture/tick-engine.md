---
type: Reference
title: Tick Engine (planned)
description: The planned canonical market-data subsystem — one Tradovate MD subscription per contract, fanned out internally to Chronometer, Analytics, Execution, and Risk.
tags: [architecture, tick-engine, tradovate, planned, phase-0]
timestamp: 2026-07-18T00:00:00Z
resource: TICK_ENGINE_RESEARCH.md
---

# Summary

**Status: planned, Phase-0 research only — not yet built.** The Tick
Engine is designed to become the canonical market-data source feeding the
Chronometer, analytics, [Execution](/terminal/tabs/execution.md), and Risk
engines. The core rule it enforces: **no module polls the broker
directly — everything subscribes to the Tick Engine.** That rule exists
for cost control as much as elegance — see
[Tick Engine constraints](/doctrine/tick-engine-constraints.md).

# Detail

**Why it's needed:** Tradovate's real-time market-data API is licensed
separately from the trading API and is not a durable history store (see
[Tradovate Market Data API](/architecture/tradovate-market-data-api.md)
for the capability inventory this design is built on). The engine must
own its own archive and treat the live feed as an expensive, rate-limited
resource consumed once and fanned out.

**Planned data flow:**

```
Tradovate MD socket ──(1 sub/type/contract)──► TICK ENGINE (Durable Object)
   subscribeQuote  ─ L1 quote  ┐
   subscribeDOM    ─ L2 depth  ├─► normalize → timestamp → sequence/sort → de-dup
   getChart(Tick)  ─ raw ticks ┘        │
   getChart(hist)  ─ backfill ──────────┤
                                        ▼
                          immutable Tick events → ┌─ R2 archive (raw)
                                                  ├─ D1 index / bars
                                                  └─ EVENT BUS (fan-out)
                                                        │
   Chronometer ◄─ Analytics ◄─ Risk ◄─ Execution ◄─ Pending-Order Activator ◄─ Cockpit
```

**Planned storage split** (mirrors the existing
[data plane](/architecture/data-plane.md) pattern of large blobs in R2 /
small queryable state in D1-Supabase):

- **Hot/streaming + sequencing** → an `ExecutionEngine`-sibling Tick
  Engine Durable Object (single-threaded ordering fits tick sequencing;
  holds the live MD socket + ring buffer).
- **Tick archive** (append-only, high volume) → R2 (`quan-state` bucket,
  already bound), day-partitioned `md/<symbol>/<date>`.
- **Queryable index/bars/sessions** → D1 (SQLite) for OHLC rollups and
  replay indices; raw ticks stay in R2.

**First integration seam:** the activation engine's `getPrice()` in
`workers/execution.js` (Phase 3b) already polls Yahoo — it is designed to
flip to subscribing to the Tick Engine's event bus with no other change
to the activation lifecycle. That seam is the proof the design composes.
The Chart tab's dedicated Tradovate view is meant to render from the same
event bus.

# Related

* [Tradovate Market Data API](/architecture/tradovate-market-data-api.md) — the capability inventory this design targets.
* [Tick Engine constraints](/doctrine/tick-engine-constraints.md) — the cost/licensing/rate-limit rules that shape it.
* [Execution tab](/terminal/tabs/execution.md) — the first planned consumer.

# Citations

[1] Vault raw source — `raw/TICK_ENGINE_RESEARCH.md` §0, §5, §6.
[2] Qu'an repo — `workers/execution.js` (Phase 3b `getPrice()` seam).
