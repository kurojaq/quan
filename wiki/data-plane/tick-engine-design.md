---
type: Architecture / Execution Playbook
title: Tick Engine Design & Implementation
description: Durable Object for market-data ingestion; Tradovate WebSocket client; event bus; state model; deployment to demo/live
tags: [tick-engine, websocket, durable-objects, market-data, tradovate]
citations:
  - TICK_ENGINE_RESEARCH.md (sections 1–6)
  - Terminal Architecture Overview (Layer 3: Data Plane)
---

# Tick Engine Design & Implementation

## Architecture Overview

```
Tradovate MD Socket
  ├─ subscribe.Quote (L1)
  ├─ subscribe.DOM (L2)
  ├─ getChart(Tick) (raw ticks)
  └─ getChart(history) (backfill)
            ↓
    [Tick Engine Durable Object]
            ├─ Receive
            ├─ Normalize (timestamp, price format)
            ├─ Sequence & de-dup
            ├─ Sort out-of-order ticks
            └─ Emit immutable Tick events
            ↓
    [Event Bus] ─ internal fan-out
            ├─ Chronometer (analytics consumer)
            ├─ Execution Engine (activation consumer)
            ├─ Risk Engine (portfolio consumer)
            ├─ Learning Loop (outcome logging)
            └─ Archive Writer (R2 + D1)
            ↓
    [Storage]
    ├─ R2 `quan-ticks` (raw NDJSON, day-partitioned)
    └─ D1 `ticks_index` (queryable bars + session metadata)
```

## Durable Object State Model

### Core State

```javascript
{
  // Connection state
  mdSocket: WebSocket,                    // Live Tradovate MD socket
  mdAccessToken: string,                  // Auth token from Tradovate
  instrument: string,                     // Symbol (ESZ26, ZNM26, e6U26, SPX, etc.)
  
  // Tick sequencing
  lastTickId: number,                     // Highest tick ID seen (for de-dup)
  lastTimestamp: number,                  // Highest timestamp seen (for out-of-order detection)
  tickRingBuffer: Tick[],                 // Ring buffer for live ticks (size: 10,000)
  ringBufferIndex: number,                // Circular write position
  
  // Rate limiting + throttling
  ticksInWindow: number,                  // Count in current 1-second window
  tickWindow: number,                     // Current second timestamp
  p_ticket: string | null,                // Penalty ticket (from Tradovate on abuse)
  p_time: number | null,                  // Penalty time (seconds to backoff)
  
  // Subscribers
  subscribers: Set<WebSocket>,            // Clients subscribed to live updates
  
  // Metadata
  basePrice: number,                      // Reference price for delta encoding
  baseTimestamp: number,                  // Reference timestamp for tick offsets
  sessionStartTime: number,               // Trading session start
  sessionEndTime: number,                 // Trading session end
  
  // Archive tracking
  lastArchivedBatch: number,              // Last batch written to R2/D1
  archiveBuffer: Tick[],                  // Buffer for next R2 flush
  archiveFlushTime: number,               // When to flush (every 5 min or 10K ticks)
}
```

### Tick Event Schema

```javascript
{
  // Immutable tick
  id: number,                             // Tradovate tick ID (for de-dup)
  timestamp: number,                      // Milliseconds since epoch
  price: number,                          // Traded price
  size: number,                           // Traded quantity (in ticks)
  direction: 'buy' | 'sell' | 'unknown', // Tick direction
  
  // Optional: Level 1 quote state at tick time
  bid?: number,                           // Best bid
  bidSize?: number,
  ask?: number,                           // Best ask
  askSize?: number,
  
  // Optional: Level 2 DOM snapshot
  bidLevels?: Array<{price, size}>,
  askLevels?: Array<{price, size}>,
  
  // Metadata
  source: 'quote' | 'dom' | 'chart' | 'histogram',  // Which endpoint provided it
  sequence: number,                       // Local sequence number (for ordering)
}
```

## WebSocket Protocol (Tradovate MD Socket)

### Frame Format

**Open:** Server sends `o`

**Authorize:** Client sends:
```
authorize\n<requestId>\n\n<mdAccessToken>
```

**Keep-alive:** Server sends `h` every ~2.5s; client responds with `[]`

**Data frame:** Client sends:
```
<endpoint>\n<id>\n<query>\n<body>
```

