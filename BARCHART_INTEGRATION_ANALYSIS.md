# Barchart Integration Analysis — CSV Fetcher Design

**Date:** 2026-07-23  
**Goal:** Build a seamless CSV fetcher that can pull any Barchart CSV and plug into the terminal  
**Status:** Analysis complete, ready for implementation

## Page Structure Findings

### URL Pattern
```
https://www.barchart.com/futures/quotes/{SYMBOL}/options/{EXPIRATION}
  ?moneyness=allRows
  &futuresOptionsView=split
  &futuresOptionsTime=intraday
```

**Example:** `https://www.barchart.com/futures/quotes/ZNU26/options/aug-26`

**Key Parameters:**
- `{SYMBOL}` — Futures contract symbol (ZNU26 = 10-Year T-Note Sep '26)
- `{EXPIRATION}` — Option expiration month (aug-26, sep-26, etc.)
- `moneyness` — Filter: allRows (no filter), ITM, OTM, etc.
- `futuresOptionsView` — split, calls, puts
- `futuresOptionsTime` — intraday (live), eod (end-of-day), etc.

### Page Architecture

**Framework:** AngularJS (ng-controller, ng-show, ng-repeat directives)

**Key Elements:**
1. **Header:** Logo, search, user auth (Barchart Premier login)
2. **Navigation:** Symbols, categories, watchlist, alerts
3. **Main Content:** Dynamic table(s) powered by AngularJS controllers
4. **Scripts:** 
   - Global app bundle: `app-Y3QN5GH3.js` (~3.2MB)
   - AngularJS core: `angular-MIP5O43L.js` (~333KB)
   - Configuration: `config.js` (~232KB)
   - Analytics & tracking
   - Ad services (DoubleClick, Criteo, etc.)

**Data Flow:**
```
Browser Request (URL)
    ↓
AngularJS bootstraps app
    ↓
API call to Barchart backend (likely /api/options/quotes)
    ↓
JSON response with option chain data
    ↓
ng-repeat renders rows in table
    ↓
Browser displays options grid
    ↓
CSV export button → downloads CSV
```

### Option Data Structure (Inferred)

From the URL parameters and page analysis, each option row likely contains:

**Call & Put Sides (symmetric):**
```json
{
  "strike": 130.5,
  
  "call": {
    "symbol": "ZNU26C130.5",
    "bid": 1.25,
    "ask": 1.30,
    "last": 1.27,
    "bid_size": 50,
    "ask_size": 75,
    "open_interest": 1240,
    "volume": 185,
    "iv": 12.5,
    "delta": 0.65,
    "gamma": 0.008,
    "vega": 0.12,
    "theta": -0.04,
    "rho": 0.02
  },
  
  "put": {
    "symbol": "ZNU26P130.5",
    "bid": 0.55,
    "ask": 0.60,
    "last": 0.57,
    "bid_size": 100,
    "ask_size": 120,
    "open_interest": 890,
    "volume": 245,
    "iv": 12.3,
    "delta": -0.35,
    "gamma": 0.008,
    "vega": 0.11,
    "theta": -0.02,
    "rho": -0.01
  }
}
```

## CSV Export Method Options

### Option 1: Direct API Call (Recommended)
**Approach:** Reverse-engineer the API endpoint that Barchart's frontend uses

**Pros:**
- No parsing of HTML/JS required
- Direct JSON → CSV conversion
- Fast and reliable
- Programmatic, no browser automation needed

**Cons:**
- API endpoint may be undocumented or rate-limited
- May require authentication/headers
- Fragile if API changes

**Implementation:**
```javascript
// Intercept network requests to find API endpoint
// Likely pattern: 
// GET https://www.barchart.com/api/quotes/options/futures/{symbol}/{expiration}
// or
// GET https://www.barchart.com/v1/futures/{symbol}/options/{expiration}

async function fetchBarchartOptionsCSV(symbol, expiration) {
  const apiUrl = `https://www.barchart.com/api/quotes/options/futures/${symbol}/${expiration}`;
  
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0...',
      'Accept': 'application/json',
      // May need auth tokens or session cookies
    }
  });
  
  const data = await response.json();
  return convertToCSV(data);
}
```

### Option 2: Playwright/Puppeteer Scraping
**Approach:** Automate Chrome browser, load page, extract table data

**Pros:**
- Handles JavaScript rendering
- Can interact with filters/parameters
- Works even if API is undocumented

**Cons:**
- Slow (5-15 seconds per page)
- Requires Chrome/Chromium
- Fragile to HTML structure changes
- Heavy resource consumption

**Implementation:**
```javascript
async function fetchBarchartViaPlaywright(symbol, expiration) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const url = `https://www.barchart.com/futures/quotes/${symbol}/options/${expiration}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  
  // Extract table data via AngularJS scope or DOM parsing
  const data = await page.evaluate(() => {
    return document.querySelectorAll('table tbody tr').map(row => ({
      strike: row.cells[0].textContent,
      callBid: row.cells[1].textContent,
      callAsk: row.cells[2].textContent,
      // ...more cells
    }));
  });
  
  await browser.close();
  return convertToCSV(data);
}
```

