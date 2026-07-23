-- Kalman Morphology Filter State Schema
-- Stores Kalman filter estimates (true morphology probabilities + covariance)
-- across sessions for persistent state estimation

-- Kalman filter state: P (covariance matrix), x_hat (state estimate)
CREATE TABLE IF NOT EXISTS kalman_morphology_state (
  userId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  instrumentSymbol TEXT NOT NULL,

  -- Timestamp
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Kalman filter state vector: [impulse_prob, accum_prob, exhaust_prob, mr_prob]
  -- These are the filtered (smoothed) morphology probabilities
  x_impulse REAL DEFAULT 0.25,
  x_accumulation REAL DEFAULT 0.25,
  x_exhaustion REAL DEFAULT 0.25,
  x_mean_reversion REAL DEFAULT 0.25,

  -- Covariance matrix (4x4 symmetric) — stored as JSON for flexibility
  -- P_matrix = [[P_00, P_01, P_02, P_03],
  --             [P_01, P_11, P_12, P_13],
  --             [P_02, P_12, P_22, P_23],
  --             [P_03, P_13, P_23, P_33]]
  covariance_matrix JSON,

  -- Process noise Q (morphology stability) — diagonal matrix
  -- Tuning parameter: how fast can morphology shift?
  -- Q = [[q_impulse, 0, 0, 0],
  --      [0, q_accum, 0, 0],
  --      [0, 0, q_exhaust, 0],
  --      [0, 0, 0, q_mr]]
  process_noise_q JSON DEFAULT '{"impulse": 0.01, "accumulation": 0.01, "exhaustion": 0.01, "mean_reversion": 0.01}',

  -- Measurement noise R (classifier noise) — diagonal matrix
  -- Tuning parameter: how noisy is the raw classifier?
  measurement_noise_r JSON DEFAULT '{"impulse": 0.05, "accumulation": 0.05, "exhaustion": 0.05, "mean_reversion": 0.05}',

  -- Last observation (raw morphology from classifier) for debugging
  last_observation_impulse REAL,
  last_observation_accumulation REAL,
  last_observation_exhaustion REAL,
  last_observation_mean_reversion REAL,

  -- Innovation (residual) from last update
  last_innovation JSON,

  -- Kalman gain (for monitoring)
  last_kalman_gain JSON,

  PRIMARY KEY (userId, sessionId, instrumentSymbol)
);

-- Index for fast lookup by user + session
CREATE INDEX idx_kalman_state_user_session ON kalman_morphology_state(userId, sessionId);
CREATE INDEX idx_kalman_state_instrument ON kalman_morphology_state(userId, instrumentSymbol);

-- Kalman filter metrics (for monitoring filter health)
CREATE TABLE IF NOT EXISTS kalman_filter_diagnostics (
  userId TEXT NOT NULL,
  sessionId TEXT NOT NULL,
  instrumentSymbol TEXT NOT NULL,

  -- Timestamp
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Filter diagnostics
  trace_P REAL,  -- Trace of covariance (total uncertainty)
  det_P REAL,    -- Determinant of covariance
  condition_number REAL,  -- Condition number (ill-conditioning indicator)

  -- Residual statistics
  residual_mean JSON,  -- Mean innovation for each morphology
  residual_stddev JSON,  -- Std dev of innovations

  -- Confidence scores (derived from covariance diagonal)
  impulse_confidence REAL,
  accumulation_confidence REAL,
  exhaustion_confidence REAL,
  mean_reversion_confidence REAL,

  PRIMARY KEY (userId, sessionId, instrumentSymbol, createdAt)
);

CREATE INDEX idx_kalman_diag_user_session ON kalman_filter_diagnostics(userId, sessionId);

-- View: Current Kalman morphology estimates (latest state)
CREATE VIEW v_kalman_morphology_current AS
SELECT
  userId,
  sessionId,
  instrumentSymbol,
  x_impulse,
  x_accumulation,
  x_exhaustion,
  x_mean_reversion,
  -- Confidence scores (1 / sqrt(P_ii))
  CASE WHEN json_extract(covariance_matrix, '$.P_00') > 0
    THEN 1.0 / sqrt(json_extract(covariance_matrix, '$.P_00'))
    ELSE 0.0
  END AS impulse_confidence,
  CASE WHEN json_extract(covariance_matrix, '$.P_11') > 0
    THEN 1.0 / sqrt(json_extract(covariance_matrix, '$.P_11'))
    ELSE 0.0
  END AS accumulation_confidence,
  CASE WHEN json_extract(covariance_matrix, '$.P_22') > 0
    THEN 1.0 / sqrt(json_extract(covariance_matrix, '$.P_22'))
    ELSE 0.0
  END AS exhaustion_confidence,
  CASE WHEN json_extract(covariance_matrix, '$.P_33') > 0
    THEN 1.0 / sqrt(json_extract(covariance_matrix, '$.P_33'))
    ELSE 0.0
  END AS mean_reversion_confidence,
  updatedAt
FROM kalman_morphology_state;

-- View: Kalman filter performance (residuals over time)
CREATE VIEW v_kalman_filter_health AS
SELECT
  userId,
  sessionId,
  instrumentSymbol,
  createdAt,
  trace_P,
  condition_number,
  json_extract(residual_mean, '$.impulse') AS residual_impulse_mean,
  json_extract(residual_mean, '$.accumulation') AS residual_accum_mean,
  json_extract(residual_stddev, '$.impulse') AS residual_impulse_stddev,
  json_extract(residual_stddev, '$.accumulation') AS residual_accum_stddev
FROM kalman_filter_diagnostics
ORDER BY createdAt DESC;
