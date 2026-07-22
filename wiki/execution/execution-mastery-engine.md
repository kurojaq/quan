---
type: Engine Framework
title: Execution Mastery Engine (Learning Loop v1)
description: Closed-loop learning system for trading execution performance; integrates with morphology classifier, Greeks compute, and terminal feedback
tags: [execution, learning-loop, performance-science, tradovate, brier-scoring]
citations:
  - [[version-1-1-science-framework]] (morphology, performance science)
  - [[rolling-analysis-engine]] (term structure analysis)
  - [[learning-loop]] (learning loop design)
  - Execution Mastery/Performance.csv (trade record structure)
---

# Execution Mastery Engine (Learning Loop v1)

**Purpose:** Closed-loop learning from **real trades** (Tradovate execution records) to improve terminal execution strategy.

**Data Source:** Tradovate performance export (CSV) → D1 ingest → Learning Loop → Prediction accuracy feedback

**Timeline:** Week 7 of 12-week roadmap (after Greeks API, morphology, Tick Engine validated)

---

## 1. Performance.csv Structure Analysis

### Current Data (Single Trade Record)

```
symbol,_priceFormat,_priceFormatType,_tickSize,
buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,
boughtTimestamp,soldTimestamp,duration

NQU6,-2,0,0.25,
587520790663,587520790645,20,
29026.75,29337.25,"$124,200.00",
07/22/2026 08:48:01,07/21/2026 14:19:06,
18h 28min 55sec
```

### Extracted Fields

| Field | Type | Purpose |
|-------|------|---------|
| **symbol** | string | Instrument identifier |
| **_tickSize** | float | Min price movement (0.25 = quarter) |
| **qty** | int | Position size |
| **buyPrice** | float | Entry price |
| **sellPrice** | float | Exit price |
| **pnl** | float | Realized P&L ($124,200 = 20 × 311 ticks × $0.25/tick) |
| **boughtTimestamp** | datetime | Entry time |
| **soldTimestamp** | datetime | Exit time |
| **duration** | duration | Hold time (18h 28m 55s) |
| **buyFillId** / **sellFillId** | string | Tradovate order IDs (for audit trail) |

### Calculated Fields (Enriched)

```typescript
// From raw data
const profitTicks = (sellPrice - buyPrice) / tickSize;        // 311 ticks
const profitPerTick = profitTicks * qty;                       // 6,220 ticks
const profitPerShare = sellPrice - buyPrice;                   // $311/contract

// Time-based
const holdMinutes = (soldTimestamp - boughtTimestamp) / 60;   // ~1108 minutes
const holdHours = holdMinutes / 60;                            // ~18.5 hours
const profitPerHour = pnl / holdHours;                         // $6,721/hour

// Statistical
const returnOnRisk = pnl / (buyPrice * qty);                   // ROI %
const maxDrawdownPotential = buyPrice * qty * 0.02;            // 2% stop-loss
const riskRewardRatio = pnl / maxDrawdownPotential;            // 40:1 (very good)
```

---

## 2. Execution Mastery Engine Architecture

### Overview

```
┌──────────────────────────────────────┐
│  Tradovate API (Live Execution)      │
│  ↓ Order fills, executions           │
├──────────────────────────────────────┤
│  Execution Recorder (JSON)           │
│  - Capture: entry, exit, P&L         │
│  - Enrich: Greeks, morphology, IV    │
│  - Store: D1 (execution_ledger)      │
├──────────────────────────────────────┤
│  Performance Analyzer                │
│  - Aggregate trades (daily, weekly)  │
│  - Calculate metrics (ROI, Sharpe)   │
│  - Time-series P&L decomposition     │
├──────────────────────────────────────┤
│  Morphology Correlator               │
│  - Match trade entry → market morph  │
│  - Calculate win % by morphology     │
│  - Brier score (predicted vs actual) │
├──────────────────────────────────────┤
│  Learning Loop                       │
│  - Feedback signal (win/loss)        │
│  - Update model (morphology weights) │
│  - A/B test hypothesis strategies    │
├──────────────────────────────────────┤
│  Terminal Dashboard                  │
│  - Live P&L curve                    │
│  - Win % by morphology               │
│  - Greeks heatmap (entry selection)  │
│  - Feedback to next trade            │
└──────────────────────────────────────┘
```

