---
type: Implementation Guide
title: Execution Mastery Engine — Deep Dive & Robust Techniques
description: Implementation patterns, architectural decisions, robust abstractions, and edge-case handling for closed-loop learning system; market-agnostic techniques extracted from performance data
tags: [execution, learning-loop, implementation, robust-patterns, market-abstractions]
citations:
  - [[doctrine/invariants]] (hard constraints)
  - [[execution-mastery-engine]] (original design)
  - [[version-1-1-science-framework]] (morphology, performance science)
---

# Execution Mastery Deep Dive: Robust Techniques & Implementation

**Status:** Deep analysis phase (Week 6)  
**Purpose:** Extract market-independent techniques for execution learning  
**Scope:** Implementation patterns, edge-cases, robust abstractions  

---

## Part 1: Architectural Invariants for Execution Mastery

Apply [[doctrine/invariants]] to Execution Mastery design:

### Invariant E1: Trade Classification Is Immutable

**Statement:** The moment a trade is recorded in `execution_ledger`, its classification (morphology, Greeks, market state) is **frozen**. Do not re-derive or update these after the fact.

**Why:** 
- User makes trade decision at 09:15 ET when market is IMPULSE
- We record: `buyTimestamp=09:15, buyMorphology='impulse'`
- Later at 14:00, morphology changes to ACCUMULATION
- If we update the historical trade's morphology to ACCUMULATION, we're rewriting history
- Win rate by morphology becomes unreliable (same trade counted under two morphologies at different times)

**Implementation:**
```sql
-- CORRECT: Immutable record at entry time
INSERT INTO execution_ledger (
  tradeId, symbol, qty, buyPrice, buyTimestamp, 
  buyMorphology, buyGreeks, buyIV,
  createdAt
) VALUES (
  'abc-123', 'ESZ26', 30, 5460.25, '2026-07-22 09:15:00',
  'impulse', {...}, 18.2,
  CURRENT_TIMESTAMP
);
-- buyMorphology will NEVER change. Ever.

-- WRONG: Updating historical morphology
UPDATE execution_ledger 
SET buyMorphology = 'accumulation' 
WHERE buyTimestamp < '2026-07-22 14:00:00';
-- This corrupts your historical analysis.
```

**Edge Case:** Open trades (no exit yet)
- Store `buyMorphology` at entry (fixed)
- Don't update to current morphology (would make it mutable)
- When trade closes, record `sellMorphology` separately (optional, for exit context)
- Learning loop uses `buyMorphology` (entry decision context)

**Enforcement:**
```typescript
class ExecutionLedger {
  recordEntry(trade: EntryRecord) {
    // Capture morphology @ entry time
    const morphology = this.morphologyClassifier.get(trade.entryTime);
    
    // Store + commit immediately (no updates allowed)
    const record = {
      ...trade,
      buyMorphology: morphology,
      buyGreeks: trade.greeks,
      buyIV: trade.iv,
      createdAt: Date.now()
    };
    
    // Persist (D1 write)
    db.insert('execution_ledger', record);
    
    // Mark immutable: subsequent calls are updates (exit), not changes
    return { tradeId: record.id, immutable: true };
  }
  
  recordExit(tradeId: string, exit: ExitRecord) {
    // Only update exit-related fields (sellPrice, sellTimestamp, etc.)
    // Never touch buyMorphology or other entry fields
    const allowed = ['sellPrice', 'sellTimestamp', 'sellGreeks', 'pnl', 'outcome'];
    
    const updates = pick(exit, allowed);
    db.update('execution_ledger', { id: tradeId }, updates);
  }
  
  // No method to update buyMorphology, buyGreeks, etc.
  // If you need to "correct" a trade, create a new record (don't update)
}
```

**Implication:** If you discover the morphology classifier was wrong, you:
1. Fix the classifier for *future* trades
2. Do NOT backfill historical trades
3. Document the discovery (new version of classifier)
4. Optional: create separate `classifier_audit` table (why classifier changed)

---

### Invariant E2: Prediction Model Is Versioned

**Statement:** Every model prediction must carry a `modelVersion` tag. You can never ask "what did the model predict?" without knowing **which model**. Different versions predict differently.

**Why:**
- Day 1: Model v1.0 says impulse has 70% win rate
- Day 8: You retrain with new data → v1.1 says impulse has 75% win rate
- Without versioning, Brier scores get mixed: v1.0 predictions scored against v1.1 calibration
- Historical Brier scores become meaningless