### Option 3: Manual CSV Download + Upload
**Approach:** User downloads CSV from Barchart, uploads to terminal

**Pros:**
- No scraping/API calls needed
- User controls data freshness
- No authentication issues

**Cons:**
- Manual, not seamless
- Requires user to navigate Barchart site
- Not automated

## Recommended Approach: API Reverse-Engineering

### Step 1: Identify API Endpoint
From the saved HTML, I'll analyze network calls to find the API endpoint. Expected patterns:

**Hypothesis 1:** RESTful pattern
```
GET /api/quotes/options/futures/{symbol}/{expiration}
GET /api/v1/futures/{symbol}/options
GET /api/data/options/{symbol}
```

**Hypothesis 2:** GraphQL
```
POST /graphql
Body: { query: "{ optionsChain(symbol: \"ZNU26\", expiration: \"aug-26\") { ... } }" }
```

**Investigation:**
1. Open Barchart options page in Chrome DevTools (Network tab)
2. Filter for XHR/Fetch requests
3. Find the one returning option chain JSON
4. Note the URL, headers, cookies, parameters

### Step 2: Required Headers
Likely required:
```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Accept: application/json
Accept-Encoding: gzip, deflate, br
Referer: https://www.barchart.com/futures/quotes/{symbol}/options/{expiration}
Cookie: sessionid=..., tracking=...
X-Requested-With: XMLHttpRequest  (if needed)
```

### Step 3: Authentication
Barchart likely uses:
- Session cookies (persistent across requests)
- JWT tokens in headers
- Or public/guest access (likely for limited data)

**Check:** Can you access the page without login? If yes, the options data is public.

### Step 4: CSV Generation
Once JSON is retrieved, convert to CSV:

```javascript
function convertOptionsToCSV(jsonData) {
  const headers = [
    'Strike', 'CallSymbol', 'CallBid', 'CallAsk', 'CallLast', 
    'CallVolume', 'CallOI', 'CallIV', 'CallDelta', 'CallGamma', 
    'CallVega', 'CallTheta', 'CallRho',
    'PutSymbol', 'PutBid', 'PutAsk', 'PutLast',
    'PutVolume', 'PutOI', 'PutIV', 'PutDelta', 'PutGamma',
    'PutVega', 'PutTheta', 'PutRho'
  ];
  
  const rows = jsonData.options.map(opt => [
    opt.strike,
    opt.call.symbol, opt.call.bid, opt.call.ask, opt.call.last,
    opt.call.volume, opt.call.openInterest, opt.call.iv, opt.call.delta, opt.call.gamma,
    opt.call.vega, opt.call.theta, opt.call.rho,
    opt.put.symbol, opt.put.bid, opt.put.ask, opt.put.last,
    opt.put.volume, opt.put.openInterest, opt.put.iv, opt.put.delta, opt.put.gamma,
    opt.put.vega, opt.put.theta, opt.put.rho
  ]);
  
  return [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');
}
```