---

## 3. Data Model (D1 Schema)

### Table: execution_ledger

```sql
CREATE TABLE execution_ledger (
  -- Identifiers
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tradeId TEXT UNIQUE NOT NULL,      -- guid
  userId TEXT NOT NULL,               -- subscription.user_id
  
  -- Trade Details
  symbol TEXT NOT NULL,               -- 'ESZ26', 'NQU6', etc.
  tickSize REAL NOT NULL,             -- 0.25, 0.01, etc.
  qty INTEGER NOT NULL,               -- position size
  
  -- Entry
  buyTimestamp TIMESTAMP NOT NULL,    -- when bought
  buyPrice REAL NOT NULL,             -- entry price
  buyGreeks JSON,                     -- {delta, gamma, vega, theta} @ entry
  buyMorphology TEXT,                 -- 'impulse', 'accumulation', etc.
  buyIV REAL,                         -- IV at entry
  
  -- Exit
  sellTimestamp TIMESTAMP,            -- when sold (nullable: still open)
  sellPrice REAL,                     -- exit price (nullable)
  sellGreeks JSON,                    -- Greeks @ exit
  
  -- P&L
  pnl REAL,                           -- realized P&L (dollars)
  profitTicks INTEGER,                -- (sellPrice - buyPrice) / tickSize
  holdMinutes INTEGER,                -- duration in minutes
  
  -- Performance Metrics
  roi REAL,                           -- ROI % (pnl / notional)
  sharpeRatio REAL,                   -- risk-adjusted return
  maxDD REAL,                         -- max intraday drawdown
  
  -- Feedback (Learning Loop)
  prediction REAL,                    -- model predicted win% (0-1)
  outcome INTEGER,                    -- 1 = win, 0 = loss
  brierScore REAL,                    -- (prediction - outcome)^2
  
  -- Audit
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_execution_user_symbol ON execution_ledger(userId, symbol);
CREATE INDEX idx_execution_timestamp ON execution_ledger(buyTimestamp DESC);
CREATE INDEX idx_execution_morphology ON execution_ledger(buyMorphology);
```

### Table: morphology_performance

```sql
CREATE TABLE morphology_performance (
  -- Grouping
  morphology TEXT NOT NULL,           -- 'impulse', 'accumulation', 'exhaustion', 'meanreversion'
  symbol TEXT NOT NULL,               -- 'ESZ26', 'NQU6', etc.
  dateTraded DATE NOT NULL,           -- trading date
  
  -- Metrics
  tradeCount INTEGER,                 -- # trades in this morphology
  winCount INTEGER,                   -- # winning trades
  lossCount INTEGER,                  -- # losing trades
  
  avgPnl REAL,                        -- average P&L per trade
  totalPnl REAL,                      -- sum P&L
  winRate REAL,                       -- winCount / tradeCount (0-1)
  
  avgHoldMinutes REAL,                -- average hold time
  profitFactor REAL,                  -- sum(wins) / sum(losses)
  
  -- Sharpe-like metric
  stdDevPnl REAL,                     -- volatility of trades
  sharpeRatio REAL,                   -- (avgPnl - riskFreeRate) / stdDevPnl
  
  -- Brier Score (forecast skill)
  avgPrediction REAL,                 -- average model prediction (0-1)
  brierScore REAL,                    -- mean((prediction - outcome)^2)
  
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_morph_perf_composite ON morphology_performance(morphology, symbol, dateTraded DESC);
```

### Table: learning_loop_feedback

```sql
CREATE TABLE learning_loop_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Trade Reference
  tradeId TEXT NOT NULL UNIQUE,
  userId TEXT NOT NULL,
  
  -- Model Prediction
  predictedWinPct REAL,               -- model's forecast (0-1)
  predictedHoldMinutes INTEGER,       -- model's forecast on duration
  predictedGreeksDelta REAL,          -- model suggested delta exposure
  
  -- Actual Outcome
  actualWinLoss INTEGER,              -- 1 = win, 0 = loss
  actualHoldMinutes INTEGER,          -- actual hold time
  actualGreeksDelta REAL,             -- actual Greeks at exit
  
  -- Scoring
  brierScore REAL,                    -- (predicted - actual)^2
  calibrationError REAL,              -- prediction error magnitude
  
  -- Feedback Signal (for model retraining)
  feedbackTimestamp TIMESTAMP,        -- when feedback recorded
  modelVersion TEXT,                  -- which model version
  hypothesis TEXT,                    -- A/B test hypothesis (if applicable)
  
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_feedback_user ON learning_loop_feedback(userId, feedbackTimestamp DESC);
CREATE INDEX idx_feedback_model ON learning_loop_feedback(modelVersion);
```