**Implementation:**
```sql
-- CORRECT: Version every prediction
INSERT INTO learning_loop_feedback (
  tradeId, predictedWinPct, actualWinLoss, brierScore,
  modelVersion,  -- e.g., 'v1.1-2026-07-22'
  feedbackTimestamp
) VALUES (
  'abc-123', 0.82, 1, 0.0324,
  'v1.1-2026-07-22',
  CURRENT_TIMESTAMP
);

-- Query brier scores for a specific model version
SELECT AVG(brierScore) FROM learning_loop_feedback
WHERE modelVersion = 'v1.1-2026-07-22' AND morphology = 'impulse';
-- → 0.15 (Brier score for impulse trades under v1.1)

-- WRONG: No version, conflating predictions across model changes
SELECT AVG(brierScore) FROM learning_loop_feedback
WHERE morphology = 'impulse';
-- → 0.18 (meaningless: v1.0 + v1.1 mixed together)
```

**Model Versions Are Immutable:**
```python
# In Pyodide (model retraining)
class ExecutionMasteryModel:
  def retrain(self, recent_trades: List[Trade]) -> str:
    """Retrain and return new model version string."""
    
    # Timestamp-based version (or git hash, or sequence number)
    version = f"v{self.version_number}-{date.today()}"
    
    # Update weights
    for morphology in ['impulse', 'accumulation', 'mean_reversion', 'exhaustion']:
      trades = [t for t in recent_trades if t.morphology == morphology]
      win_rate = sum(1 for t in trades if t.pnl > 0) / len(trades)
      self.weights[morphology] *= (1 + (win_rate - 0.5) * 0.15)
    
    # Store model file (immutable)
    model_file = f"models/execution_mastery_{version}.json"
    with open(model_file, 'w') as f:
      json.dump(self.weights, f)
    
    # Update "current version" pointer
    self.current_version = version
    
    # Log deployment
    print(f"Model deployed: {version}")
    
    return version
```

**Never:** Overwrite a model file. Always create new versioned file.

**Edge Case:** Rolling back to old model
- Don't delete old model files (versioning is audit trail)
- Create new version that points to old weights
- Tag it: `v1.0-rollback-reason-2026-07-23`

---

### Invariant E3: Win/Loss Determination Is Deterministic

**Statement:** Whether a trade is a win or loss must be determined **once** at exit, and never change. Not based on opinion, emotion, or later price action.

**Why:**
- Trade: buy at 5460, sell at 5467 → $7/contract profit (clear win)
- But what if the market later drops to 5450?
- "Could have made more" is not the same as "did make money"
- Brier score measures: did the model predict correctly about whether this trade would be profitable?
- If we change the definition of "win" after the trade, Brier score becomes meaningless

**Implementation:**
```typescript
// CORRECT: Deterministic win/loss at exit
function recordExit(trade: ClosedTrade) {
  const pnl = (trade.sellPrice - trade.buyPrice) * trade.qty * multiplier;
  const outcome = pnl > 0 ? 1 : 0;  // 1 = win, 0 = loss (even if P&L = 0)
  
  // Record outcome (immutable)
  db.update('execution_ledger', { id: trade.id }, {
    sellPrice: trade.sellPrice,
    sellTimestamp: trade.sellTimestamp,
    pnl: pnl,
    outcome: outcome  // Immutable
  });
}

// WRONG: Changing win/loss based on later market action
// DON'T DO THIS:
function updateTradeOutcome(tradeId, laterPrice) {
  const trade = db.get('execution_ledger', tradeId);
  const laterPnL = (laterPrice - trade.buyPrice) * trade.qty;
  
  // Redefine win/loss based on hypothetical later price
  const newOutcome = laterPnL > trade.pnl ? 1 : 0;
  
  db.update('execution_ledger', { id: tradeId }, {
    outcome: newOutcome  // NO! This corrupts historical data
  });
}

// ALSO WRONG: "If it went to X level, it would have been better"
// These are regrets, not outcomes
```

**Edge Case:** Partial fills or split exits
- Trade enters 30 contracts at 5460
- Exits 20 at 5467, 10 at 5470
- Record as **one trade** with average exit (weighted average of two fills)
- Outcome: pnl > 0 → win (regardless of which half was closed first)
- Or: split into two sub-trades (each with its own outcome)
- Choose one approach consistently (immutable)

---

### Invariant E4: Morphology Classifier Is Single Source of Truth

**Statement:** The morphology classification (IMPULSE/ACCUMULATION/EXHAUSTION/MEAN_REVERSION) at entry time comes **only** from the morphology classifier at the exact entry timestamp. No overrides, no manual corrections.

**Why:**
- Morphology is the **explanatory variable** (cause)
- Win rate is the **dependent variable** (effect)
- If we manually override morphology ("actually, that was accumulation, not impulse"), we're saying the classifier is wrong
- But then we use manual classifications to train the next classifier (garbage in, garbage out)
- Brier score measures: did the model predict correctly for this market morphology?
- If we change the morphology definition retroactively, we're not measuring prediction accuracy (model drift)