## Integration with Qu'an Terminal

### Module: `js/barchart-fetcher.js` (300+ lines)

**Public API:**
```javascript
window.__barchartFetcher = {
  /**
   * Fetch options chain from Barchart
   * @param {string} symbol - Futures contract (e.g., "ZNU26")
   * @param {string} expiration - Option expiration (e.g., "aug-26")
   * @param {object} options - Filters (moneyness, view, etc.)
   * @returns {Promise<Array>} Array of option rows
   */
  fetchOptionsChain: async (symbol, expiration, options = {}) => { },
  
  /**
   * Fetch as CSV string
   * @returns {Promise<string>} CSV formatted data
   */
  fetchOptionsCSV: async (symbol, expiration, options = {}) => { },
  
  /**
   * Download CSV file directly
   * @returns {Promise<void>}
   */
  downloadOptionsCSV: async (symbol, expiration, options = {}) => { },
  
  /**
   * Get available expirations for a symbol
   * @returns {Promise<Array<string>>}
   */
  getAvailableExpirations: async (symbol) => { },
  
  /**
   * Validate symbol and expiration
   * @returns {Promise<boolean>}
   */
  validateSymbol: async (symbol) => { }
};
```

### UI Component: Barchart Import Panel

**In app.html:**
```html
<div id="barchartImportPanel" class="import-panel">
  <div class="panel-header">
    <h3>📊 Barchart Options Importer</h3>
  </div>
  
  <div class="input-row">
    <label>Symbol:</label>
    <input id="barchartSymbol" type="text" placeholder="ZNU26">
  </div>
  
  <div class="input-row">
    <label>Expiration:</label>
    <select id="barchartExpiration">
      <option value="">Loading...</option>
    </select>
  </div>
  
  <div class="filter-row">
    <label>View:</label>
    <select id="barchartView">
      <option value="split">Split (Calls & Puts)</option>
      <option value="calls">Calls Only</option>
      <option value="puts">Puts Only</option>
    </select>
  </div>
  
  <div class="button-row">
    <button onclick="window.__barchartFetcher.downloadOptionsCSV(...)">
      Download CSV
    </button>
    <button onclick="window.__barchartFetcher.importToTerminal(...)">
      Import to Terminal
    </button>
  </div>
  
  <div class="status-log" id="barchartStatus"></div>
</div>
```

### Workflow: Symbol → Expiration → CSV → Upload → Chain Data → Analysis

```
User enters symbol (ZNU26)
    ↓
fetchExpirations(ZNU26) → [aug-26, sep-26, oct-26, ...]
    ↓
User selects expiration (aug-26)
    ↓
fetchOptionsChain(ZNU26, aug-26) → JSON data
    ↓
convertToCSV(data) → CSV string
    ↓
Save to D1 (csv_session_store) via existing upload mechanism
    ↓
Doctrine/Price tab reads CSV, creates chain data structure
    ↓
Golden-ref calculation, Greeks, heatmap, all existing flows continue
```

## Data Freshness Strategy

