-- Migration 0044: Execution Mastery Ledger Schema
-- Purpose: Trade recording, morphology tracking, learning loop feedback
-- Immutability: buyMorphology, buyGreeks, buyPrice, buyTimestamp are frozen @ entry
-- Versioning: modelVersion tags every prediction

-- Table 1: execution_ledger (every trade: entry → exit)
CREATE TABLE IF NOT EXISTS execution_ledger (
  -- Identifiers
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tradeId TEXT UNIQUE NOT NULL,
  userId TEXT NOT NULL,

  -- Trade Context
  symbol TEXT NOT NULL,              -- 'ESZ26', 'NQU6', 'ZNM26'
  tickSize REAL NOT NULL,            -- 0.25, 0.01, etc.
  qty INTEGER NOT NULL,              -- position size (contracts)

  -- Entry (IMMUTABLE @ record time)
  buyTimestamp TIMESTAMP NOT NULL,
  buyPrice REAL NOT NULL,
  buyGreeks JSON,                    -- {delta, gamma, vega, theta} @ entry
  buyMorphology TEXT NOT NULL,       -- 'impulse', 'accumulation', 'exhaustion', 'meanreversion'
  buyIV REAL,                        -- IV @ entry
  buyFillId TEXT,                    -- Tradovate fill ID (audit trail)

  -- Exit (mutable until closed)
  sellTimestamp TIMESTAMP,           -- NULL if still open
  sellPrice REAL,                    -- NULL if still open
  sellGreeks JSON,                   -- {delta, gamma, vega, theta} @ exit (optional)
  sellFillId TEXT,                   -- Tradovate fill ID (audit trail)

  -- P&L (calculated @ exit)
  pnl REAL,                          -- Realized P&L (dollars), NULL if open
  profitTicks INTEGER,               -- (sellPrice - buyPrice) / tickSize, NULL if open
  holdMinutes INTEGER,               -- (sellTimestamp - buyTimestamp) / 60, NULL if open

  -- Performance Metrics (calculated @ exit)
  roi REAL,                          -- ROI %, NULL if open
  sharpeRatio REAL,                  -- risk-adjusted (calculated later)
  maxDD REAL,                        -- max intraday drawdown (optional)

  -- Feedback (Learning Loop)
  prediction REAL,                   -- model predicted win% (0-1) @ entry
  outcome INTEGER,                   -- 1=win, 0=loss, NULL=open
  brierScore REAL,                   -- (prediction - outcome)^2, NULL=open
  modelVersion TEXT,                 -- which model predicted (e.g., 'v1.1-2026-07-22')

  -- Audit
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (userId) REFERENCES subscriptions(user_id)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_execution_user_symbol
  ON execution_ledger(userId, symbol, buyTimestamp DESC);

CREATE INDEX IF NOT EXISTS idx_execution_morphology
  ON execution_ledger(userId, buyMorphology, buyTimestamp DESC);

CREATE INDEX IF NOT EXISTS idx_execution_timestamp
  ON execution_ledger(userId, buyTimestamp DESC);

CREATE INDEX IF NOT EXISTS idx_execution_open
  ON execution_ledger(userId, outcome)
  WHERE outcome IS NULL;  -- For "open trades" query

---

-- Table 2: morphology_performance (daily aggregation)
CREATE TABLE IF NOT EXISTS morphology_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Grouping
  userId TEXT NOT NULL,
  morphology TEXT NOT NULL,          -- 'impulse', 'accumulation', etc.
  symbol TEXT NOT NULL,              -- 'ESZ26', 'NQU6', etc.
  dateTraded DATE NOT NULL,          -- trading date

  -- Trade Counts
  tradeCount INTEGER NOT NULL,       -- total trades
  winCount INTEGER,                  -- # wins (pnl > 0)
  lossCount INTEGER,                 -- # losses (pnl <= 0)

  -- P&L Aggregates
  totalPnl REAL,                     -- sum(pnl)
  avgPnl REAL,                       -- avg(pnl)
  minPnl REAL,                       -- min(pnl)
  maxPnl REAL,                       -- max(pnl)

  -- Win Rate
  winRate REAL,                      -- winCount / tradeCount (0-1)

  -- Duration
  avgHoldMinutes REAL,               -- avg(holdMinutes)

  -- Risk Metrics
  stdDevPnl REAL,                    -- volatility
  sharpeRatio REAL,                  -- (avgPnl - 0) / stdDevPnl
  profitFactor REAL,                 -- sum(wins) / abs(sum(losses))

  -- Forecast Quality (Brier Score)
  avgPrediction REAL,                -- avg(prediction) across trades
  brierScore REAL,                   -- mean((prediction - outcome)^2)

  -- Metadata
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (userId) REFERENCES subscriptions(user_id),
  UNIQUE(userId, morphology, symbol, dateTraded)
);

CREATE INDEX IF NOT EXISTS idx_morph_perf_composite
  ON morphology_performance(userId, morphology, symbol, dateTraded DESC);

CREATE INDEX IF NOT EXISTS idx_morph_perf_user_date
  ON morphology_performance(userId, dateTraded DESC);

---