**Implementation:**
```typescript
// CORRECT: Query classifier @ exact entry time
async function recordEntry(entry: EntryRecord) {
  // Get morphology at EXACT entry timestamp (not "current" morphology)
  const morphology = await morphologyClassifier.getAtTime(
    entry.timestamp,  // Exact timestamp (e.g., 09:15:00.123)
    entry.symbol
  );
  
  // Record (immutable)
  db.insert('execution_ledger', {
    ...entry,
    buyMorphology: morphology  // Frozen at entry time
  });
}

// WRONG: Manual override
function overrideMorphology(tradeId, newMorphology) {
  db.update('execution_ledger', { id: tradeId }, {
    buyMorphology: newMorphology  // NO! Rewriting history
  });
}

// ALSO WRONG: "I think this should have been impulse"
// If classifier got it wrong, fix the classifier for future trades
// Don't rewrite historical trades
```

**Edge Case:** Classifier changed between entry and exit
- Entry at 09:15 (morphology=IMPULSE)
- Exit at 14:00 (morphology now=ACCUMULATION due to market shift)
- Result: trade is classified as IMPULSE (entry morphology is locked)
- Optional: store exit morphology separately (for narrative, not for learning)
- Learning loop uses entry morphology (the context of the decision)

**Enforcement:**
```python
# In morphology classifier
class MorphologyClassifier:
  def get_at_time(self, timestamp: datetime, symbol: str) -> str:
    """Get morphology at specific historical timestamp."""
    
    # Query tick data @ that timestamp
    ticks = self.tick_engine.get_range(symbol, timestamp - 1min, timestamp)
    
    # Classify based on those ticks (immutable point-in-time snapshot)
    morphology = self._classify(ticks)
    
    return morphology
  
  def get_current(self, symbol: str) -> str:
    """Get morphology right now (for trading, not for analysis)."""
    
    ticks = self.tick_engine.get_recent(symbol, window=5min)
    morphology = self._classify(ticks)
    
    return morphology
```

---

## Part 2: Robust Abstractions (Market-Independent)

These patterns work across any market, any morphology:

### Abstraction A1: Forecast Quality as a Signal (Brier Score)

**Pattern:** Use prediction error (Brier score) as a feedback signal for model improvement.

**Market-Independent:** Works on any asset, any morphology, any time horizon.

**Why it's robust:**
- Brier score = (prediction - outcome)²
- Ranges 0 (perfect) to 1 (worst)
- Symmetric: equally penalizes overconfidence and underconfidence
- No assumption about market regime, Greeks, or strategy

**Implementation:**
```typescript
interface TradeWithPrediction {
  tradeId: string;
  buyMorphology: string;
  prediction: number;  // 0-1 (model's predicted win%)
  outcome: number;     // 0 or 1 (actual: loss or win)
}

function calculateBrierScore(trade: TradeWithPrediction): number {
  return Math.pow(trade.prediction - trade.outcome, 2);
}

// Example:
const trades = [
  { morphology: 'impulse', prediction: 0.85, outcome: 1 },  // Brier = 0.0225
  { morphology: 'impulse', prediction: 0.85, outcome: 0 },  // Brier = 0.7225
  { morphology: 'impulse', prediction: 0.50, outcome: 1 },  // Brier = 0.2500
];

const avgBrier = trades.reduce((sum, t) => sum + calculateBrierScore(t), 0) / trades.length;
// avgBrier = 0.3317

// Interpretation: model's impulse predictions off by ~0.33 on average
```

**Calibration Check (Are predictions truthful?):**
```sql
-- For impulse trades where model said "70% win rate"
SELECT
  ROUND(CAST(prediction AS INT) * 10) / 10 AS predictionBucket,
  COUNT(*) as tradeCount,
  ROUND(100.0 * SUM(outcome) / COUNT(*), 1) as actualWinRate,
  ROUND(predictionBucket * 100, 1) as modelPredictedWinRate
FROM learning_loop_feedback
WHERE modelVersion = 'v1.1-2026-07-22' 
  AND morphology = 'impulse'
GROUP BY predictionBucket
ORDER BY predictionBucket;

-- Output:
-- predictionBucket | tradeCount | actualWinRate | modelPredictedWinRate
-- 0.5              | 12         | 42.0%         | 50.0%     (overconfident by 8%)
-- 0.6              | 18         | 61.0%         | 60.0%     (well-calibrated)
-- 0.7              | 25         | 76.0%         | 70.0%     (underconfident by 6%)
-- 0.8              | 15         | 86.7%         | 80.0%     (underconfident by 7%)

-- Action: Model is slightly underconfident (predicts 70-80%, achieves 76-87%)
-- Next training: increase impulse weight by 5-10%
```

