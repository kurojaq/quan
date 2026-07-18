---
type: Reference
title: Tradovate Market Data API — Capability Inventory
description: What the Tradovate WebSocket market-data API actually exposes, compiled from official docs before designing the Tick Engine against it.
tags: [architecture, tradovate, api, research]
timestamp: 2026-07-18T00:00:00Z
resource: TICK_ENGINE_RESEARCH.md
---

# Summary

Phase-0 capability research compiled 2026-07-10 from Tradovate's official
docs, developer FAQ repo, and community forum, to ground the
[Tick Engine](/architecture/tick-engine.md) design in verified capability
rather than assumptions. Figures Tradovate declines to publish as hard
numbers are marked below as open questions to confirm empirically.

# Detail

**Connectivity** — two independent WebSocket endpoints, same frame
protocol, different auth tokens:

| Socket | Auth token | Purpose |
|---|---|---|
| Trading/user (`wss://demo\|live.tradovateapi.com/v1/websocket`) | `accessToken` | orders, positions, account, user-sync |
| Market data (`wss://md.tradovateapi.com/v1/websocket`) | `mdAccessToken` | quotes, DOM, charts, histograms |

The MD host is shared between demo and live; **entitlement is carried by
the token** — a demo token yields demo/trial data. `mdAccessToken` is
already captured by `workers/execution.js`'s token record.

**Frame protocol** (SockJS-style): open frame `o` → client sends
`authorize\n<requestId>\n\n<mdAccessToken>` → heartbeat frame `h`
expects a client keep-alive (`[]`) roughly every ~2.5s or the server
drops the connection → requests are `<endpoint>\n<id>\n<query>\n<body>`
→ responses are `a[…]` arrays: command replies (`{s,i,d}`) or real-time
events (`{e:"md", d}`) → close is `c[…]`.

**Endpoint inventory** (all over the MD socket; hard constraint — **one
subscription of each type per contract**, so the Tick Engine must be the
single multiplexing subscriber):

| Endpoint | Kind | Returns | Notes |
|---|---|---|---|
| `md/subscribeQuote` | Level 1 | best bid/ask, last, high/low, open, settlement, totalTradeVolume, openInterest | |
| `md/subscribeDOM` | Level 2 | bids[]/offers[] `{price,size}` | depth level count "variable — confirm on demo" |
| `md/subscribeHistogram` | aux | base price + per-level traded-volume distribution | volume-at-price / TPO-like |
| `md/getChart` | bars + ticks + history | historical packet(s) then live packets | the workhorse for tick-by-tick and OHLC |

**`md/getChart`** serves tick, aggregated-bar, and historical-backfill
data from one endpoint. For raw ticks: `underlyingType:"Tick"`,
`elementSize:1`, `elementSizeUnit:"UnderlyingUnits"`. Tick packets are
delta-encoded (`bt`/`t` base+offset timestamp, `bp`/`p` base+offset
price) and **can arrive out of chronological order** — the client must
sequence/sort and de-dup; Tradovate does not publish a max lookback or
max-elements-per-request, and is explicitly not a durable history store.

**Rate limits** — no published hard caps; community guidance treats
~5,000 requests/hour (rolling 60-min) as an advisory ceiling. Exceeding
the (variable) limit → HTTP 429, blocked ~20–30s. Repeated abuse/reconnect
floods → a penalty ticket (`p-ticket` + `p-time`) that must be honored
with backoff, never hammered. See [Tick Engine constraints](/doctrine/tick-engine-constraints.md)
for how this shapes engine design.

# Open questions (confirm empirically on a demo account)

- Exact heartbeat interval + keep-alive frame the server enforces.
- DOM depth: how many bid/ask levels demo actually streams.
- `getChart(Tick)` history horizon and pagination termination.
- Tick throughput on a liquid contract (ES) at the open, to size the
  Durable Object ring buffer and R2 flush cadence.
- Rate-limit ceiling in practice before a 429, and `p-time` on penalty.
- Multi-contract subscription behavior on one socket and the concurrent-
  connection ceiling.
- Whether `openInterest`/`settlement` populate intraday on demo, or only EOD.

# Related

* [Tick Engine](/architecture/tick-engine.md) — the subsystem this research grounds.
* [Tick Engine constraints](/doctrine/tick-engine-constraints.md) — the resulting design rules.

# Citations

[1] Vault raw source — `raw/TICK_ENGINE_RESEARCH.md` §1–§4, §7.
[2] Tradovate Partner API — Market Data: https://partner.tradovate.com/overview/core-concepts/web-sockets/market-data/market-data
[3] Tradovate Partner API — Tick Charts: https://partner.tradovate.com/overview/core-concepts/web-sockets/market-data/tick-charts
[4] tradovate/example-api-faq — Rate/data limits: https://github.com/tradovate/example-api-faq/blob/main/docs/HowDoesTradovateLimitRequestsAndData.md