### Real-Time Updates (Intraday)
- API call interval: 5-10 seconds (match Barchart's update frequency)
- Cache latest in `window.__barchartCache`
- Dedupe: only refresh if symbol/expiration changed

### End-of-Day
- Single call after market close
- Store in D1 for backtesting/analysis
- Preserve timestamp for audit trail

### Rate Limiting
- Max 1 request per symbol per 5 seconds
- Batch multiple symbols if possible
- Respect Barchart's terms (may require paid account for high volume)

## Error Handling

**Connection Errors:**
- Retry with exponential backoff (3 attempts, 1s → 2s → 4s)
- Fall back to cached data if available
- Display: "Data may be stale (last updated 2 mins ago)"

**Invalid Symbol:**
- Return empty array, user sees "Symbol not found"
- Suggest similar symbols via autocomplete

**API Rate Limit:**
- Queue requests, process sequentially
- Show: "Processing queue (3 pending)..."

**Parse Errors:**
- Log raw response for debugging
- Return partial data if available (skip bad rows)

## Implementation Roadmap

### Phase 1: API Discovery (2 hours)
- [ ] Open Barchart page in DevTools
- [ ] Identify API endpoint URL
- [ ] Test endpoint directly (curl, Postman)
- [ ] Document response schema
- [ ] Check authentication requirements

### Phase 2: Core Fetcher (4 hours)
- [ ] Implement `js/barchart-fetcher.js`
- [ ] HTTP client with error handling
- [ ] CSV conversion function
- [ ] Cache layer
- [ ] Basic tests (mock API responses)

### Phase 3: UI Integration (3 hours)
- [ ] Add import panel to app.html
- [ ] Wire symbol lookup + expiration dropdown
- [ ] Download button → triggers `downloadOptionsCSV()`
- [ ] Status display (loading, errors, success)

### Phase 4: Terminal Integration (2 hours)
- [ ] Hook CSV upload to existing `csv-session-manager.js`
- [ ] Parse CSV as option chain data
- [ ] Populate golden-ref fields
- [ ] Test Greeks calculation, heatmap rendering

### Phase 5: Testing & Refinement (2 hours)
- [ ] Test with 5+ different symbols
- [ ] Test expiration filtering
- [ ] Test offline fallback (cached data)
- [ ] Performance: <2s per chain download
- [ ] Verify CSV matches Barchart web display

**Total Effort:** ~13 hours (2-3 days)

## Known Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| API endpoint changes | High | Monitor Barchart updates, maintain version history, fallback to Playwright |
| Rate limiting | Medium | Implement queue + backoff, respect free tier limits |
| Authentication required | Medium | Try public endpoints first, implement OAuth if needed |
| Data format variations | Low | Defensive parsing, log anomalies, test across expiration dates |
| Barchart terms of service | High | Use data only for personal trading, don't resell, respect rate limits |

## Success Criteria

- ✓ Fetch any Barchart options chain in <2 seconds
- ✓ CSV format matches Barchart's export exactly
- ✓ Seamless integration with terminal's existing CSV upload
- ✓ Real-time updates (intraday, <10s latency)
- ✓ Handles errors gracefully (no crashes, fallback to cache)
- ✓ Supports all futures symbols (ZNU26, ZBU26, CL, etc.)
- ✓ Works offline with cached data

## Next Steps

1. **Research API Endpoint:** Open Barchart options page, inspect network tab, find JSON endpoint
2. **Test Endpoint:** Use curl/Postman to verify format and authentication
3. **Design CSV Schema:** Define exact column order and data types
4. **Implement Fetcher:** Build `js/barchart-fetcher.js` module
5. **Integrate UI:** Add import panel to app.html
6. **Test End-to-End:** Verify full workflow (symbol → CSV → chain → Greeks)
7. **Document API:** Save discovered endpoint, headers, rate limits for future reference

## Files to Create

- `js/barchart-fetcher.js` — Core fetching + CSV conversion
- `js/barchart-ui-integration.js` — UI panel + event handlers
- `BARCHART_API_REFERENCE.md` — Endpoint specs (after discovery)

## Questions for Clarification

1. **Do you want to support live intraday updates?** (requires frequent API polling)
2. **Should the CSV auto-import or wait for user confirmation?** (safety vs. convenience)
3. **Which futures symbols are priority?** (ZB, ZN, CL, etc. — focus development there first)
4. **Is Barchart Premier access available?** (may unlock higher-quality data / lower rate limits)