**Robustness:** This works for:
- Any asset class (futures, options, stocks)
- Any time horizon (scalping to swing)
- Any morphology
- Different market regimes (bull, bear, sideways)

---

### Abstraction A2: Morphology-Stratified Performance (Grouping by Condition)

**Pattern:** Never aggregate across morphologies. Always stratify by market condition.

**Market-Independent:** The "condition" (morphology) changes, but the principle doesn't.

**Why it's robust:**
- A strategy might be great in IMPULSE but terrible in EXHAUSTION
- Averaging across morphologies hides the signal
- Each morphology has different risk/reward profile

**Implementation:**
```sql
-- CORRECT: Stratified by morphology
SELECT
  buyMorphology,
  COUNT(*) as tradeCount,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winCount,
  ROUND(100.0 * SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as winRate,
  ROUND(AVG(pnl), 0) as avgPnl,
  ROUND(STDDEV(pnl), 0) as stdDevPnl,
  ROUND((AVG(pnl) - 0) / STDDEV(pnl), 2) as sharpeRatio
FROM execution_ledger
WHERE userId = ? AND buyTimestamp >= DATE('now', '-30 days')
GROUP BY buyMorphology
ORDER BY sharpeRatio DESC;

-- Output:
-- buyMorphology  | trades | wins | winRate | avgPnl | stdDev | sharpe
-- impulse        | 18     | 16   | 88.9%   | 42000  | 15000  | 2.8
-- accumulation   | 12     | 8    | 66.7%   | 28000  | 22000  | 1.3
-- mean_reversion | 8      | 2    | 25.0%   | 8000   | 35000  | 0.2
-- exhaustion     | 5      | 1    | 20.0%   | -5000  | 40000  | -0.1

-- WRONG: Averaging across morphologies (hides signal)
SELECT
  COUNT(*) as totalTrades,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as totalWins,
  ROUND(100.0 * SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as overallWinRate,
  ROUND(AVG(pnl), 0) as overallAvgPnl
FROM execution_ledger
WHERE userId = ? AND buyTimestamp >= DATE('now', '-30 days');

-- Output: 55% win rate, $20K avg P&L
-- But this hides that impulse is 88.9% and exhaustion is 20%!
```

**Application:**
```typescript
// Position sizing based on morphology performance
const positionSizing = {
  impulse: {
    baseQty: 30,
    scale: sharpeRatio > 2.0 ? 1.3 : 1.0,  // Scale up if Sharpe > 2
    maxQty: 50
  },
  accumulation: {
    baseQty: 20,
    scale: 1.0,  // Steady
    maxQty: 30
  },
  mean_reversion: {
    baseQty: 10,
    scale: sharpeRatio > 0.5 ? 1.0 : 0.5,  // Scale down if underperforming
    maxQty: 20
  },
  exhaustion: {
    baseQty: 0,
    scale: 0.0,  // Skip (negative sharpe)
    maxQty: 0
  }
};
```

**Robustness:** This works for:
- Any strategy (not market-specific)
- Different time periods (week, month, quarter)
- Different user cohorts (risk profiles)
- Adding new morphologies (just add a row)

---

### Abstraction A3: Time-Stratified Analysis (Controlling for Market Regime)

**Pattern:** Compare performance across time periods, not just morphologies.

**Market-Independent:** Any market has time periods (days, weeks, months, seasons).

**Why it's robust:**
- Market behavior changes over time
- Monday might be impulse-heavy, Friday might be exhaustion-heavy
- Model trained on June might not work in July
- Stratifying by date catches regime changes

**Implementation:**
```sql
-- Performance by morphology AND date
SELECT
  DATE(buyTimestamp) as tradeDate,
  buyMorphology,
  COUNT(*) as tradeCount,
  ROUND(100.0 * SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as winRate,
  ROUND(AVG(pnl), 0) as avgPnl
FROM execution_ledger
WHERE userId = ? AND buyTimestamp >= DATE('now', '-60 days')
GROUP BY tradeDate, buyMorphology
ORDER BY tradeDate DESC, buyMorphology;

-- Output shows temporal trends:
-- tradeDate  | morphology     | trades | winRate | avgPnl
-- 2026-07-22 | impulse        | 5      | 80%     | 35000
-- 2026-07-22 | accumulation   | 3      | 67%     | 22000
-- 2026-07-21 | impulse        | 4      | 100%    | 45000  ← Great day for impulse
-- 2026-07-21 | exhaustion     | 2      | 0%      | -8000  ← Bad day for exhaustion
-- 2026-07-20 | impulse        | 3      | 67%     | 28000  ← Impulse declining
```

