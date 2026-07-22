---
type: Execution Playbook
title: Tick Engine Implementation Guide
description: Step-by-step deployment of market-data Durable Object; integration with existing Workers; demo account validation
tags: [tick-engine, implementation, deployment, cloudflare, tradovate]
citations:
  - tick-engine-design.md (complete architecture)
  - TICK_ENGINE_RESEARCH.md (research + empirical checklist)
---

# Tick Engine Implementation Guide

## Project Structure

```
workers/
├── tick-engine.js                  [Durable Object - market-data hub]
├── tradovate-client.js             [WebSocket client for Tradovate MD socket]
├── execution.js                    [Updated to use Tick Engine]
└── wrangler-tick-engine.toml       [Cloudflare deployment config]

functions/api/
├── quote.js                        [Updated to fetch from Tick Engine]
└── _shared.js                      [Shared utilities]

wiki/
├── tick-engine-design.md           [Architecture + state model]
└── tick-engine-implementation.md   [This file - deployment steps]

database/
└── migrations/
    └── 0043_ticks_index.sql        [D1 schema for tick archival]
```

## Phase 1: Demo Account Setup (Week 2)

### Step 1: Create Tradovate Demo Account

**Goal:** Obtain free real-time API access for 14 days (for validation)

1. Visit https://tradovate.com/sign-up (free trial)
2. Create account (email, password)
3. Verify email
4. Request API access (Partner API → Enable → Demo account receives real-time market data)
5. Retrieve credentials:
   - Demo user ID
   - `mdAccessToken` (for market-data socket connection)
   - Confirm demo account has real-time Tradovate data enabled

**Verification:**
```bash
# Test with curl (manually construct SockJS frame)
curl -i -N -H "Connection: Upgrade" \
  wss://md.tradovateapi.com/v1/websocket
# Should return HTTP 101 Switching Protocols
```

### Step 2: Deploy Tick Engine to Staging

**Prerequisites:**
- Cloudflare account with Workers enabled
- Wrangler CLI installed
- D1 database created
- R2 bucket created

**Commands:**

```bash
# Install dependencies
npm install wrangler

# Configure wrangler
wrangler login

# Create D1 database (if not exists)
wrangler d1 create quan --remote

# Create R2 bucket (if not exists)
wrangler r2 bucket create quan-ticks

# Deploy Tick Engine to staging
wrangler deploy --config workers/wrangler-tick-engine.toml --env staging
```

**Expected output:**
```
✓ Published tick-engine (staging)
  https://tick-engine-staging.example.com/
```

### Step 3: Initialize D1 Schema

Create tick index table in D1:

```bash
# Apply migration
wrangler d1 execute quan --remote --file=database/migrations/0043_ticks_index.sql
```

**Migration SQL:**
```sql
CREATE TABLE ticks_index (
  id INTEGER PRIMARY KEY,
  date TEXT,
  instrument TEXT,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  tick_count INTEGER,
  first_price REAL,
  last_price REAL,
  high REAL,
  low REAL,
  r2_key TEXT,
  status TEXT DEFAULT 'archiving',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ticks_date_inst ON ticks_index(date, instrument);
CREATE INDEX idx_ticks_r2_key ON ticks_index(r2_key);
```

### Step 4: Bind Tick Engine to Pages Project

Update Cloudflare Pages project settings:

**Project → Settings → Bindings → Add Binding:**

| Binding Name | Type | Resource |
|---|---|---|
| `TICK_ENGINE` | Durable Object | `TickEngine` (namespace) |
| `DB` | D1 Database | `quan` (database) |
| `R2_BUCKET` | R2 Bucket | `quan-ticks` |

**Deploy via wrangler:**
```bash
wrangler pages deploy --project-name quan --binding TICK_ENGINE=tick-engine
```

### Step 5: Wire Tick Engine into Execution Worker

Update `workers/execution.js` to subscribe to Tick Engine:

```javascript
// workers/execution.js (excerpt)

export async function onRequest({ params, env, request }) {
  const { instrument } = params;
  
  // Get Tick Engine for this instrument
  const tickEngineId = env.TICK_ENGINE.idFromName(`${instrument}:live`);
  const tickEngine = env.TICK_ENGINE.get(tickEngineId);
  
  // Subscribe to live ticks
  const ws = await tickEngine.fetch(new Request('https://tick-engine/ws'));
  
  // Use WebSocket to receive real-time updates
  // Old: polls Yahoo every 5 seconds
  // New: receives tick every <50ms
}
```

### Step 6: Update Quote Endpoint

