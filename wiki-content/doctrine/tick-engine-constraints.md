---
type: Risk Model
title: Tick Engine Cost & Licensing Constraints
description: The cost, licensing, and rate-limit rules that must govern the planned Tick Engine's design and build order.
tags: [doctrine, tick-engine, risk, cost, licensing]
timestamp: 2026-07-18T00:00:00Z
resource: TICK_ENGINE_RESEARCH.md
---

# Rules

1. **Build and validate on demo, for free, inside the 14-day trial
   window.** Tradovate's demo/simulation account gets real-time CME
   futures data through the same API surface as live, free, for 14 days.
   Plan the build so a full ingest → archive → replay cycle fits inside
   one trial (re-registering yields a fresh trial if needed).
2. **Live real-time data is licensed, not just metered.** A live account
   needs the $25/mo API access add-on **and** a CME ILA / sub-vendor
   real-time license (≈$290–500/mo) — free Level 1 data bundled with a
   live brokerage account covers the *platform*, not the API. A
   documented fallback for research data is DataBento CME Globex
   (~$199/mo).
3. **One socket, one subscription per contract, fanned out internally.**
   The Tradovate MD API allows only one subscription of each type (quote/
   DOM/chart) per contract — this is why no module may poll the broker
   directly; every subsystem subscribes to the
   Tick Engine instead.
4. **Never re-poll the live feed.** Because live data is expensive and
   licensed, the engine must consume the feed once and distribute
   internally — re-polling multiplies license-exposure for no benefit.
5. **Honor rate limits and penalty backoff.** No hard caps are published;
   treat ~5,000 req/hour as an advisory ceiling, and always honor
   `p-time` backoff after a penalty ticket rather than reconnect-flooding.
6. **Own the archive; never treat Tradovate as a permanent historical
   repository.** Real-time is licensed and historical backfill is
   bounded/best-effort — the engine persists every normalized tick itself
   (R2 archive + D1 index), partitioned `symbol/date` as immutable
   objects.

# Rationale

Rule 1–2 make the API's licensing structure the single biggest
architectural driver of the whole design — it's the reason the engine
must be single-subscriber-per-contract (rule 3) and self-archiving
(rule 6), not an afterthought. Rule 5 exists because Tradovate already
surfaces `p-ticket` in `workers/execution.js`'s auth path — the
constraint is enforceable today, not speculative.

# Related

* Tick Engine — the subsystem these rules govern.
* Tradovate Market Data API — the capability inventory these rules derive from.
* Go-Live runbook — the related "subscribers are demo-clamped" business rule for the shipped [Execution](/terminal/tabs/execution.md) engine.

# Citations

[1] Vault raw source — `raw/TICK_ENGINE_RESEARCH.md` §0, §4, §5.