---

## 4. Learning Loop Integration

### Data Flow

```
Tradovate Execution (order fill)
  ↓ {symbol, qty, buyPrice, buyTimestamp, fillId}
  ↓
[1. Entry Capture]
  - Record in execution_ledger (buyPrice, buyTimestamp)
  - Query Greeks API (Greeks @ entry time)
  - Query Morphology Classifier (market morphology @ entry)
  - Store: buyGreeks, buyMorphology, buyIV
  ↓
[Waiting for exit...]
  ↓
Tradovate Exit (order fill)
  ↓ {symbol, qty, sellPrice, sellTimestamp, fillId}
  ↓
[2. Exit Capture + Enrichment]
  - Record in execution_ledger (sellPrice, sellTimestamp)
  - Calculate P&L, ROI, hold time
  - Query Greeks @ exit (sellGreeks)
  - Calculate profitTicks, roi, sharpeRatio
  ↓
[3. Morphology Correlation]
  - Retrieve buyMorphology from ledger
  - Aggregate into morphology_performance table
  - Update winRate, avgPnl, profitFactor
  ↓
[4. Learning Loop Feedback]
  - Query model prediction (was model bullish on this morphology?)
  - Calculate brierScore = (prediction - outcome)^2
  - Store in learning_loop_feedback
  - Use as signal for model retraining
  ↓
[5. Terminal Feedback]
  - Update Chart tab (live P&L curve)
  - Update Doctrine tab (win % by morphology)
  - Show Brier score (forecast accuracy)
  - Suggest next trade based on updated model
```

### Example Feedback Cycle

```
Entry @ 08:48 (NQU6)
├─ Market morphology: IMPULSE (strong trend)
├─ Delta exposure: 0.45 (directional bullish)
├─ Model prediction: 65% win rate (high confidence)
└─ Greeks: delta=0.45, gamma=0.02, vega=0.08

Exit @ 14:19 (same day)
├─ Actual outcome: WIN ($124,200 profit)
├─ Actual hold: 5.5 hours
├─ Model prediction: 65% → Brier score = (0.65 - 1.0)^2 = 0.1225
└─ Feedback: Model was underconfident

Model Update
├─ Increase impulse morphology weight
├─ Refine Greeks sensitivity (gamma convexity matters)
├─ Next prediction: 70% win rate (on similar setup)
```

---

## 5. Learning Loop Metrics

### Brier Score (Forecast Skill)

```
Brier Score = mean((prediction_i - outcome_i)^2)

Range: 0 (perfect) to 1 (worst)

Example trades:
├─ Trade 1: predicted 0.65, outcome 1.0 (win)
│  Brier = (0.65 - 1.0)^2 = 0.1225
├─ Trade 2: predicted 0.55, outcome 0.0 (loss)
│  Brier = (0.55 - 0.0)^2 = 0.3025
├─ Trade 3: predicted 0.72, outcome 1.0 (win)
│  Brier = (0.72 - 1.0)^2 = 0.0784
└─ Mean Brier Score = (0.1225 + 0.3025 + 0.0784) / 3 = 0.1678

Interpretation:
- 0.00 = perfect forecast
- 0.25 = random (no skill)
- 0.50 = worse than random
- 1.00 = worst possible
```

### Calibration (Are predictions truthful?)

```
Calibration Analysis:
├─ When model says 60% win rate → actual win rate should be ~60%
├─ When model says 80% win rate → actual win rate should be ~80%
└─ If actual ≠ predicted → model is miscalibrated

For Qu'an:
├─ Impulse morphology: model says 70% → actual 68% ✅ (well-calibrated)
├─ Mean reversion: model says 55% → actual 42% ❌ (overconfident)
└─ Action: adjust mean-reversion weights or reduce confidence
```

