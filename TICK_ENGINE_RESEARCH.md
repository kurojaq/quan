# Tradovate Market Data — API Capability Research

> Phase-0 research for the proprietary **Tick Engine** (the market-data subsystem
> that will become the canonical source feeding the Chronometer, analytics,
> Execution Engine, and Risk Engine). This documents *what the Tradovate API
> actually exposes* before we design the engine — so the blueprint is built on
> verified capability, not assumptions.
>
> Compiled 2026-07-10 from Tradovate's official docs, developer FAQ repo, and
> community forum. **Figures Tradovate declines to publish as hard numbers are
> marked "variable — confirm empirically."** Sources at the bottom.

---

## 0. Bottom line (the two facts that shape everything)

1. **Demo gives real-time API market data, free, for 14 days.** The Tradovate
   simulation account includes real-time CME futures data through the *same* API
   surface as live, for the 14-day trial. → **We can build and validate the
   entire Tick Engine on demo at zero data cost.** The clock is the constraint,
   not money: plan the build so a demo can exercise ingest → archive → replay
   end-to-end inside a trial window (and re-registering yields a fresh trial).

2. **Live real-time API data carries a CME license, not just the API fee.**
   A *live* account needs the **$25/mo API access add-on** *and* — because CME
   requires API consumers to be registered sub-vendors — the **CME ILA / sub-vendor
   real-time license, ≈ $290–$500/mo**. Free Level 1 CME data that comes with a
   live brokerage account applies to the *platform*, **not** the API. This is the
   single biggest architectural driver: it is the reason the design must **own its
   own historical archive** (§5) and treat the live real-time feed as an expensive,
   rate-limited resource to be consumed once and fanned out — never re-polled.
   A documented alternative for research data is **DataBento** CME Globex (~$199/mo).

Implication for the Qu'an architecture: the "no module polls the broker directly —
everything subscribes to the Tick Engine" rule in the spec isn't just elegance,
it's **cost control**. One socket, one subscription per contract, fanned out
internally.

---

## 1. Connectivity

Two independent WebSocket endpoints. Both use the **same frame protocol** and
require authorization, but with **different tokens** from the auth response.

| Socket | URL (demo / live share the MD host) | Auth token | Purpose |
|---|---|---|---|
| Trading / user | `wss://demo.tradovateapi.com/v1/websocket` · `wss://live.tradovateapi.com/v1/websocket` | `accessToken` | orders, positions, account, user-sync events |
| **Market data** | `wss://md.tradovateapi.com/v1/websocket` | **`mdAccessToken`** | quotes, DOM, charts, histograms |

