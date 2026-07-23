-- Tensor Greeks Engine Schema
-- Stores full 6×6 Hessian matrix (second derivatives of option price)
-- and eigenvalue analysis for detecting market geometry and ill-conditioning

-- Tensor Greeks state: 6×6 Hessian matrix + eigenanalysis
CREATE TABLE IF NOT EXISTS tensor_greeks_state (
  userId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  instrumentSymbol TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- First-order Greeks (diagonal of Hessian)
  delta REAL,
  gamma REAL,
  vega REAL,
  theta REAL,
  rho REAL,
  dealer_sensitivity REAL,

  -- Second-order Greeks (off-diagonal Hessian elements)
  -- gamma_vega: how gamma changes with vol (∂γ/∂σ)
  gamma_vega REAL,
  -- vega_theta: how vega decays with time (∂ν/∂t)
  vega_theta REAL,
  -- gamma_theta: how gamma decays with time (∂γ/∂t)
  gamma_theta REAL,
  -- gamma_dealer: gamma feedback from dealer positioning (∂γ/∂dealer_gamma)
  gamma_dealer REAL,
  -- vega_dealer: vol response to dealer (∂ν/∂dealer_gamma)
  vega_dealer REAL,
  -- theta_rho: how theta changes with rates (∂θ/∂r)
  theta_rho REAL,

  -- Eigenvalue analysis
  -- Store as JSON: [λ_1, λ_2, λ_3, λ_4, λ_5, λ_6] (sorted descending)
  eigenvalues JSON,
  -- Eigenvector of largest eigenvalue (principal Greeks direction)
  principal_eigenvector JSON,

  -- Condition number (λ_max / λ_min): ill-conditioning indicator
  -- High condition number = small price moves → huge P&L swings
  condition_number REAL,

  -- Hessian matrix (full 6×6 for reference)
  -- Stored as JSON: [[row1], [row2], ..., [row6]]
  hessian_matrix JSON,

  -- Stability metrics
  trace_H REAL,  -- Sum of diagonal (sum of all curvatures)
  det_H REAL,    -- Determinant (volume of curvature ellipsoid)
  frobenius_norm REAL,  -- ||H||_F (overall magnitude)

  -- Market geometry classification
  -- STABLE: well-conditioned market, predictable Greeks
  -- STRESSED: ill-conditioned, high sensitivity
  -- DEGENERATE: near-singular, extreme Greeks
  geometry_class TEXT DEFAULT 'STABLE',

  -- Risk warnings
  is_ill_conditioned INTEGER DEFAULT 0,  -- 1 if condition_number > 100
  has_gamma_spike INTEGER DEFAULT 0,     -- 1 if gamma > 0.1
  has_vega_theta_coupling INTEGER DEFAULT 0,  -- 1 if |vega_theta| > 0.5
  is_degenerate INTEGER DEFAULT 0,       -- 1 if det_H ≈ 0

  PRIMARY KEY (userId, sessionId, instrumentSymbol, timestamp)
);

-- Index for fast lookup
CREATE INDEX idx_tensor_greeks_user_session ON tensor_greeks_state(userId, sessionId);
CREATE INDEX idx_tensor_greeks_geometry ON tensor_greeks_state(geometry_class);
CREATE INDEX idx_tensor_greeks_timestamp ON tensor_greeks_state(timestamp DESC);

-- Tensor Greeks diagnostics (track over time)
CREATE TABLE IF NOT EXISTS tensor_greeks_diagnostics (
  userId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  instrumentSymbol TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Eigenvalue spectrum (for visualizing market geometry)
  lambda_1 REAL,  -- Largest eigenvalue (principal curvature)
  lambda_2 REAL,
  lambda_3 REAL,
  lambda_4 REAL,
  lambda_5 REAL,
  lambda_6 REAL,  -- Smallest eigenvalue

  -- Principal Greeks direction (which factors matter most?)
  principal_component_S REAL,        -- Price sensitivity
  principal_component_vol REAL,      -- Vol sensitivity
  principal_component_time REAL,     -- Time decay
  principal_component_strike REAL,   -- Strike exposure
  principal_component_rate REAL,     -- Interest rate exposure
  principal_component_dealer REAL,   -- Dealer positioning exposure

  -- Stability trend
  condition_number REAL,
  stability_score REAL,  -- 0-1: 1 = stable, 0 = degenerate

  -- Risk event tracking
  event_gamma_spike INTEGER DEFAULT 0,       -- 1 if gamma > 0.1
  event_ill_conditioning INTEGER DEFAULT 0,  -- 1 if cond_num > 100
  event_theta_acceleration INTEGER DEFAULT 0,-- 1 if |theta| accelerating
  event_dealer_feedback INTEGER DEFAULT 0,   -- 1 if gamma_dealer > 0.05

  PRIMARY KEY (userId, sessionId, instrumentSymbol, timestamp)
);

CREATE INDEX idx_tensor_diag_user_session ON tensor_greeks_diagnostics(userId, sessionId);

-- View: Current Tensor Greeks (latest snapshot)
CREATE VIEW v_tensor_greeks_current AS
SELECT
  userId,
  sessionId,
  instrumentSymbol,
  delta, gamma, vega, theta, rho,
  gamma_vega, vega_theta, gamma_theta, gamma_dealer, vega_dealer,
  condition_number,
  geometry_class,
  is_ill_conditioned,
  has_gamma_spike,
  has_vega_theta_coupling,
  is_degenerate,
  timestamp
FROM tensor_greeks_state
WHERE (userId, sessionId, instrumentSymbol, timestamp) IN (
  SELECT userId, sessionId, instrumentSymbol, MAX(timestamp)
  FROM tensor_greeks_state
  GROUP BY userId, sessionId, instrumentSymbol
);

-- View: Tensor Greeks risk alerts
CREATE VIEW v_tensor_greeks_alerts AS
SELECT
  userId,
  sessionId,
  instrumentSymbol,
  timestamp,
  CASE
    WHEN is_degenerate = 1 THEN 'DEGENERATE: Market near singular; Greeks unreliable'
    WHEN is_ill_conditioned = 1 AND has_gamma_spike = 1 THEN 'CRITICAL: Gamma explosion + ill-conditioning'
    WHEN has_vega_theta_coupling = 1 THEN 'WARNING: Vega-Theta coupling detected; time decay × vol interaction'
    WHEN has_gamma_spike = 1 THEN 'CAUTION: Gamma spike; large price moves → huge P&L swings'
    WHEN is_ill_conditioned = 1 THEN 'WARNING: Ill-conditioned Greeks; condition_number > 100'
    ELSE 'OK: Market geometry stable'
  END AS alert,
  condition_number,
  geometry_class
FROM tensor_greeks_state
WHERE (userId, sessionId, instrumentSymbol, timestamp) IN (
  SELECT userId, sessionId, instrumentSymbol, MAX(timestamp)
  FROM tensor_greeks_state
  GROUP BY userId, sessionId, instrumentSymbol
);

-- View: Principal Greeks over time (what factors matter most?)
CREATE VIEW v_principal_greeks_trend AS
SELECT
  userId,
  sessionId,
  instrumentSymbol,
  timestamp,
  principal_component_S AS price_sensitivity,
  principal_component_vol AS vol_sensitivity,
  principal_component_time AS time_decay,
  principal_component_strike AS strike_exposure,
  principal_component_rate AS rate_exposure,
  principal_component_dealer AS dealer_exposure,
  lambda_1 / (NULLIF(lambda_6, 0)) AS condition_number,
  stability_score
FROM tensor_greeks_diagnostics
ORDER BY timestamp DESC;
