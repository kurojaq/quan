-- Stochastic Regime Engine Schema
-- Stores Ornstein-Uhlenbeck (OU) process parameters + regime classifications
-- for real-time vol mean-reversion analysis

-- OU process parameters + regime classification
CREATE TABLE IF NOT EXISTS stochastic_regime_state (
  userId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  instrumentSymbol TEXT NOT NULL,

  -- Timestamp
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Regime classification
  -- TRENDING = low mean reversion speed (κ < 0.02) → momentum dominates
  -- MEAN_REVERT = high mean reversion speed (κ > 0.05) → vol clustering
  -- NEUTRAL = intermediate (0.02 ≤ κ ≤ 0.05)
  regime TEXT NOT NULL DEFAULT 'NEUTRAL',
  regime_confidence REAL DEFAULT 0.5,  -- 0-1, how sure are we?

  -- Ornstein-Uhlenbeck parameters (fitted from recent vol data)
  -- OU: dσ(t) = κ(σ̄ - σ(t))dt + η*dW(t)
  kappa REAL NOT NULL DEFAULT 0.03,  -- Mean reversion speed (1/days)
  sigma_bar REAL NOT NULL DEFAULT 0.20,  -- Long-run vol mean (annualized)
  eta REAL NOT NULL DEFAULT 0.05,  -- Vol-of-vol (volatility of volatility)

  -- AR(1) fitted parameters (discrete approximation)
  -- σ(t) = θ_0 + θ_1*σ(t-1) + ε(t)
  theta_0 REAL,  -- Intercept
  theta_1 REAL,  -- Persistence (AR coefficient, range [0,1])

  -- Fit statistics (for monitoring regime detection quality)
  r_squared REAL,  -- Goodness of fit
  fit_residual_stddev REAL,  -- Residual noise level

  -- Recent realized volatility
  realized_vol_window_60min REAL,  -- Last 60 minutes
  realized_vol_window_240min REAL,  -- Last 4 hours (240 min)

  -- IV term structure (vol curve)
  iv_atm REAL,  -- IV at-the-money
  iv_25delta_call REAL,  -- 25-delta call IV
  iv_25delta_put REAL,  -- 25-delta put IV
  skew REAL,  -- (IV_put - IV_call) / IV_atm

  -- Vol × price correlation
  vol_price_correlation REAL,  -- Correlation coefficient

  PRIMARY KEY (userId, sessionId, instrumentSymbol)
);

-- Index for fast lookup
CREATE INDEX idx_regime_state_user_session ON stochastic_regime_state(userId, sessionId);
CREATE INDEX idx_regime_state_instrument ON stochastic_regime_state(userId, instrumentSymbol);
CREATE INDEX idx_regime_state_regime ON stochastic_regime_state(regime);

-- Historical regime data (for backtesting + learning loop)
CREATE TABLE IF NOT EXISTS regime_history (
  userId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  instrumentSymbol TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Regime at this timestamp
  regime TEXT NOT NULL,
  regime_confidence REAL,

  -- OU parameters at this time
  kappa REAL,
  sigma_bar REAL,
  eta REAL,

  -- Vol data
  realized_vol REAL,
  iv_atm REAL,

  -- Outcome (for learning loop)
  -- Next morphology transition? (populated retroactively)
  next_morphology_transition TEXT,
  morphology_transition_timestamp TIMESTAMP,
  time_to_transition_minutes INTEGER,

  PRIMARY KEY (userId, sessionId, instrumentSymbol, timestamp)
);

CREATE INDEX idx_regime_history_user_session ON regime_history(userId, sessionId);
CREATE INDEX idx_regime_history_time ON regime_history(timestamp DESC);

-- Regime transition statistics (for A/B testing)
CREATE TABLE IF NOT EXISTS regime_transition_stats (
  userId TEXT NOT NULL,
  from_regime TEXT NOT NULL,
  to_regime TEXT NOT NULL,
  instrumentSymbol TEXT NOT NULL,

  -- Transition statistics
  transition_count INTEGER DEFAULT 0,
  avg_time_to_transition REAL,  -- Minutes from regime change to morphology transition
  median_time_to_transition REAL,
  std_dev_time REAL,

  -- Trading outcome stats
  avg_pnl_following_transition REAL,
  win_rate_after_transition REAL,
  sharpe_ratio_after_transition REAL,

  -- Last transition timestamp
  last_transition_at TIMESTAMP,

  PRIMARY KEY (userId, from_regime, to_regime, instrumentSymbol)
);

-- View: Current regime (latest state)
CREATE VIEW v_stochastic_regime_current AS
SELECT
  userId,
  sessionId,
  instrumentSymbol,
  regime,
  regime_confidence,
  kappa,
  sigma_bar,
  eta,
  theta_1 AS persistence,
  realized_vol_window_60min,
  realized_vol_window_240min,
  iv_atm,
  skew,
  vol_price_correlation,
  updatedAt
FROM stochastic_regime_state;

-- View: Regime effectiveness (which regime leads to better outcomes?)
CREATE VIEW v_regime_effectiveness AS
SELECT
  userId,
  from_regime,
  to_regime,
  instrumentSymbol,
  transition_count,
  avg_pnl_following_transition,
  win_rate_after_transition,
  sharpe_ratio_after_transition,
  last_transition_at,
  -- Effectiveness score (higher = better)
  (win_rate_after_transition * 2 + sharpe_ratio_after_transition) / 3 AS effectiveness_score
FROM regime_transition_stats
WHERE transition_count >= 5  -- Only consider regimes with sufficient data
ORDER BY effectiveness_score DESC;