`mdAccessToken` is returned by `/auth/accesstokenrequest` alongside `accessToken`
(our runtime Worker already captures it — see `workers/execution.js`, the token
record's `mdAccessToken`). The MD host is shared between demo and live; the
**entitlement is carried by the token**, so a demo token yields demo/trial data.

### Frame protocol (SockJS-style — confirm exact bytes empirically)

- On connect the server sends an **open frame**: `o`.
- Client must **authorize** promptly by sending a text frame:
  `authorize\n<requestId>\n\n<mdAccessToken>` (endpoint / id / *(blank query)* / body).
- **Heartbeat:** the socket sends/expects a heartbeat frame `h`; the client must
  emit a keep-alive (`[]`) on the order of **every ~2.5 s** or the server drops
  the connection. ← verify the exact interval on the wire.
- **Request frame:** `<endpoint>\n<id>\n<query>\n<body>`, e.g.
  `md/subscribeQuote\n2\n\n{"symbol":"ESM7"}`.
- **Response frames:** `a[ … ]` — a JSON array of messages. Two shapes ride this:
  - **command replies:** `{ "s": 200, "i": <id>, "d": { … } }` (status + your request id)
  - **real-time events:** `{ "e": "md", "d": { … } }` (event payloads for your subs)
- **Close frame:** `c[ … ]`.

> These framing details are stable and well-known from Tradovate's `example-api-js`
> reference client, but the docs render them via a JS SPA that can't be scraped
> here — **treat §1's frame specifics as "verify against a live demo socket +
> `tradovate/example-api-js` before implementing."**

---

## 2. Market-data endpoints (the inventory)

All are sent over the **MD socket**. Each real-time subscription returns a
**subscription id** on its data object — **cache it to unsubscribe**. Hard
constraint: **a client may hold only ONE subscription of each type (quote / DOM /
chart) per contract.** That shapes the Tick Engine as the *single* subscriber that
multiplexes internally.

| Endpoint | Kind | Request | Returns | Notes |
|---|---|---|---|---|
| `md/subscribeQuote` | **Level 1** | `{ symbol }` (string `"ESM7"` or contract id) | Quote entity | best bid/ask (price+size), last trade (price+size), high/low, open, settlement, **totalTradeVolume**, **openInterest** |
| `md/unsubscribeQuote` | — | `{ symbol }` | — | stop a quote sub |
| `md/subscribeDOM` | **Level 2** | `{ symbol }` | bids[] & offers[] of `{price, size}` | **depth of market** — the order book. Depth level count is **"variable depending on available data"** — *confirm how many levels demo actually returns.* |
| `md/unsubscribeDOM` | — | `{ symbol }` | — | |
| `md/subscribeHistogram` | aux | `{ symbol }` | base price + per-level traded-volume distribution | volume-at-price / TPO-like profile |
| `md/unsubscribeHistogram` | — | `{ symbol }` | — | |
| `md/getChart` | bars **and** ticks, **+ history** | see §3 | historical packet(s) **then** live packets, each with its own id | the workhorse for both tick-by-tick and OHLC |
| `md/cancelChart` | — | `{ subscriptionId }` | — | stop a chart stream |

**Level 1 vs Level 2:** Level 1 = `subscribeQuote` (top of book + last). Level 2 =
`subscribeDOM` (the depth ladder). Both are available; DOM depth is not guaranteed
to be full-book and must be measured on the demo feed.

---

## 3. Charts, ticks, and history (`md/getChart`)

One endpoint serves **tick-by-tick data, aggregated bars, and historical backfill**.

Request params:
- `symbol`
- `chartDescription`: `{ underlyingType, elementSize, elementSizeUnit, withHistogram }`
  - `underlyingType`: **`Tick`**, `DailyBar`, `MinuteBar`, `Custom`, `DOM`
  - `elementSizeUnit`: `Volume`, `Range`, `UnderlyingUnits`, `Renko`, `MomentumRange`, `PointAndFigure`, `OFARange`
  - **For raw ticks:** `underlyingType: "Tick"`, `elementSize: 1`, `elementSizeUnit: "UnderlyingUnits"`
- `timeRange`: `{ closestTimestamp | asFarAsTimestamp | asMuchAsElements | closestTickId }`
  → this is how you request **history** (backfill) and bound the response size.

**Tick packet response** (compact, delta-encoded):
- `id` — subscription id
- `bt` — base timestamp; each tick carries `t` = offset added to `bt`
- `bp` — base price (in tick sizes); each tick carries `p` = offset added to `bp`
- **tick size/volume** per tick (traded quantity)
- optional relative **bid `b` / ask `a`** and their sizes
- **Out-of-order delivery:** *"tick stream data can arrive out of chronological
  order — it is the client's responsibility to store and sort."* → the Tick
  Engine **must** sequence/sort + de-dup (this is a core engine requirement, §6).

**Historical limits:** the docs describe `timeRange` bounding (by timestamp / by
element count) and pagination via successive `getChart` calls walking backward, but
**do not publish a maximum lookback or max-elements-per-request** → *confirm the
practical backfill horizon empirically on demo.* Design assumption: Tradovate is
**not** a durable history store — backfill is best-effort and bounded. **We keep
our own archive (§5).**

---

## 4. Rate & subscription limits

Tradovate **deliberately publishes no hard caps** — the official FAQ states *"there
is no hard-cap on request rate or data size limits; these values are variable"* and
adjust dynamically by endpoint and load. What we know:

- **Throttling:** exceed the (variable) limit → **HTTP 429 / Too Many Requests**;
  new requests blocked for ~**20–30 s**. Community-reported guidance cites an order
  of **~5,000 requests/hour (rolling 60-min)** as a working ceiling — treat as
  advisory, not contractual.
- **p-ticket penalty:** repeated abuse / reconnect floods → a **penalty ticket**
  (`p-ticket` + `p-time`) that throttles or blocks access for a stretch. *(Our auth
  path in `workers/execution.js` already surfaces `p-ticket` — the Tick Engine's
  reconnect logic must honor `p-time` backoff, never hammer.)*
- **Subscription cardinality:** **one sub of each type per contract** (§2). Cleanup
  on unsubscribe is mandatory or you leak subs.
- **Concurrent connections:** not officially numbered → *confirm; assume "few," and
  design for a single shared MD socket.*

**Design consequence:** the Tick Engine is a **rate-limit governor** as much as a
data pipe — a single MD socket, minimal REST, exponential backoff honoring
`p-time`, and internal fan-out so N subsystems cost 1 subscription.

---

## 5. Why we own the archive (storage)

Tradovate is a **feed, not a warehouse**: real-time is expensive-and-licensed,
historical is bounded/best-effort, and the spec explicitly says *"do not rely on
Tradovate as a permanent historical repository."* So the engine persists every
normalized tick itself. Fit to the existing Cloudflare stack:

- **Hot / streaming state + sequencing** → the **`ExecutionEngine` sibling Tick
  Engine Durable Object** (single-threaded ordering is exactly what tick
  sequencing wants; holds the live MD socket + ring buffer).
- **Tick archive (append-only, high volume)** → **R2** (`quan-state` bucket
  already bound) as columnar/NDJSON day-partitioned objects, `md/<symbol>/<date>`.
- **Queryable index / bars / sessions** → **D1** (SQLite) for OHLC rollups,
  session boundaries, and replay indices; the raw ticks stay in R2.
- This mirrors how the terminal already splits large blobs (R2) from small
  queryable state (Supabase/D1) — see `functions/api/state.js`.

Design "as though Qu'an accumulates years of proprietary history": partition by
`symbol/date`, immutable objects, a manifest index, and a compaction job.

---

## 6. How each capability maps into the Tick Engine

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

- **The activation engine's `getPrice()` seam** (already built in
  `workers/execution.js`, Phase 3b) is the first consumer: today it polls Yahoo;
  it flips to **subscribing to the Tick Engine's event bus** with *no other change*
  to the activation lifecycle. That seam is the proof the architecture composes.