### Performance By Morphology

```
Daily Report:
┌─────────────────────┬──────┬──────┬────────┐
│ Morphology          │ Wins │ Loss │ Win %  │
├─────────────────────┼──────┼──────┼────────┤
│ Impulse             │  8   │  2   │ 80%    │  ← Profitable
│ Accumulation        │  5   │  4   │ 56%    │  ← Marginal
│ Exhaustion          │  2   │  6   │ 25%    │  ← Avoid
│ Mean Reversion      │  3   │  5   │ 37%    │  ← Unprofitable
└─────────────────────┴──────┴──────┴────────┘

Guidance:
- Focus: Impulse setup (80% win rate)
- Monitor: Accumulation (marginal)
- Skip: Exhaustion + Mean Reversion (negative expectancy)

Brier Score by Morphology:
├─ Impulse: 0.14 (good forecast skill)
├─ Accumulation: 0.24 (fair)
├─ Exhaustion: 0.45 (poor)
├─ Mean Reversion: 0.38 (mediocre)
```

---

## 6. Integration with Qu'an Wiki Learnings

### [[version-1-1-science-framework]]

**Morphology Classification:**
- Terminal classifies market as one of 4 types (Impulse, Accumulation, Exhaustion, Mean Reversion)
- Execution Mastery tracks P&L by morphology
- Learning Loop adjusts model weights based on empirical win rates

**Performance Science:**
- Brier score measures forecast skill (directly from wiki)
- Calibration analysis ensures honest predictions
- Sharpe ratio per morphology (risk-adjusted returns)

**Application:**
```typescript
// In Doctrine tab
if (morphology === 'impulse' && winRateByMorphology['impulse'] > 0.75) {
  // High-confidence setup: suggest larger position
  suggestedQty = baseQty * 1.5;
  confidence = 'HIGH';
} else if (morphology === 'exhaustion' && brierScore > 0.40) {
  // Model uncertain: skip this setup
  suggestedQty = 0;
  reason = 'Poor forecast skill in exhaustion';
}
```

### [[rolling-analysis-engine]]

**Term Structure Analysis:**
- Track trades across expirations (front-month, 2nd month, etc.)
- Aggregate P&L by contract month
- Identify seasonal patterns (e.g., "front-month better for impulse")

**Application:**
```sql
SELECT
  symbol,
  SUBSTR(symbol, -4) AS expiration,  -- 'ESZ26', 'ESH27' → 'Z26', 'H27'
  buyMorphology,
  COUNT(*) as tradeCount,
  AVG(CAST(pnl AS FLOAT)) as avgPnl
FROM execution_ledger
WHERE buyTimestamp >= DATE('now', '-30 days')
GROUP BY symbol, expiration, buyMorphology
ORDER BY avgPnl DESC;
```

### [[learning-loop]]

**Closed-Loop Design:**
1. **Hypothesis** - "Impulse morphology has 70% win rate"
2. **Prediction** - Model forecasts 70% on next impulse setup
3. **Trade** - Execute on impulse, record entry + exit
4. **Measurement** - Outcome (win/loss), Brier score
5. **Feedback** - Update model weights, recalibrate
6. **Iteration** - Repeat with refined model

**Key Loop Variant (Learning):**
- Traditional loop: single metric (P&L)
- Qu'an variant: ensemble metrics (P&L + Brier + Sharpe + calibration)

### [[execution-module]]

**Tradovate Execution Engine:**
- Records live fills → execution_ledger (entry capture)
- Manages multi-leg orders (entry + exit)
- Audit trail via buyFillId / sellFillId
- Integration: execution_ledger links to fill IDs

---

## 7. Weekly Performance Report (Example)

### Report Structure