**Detect Regime Changes:**
```sql
-- Model degradation check: is Brier score increasing over time?
SELECT
  DATE(feedbackTimestamp) as feedbackDate,
  modelVersion,
  COUNT(*) as predictions,
  ROUND(AVG(brierScore), 3) as avgBrier
FROM learning_loop_feedback
WHERE modelVersion = 'v1.1-2026-07-22'
GROUP BY feedbackDate, modelVersion
ORDER BY feedbackDate DESC;

-- Output:
-- feedbackDate | model | predictions | avgBrier
-- 2026-07-22   | v1.1  | 8           | 0.124  ← Stable
-- 2026-07-21   | v1.1  | 6           | 0.129  ← Stable
-- 2026-07-20   | v1.1  | 5           | 0.198  ← Degrading! (0.198 > 0.129)
-- 2026-07-19   | v1.1  | 7           | 0.156

-- Action: Market regime shifted on 2026-07-20. Time to retrain model.
```

**Robustness:** This works for:
- Any market (always has time dimension)
- Detecting model staleness (Brier increases → retrain)
- Identifying best/worst periods (optimize position sizing)
- Seasonal patterns (Monday vs Friday, month-end, etc.)

---

### Abstraction A4: Hold Time as Feature (Not Just Outcome)

**Pattern:** Measure performance stratified by hold duration, not just P&L.

**Market-Independent:** All trades have duration; duration distribution reveals strategy timing.

**Why it's robust:**
- Scalper (hold <5 min) vs swing trader (hold >4 hours) have different risk profiles
- Averaging impulse trades with 30min hold + 16hour hold hides the signal
- Model should predict different win rates for different hold times

**Implementation:**
```sql
-- Stratify by hold duration
SELECT
  buyMorphology,
  CASE 
    WHEN holdMinutes < 5 THEN 'scalp'
    WHEN holdMinutes < 60 THEN 'short-term'
    WHEN holdMinutes < 240 THEN 'intra-day'
    ELSE 'swing'
  END as holdCategory,
  COUNT(*) as tradeCount,
  ROUND(100.0 * SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as winRate,
  ROUND(AVG(holdMinutes), 0) as avgHoldMinutes,
  ROUND(AVG(profitPerHour), 0) as profitPerHour
FROM execution_ledger
WHERE buyTimestamp >= DATE('now', '-30 days')
GROUP BY buyMorphology, holdCategory
ORDER BY buyMorphology, holdCategory;

-- Output:
-- morphology     | holdCategory | trades | winRate | holdMin | $/hour
-- impulse        | scalp        | 3      | 100%    | 2       | 18000  ← Best
-- impulse        | short-term   | 8      | 88%     | 15      | 9000
-- impulse        | intra-day    | 4      | 75%     | 120     | 3000   ← Worst (hold too long)
-- accumulation   | intra-day    | 6      | 67%     | 180     | 1400   ← This is better for accumulation
-- exhaustion     | swing        | 3      | 33%     | 600     | -200   ← Skip entirely

-- Insight: Impulse works best as scalp, accumulation as intra-day
```

**Position Sizing by Hold Time:**
```typescript
const positionSizingByDuration = {
  impulse: {
    scalp: { qty: 50, maxHoldMinutes: 5 },       // Scale up
    shortTerm: { qty: 30, maxHoldMinutes: 60 },  // Normal
    intraDay: { qty: 15, maxHoldMinutes: 240 },  // Scale down
    swing: { qty: 0 }  // Skip (doesn't work)
  },
  accumulation: {
    intraDay: { qty: 30, maxHoldMinutes: 240 },  // Best hold time
    shortTerm: { qty: 20 },
    scalp: { qty: 10 }  // Not ideal
  }
};
```

**Robustness:** This works for:
- Day traders vs swing traders (different time horizons)
- Overnight vs intraday strategies
- Greeks decay (theta profits over time)
- Identifying when to hold vs exit

---

## Part 3: Edge Cases & Failure Modes

### Edge Case E1: Trade Never Exits (Open Position)

**Problem:** `sellTimestamp` is NULL → calculation fails

**Solution:**
```sql
-- Mark as "open" (not win/loss yet)
CREATE COLUMN outcome_status TEXT DEFAULT 'pending';

-- Values: 'pending' (open), 'win' (pnl > 0), 'loss' (pnl <= 0)
UPDATE execution_ledger
SET outcome_status = CASE
  WHEN sellTimestamp IS NULL THEN 'pending'
  WHEN pnl > 0 THEN 'win'
  ELSE 'loss'
END;

-- Query: only closed trades for Brier score
SELECT AVG(brierScore) FROM learning_loop_feedback
WHERE outcome_status != 'pending';
```