Example:
```
md/subscribeQuote\n1\n\n{"symbol":"ESZ26"}
```

**Response:**
```
a[{"s":200,"i":1,"d":{...}},{"e":"md","d":{...}}]
```

### Endpoints

| Endpoint | Payload | Notes |
|----------|---------|-------|
| `md/subscribeQuote` | `{symbol: "ESZ26"}` | Returns Quote entity (L1) |
| `md/subscribeDOM` | `{symbol: "ESZ26"}` | Returns DOM entity (L2) |
| `md/subscribeHistogram` | `{symbol: "ESZ26"}` | Returns histogram (volume-at-price) |
| `md/getChart` | `{symbol, chartDescription, timeRange}` | Ticks + bars + history |
| `md/unsubscribeQuote` | `{symbol: "ESZ26"}` | Stop quote sub |

### Handling Out-of-Order Delivery

**Critical:** Ticks can arrive non-chronological. The Durable Object must sequence them.

Algorithm:
```javascript
if (newTick.id === lastTickId) {
  // De-dup: already seen this tick
  return;
}

if (newTick.timestamp < lastTimestamp) {
  // Out-of-order: buffer and re-sort
  insertSorted(tickRingBuffer, newTick);
} else {
  // In-order: append and update high watermark
  tickRingBuffer[ringBufferIndex++] = newTick;
  lastTimestamp = newTick.timestamp;
  lastTickId = newTick.id;
}

// Emit sorted batch every 100ms or when buffer fills
```

## State Model: Incoming Data → Tick Event

### From Quote (L1)

Tradovate `Quote` entity:
```json
{
  "symbol": "ESZ26",
  "bid": 5460.25,
  "bidSize": 120,
  "ask": 5460.50,
  "askSize": 95,
  "last": 5460.40,
  "lastSize": 1,
  "high": 5465.00,
  "low": 5455.75,
  "totalTradeVolume": 2450000,
  "openInterest": 850000
}
```

Convert to Tick:
```javascript
{
  timestamp: now(),
  price: quote.last,
  size: quote.lastSize,
  direction: inferFromBidAsk(quote),  // Bid-ask crossover logic
  bid: quote.bid,
  bidSize: quote.bidSize,
  ask: quote.ask,
  askSize: quote.askSize,
  source: 'quote'
}
```

### From DOM (L2)

Tradovate `DOM` entity:
```json
{
  "bids": [
    {"price": 5460.00, "size": 50},
    {"price": 5459.75, "size": 75}
  ],
  "offers": [
    {"price": 5460.50, "size": 120},
    {"price": 5460.75, "size": 90}
  ]
}
```

Emit Tick with DOM snapshot:
```javascript
{
  timestamp: now(),
  price: dom.offers[0].price,  // Assume last trade at ask
  size: 1,  // DOM doesn't have individual ticks
  bidLevels: dom.bids,
  askLevels: dom.offers,
  source: 'dom'
}
```

### From getChart(Tick)

Tradovate tick packet (delta-encoded):
```json
{
  "id": 123,  // Subscription ID
  "bt": 1689854400000,  // Base timestamp
  "bp": 546000,  // Base price (in ticks, e.g., 54.6000)
  "ticks": [
    {"t": 0, "p": 0, "s": 10},  // Offset time=0, price offset=0, size=10
    {"t": 50, "p": 2, "s": 15},  // Offset time=50ms, price+2 ticks, size=15
    ...
  ]
}
```

Decode:
```javascript
const baseTime = bt;
const basePrice = bp / 100;  // Convert from ticks

for (const tick of ticks) {
  const absoluteTime = baseTime + tick.t;
  const absolutePrice = basePrice + (tick.p * minPriceTick);
  
  emit({
    id: `${subscriptionId}_${tick.sequence}`,
    timestamp: absoluteTime,
    price: absolutePrice,
    size: tick.s,
    source: 'chart'
  });
}
```

## Event Bus: Consumers

Once Ticks are sequenced + normalized, they flow to consumers via event bus.

### Consumer Interface

```javascript
// Consumer subscribes via WebSocket or HTTP long-poll
GET /tick-engine/:instrument/subscribe?consumer=execution

// Tick Engine sends immutable events
{
  "tick": {
    "timestamp": 1689854425000,
    "price": 5460.40,
    "size": 5,
    ...
  },
  "state": {
    "bid": 5460.25,
    "ask": 5460.50,
    "volume": 2450000,
    "openInterest": 850000
  }
}
```