```markdown
# Execution Mastery Report — Week of 07/21-07/27/2026

## Summary
- Total Trades: 27
- Winning Trades: 17 (63% win rate)
- Losing Trades: 10 (37% loss rate)
- Total P&L: $847,320
- Avg P&L per Trade: $31,382
- Avg Hold Time: 4.2 hours

## By Morphology

### Impulse (8 trades)
- Win Rate: 87.5% (7W / 1L)
- Total P&L: $421,500
- Avg P&L: $52,688
- Brier Score: 0.12 ✅ (strong forecast)
- Sharpe Ratio: 2.3 ✅ (excellent risk-adjusted)

**Action:** Increase position size by 20% on impulse setups.

### Accumulation (6 trades)
- Win Rate: 66.7% (4W / 2L)
- Total P&L: $198,240
- Avg P&L: $33,040
- Brier Score: 0.28 ⚠️ (moderate forecast)
- Sharpe Ratio: 1.1 ⚠️ (fair risk-adjusted)

**Action:** Maintain current position size; monitor for improvements.

### Exhaustion (8 trades)
- Win Rate: 25% (2W / 6L)
- Total P&L: -$103,420
- Avg P&L: -$12,928
- Brier Score: 0.48 ❌ (poor forecast)
- Sharpe Ratio: -0.8 ❌ (negative returns)

**Action:** Skip exhaustion setups until model improves.

### Mean Reversion (5 trades)
- Win Rate: 40% (2W / 3L)
- Total P&L: $331,000
- Avg P&L: $66,200 (high variance)
- Brier Score: 0.35 ⚠️ (mediocre forecast)
- Sharpe Ratio: 0.5 ⚠️ (low risk-adjusted)

**Action:** Use only with low position size; monitor Greeks (theta decay).

## Model Calibration

### Predicted vs Actual Win %

| Morphology | Predicted | Actual | Delta | Status |
|---|---|---|---|---|
| Impulse | 75% | 87.5% | +12.5% | Underconfident ↑ |
| Accumulation | 60% | 66.7% | +6.7% | Good |
| Exhaustion | 50% | 25% | -25% | Overconfident ↓ |
| Mean Reversion | 55% | 40% | -15% | Overconfident ↓ |

**Model Update:**
- Increase impulse weight by 15%
- Decrease exhaustion weight by 30%
- Recalibrate mean-reversion model (may need feature engineering)

## Greeks Sensitivity Analysis

### Best Performing Entry Greeks

```
Impulse wins (7 trades):
├─ Avg entry delta: 0.52
├─ Avg entry gamma: 0.018
├─ Avg entry vega: 0.095
└─ Pattern: high delta + moderate gamma (directional conviction)

Exhaustion losses (6 trades):
├─ Avg entry delta: 0.28
├─ Avg entry gamma: 0.035
├─ Avg entry vega: 0.062
└─ Pattern: low delta + high gamma (trapped in volatility)
```

**Insight:** Gamma > 0.03 correlates with losses in low-delta setups.

**Action:** In low-delta environments, prioritize low-gamma entries.

## Next Week Forecast

```
Based on current model (post-calibration):

Impulse Probability: 65% (↑ from 60%)
├─ Expected Win Rate: 82%
├─ Expected Avg P&L: $48,000
└─ Position Size: +20%

Accumulation Probability: 25% (stable)
├─ Expected Win Rate: 65%
├─ Expected Avg P&L: $32,000
└─ Position Size: 1x

Exhaustion Probability: 5% (↓ from 10%)
├─ Expected Win Rate: 30%
├─ Expected Avg P&L: -$8,000
└─ Position Size: Skip

Mean Reversion Probability: 5% (↓ from 10%)
├─ Expected Win Rate: 40%
├─ Expected Avg P&L: $12,000
└─ Position Size: 0.5x (test only)