Already done in [[quote.js]] (see changes above). The endpoint now:
1. Tries Tick Engine first (if available + configured)
2. Falls back to Yahoo for non-Tradovate symbols
3. Includes source in response (`source: 'tradovate-tick-engine'` or `'yahoo'`)

**Test:**
```bash
curl "https://app.husrihtlaefan.org/api/quote?instrument=ESZ26" \
  -H "Authorization: Bearer $TOKEN"

# Response:
{
  "instrument": "ESZ26",
  "price": 5460.25,
  "bid": 5460.10,
  "ask": 5460.40,
  "bidSize": 150,
  "askSize": 200,
  "timestamp": 1689854400000,
  "source": "tradovate-tick-engine"
}
```

### Step 7: Empirical Validation (Research Checklist §7)

Run tests on demo account to validate assumptions from research doc.

**Checklist:**

- [ ] **Heartbeat interval:** Connect, measure time between `h` frames. Confirm ~2.5s.
  ```bash
  # Connect and log frames:
  wscat -c wss://md.tradovateapi.com/v1/websocket
  # Watch for 'h' every ~2.5s
  ```

- [ ] **DOM depth:** Subscribe to DOM on liquid contract (ES). Count levels.
  ```javascript
  // In Tick Engine, log DOM subscription
  subscribeDOM('ESZ26');  // Check response: how many levels?
  ```

- [ ] **Tick throughput on ES at open:** Count ticks/second at 9:30 AM ET.
  ```javascript
  // In Tick Engine, count ticks per second
  let ticksPerSec = 0;
  setInterval(() => {
    console.log(`Throughput: ${ticksPerSec} ticks/sec`);
    ticksPerSec = 0;
  }, 1000);
  ```

- [ ] **Rate-limit ceiling:** Send requests until 429 response. Note count before throttle.
  ```javascript
  // Test: send md/subscribeQuote 100 times rapidly
  // Measure: when does first 429 arrive?
  // Expected: ~5,000 req/hour = ~1.4 req/sec
  ```

- [ ] **p-time penalty:** Trigger penalty. Measure backoff duration.
  ```javascript
  // Check response.p_time when p_ticket present
  console.log(`Backoff required: ${p_time}s`);
  ```

- [ ] **Multiple contracts on one socket:** Subscribe to ES, ZN, GC on same socket.
  ```javascript
  await subscribeQuote('ESZ26');
  await subscribeQuote('ZNM26');
  await subscribeQuote('GCZ26');
  // Verify all three stream data without errors
  ```

- [ ] **Quote field completeness:** Check if `openInterest` + `settlement` present intraday.
  ```javascript
  // Log every quote:
  console.log(quote);
  // Check: is quote.openInterest defined? quote.settlement?
  ```

- [ ] **Archive persistence:** Flush 10K ticks to R2/D1. Verify queryable.
  ```bash
  # Check R2:
  wrangler r2 object get quan-ticks/instruments/ESZ26/2026-07-22/09.ndjson | head
  
  # Check D1:
  wrangler d1 execute quan --remote "SELECT * FROM ticks_index WHERE instrument='ESZ26'"
  ```

- [ ] **Latency:** Measure time from tick received → consumer event dispatched.
  ```javascript
  const recvTime = Date.now();
  tickEngine.ingestTick(tick);  // → emits to subscribers
  // Subscriber receives: (Date.now() - recvTime)
  // Target: <50ms
  ```

**Success criteria:** All 9 items pass ✅

### Step 8: Load Testing

**Goal:** Confirm performance under load.

Test ES (most liquid) during market open:

```javascript
// Measure over 5 minutes (9:30-9:35 AM ET)
const startTime = Date.now();
let tickCount = 0;
let outOfOrderCount = 0;
let sequenceBreaks = 0;

tickEngine.on('tick', (tick) => {
  tickCount++;
  if (tick.timestamp < lastTimestamp) outOfOrderCount++;
  if (tick.sequence !== lastSequence + 1) sequenceBreaks++;
  lastTimestamp = tick.timestamp;
  lastSequence = tick.sequence;
});

setTimeout(() => {
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`
    Ticks received: ${tickCount}
    Ticks/sec: ${(tickCount / elapsed).toFixed(1)}
    Out-of-order: ${outOfOrderCount} (${((outOfOrderCount / tickCount) * 100).toFixed(2)}%)
    Sequence breaks: ${sequenceBreaks}
  `);
}, 5 * 60 * 1000);
```

**Expected results (ES at open):**
- Ticks/sec: 50-150
- Out-of-order: <5%
- Sequence breaks: 0 (Tick Engine reorders)

---