**Implication:** Open trades don't contribute to learning loop until they close. That's correct (don't count unrealized P&L).

---

### Edge Case E2: Large Win Followed by Large Loss (Volatility)

**Problem:** Standard deviation might be huge → Sharpe ratio looks bad

**Solution:**
```sql
-- Use rolling Sharpe (limits look-back window)
WITH rolling_trades AS (
  SELECT
    DATE(buyTimestamp) as tradeDate,
    pnl,
    ROW_NUMBER() OVER (ORDER BY buyTimestamp DESC) as recency
  FROM execution_ledger
  WHERE buyMorphology = 'impulse' AND recency <= 20  -- Last 20 trades
)
SELECT
  AVG(pnl) as avgPnl,
  STDDEV(pnl) as stdDev,
  AVG(pnl) / STDDEV(pnl) as sharpe
FROM rolling_trades;

-- This gives Sharpe over last 20 trades (more responsive to regime changes)
-- vs all-time Sharpe (which includes old volatility)
```

**Implication:** Recent performance matters more than old. Model should retrain on recent data.

---

### Edge Case E3: Morphology Never Appears in Recent Trades

**Problem:** Win rate for 'exhaustion' is NULL (no recent trades)

**Solution:**
```sql
-- Use default/fallback prediction
SELECT
  m.morphology,
  COALESCE(
    ROUND(100.0 * SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*), 1),
    50.0  -- Default to 50% if no recent data (uninformed)
  ) as winRate,
  COUNT(*) as recentTradeCount
FROM (
  SELECT 'impulse' as morphology
  UNION SELECT 'accumulation'
  UNION SELECT 'mean_reversion'
  UNION SELECT 'exhaustion'
) m
LEFT JOIN execution_ledger e ON m.morphology = e.buyMorphology
  AND e.buyTimestamp >= DATE('now', '-30 days')
GROUP BY m.morphology;

-- Output:
-- morphology     | winRate | recentTradeCount
-- impulse        | 87.5%   | 8
-- accumulation   | 66.7%   | 6
-- mean_reversion | 40.0%   | 5
-- exhaustion     | 50.0%   | 0  ← Default (no data)
```

**Implication:** If a morphology hasn't appeared recently, predict 50% (no edge).

---

### Edge Case E4: Model Prediction = 0.5 But Trade Wins

**Problem:** Brier score = (0.5 - 1)^2 = 0.25 (not penalizing uncertainty)

**Solution:** This is correct behavior!
- Prediction 0.5 = "I don't know" (50/50 toss-up)
- Trade wins (outcome 1) → Brier 0.25 (medium error)
- Model was uncertain, got lucky (not a good prediction)
- If 20 similar trades (all prediction 0.5) → 10 win, 10 lose
  - Brier = mean(0.25 + 0.25 + ...) = 0.25 (perfectly calibrated)

**Implication:** Models that say "I don't know" (0.5) are correct 50% of the time, with Brier 0.25. This is baseline; useful models should have Brier < 0.25.

---

### Edge Case E5: All Trades in a Period Are Wins

**Problem:** Brier score = 0 (perfect), but sample size = 3

**Solution:**
```sql
-- Add confidence interval (Bayesian approach)
SELECT
  buyMorphology,
  COUNT(*) as sampleSize,
  ROUND(100.0 * SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as winRate,
  CASE
    WHEN sampleSize < 5 THEN 'very low confidence'
    WHEN sampleSize < 10 THEN 'low confidence'
    WHEN sampleSize < 30 THEN 'medium confidence'
    ELSE 'high confidence'
  END as confidenceLevel
FROM learning_loop_feedback
GROUP BY buyMorphology;

-- Action: Don't update model weights based on 3-trade sample
-- Need at least 10-30 trades per morphology before retraining
```

**Implication:** Small samples are noisy. Require minimum sample size before updating weights.

---

### Edge Case E6: Scheduled Retrain But No Recent Trades

**Problem:** Weekly retrain job runs, but no new trades since last week

**Solution:**
```python
def weekly_retrain():
    recent_trades = db.query("""
        SELECT * FROM execution_ledger
        WHERE buyTimestamp >= DATE('now', '-7 days')
    """)
    
    if len(recent_trades) < MIN_TRADES_FOR_RETRAIN:  # e.g., 10
        print(f"Skipping retrain: only {len(recent_trades)} trades (need {MIN_TRADES_FOR_RETRAIN})")
        return  # Don't retrain on tiny sample
    
    # Otherwise, proceed
    model = ExecutionMasteryModel()
    new_version = model.retrain(recent_trades)
    print(f"Model updated: {new_version}")
```

**Implication:** Retrain only if there's enough new data. Otherwise, keep using old model.

---

## Part 4: Implementation Roadmap (Week 7-12)

### Week 7: Data Layer (Immutable Ledger)

**Goal:** Set up D1 schema + ingestion pipeline

**Invariants to enforce:**
- E1: buyMorphology is immutable (INSERT only, no UPDATE)
- E3: outcome is deterministic (calculated at exit time, locked)
- E4: morphology comes from classifier, never overridden

**Implementation:**
```typescript
// Week 7: Create D1 schema
db.execute(`
  CREATE TABLE execution_ledger (
    id INTEGER PRIMARY KEY,
    tradeId TEXT UNIQUE NOT NULL,
    buyTimestamp TIMESTAMP NOT NULL,
    buyMorphology TEXT NOT NULL,  -- Immutable
    buyGreeks JSON NOT NULL,       -- Immutable
    buyPrice REAL NOT NULL,        -- Immutable
    
    sellTimestamp TIMESTAMP,
    sellPrice REAL,
    pnl REAL,
    outcome INTEGER,               -- Immutable (calculated once)
    
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- No updatedAt (immutable)
  );
  
  CREATE TRIGGER enforce_immutability
  BEFORE UPDATE ON execution_ledger
  FOR EACH ROW
  BEGIN
    -- Prevent update to immutable fields
    IF NEW.buyMorphology != OLD.buyMorphology THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'buyMorphology is immutable';
    END IF;
    IF NEW.buyPrice != OLD.buyPrice THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'buyPrice is immutable';
    END IF;
    -- Allow updates to exit fields only
  END;
`);

// Week 7: Ingest CSV from Tradovate
async function ingestPerformanceCSV(csv: string) {
  const rows = csv.split('\n').slice(1);  // Skip header
  
  for (const row of rows) {
    const [symbol, _, __, tickSize, buyFillId, sellFillId, qty, buyPrice, sellPrice, pnl, boughtTime, soldTime, duration] = row.split(',');
    
    // Parse timestamps
    const buyTimestamp = parseDate(boughtTime);
    const sellTimestamp = parseDate(soldTime);
    
    // Get morphology @ buy time (classifier, not manual)
    const morphology = await morphologyClassifier.getAtTime(buyTimestamp, symbol);
    
    // Get Greeks @ buy time
    const greeks = await greeksAPI.getAtTime(buyTimestamp, symbol);
    
    // Insert (immutable)
    db.insert('execution_ledger', {
      tradeId: uuid(),
      symbol,
      qty,
      tickSize,
      buyFillId,
      sellFillId,
      buyPrice: parseFloat(buyPrice),
      sellPrice: parseFloat(sellPrice),
      buyTimestamp,
      sellTimestamp,
      buyMorphology: morphology,  // From classifier
      buyGreeks: greeks,
      pnl: parseFloat(pnl),
      outcome: parseFloat(pnl) > 0 ? 1 : 0,
      createdAt: Date.now()
    });
  }
}
```

---

### Week 8: Analytics Layer

**Goal:** Aggregate trades by morphology, calculate metrics

**Abstractions to implement:**
- A2: Morphology-stratified performance
- A3: Time-stratified analysis
- A4: Hold time as feature

**Implementation:**
```sql
-- Week 8: Create views for analytics
CREATE VIEW morphology_daily AS
SELECT
  DATE(buyTimestamp) as tradeDate,
  buyMorphology,
  symbol,
  COUNT(*) as tradeCount,
  SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) as winCount,
  ROUND(100.0 * SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as winRate,
  ROUND(AVG(pnl), 0) as avgPnl,
  ROUND(STDDEV(pnl), 0) as stdDevPnl,
  ROUND((AVG(pnl) - 0) / NULLIF(STDDEV(pnl), 0), 2) as sharpeRatio
FROM execution_ledger
GROUP BY tradeDate, buyMorphology, symbol;

CREATE VIEW hold_duration_analysis AS
SELECT
  buyMorphology,
  CASE 
    WHEN holdMinutes < 5 THEN 'scalp'
    WHEN holdMinutes < 60 THEN 'short-term'
    WHEN holdMinutes < 240 THEN 'intra-day'
    ELSE 'swing'
  END as holdCategory,
  COUNT(*) as tradeCount,
  ROUND(100.0 * SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as winRate,
  ROUND(AVG(profitPerHour), 0) as profitPerHour
FROM execution_ledger
GROUP BY buyMorphology, holdCategory;
```

---

### Week 9: Learning Loop

**Goal:** Connect predictions to outcomes, calculate Brier scores

**Invariants to enforce:**
- E2: Every prediction tagged with modelVersion

**Implementation:**
```python
# Week 9: Model + Brier score calculation
class ExecutionMasteryModel:
  def predict(self, morphology: str, symbol: str) -> float:
    """Predict win% for this morphology."""
    win_rate = self.weights.get(morphology, 0.5)
    return win_rate
  
  def record_feedback(self, trade: ClosedTrade):
    """Record prediction vs outcome."""
    
    prediction = self.predict(trade.buyMorphology, trade.symbol)
    outcome = trade.outcome  # 1 or 0
    brier = (prediction - outcome) ** 2
    
    db.insert('learning_loop_feedback', {
      tradeId: trade.id,
      predictedWinPct: prediction,
      actualWinLoss: outcome,
      brierScore: brier,
      modelVersion: self.current_version,
      feedbackTimestamp: Date.now()
    });
  
  def retrain(self, recent_trades: List[ClosedTrade]) -> str:
    """Retrain model on recent data."""
    
    if len(recent_trades) < MIN_TRADES:
      return self.current_version  # Skip
    
    # Update weights
    for morphology in MORPHOLOGIES:
      morphology_trades = [t for t in recent_trades if t.buyMorphology == morphology]
      if len(morphology_trades) >= 5:
        win_rate = sum(1 for t in morphology_trades if t.outcome == 1) / len(morphology_trades)
        self.weights[morphology] *= (1 + (win_rate - 0.5) * 0.15)
    
    # New version
    version = f"v{self.version_number}-{today()}"
    self.current_version = version
    
    # Store (immutable)
    self._save_model(version)
    
    return version
```

---

### Week 10: Terminal Integration

**Goal:** Doctrine tab displays results + position sizing

**Implementation:**
```typescript
// Week 10: Update Doctrine tab
const doctrineTab = {
  title: 'Execution Mastery',
  
  render() {
    // Fetch morphology performance (stratified)
    const stats = db.query(`
      SELECT buyMorphology, winRate, avgPnl, sharpeRatio, brierScore
      FROM morphology_daily
      WHERE tradeDate >= DATE('now', '-7 days')
      GROUP BY buyMorphology
    `);
    
    // Display heatmap
    const heatmap = {
      impulse: {
        winRate: '87.5%',     color: 'green',
        sharpe: '2.3',        indicator: '✅ Excellent',
        action: '↑ Scale 1.2x',
        brier: '0.12'         // Forecast accuracy
      },
      accumulation: {
        winRate: '66.7%',     color: 'yellow',
        sharpe: '1.1',        indicator: '⚠️ Fair',
        action: '= Keep 1.0x',
        brier: '0.28'
      },
      // ...
    };
    
    // Position sizing adjustment
    return render(heatmap);
  }
};
```

---

### Week 11-12: Optimization

**Goal:** A/B testing, regime detection, continuous improvement

**Implementation:**
```python
# Week 11: A/B testing framework
def run_experiment(hypothesis: str, control_weight: float, treatment_weight: float):
  """Run A/B test on model weights."""
  
  # Control: use current weights
  control_model = self.current_model
  
  # Treatment: adjust impulse weight
  treatment_model = Model()
  treatment_model.weights['impulse'] *= 1.1  # Increase by 10%
  
  # Split traffic (alternating trades, or by user cohort)
  for trade in recent_trades:
    if trade.id % 2 == 0:
      pred = control_model.predict(trade.morphology)
      tag = 'control'
    else:
      pred = treatment_model.predict(trade.morphology)
      tag = 'treatment'
    
    # Record with tag
    db.insert('learning_loop_feedback', {
      ...trade,
      hypothesis: hypothesis,
      experiment_tag: tag
    });
  
  # Analyze results
  control_brier = db.query("SELECT AVG(brierScore) FROM learning_loop_feedback WHERE experiment_tag='control'")[0]
  treatment_brier = db.query("SELECT AVG(brierScore) FROM learning_loop_feedback WHERE experiment_tag='treatment'")[0]
  
  if treatment_brier < control_brier:
    print(f"Treatment wins! {treatment_brier} < {control_brier}")
    return treatment_model
  else:
    print(f"Control wins (or tied)")
    return control_model
```

---

## Summary: Robust Techniques Extracted from Performance

| Technique | Market-Independent | Reason | Week |
|-----------|---|---|---|
| **Brier Score Feedback** | ✅ Yes | Works on any prediction task | 9 |
| **Morphology Stratification** | ✅ Yes | Any market has conditions | 8 |
| **Time Stratification** | ✅ Yes | Detect regime changes | 8 |
| **Hold-Time Features** | ✅ Yes | Timing is universal | 8 |
| **Trade Immutability** | ✅ Yes | Prevent rewriting history | 7 |
| **Model Versioning** | ✅ Yes | Track what changed when | 9 |
| **Calibration Checks** | ✅ Yes | Ensure honest predictions | 9 |
| **A/B Testing** | ✅ Yes | Hypothesis validation | 11 |

**All these work for:**
- Any asset class (futures, options, stocks, crypto)
- Any time horizon (scalping to swing)
- Different market regimes (bull, bear, sideways)
- Different trader profiles (risk-averse to aggressive)

---

**Status:** Deep analysis complete (Week 6)  
**Next:** Begin Week 7 implementation with D1 schema + immutability enforcement
