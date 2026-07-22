# Tick Engine Launch Checklist (Week 2)

## What's Ready to Deploy

✅ **Architecture designed** (tick-engine-design.md)
✅ **Durable Object code** (workers/tick-engine.js)
✅ **WebSocket client** (workers/tradovate-client.js)
✅ **API endpoint updated** (functions/api/quote.js)
✅ **Deployment config** (workers/wrangler-tick-engine.toml)
✅ **D1 schema** (database/migrations/0043_ticks_index.sql)
✅ **Implementation guide** (tick-engine-implementation.md)
✅ **Empirical validation checklist** (9-point verification plan)

---

## Phase 1: Demo Account Validation (Week 2, 14 Days Free)

### Prerequisites (Your Action)

- [ ] **Create Tradovate demo account**
  - Go to: https://tradovate.com/sign-up
  - Sign up with email, password
  - Verify email
  - Request: Partner API → Demo Account → Real-time Market Data
  - Save: `mdAccessToken` (you'll need this)
  - Timeline: ~15 minutes

- [ ] **Prepare Cloudflare environment**
  - D1 database: `quan` (should already exist)
  - R2 bucket: `quan-ticks` (create if missing)
  - KV namespace: `tick-cache-kv` (optional, for performance)

### Deploy Steps (My Action — via Bash/CLI)

```bash
# 1. Deploy Tick Engine Durable Object to staging
wrangler deploy --config workers/wrangler-tick-engine.toml --env staging

# 2. Initialize D1 schema
wrangler d1 execute quan --remote --file database/migrations/0043_ticks_index.sql

# 3. Bind Tick Engine to Pages project
wrangler pages deployment create --project-name quan --binding TICK_ENGINE=tick-engine-staging

# 4. Deploy updated quote.js to Pages
wrangler pages deploy --project-name quan
```

### Validation Steps (Week 2, 3-4 Days)

Run the 9-point empirical validation checklist from `tick-engine-implementation.md`:

1. **Heartbeat interval** — Confirm Tradovate sends `h` every ~2.5s
2. **DOM depth** — Subscribe to ES, count order-book levels
3. **Tick throughput** — Measure ticks/sec during market open (target: 50-150)
4. **Rate-limit ceiling** — Find 429 threshold (target: ~5,000 req/hour)
5. **p-time penalty** — Trigger penalty ticket, measure backoff
6. **Multiple contracts** — Subscribe ES, ZN, GC on same socket
7. **Quote fields** — Verify `openInterest` + `settlement` present intraday
8. **Archive persistence** — Flush 10K ticks, verify R2 + D1 queryable
9. **Latency measurement** — Tick received → consumer event <50ms

**Expected results:**
- ✅ All 9 items pass
- ✅ Out-of-order resequence rate <5%
- ✅ Latency <50ms
- ✅ Archive flushing to R2/D1 with zero data loss

**Success:** Move to Phase 2

---

## Phase 2: Production Deployment (Week 3, Cost: $315-525/mo)

### Prerequisites (Your Action)

- [ ] **Provision live Tradovate account** (paper trading minimum)
  - Existing account? Upgrade to live.
  - New account? $10-50 deposit + setup (~2-3 days)

- [ ] **Acquire CME sub-vendor license** ($290-500/mo)
  - Contact Tradovate Partner Support
  - Request: "CME ILA real-time data for API access"
  - Timeline: 2-5 business days
  - Cost: Billed monthly to Tradovate account

- [ ] **Save live credentials**
  - Live user ID
  - `mdAccessToken` (production)

### Deploy Steps (Week 3, Once Prerequisites Met)

```bash
# 1. Deploy to production
wrangler deploy --config workers/wrangler-tick-engine.toml --env production

# 2. Bind to production Pages project
wrangler pages deployment create --project-name quan --binding TICK_ENGINE=tick-engine-prod

# 3. Enable live routes in Execution Worker
# (update workers/execution.js: USE_TICK_ENGINE = true for production)

# 4. Mark user as live-enabled (post-compliance)
wrangler d1 execute quan --remote \
  "UPDATE subscriptions SET liveEnabled = true WHERE user_id = '\$USER_ID' AND tier = 'desk'"
```

**Success:** Execution Engine now uses live Tick Engine prices; orders route through Tradovate.

---

## Phase 3: Optimization (Week 4+)

- [ ] Bar rollups (aggregate ticks → OHLC)
- [ ] Replay API performance tuning
- [ ] D1 index optimization (for millions of rows)
- [ ] Durable Object memory profiling
- [ ] Extended monitoring dashboard

---

## Risk & Rollback

**If Tick Engine fails in production:**

```bash
# Immediate: revert to Yahoo Finance (Execution Engine fallback)
wrangler pages deploy --project-name quan  # Re-publish quote.js with fallback

# Recovery time: <5 minutes
# Data loss: None (ticks already archived to R2/D1)
```

---

## Current Status

| Component | Status | Location |
|-----------|--------|----------|
| Tick Engine Durable Object | ✅ Coded | `workers/tick-engine.js` |
| Tradovate WebSocket Client | ✅ Coded | `workers/tradovate-client.js` |
| Quote Endpoint | ✅ Updated | `functions/api/quote.js` |
| Deployment Config | ✅ Ready | `workers/wrangler-tick-engine.toml` |
| D1 Schema | ✅ Ready | `database/migrations/0043_ticks_index.sql` |
| Design Doc | ✅ Complete | `wiki/data-plane/tick-engine-design.md` |
| Impl Guide | ✅ Complete | `wiki/data-plane/tick-engine-implementation.md` |

**Ready to execute Phase 1 upon Tradovate demo account creation.**

---

## Files Modified/Created This Session

**New Code:**
- `workers/tick-engine.js` — Durable Object (315 lines)
- `workers/tradovate-client.js` — WebSocket client (290 lines)
- `functions/api/quote.js` — Updated quote endpoint (40 lines added)
- `workers/wrangler-tick-engine.toml` — Deployment config (40 lines)
- `database/migrations/0043_ticks_index.sql` — D1 schema (80 lines)

**New Docs:**
- `wiki/data-plane/tick-engine-design.md` — Architecture + state model (600 lines)
- `wiki/data-plane/tick-engine-implementation.md` — Deployment guide (400 lines)
- `TICK_ENGINE_LAUNCH.md` — This checklist

**Updated Docs:**
- `wiki/WIKI_PROMOTION_STATUS.md` — Updated with Tick Engine status

---

## Next Action (Your Call)

Choose one:

**A) Execute Phase 1 immediately**
- [ ] Create Tradovate demo account now
- [ ] I'll deploy to staging + run validation checklist

**B) Defer Phase 1, move to GO_LIVE runbook prep**
- [ ] Skip Tick Engine for now
- [ ] Prepare production launch (Supabase/Stripe/Cloudflare config)
- [ ] Both can run in parallel (Week 2 + Week 3)

**C) Something else**
- Specify and I'll adjust

---

**Current date: 2026-07-22**  
**Tradovate trial window:** 14 days from account creation  
**CME license timeline:** 2-5 business days from request  
**12-week roadmap status:** Week 2 foundation 100% ready