Forecast Confidence: 0.71 (↑ from 0.68)
```

---

## 8. Terminal Integration

### Doctrine Tab (Learning Loop Dashboard)

```
┌─────────────────────────────────────────────────────┐
│  EXECUTION MASTERY — Weekly P&L by Morphology       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Impulse      ████████████ $421,500  ✅ 87.5% Win  │
│  Accumulation ██████ $198,240        ⚠️  66.7% Win │
│  Mean Rev.    ██░░░░░ $331,000       ⚠️  40.0% Win │
│  Exhaustion   ░░░░░░░░ -$103,420    ❌  25.0% Win  │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Model Calibration (Brier Score by Morphology)      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Impulse      ▓▓░░░░░░░░ 0.12 (Excellent) ✅       │
│  Accumulation ▓▓▓░░░░░░░ 0.28 (Fair)      ⚠️       │
│  Mean Rev.    ▓▓▓▓░░░░░░ 0.35 (Mediocre)  ⚠️       │
│  Exhaustion   ▓▓▓▓▓░░░░░ 0.48 (Poor)      ❌       │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Action Items:                                      │
│  1. ↑ Increase position by 20% on impulse setups    │
│  2. ⚠️ Monitor accumulation (fair calibration)      │
│  3. ❌ SKIP exhaustion (negative expectancy)        │
│  4. ⚠️ Reduce mean-reversion to 0.5x size           │
└─────────────────────────────────────────────────────┘
```

### Chart Tab (Real-Time P&L Curve)

```
Live P&L (Weekly)
  │
  │     ╱╲      ╱╲     ╱╲
  │    ╱  ╲  ╱╲╱  ╲   ╱  ╲
$847K ╱────╲╱────────╲─╱────╲──→
  │  ╱ Impulse    Accumulation
  │ ╱  (87.5%)     (66.7%)
  │
  └─────────────────────────────→ Time

Markers:
  🟢 Win  (18 trades)
  🔴 Loss (9 trades)
  ⚠️ Underperform morphology (grey)
```

### Real-Time Trade Suggestion

```
Current Market State:
├─ Morphology: IMPULSE ✅
├─ Delta: 0.52 (high directional conviction)
├─ Model Confidence: 82% (based on historical impulse wins)
├─ Suggested Position Size: 30 contracts (up from 25 baseline)
└─ Expected P&L: $47,000 (median)

Greeks Heatmap (Entry Selection):
├─ Delta range: 0.45-0.60 ✅ (impulse sweet spot)
├─ Gamma: <0.025 ✅ (avoid high gamma in impulse)
├─ Vega: 0.08-0.12 ✅ (moderate directional volatility)
└─ Theta: >-0.002 ✅ (time decay in our favor)

Forecast Accuracy:
├─ Brier Score on similar setups: 0.12
├─ Win Rate (historical): 87.5% (8 of past 9 impulse trades)
└─ Confidence: HIGH ✅

[EXECUTE SUGGESTED TRADE]
```

---

## 9. Data Ingestion Pipeline

### CSV → D1 (Weekly Batch)

```bash
# Export from Tradovate
# Tradovate → CSV → S3 upload → Worker → D1

worker/ingest-execution.ts
├─ Read CSV from S3 (Tradovate export)
├─ Parse columns (symbol, buyPrice, sellPrice, pnl, etc.)
├─ Validate data (prices reasonable, timestamps in order)
├─ Enrich with Greeks (query Greeks API @ entry/exit times)
├─ Enrich with morphology (query classifier @ entry time)
├─ Calculate derived metrics (roi, sharpe, hold time)
├─ Insert into execution_ledger (D1)
├─ Aggregate into morphology_performance (D1)
└─ Update learning_loop_feedback (Brier scores)
```

### Real-Time Ingestion (Tradovate API)

```typescript
// In execution-engine.js (Durable Object)
const TradovateClient = {
  onOrderFill(fill) {
    // {orderId, symbol, qty, fillPrice, timestamp}
    
    if (fill.orderType === 'BUY') {
      // Entry capture
      executionLedger.startTrade({
        tradeId: uuid(),
        symbol: fill.symbol,
        buyPrice: fill.fillPrice,
        buyTimestamp: fill.timestamp,
        qty: fill.qty,
        buyGreeks: await greeksAPI.get(fill.symbol, fill.timestamp),
        buyMorphology: await morphologyClassifier.get(fill.timestamp)
      });
    } else if (fill.orderType === 'SELL') {
      // Exit capture + enrichment
      const trade = executionLedger.getOpenTrade(fill.symbol);
      trade.sellPrice = fill.fillPrice;
      trade.sellTimestamp = fill.timestamp;
      trade.pnl = (fill.fillPrice - trade.buyPrice) * fill.qty;
      
      // Feedback signal
      learningLoop.recordFeedback({
        tradeId: trade.id,
        outcome: trade.pnl > 0 ? 1 : 0,
        prediction: await model.predictWinRate(trade.buyMorphology),
        brierScore: Math.pow(prediction - outcome, 2)
      });
    }
  }
};
```

---

## 10. Model Training (Weekly)

### Retraining Pipeline

```python
# In Pyodide (weekly batch)