### Specific Consumers

**Execution Engine** (`workers/execution.js`):
- Consumes quote ticks to trigger order activation
- Seam: `getPrice()` subscribes to Tick Engine instead of polling Yahoo
- Updates risk metrics in real-time

**Chronometer** (analytics):
- Consumes full tick stream for session analysis
- Computes Greeks, morphology on live tick updates
- Feeds Detector tab real-time view

**Learning Loop** (outcome logging):
- Consumes order fills (execution ticks)
- Logs to D1 for closed-loop hypothesis testing
- Computes Brier scores post-session

**Archive Writer** (persistence):
- Consumes all ticks
- Buffers for R2 flush (every 5 min or 10K ticks)
- Writes to `quan-ticks/{{ instrument }}/{{ date }}.ndjson`
- Updates D1 `ticks_index` with session metadata

## Storage Strategy

### R2 Archive

**Bucket:** `quan-ticks`  
**Key format:** `{{ instrument }}/{{ date }}/{{ time_range }}.ndjson`  
**Example:** `ESZ26/2026-07-22/0900-1200.ndjson`

**Content:** NDJSON (one Tick per line)
```json
{"timestamp":1689854400000,"price":5460.25,"size":10,"source":"quote"}
{"timestamp":1689854400050,"price":5460.40,"size":5,"source":"chart"}
...
```

**Partitioning:** By hour (finer granularity possible; 1-hour chunks are queryable)

### D1 Index

**Table:** `ticks_index`

```sql
CREATE TABLE ticks_index (
  id INTEGER PRIMARY KEY,
  date TEXT,                    -- 2026-07-22
  instrument TEXT,              -- ESZ26, ZNM26, SPX, etc.
  start_time TIMESTAMP,         -- Session start
  end_time TIMESTAMP,           -- Session end
  tick_count INTEGER,           -- Total ticks ingested
  first_price REAL,             -- Opening price
  last_price REAL,              -- Closing price
  high REAL,                    -- Session high
  low REAL,                     -- Session low
  r2_key TEXT,                  -- S3 path in R2 (for replay)
  status TEXT,                  -- 'archiving', 'complete'
  created_at TIMESTAMP
);
```

**Queries:**
```sql
-- Get session metadata
SELECT * FROM ticks_index WHERE instrument = 'ESZ26' AND date = '2026-07-22';

-- Replay: know R2 key to fetch full tick stream
SELECT r2_key FROM ticks_index WHERE instrument = 'ESZ26' AND date BETWEEN '2026-07-01' AND '2026-07-31';
```

## Deployment Plan

### Phase 1: Demo Account (Week 2, Free)

**Goal:** Validate architecture + API contracts before spending money on live data.

1. **Create Tradovate demo account** (free, 14-day real-time API access)
2. **Deploy Tick Engine Durable Object** to Cloudflare Workers (staging)
3. **Implement Tradovate WebSocket client** (SockJS frame handling)
4. **Validate protocol:** heartbeat, authorize, quote subscription
5. **Implement sequencing + de-dup** on raw Tradovate ticks
6. **Wire `/api/quote` to Tick Engine** event bus (replaces Yahoo proxy)
7. **Test E2E:** price updates → Detector tab real-time view
8. **Archive to R2/D1:** confirm tick batches persist correctly
9. **Empirical validation checklist** (from research doc §7):
   - [ ] Exact heartbeat interval
   - [ ] DOM depth (how many levels demo streams)
   - [ ] Tick throughput on ES at open (events/sec)
   - [ ] Rate-limit ceiling before 429
   - [ ] Multiple contracts on one socket behavior

**Metrics to capture:**
- Ticks per second (open, midday, close)
- Out-of-order rate (% of ticks needing re-sort)
- Latency: tick received → consumer event (target: <50ms)
- R2 write throughput (MB/sec)

### Phase 2: Live Account (Week 3, $315–550/mo)

**Prerequisites:**
- [ ] Demo validation passed all 9 checklist items
- [ ] Performance metrics acceptable
- [ ] Architecture proven in production Cloudflare Workers