- **Chronometer** becomes tick-driven instead of session-clock-sampled.
- **Chart tab → dedicated Tradovate view/tab** (per the spec) renders from the same
  event bus, so the price chart "inherits" into the Tradovate view.

---

## 7. Empirical checklist — confirm on the demo account before designing

The docs are vague on exactly the numbers a real-time engine must respect. Validate
these on a live demo socket first (a half-day spike):

- [ ] Exact **heartbeat interval** + keep-alive frame the server enforces.
- [ ] **DOM depth**: how many bid/ask levels demo actually streams.
- [ ] **getChart(Tick) history horizon**: how far back, max elements/request, how
      pagination terminates.
- [ ] **Tick throughput** on a liquid contract (ES) at the open — events/sec, to
      size the DO ring buffer and R2 flush cadence.
- [ ] **Rate-limit ceiling** in practice before a 429, and `p-time` on a penalty.
- [ ] Whether **multiple contracts** on one socket behave (sub cardinality across
      symbols) and the concurrent-connection ceiling.
- [ ] Quote field completeness: is **openInterest / settlement** present intraday
      on demo, or only EOD.

---

## Sources

- [Tradovate Partner API — Market Data](https://partner.tradovate.com/overview/core-concepts/web-sockets/market-data/market-data)
- [Tradovate Partner API — Market Data Request Reference](https://partner.tradovate.com/overview/core-concepts/web-sockets/market-data/market-data-request-reference)
- [Tradovate Partner API — Tick Charts](https://partner.tradovate.com/overview/core-concepts/web-sockets/market-data/tick-charts)
- [Tradovate API reference (api.tradovate.com)](https://api.tradovate.com/)
- [tradovate/example-api-faq — How Does Tradovate Limit Requests and Data](https://github.com/tradovate/example-api-faq/blob/main/docs/HowDoesTradovateLimitRequestsAndData.md)
- [Forum — What's the deal with market subscriptions & API access to charts](https://community.tradovate.com/t/whats-the-deal-with-market-subscriptions-and-api-access-to-charts-do-we-need-another-payment/11039)
- [Forum — CME sub-vendor requirement for API access ($290/mo)](https://community.tradovate.com/t/is-cme-sub-vendor-requirement-for-api-access-is-290-per-month/6215)
- [Forum — Get market data with demo account](https://community.tradovate.com/t/get-market-data-with-demo-account/3159)
- [CrossTrade — Understanding Tradovate API Rate Limits](https://crosstrade.io/blog/understanding-tradovate-api-rate-limits)
- [Tradovate — Subscribing to Tradovate Market Data](https://support.tradovate.com/s/article/Subscribing-to-Tradovate-Market-Data?language=en_US)