class ExecutionMasteryModel:
    def retrain(self, execution_ledger: List[Dict]) -> Model:
        """Refit model weights based on weekly trades."""
        
        # Group trades by morphology
        by_morphology = defaultdict(list)
        for trade in execution_ledger:
            by_morphology[trade['morphology']].append(trade)
        
        # Update morphology weights
        for morphology, trades in by_morphology.items():
            win_count = sum(1 for t in trades if t['pnl'] > 0)
            win_rate = win_count / len(trades)
            
            # Simple update rule
            self.weights[morphology] *= (1 + (win_rate - 0.5) * 0.1)
        
        # Calibration check
        for morphology, trades in by_morphology.items():
            predictions = [t['prediction'] for t in trades]
            outcomes = [1 if t['pnl'] > 0 else 0 for t in trades]
            
            brier_score = mean([(p - o)**2 for p, o in zip(predictions, outcomes)])
            
            if brier_score > 0.40:
                self.confidence[morphology] *= 0.9  # Reduce confidence
        
        return self
```

---

## 11. Success Metrics (Week 7+)

### Primary Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| **Total P&L (monthly)** | >$500K | TBD | 🔄 |
| **Win Rate** | >60% | TBD | 🔄 |
| **Sharpe Ratio** | >1.5 | TBD | 🔄 |
| **Brier Score** | <0.25 | TBD | 🔄 |

### Secondary Metrics

| Metric | Target | Purpose |
|--------|--------|---------|
| **Profit Factor** | >2.0 | Wins / Losses ratio |
| **Max Drawdown** | <10% | Risk management |
| **Trades per Day** | 3-5 | Activity level |
| **Avg Hold Time** | 4-6h | Position management |
| **Model Calibration** | +/- 5% | Forecast honesty |

---

## 12. Risk Management

### Loss Prevention

```sql
-- Flag suspicious patterns
SELECT * FROM execution_ledger
WHERE
  -- Revenge trading (rapid losses)
  (buyTimestamp - (
    SELECT soldTimestamp FROM execution_ledger 
    WHERE userId = outer.userId AND pnl < 0
    ORDER BY soldTimestamp DESC LIMIT 1
  ) < INTERVAL '15 minutes')
  
  AND pnl < -50000  -- Large loss
  
  AND holdMinutes < 60;  -- Quick reversal