## Phase 2: Production Deployment (Week 3)

### Prerequisites

Before proceeding to live, confirm:
- ✅ All 9 empirical validation items passed (Phase 1)
- ✅ Load testing passed (Phase 1)
- ✅ Archival to R2/D1 verified (Phase 1)
- ✅ Latency <50ms confirmed (Phase 1)

### Step 1: Provision Live Tradovate Account

**Eligibility check:**
- Already have Tradovate live account? (for paper trading)
- Or apply for new live account ($10-50 deposit + account setup)

**Credentials needed:**
- Live user ID
- `mdAccessToken` (production, not demo)
- CME sub-vendor approval (see Step 2)

### Step 2: Acquire CME Sub-Vendor License

**Cost:** $290–500/month (via Tradovate)

**Process:**
1. Contact Tradovate Partner Support
2. Request: "CME ILA (Index and Large Cap) real-time data for API access"
3. Provide: Company name, trading strategy, expected volume
4. Approval timeline: 2–5 business days
5. Bill monthly (added to Tradovate account)

**Verification:**
- Confirm live account can access real-time CME data via API
- Test with single request: `md/subscribeQuote?symbol=ESZ26`
- Should receive live bid/ask/last in <1s

### Step 3: Deploy to Production

```bash
# Deploy to production
wrangler deploy --config workers/wrangler-tick-engine.toml --env production

# Bind to Pages project
wrangler pages deploy --project-name quan --binding TICK_ENGINE=tick-engine-prod
```

### Step 4: Migrate Execution Engine to Live

**In `workers/execution.js`:**

```javascript
// Add config
const USE_TICK_ENGINE = env.ENVIRONMENT === 'production';

// In activation logic:
if (USE_TICK_ENGINE) {
  // Use Tick Engine (live Tradovate)
  const tickEngine = env.TICK_ENGINE.get(...);
  const livePrice = await tickEngine.getLatestTick();
} else {
  // Use Yahoo (fallback)
  const livePrice = await fetchYahooChart(...);
}
```

### Step 5: Enable Live Routes

**In `workers/execution.js`:**

```javascript
// Unlock live execution (was demo-clamped)
function userMayGoLive(user) {
  // Check if user has Desk tier + compliance approval
  if (user.tier !== 'desk') return false;
  if (!user.liveEnabled) return false;  // Requires manual approval
  return true;
}
```

**Manual step:** Operator must mark user as `liveEnabled` in D1:

```bash
wrangler d1 execute quan --remote \
  "UPDATE subscriptions SET liveEnabled = true WHERE user_id = '$USER_ID' AND tier = 'desk'"
```

---

## Monitoring & Operations

### Key Metrics to Track

| Metric | Target | Tool |
|--------|--------|------|
| Tick latency (recv → emit) | <50ms | Tick Engine logs |
| Tick throughput (ES at open) | 50-150 ticks/sec | Rate counter |
| Archive flush success rate | 99%+ | D1 query (`status='complete'`) |
| Out-of-order resequence rate | <5% | Tick Engine counter |
| Durable Object memory | <50MB | Cloudflare metrics |

### Logging

Tick Engine logs to Cloudflare Tail:

```bash
# Watch live logs
wrangler tail tick-engine-prod

# Expected output:
# [TradovateClient] Connected, authorizing...
# [TradovateClient] Authorized successfully
# [TickEngine] Archived 10045 ticks to instruments/ESZ26/2026-07-22/09.ndjson
```

### Alerting

Set up Cloudflare Analytics + External HTTP Requests to monitor:
- Tradovate socket disconnections (implies data gap)
- R2 write failures (archive loss)
- D1 query slowdown (index bloat)

---

## Rollback Plan

If Tick Engine fails in production:

1. **Immediate:** Flip `USE_TICK_ENGINE` to false in execution.js
   ```bash
   wrangler publish --env production
   ```
   Execution reverts to Yahoo Finance (slower, but functional)

2. **Data loss:** None. Ticks already archived to R2/D1 are permanent.

3. **Recovery:** Fix root cause (rate limit, socket issue, etc.) and re-deploy.

**Estimated recovery time:** <5 minutes

---

## Success Criteria (End of Phase 2)

- ✅ Live Tradovate socket connected + streaming ticks
- ✅ Execution Engine using live Tick Engine prices
- ✅ Operator can route live orders (post-compliance approval)
- ✅ Archive flushed to R2/D1 nightly (zero data loss)
- ✅ Monitoring + alerting operational
- ✅ Rollback procedure documented + tested

---

**Next:** Begin Phase 3 (Week 4+) with performance optimization + bar rollups.