-- Table 3: learning_loop_feedback (prediction vs outcome tracking)
CREATE TABLE IF NOT EXISTS learning_loop_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Trade Reference
  tradeId TEXT NOT NULL UNIQUE,
  userId TEXT NOT NULL,

  -- Prediction @ Entry Time
  predictedWinPct REAL NOT NULL,     -- 0-1 (model forecast)
  predictedHoldMinutes INTEGER,      -- optional (model's duration forecast)
  modelVersion TEXT NOT NULL,        -- 'v1.1-2026-07-22' (which model)

  -- Actual Outcome (@ Exit Time)
  actualWinLoss INTEGER NOT NULL,    -- 1=win, 0=loss
  actualHoldMinutes INTEGER,

  -- Scoring
  brierScore REAL NOT NULL,          -- (predicted - actual)^2
  calibrationError REAL,             -- prediction - outcome (signed error)

  -- Metadata
  feedbackTimestamp TIMESTAMP,       -- when outcome was recorded
  hypothesis TEXT,                   -- optional A/B test label

  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (userId) REFERENCES subscriptions(user_id),
  FOREIGN KEY (tradeId) REFERENCES execution_ledger(tradeId)
);

CREATE INDEX IF NOT EXISTS idx_feedback_user
  ON learning_loop_feedback(userId, feedbackTimestamp DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_model
  ON learning_loop_feedback(userId, modelVersion, feedbackTimestamp DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_hypothesis
  ON learning_loop_feedback(userId, hypothesis)
  WHERE hypothesis IS NOT NULL;  -- For A/B test queries

---

-- Views for analytics

-- Daily morphology performance (aggregated)
CREATE VIEW IF NOT EXISTS v_morphology_daily AS
SELECT
  userId,
  DATE(buyTimestamp) as tradeDate,
  buyMorphology as morphology,
  symbol,
  COUNT(*) as tradeCount,
  SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) as winCount,
  SUM(CASE WHEN outcome = 0 THEN 1 ELSE 0 END) as lossCount,
  ROUND(100.0 * SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as winRate,
  ROUND(AVG(pnl), 0) as avgPnl,
  ROUND(SUM(pnl), 0) as totalPnl,
  ROUND(AVG(holdMinutes), 0) as avgHoldMinutes,
  ROUND(STDDEV_POP(pnl), 0) as stdDevPnl
FROM execution_ledger
WHERE outcome IS NOT NULL  -- Only closed trades
GROUP BY userId, tradeDate, buyMorphology, symbol;

-- Hold time analysis (by duration category)
CREATE VIEW IF NOT EXISTS v_hold_time_analysis AS
SELECT
  userId,
  buyMorphology as morphology,
  CASE
    WHEN holdMinutes < 5 THEN 'scalp'
    WHEN holdMinutes < 60 THEN 'short-term'
    WHEN holdMinutes < 240 THEN 'intra-day'
    ELSE 'swing'
  END as holdCategory,
  COUNT(*) as tradeCount,
  SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) as winCount,
  ROUND(100.0 * SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as winRate,
  ROUND(AVG(holdMinutes), 0) as avgHoldMinutes,
  ROUND(AVG(pnl) / (AVG(holdMinutes) / 60.0), 0) as profitPerHour
FROM execution_ledger
WHERE outcome IS NOT NULL  -- Only closed trades
GROUP BY userId, buyMorphology, holdCategory;

-- Open trades (still waiting for exit)
CREATE VIEW IF NOT EXISTS v_open_trades AS
SELECT
  userId,
  tradeId,
  symbol,
  qty,
  buyPrice,
  buyTimestamp,
  buyMorphology,
  buyGreeks,
  prediction,
  modelVersion,
  ROUND((CAST(julianday('now') - julianday(buyTimestamp) AS REAL)) * 24 * 60, 0) as minutesOpen
FROM execution_ledger
WHERE outcome IS NULL  -- Still open
ORDER BY buyTimestamp DESC;

-- Model calibration (predicted vs actual win rates)
CREATE VIEW IF NOT EXISTS v_model_calibration AS
SELECT
  userId,
  modelVersion,
  ROUND(predictedWinPct * 10) / 10 as predictionBucket,
  COUNT(*) as predictions,
  SUM(actualWinLoss) as actualWins,
  ROUND(100.0 * SUM(actualWinLoss) / COUNT(*), 1) as actualWinRate,
  ROUND(predictionBucket * 100, 1) as modelPredictedWinRate,
  ROUND(AVG(brierScore), 3) as avgBrierScore
FROM learning_loop_feedback
GROUP BY userId, modelVersion, predictionBucket
ORDER BY userId, modelVersion, predictionBucket;

-- Model degradation detection (is Brier increasing over time?)
CREATE VIEW IF NOT EXISTS v_model_degradation AS
SELECT
  userId,
  modelVersion,
  DATE(feedbackTimestamp) as feedbackDate,
  COUNT(*) as predictions,
  ROUND(AVG(brierScore), 3) as avgBrierScore,
  ROUND(AVG(brierScore) - LAG(ROUND(AVG(brierScore), 3))
    OVER (PARTITION BY userId, modelVersion ORDER BY DATE(feedbackTimestamp)), 3) as brierTrend
FROM learning_loop_feedback
GROUP BY userId, modelVersion, DATE(feedbackTimestamp)
ORDER BY userId, modelVersion, feedbackDate DESC;