-- Action: Alert trader, require confirmation on next trade
```

### Position Sizing by Morphology

```typescript
const positionSizing = {
  impulse: {
    baseQty: 25,
    adjustment: winRate > 0.80 ? 1.2 : 1.0,  // Scale up if winning
    maxQty: 40
  },
  accumulation: {
    baseQty: 20,
    adjustment: 1.0,
    maxQty: 30
  },
  exhaustion: {
    baseQty: 5,  // Minimal
    adjustment: 0.0,  // Skip if poor performance
    maxQty: 10
  },
  meanReversion: {
    baseQty: 10,
    adjustment: brierScore < 0.35 ? 1.0 : 0.5,  // Reduce if uncertain
    maxQty: 20
  }
};
```

---

## 13. Implementation Roadmap

### Week 7: Core Ledger + Ingestion

- [ ] D1 schema (execution_ledger, morphology_performance)
- [ ] CSV ingestion (Tradovate export → D1)
- [ ] Real-time order fill capture (Tradovate API → execution-engine)
- [ ] Greeks enrichment (query Greeks API @ entry/exit)
- [ ] Morphology enrichment (query classifier @ entry)

### Week 8: Analytics + Reporting

- [ ] Morphology_performance aggregation (daily, weekly)
- [ ] Brier score calculation (prediction vs outcome)
- [ ] Win rate by morphology
- [ ] Weekly performance report (SQL → markdown)

### Week 9: Learning Loop Integration

- [ ] Learning_loop_feedback table
- [ ] Model prediction (what's next win% forecast?)
- [ ] Calibration analysis (predicted vs actual)
- [ ] Model retraining (weekly batch in Pyodide)

### Week 10: Terminal Dashboard

- [ ] Doctrine tab (P&L by morphology, Brier scores)
- [ ] Chart tab (live P&L curve by morphology)
- [ ] Trade suggestion (next morphology forecast + position sizing)
- [ ] Real-time feedback (Brier score as trades close)

### Week 11-12: Optimization + Risk

- [ ] Position sizing rules (scale by morphology + win rate)
- [ ] Loss prevention (revenge trading detection)
- [ ] A/B testing framework (hypothesis → prediction → feedback)
- [ ] Documentation + runbook

---

## 14. Example: End-to-End Trade Cycle

### Setup: Monday 08:00 ET

**Market State:**
```
Morphology: IMPULSE (strong uptrend)
Delta exposure: 0.52 (bullish)
Greeks: {delta: 0.52, gamma: 0.018, vega: 0.095, theta: -0.001}
```

**Model Forecast:**
```
Impulse historical win rate: 87.5%
Model prediction: 82% (calibrated lower due to Brier score)
Suggested position size: 30 contracts (1.2x base)
Expected P&L: $45,000 (median)
```

**Trade Execution:**
```sql
INSERT INTO execution_ledger (
  tradeId, symbol, qty, 
  buyPrice, buyTimestamp, buyGreeks, buyMorphology,
  prediction
) VALUES (
  'abc-123-def', 'ESZ26', 30,
  5460.25, '2026-07-21 08:48:01', 
  '{"delta": 0.52, "gamma": 0.018, "vega": 0.095, "theta": -0.001}',
  'impulse',
  0.82
);
```

### Execution: Monday 14:19 ET

**Exit:**
```sql
UPDATE execution_ledger SET
  sellPrice = 5567.50,
  sellTimestamp = '2026-07-21 14:19:06',
  pnl = (5567.50 - 5460.25) * 30 = $3,218.75,  -- Wait, this seems small
  -- Actually: $3,218.75 × 100 = $321,875 (in reality, contracts are 100x multiplier)
  holdMinutes = 325,
  roi = 321875 / (5460.25 * 30 * 100),
  outcome = 1  -- Win
WHERE tradeId = 'abc-123-def';
```

### Feedback: Monday 14:30 ET

```sql
INSERT INTO learning_loop_feedback (
  tradeId, 
  predictedWinPct, actualWinLoss,
  brierScore,
  modelVersion
) VALUES (
  'abc-123-def',
  0.82, 1,  -- Predicted 82%, actual win
  (0.82 - 1.0)^2 = 0.0324,  -- Low error (good forecast)
  'v1.2-2026-07-21'
);
```

### Doctrine Tab Update

```
Impulse Trades (Week of 07/21):
├─ Trade 1: ✅ Win (Brier: 0.0324)
├─ Trade 2: ✅ Win (Brier: 0.0289)
├─ Trade 3: ❌ Loss (Brier: 0.1825)
│
├─ Win Rate: 2/3 = 66.7%
├─ Avg Brier: 0.0813
└─ Model Calibration: Underconfident → ↑ increase next prediction to 85%
```

---

## 15. Glossary

| Term | Definition |
|------|-----------|
| **Execution Ledger** | D1 table storing all trades (entry, exit, P&L, Greeks, morphology) |
| **Morphology Performance** | Daily aggregation of trades by market morphology (win rate, avg P&L) |
| **Learning Loop Feedback** | Table tracking model predictions vs actual outcomes (Brier scores) |
| **Brier Score** | Forecast error metric: (prediction - outcome)^2; 0 = perfect, 1 = worst |
| **Calibration** | Are model predictions truthful? (60% pred should yield ~60% actual) |
| **Win Rate** | Fraction of trades profitable (not magnitude, just % of winners) |
| **Profit Factor** | Ratio of total wins to total losses (>2.0 is good) |
| **Sharpe Ratio** | Risk-adjusted return (avg P&L / std dev P&L); higher is better |
| **Greeks @ Entry** | Delta, gamma, vega, theta at time of trade entry (market conditions) |
| **Position Sizing** | Qty adjustment based on morphology + model confidence |

---

**Framework Created:** 2026-07-22  
**Status:** Ready for Week 7 implementation  
**Next:** Coordinate with Execution Engine team (Week 6) for Tradovate API integration
