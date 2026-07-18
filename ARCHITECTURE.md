# Qu'an Engine — Internal Map & Hardening Audit

Produced for the *Production Hardening & Architectural Refinement* pass (spec §1:
audit before modifying). This is the engine's internal map: every layer, the data
flow between them, and the defects found during the audit with their dispositions.

## 1. Layers

### 1.1 Presentation (static Pages app, no build step)
- `index.html` landing · `app.html` terminal shell · `heatmap.html` Heat Map tab
  (standalone document, loaded in an iframe; the largest single module)
- `view.html` read-only client view · `timestate.html` ZN Timestate · `cboe.html` CBOE
- `js/` — one classic script per feature area, loaded `defer` in dependency order
  from `app.html` (pipeline-status → parsers → gates → warehouse → tabs → report).
  All cross-module wiring is via `window.__*` globals and `quan:*` CustomEvents.

### 1.2 Analytics (Pyodide, in-browser Python)
- `engine/heatmap/`, `engine/report/`, `engine/payload/`, `engine/compass/` — four
  **intentionally diverged** copies of the Python engine, one per consumer
  (README: do not merge). Each has a `manifest.json` with `MODULES`, an
  `ENGINE_HASH`, and a baked golden-reference self-test (`REF_B64` → `REF_EXPECTED`).
- Boot path (heatmap): `ensureEngine()` → CDN pyodide 0.26.2 → numpy+pandas →
  mount `/eng` from manifest → self-test → `quan_heatmap_bridge`.
- Known gotcha (fixed previously, keep honoring): Python `json.dumps` emits bare
  `NaN`/`Infinity`, which `JSON.parse` rejects — sanitize before dumping.

### 1.3 Data plane (Cloudflare)
- **Pages Functions** `functions/api/*`: Stripe (checkout/webhook/portal/
  subscription), auth-gated market data (`quote`, `history`), workspace state
  (`state` — Supabase + R2), brief archive (`archive`), publishing (`publish`,
  `view`, `client-tokens`), Drive-ingest read path (`ingest-list`, `ingest-file`),
  auto-pull control (`autopull`), admin.
- **Standalone Workers** (`workers/`): `ingest-worker` (cron: Google Drive →
  classify → R2 + D1 index), `barchart-fetch` (cloud auto-download),
  `realtime` (Durable Objects fan-out), `cron-warm` (KV price-history pre-warm),
  `execution` (Tradovate), `yahoo-proxy` (superseded, kept for reference).
- **Stores**: R2 `QUAN_INGEST_BUCKET` (keys `INST/EXP/SESSION_DATE/dataType.csv`),
  D1 `ingest_files` (the warehouse index), KV (price cache), Supabase (auth/state).

### 1.4 Client warehouse (`js/warehouse.js`)
`STORE[inst].sess[date]` cells: `{anchor, locked, active, exp:{Daily|EOM:{chain,
greeks,…}}}`, persisted as meta + blob keys through `window.storage` →
localStorage → memory. Feeds every tab (`__polarLoadChain`/`__strikeLoadChain`/
`__compassLoadChain`) and the heatmap iframe via `postMessage` (`quanFeed`).
Auto-load: on date/instrument selection, queries `/api/ingest-list` and pulls
`/api/ingest-file` when the cell is empty.

## 2. Data lifecycle

```
Drive (operator uploads Barchart CSVs, one subfolder per instrument)
  → ingest-worker (cron 15m): classifyName → sessionDateFor → R2 put + D1 index
  → /api/ingest-list (D1) + /api/ingest-file (R2)        [operator-gated]
  → warehouse.js autoLoadFromIngest → __qLoadChain/__qLoadGreeks
  → tabs (SOP/Strike/Compass) + heatmap iframe (quanFeed postMessage)
  → Pyodide engines (brief, heatmap bridge, payload)
  → Report tab brief → /api/archive (durable history) → publish → view.html
```
Parallel inputs: manual CSV upload (header hub), Barchart auto-pull worker
(`/api/autopull` + `auto-pull.js`).

## 3. Defects found (audit → disposition)

| # | Defect | Where | Disposition |
|---|--------|-------|-------------|
| D1 | Instrument symbol knowledge duplicated in ≥6 places (ingest-worker `ROOT_MAP`, detector `INSTRUMENT_GROUPS`, heatmap `INSTR` mult table, adapter `FAMILY` regexes, auto-pull `frontSymbol`, heatmap `instFromName`) — drifts independently; currencies/metals fall through gaps | workers + js | **Fixed**: single registry `js/instrument-registry.js`, all consumers derive from it |
| D2 | `frontSymbol()` regex `^([a-z]{2}[a-z]?\d{2})` only matches all-letter roots — FX filenames (`e6u26…`) never match, so auto-pull builds wrong contract names for every currency | `js/auto-pull.js` | **Fixed** via registry contract parsing |
| D3 | Rule 1 session date = download date **+1 calendar day** — Friday chains index under Saturday, so the terminal (which asks for trading days) never finds them: "historical datasets missing" for Mondays | `workers/ingest-worker.js` | **Fixed**: weekend-skip on write; read path also accepts legacy weekend-dated rows |
| D4 | `WH_KEY` ReferenceError in the hydrate purge — swallowed by `catch`, so the legacy-warehouse purge silently never ran | `js/warehouse.js` | **Fixed** |
| D5 | Auto-load path is fully silent: list failures return `{files:[]}` (indistinguishable from "no data"), every stage wrapped in `catch(_){}` — violates "no stage may silently fail" | `js/warehouse.js` | **Fixed**: staged `__qPipe` reporting (list/match/fetch/load) with instrument/session context |
| D6 | `_ingestCache[inst]` never invalidated — files ingested by the cron mid-session never appear until reload | `js/warehouse.js` | **Fixed**: TTL |
| D7 | `fetchDayRange` latches its dedupe key *before* fetching — a failed fetch permanently blocks retry for that (inst,date) | `heatmap.html` | **Fixed**: latch on success only |
| D8 | Ingest worker stores whatever Drive returns — no CSV validation before R2 put; a truncated/HTML error body poisons the warehouse | `workers/ingest-worker.js` | **Fixed**: validation stage; invalid rows indexed with `status='invalid'` + reason |
| D9 | `instFromName` in heatmap assumes alpha-only roots and `2\d` years — flags FX terminal feeds as mismatched | `heatmap.html` | **Fixed** via registry parse |
| D10 | Adapter data-heuristic misclassifies: gold (integer strikes ≥1000) → INDEX, copper (2-dec strikes ~5) → OTHER | `js/instrument-adapter.js` | Name/selection remain primary (doctrine unchanged); family roots now come from the registry so name detection covers energy/ags too |
| D11 | Three separate localStorage KV shims (warehouse, detector, …) with identical fallback logic | js/ | Left in place this pass (behavior-preserving); candidate for a shared util later |
| D12 | `Quan Terminal Baseline.backup-*.html` — ~35 MB of dead backups in the repo | root | Flagged; operator's call to delete (git history retains them) |

## 4. Invariants to preserve
- Analytical doctrine, normalized time systems, and outputs are frozen; the four
  `engine/` copies stay diverged.
- `heatmap.html` always runs inside an iframe (auth comes from the parent).
- Every `__qPipe` call-site guards with `window.__qPipe &&` — observability must
  never become a hard dependency.
- Classification rules (Rule 1/Rule 2) live in the ingest worker; the client
  never re-derives session dates from filenames when index metadata exists.