**Steps:**
1. **Provision live Tradovate account** (requires API approval)
2. **Purchase CME sub-vendor license** (§5 of research: $290–500/mo via Tradovate)
3. **Deploy to production** (same code, different auth token)
4. **Migrate Execution Engine** from Yahoo → Tick Engine for live orders
5. **Enable live routes** in execution cockpit (currently demo-only)
6. **Monitor:** real-time tick latency, rate-limit behavior, archive completeness

**Cost:** $25/mo (Tradovate API) + $290–500/mo (CME) = **$315–525/mo**

### Phase 3: Optimization (Week 4+)

- Tune archive flush cadence (now: 5 min or 10K ticks)
- Implement D1 bar rollups (aggregate ticks → OHLC)
- Add replay API (`GET /tick-engine/:instrument/replay?start=...&end=...`)
- Performance optimization (ring buffer sizing, serialization)

## Integration Points

### 1. Execution Engine (`workers/execution.js`)

**Before:** Polls Yahoo every N seconds
```javascript
async function getPrice() {
  const { price } = await fetch('/api/quote');
  return price;
}
```

**After:** Subscribes to Tick Engine event bus
```javascript
const tickEngine = env.TICK_ENGINE.get(`${instrument}:live`);
tickEngine.subscribe((tick) => {
  // Activation: check if price crossed order level
  if (tick.price >= order.limitPrice) {
    executeOrder(order);
  }
});
```

### 2. Detector Tab (`js/detector.js`)

**Before:** Static chains + Greeks (no live price)  
**After:** Tick Engine feeds real-time price

```javascript
tickStream.subscribe((tick) => {
  updateDetectorView({
    currentPrice: tick.price,
    bid: tick.bid,
    ask: tick.ask,
    volume: tick.size
  });
});
```

### 3. Archive Writer (new Worker)

**Trigger:** Every 5 minutes or 10K ticks

```javascript
// In Tick Engine Durable Object
if (archiveBuffer.length >= 10000 || timeSinceLastFlush > 5 * 60 * 1000) {
  await flushArchive(archiveBuffer);  // → R2 + D1
}
```

### 4. API Layer (`functions/api/quote.js`)

**Before:**
```javascript
export async function onRequest({ params, env }) {
  const { instrument } = params;
  const yahoo_price = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${instrument}`);
  return new Response(JSON.stringify(yahoo_price));
}
```

**After:**
```javascript
export async function onRequest({ params, env }) {
  const { instrument } = params;
  const tickEngine = env.TICK_ENGINE.get(`${instrument}:live`);
  const latestTick = await tickEngine.getLatestTick();
  return new Response(JSON.stringify({
    price: latestTick.price,
    bid: latestTick.bid,
    ask: latestTick.ask,
    timestamp: latestTick.timestamp
  }));
}
```

## Rate Limiting & Penalty Handling

Tradovate API returns `p-ticket` + `p-time` on abuse.

**In Tick Engine:**

```javascript
// Track p-ticket from Tradovate response
if (response.p_ticket) {
  this.state.p_ticket = response.p_ticket;
  this.state.p_time = response.p_time;
  
  // Back off: don't send requests for p_time seconds
  await sleep(p_time * 1000);
}

// Rate governance: 5,000 req/hour ceiling
if (ticksInCurrentSecond > 100) {  // Rough heuristic
  // Slow down: don't send new subscriptions, wait for buffer to drain
}
```

---

## Success Criteria

**By end of Week 2 (demo):**
- ✅ Tick Engine Durable Object running on staging
- ✅ Tradovate MD socket connected (quote + DOM subscriptions live)
- ✅ Ticks sequenced + de-duped (no duplicates in archive)
- ✅ Archive flushed to R2 (byte-for-byte correct)
- ✅ D1 index populated (queries return session metadata)
- ✅ Execution Engine seam wired (getPrice() uses Tick Engine)
- ✅ All 9 empirical validation checklist items passed
- ✅ Latency <50ms (tick received → consumer event)

**By end of Week 3 (live):**
- ✅ Live Tradovate account provisioned
- ✅ CME sub-vendor license active
- ✅ Production deployment passes smoke tests
- ✅ Execution Engine live routes enabled (post-compliance review)

---

**Next:** See [[tick-engine-implementation.md]] for code walkthrough + file-by-file structure.
