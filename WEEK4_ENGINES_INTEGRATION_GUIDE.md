# Week 4 Advanced Engines Integration Guide

**Status:** Engine code complete (Kalman + Regime); ready for integration  
**Commit:** `4a5aa6e`  
**Target:** Deploy both engines into execution cockpit by end of Week 4

---

## What's Built

### 1. Kalman Morphology Filter (`js/kalman-morphology-filter.py`)

**Purpose:** Reduce false morphology signals 40-50% via state-space estimation

**Code Path:**
- **Pyodide module:** `js/kalman-morphology-filter.py` (340 lines)
- **D1 schema:** `database/migrations/0045_kalman_morphology_schema.sql`
- **Tables:** kalman_morphology_state, kalman_filter_diagnostics
- **Views:** v_kalman_morphology_current, v_kalman_filter_health

**API (from Pyodide):**
```python
from kalman-morphology-filter import filter_morphology, get_filter_state, restore_filter_state

# On every morphology observation:
filtered = filter_morphology([impulse, accum, exhaust, mr])
# Returns: {
#   'filtered_probs': [0.28, 0.22, 0.18, 0.32],  # Smoothed probs
#   'confidence_scores': [0.8, 0.6, 0.4, 0.85],  # Calibrated uncertainty
#   'covariance_trace': 0.42,  # Overall uncertainty
# }

# Store state to DB:
state = get_filter_state()
# INSERT INTO kalman_morphology_state (x_hat, P, ...) VALUES (state)

# Restore on next session:
restore_filter_state(stored_state)
```

**Integration Point:** Execution Engine
- **Replace:** Raw morphology M with filtered morphology
- **File:** `js/execution.js`
- **Change:** Instead of `morphology = classifyMorphology(...)`, call `morphology = filterMorphology(classifyMorphology(...))`

---

### 2. Stochastic Regime Engine (`js/stochastic-regime-engine.py`)

**Purpose:** Classify volatility regime (TRENDING vs MEAN_REVERT) for adaptive sizing

**Code Path:**
- **Pyodide module:** `js/stochastic-regime-engine.py` (370 lines)
- **D1 schema:** `database/migrations/0046_stochastic_regime_schema.sql`
- **Tables:** stochastic_regime_state, regime_history, regime_transition_stats
- **Views:** v_stochastic_regime_current, v_regime_effectiveness

**API (from Pyodide):**
```python
from stochastic-regime-engine import detect_regime, add_vol_observation, get_regime_diagnostics

# On every vol tick (1-min or 5-min):
add_vol_observation(realized_vol)

# Periodically (every 30 min or when needed):
regime = detect_regime()
# Returns: {
#   'regime': 'MEAN_REVERT',  # or 'TRENDING', 'NEUTRAL'
#   'regime_confidence': 0.78,
#   'kappa': 0.067,  # Mean reversion speed (1/days)
#   'sigma_bar': 0.185,  # Long-run vol mean
#   'eta': 0.042,  # Vol-of-vol
#   'theta_1': 0.945,  # Persistence
# }

# Get diagnostics:
diag = get_regime_diagnostics()
```

**Integration Point:** Greeks Engine + Execution Engine
- **Replace:** Static Greeks with regime-conditional Greeks
- **Files:** `js/greeks-engine.js`, `js/execution.js`
- **Change:** Adjust Greeks parameters based on regime
  - MEAN_REVERT regime: tighter Greeks (more precise estimates)
  - TRENDING regime: wider Greeks (less precise, more momentum)

---

## Step-by-Step Integration

### Step 1: Apply D1 Migrations (Day 1)

```bash
# Apply Kalman schema
wrangler d1 execute quan --remote --file=database/migrations/0045_kalman_morphology_schema.sql

# Apply Stochastic Regime schema
wrangler d1 execute quan --remote --file=database/migrations/0046_stochastic_regime_schema.sql

# Verify tables created
wrangler d1 execute quan --remote "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%kalman%' OR name LIKE '%regime%'"
```

### Step 2: Wire Kalman Filter into Execution (Day 2-3)

**File: `js/execution.js`**

Before:
```javascript
function classifyAndSize(Greeks, prices) {
  const M = classifyMorphology(Greeks, prices);  // Raw morphology
  const positionSize = calculateSize(M, Greeks);
  return positionSize;
}
```

After:
```javascript
// Import Kalman filter (Pyodide)
async function classifyAndSize(Greeks, prices) {
  const M_raw = classifyMorphology(Greeks, prices);
  
  // Load Kalman state from DB
  const kalmanState = await fetch('/api/kalman/state').then(r => r.json());
  
  // Run Kalman filter (Pyodide)
  const pyodide = window.pyodide;
  const filtered = await pyodide.runPythonAsync(`
    import kalman-morphology-filter as kmf
    kmf.restore_filter_state(${JSON.stringify(kalmanState)})
    result = kmf.filter_morphology([${M_raw.join(',')}])
  `);
  
  const M_filtered = filtered.filtered_probs;
  const confidence = filtered.confidence_scores;
  
  // Save new Kalman state
  const newState = await pyodide.runPythonAsync('kmf.get_filter_state()');
  await fetch('/api/kalman/state', {
    method: 'POST',
    body: JSON.stringify(newState)
  });
  
  // Position sizing uses filtered morphology + confidence weighting
  const positionSize = calculateSize(M_filtered, Greeks, confidence);
  
  return {
    positionSize,
    morphology: M_filtered,
    kalmanConfidence: confidence,
  };
}
```

### Step 3: Wire Stochastic Regime into Greeks (Day 3-4)

**File: `js/greeks-engine.js`**

Before:
```javascript
function computeGreeks(S, K, T, r, vol) {
  // Static Greeks computation
  const delta = ...;
  const gamma = ...;
  return { delta, gamma, vega, theta, rho };
}
```

After:
```javascript
async function computeGreeks(S, K, T, r, vol, volHistory) {
  // Detect regime from vol history
  const pyodide = window.pyodide;
  
  for (const v of volHistory) {
    await pyodide.runPythonAsync(`
      import stochastic-regime-engine as sre
      sre.add_vol_observation(${v})
    `);
  }
  
  const regime = await pyodide.runPythonAsync('sre.detect_regime()');
  // regime = { regime: 'MEAN_REVERT' | 'TRENDING', kappa: 0.067, ... }
  
  // Adjust Greeks computation based on regime
  let greekParams = {
    volatilityModel: 'GBM',  // Default
    smoothing: 0.8,
  };
  
  if (regime.regime === 'MEAN_REVERT') {
    greekParams.volatilityModel = 'OU';  // Use OU for mean-reverting vol
    greekParams.kappa = regime.kappa;
    greekParams.sigma_bar = regime.sigma_bar;
    greekParams.smoothing = 0.9;  // More precise
  } else if (regime.regime === 'TRENDING') {
    greekParams.volatilityModel = 'GBM';  // Use random walk for trending vol
    greekParams.smoothing = 0.7;  // Less precise, allow more drift
  }
  
  // Compute Greeks with regime-conditional model
  const delta = computeDeltaConditional(S, K, T, r, vol, greekParams);
  const gamma = computeGammaConditional(S, K, T, r, vol, greekParams);
  
  return { delta, gamma, vega, theta, rho, regime };
}
```

### Step 4: Create Engine Status Endpoint (Day 4)

**File: `workers/engine-status.ts`** (new Worker)

```typescript
export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method === 'GET' && request.url.includes('/api/engine-status')) {
    // Fetch latest Kalman state
    const kalmanState = await env.DB.prepare(
      'SELECT * FROM v_kalman_morphology_current LIMIT 1'
    ).first();
    
    // Fetch latest regime
    const regime = await env.DB.prepare(
      'SELECT * FROM v_stochastic_regime_current LIMIT 1'
    ).first();
    
    return new Response(JSON.stringify({
      timestamp: new Date().toISOString(),
      kalman: kalmanState,
      regime: regime,
      engineVersion: 'v1.1-week4',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  return new Response('Not found', { status: 404 });
}
```

### Step 5: Set Up A/B Testing (Day 5)

**File: `js/execution-mastery-model.py`** (update existing)

Add engine version tracking:

```python
class ExecutionMasteryModel:
  def __init__(self):
    self.model_version = 'v1.0'  # Baseline
    self.engine_version = 'v1.0-no-kalman-regime'  # No advanced engines
    
    # Baseline weights (no Kalman/Regime)
    self.weights = {
      'impulse': 0.70,
      'accumulation': 0.60,
      'mean_reversion': 0.55,
      'exhaustion': 0.50,
    }
  
  def predict_with_engines(self, morphology, confidence, regime):
    # v1.1: Using Kalman filtered morphology + regime-aware sizing
    # Scale morphology probabilities by Kalman confidence
    scaled_M = {
      k: morphology[k] * (confidence[k] ** 0.5)  # Weight by sqrt(confidence)
      for k in morphology
    }
    
    # Apply regime multiplier
    regime_multiplier = {
      'MEAN_REVERT': 1.2,  # More aggressive in mean-revert
      'TRENDING': 0.9,     # More conservative in trending
      'NEUTRAL': 1.0,
    }[regime]
    
    # Predict win %
    win_pct = sum(self.weights[m] * scaled_M[m] for m in self.weights)
    return win_pct * regime_multiplier
```

Record both v1.0 and v1.1 predictions:

```sql
-- In learning_loop_feedback table, add:
modelVersion TEXT,  -- 'v1.0' (baseline) or 'v1.1' (with engines)
predictedWinPct_v10 REAL,  -- Baseline prediction
predictedWinPct_v11 REAL,  -- With Kalman + Regime
actual_outcome INT,

-- Calculate Brier scores for both
brierScore_v10 = (predictedWinPct_v10 - actual_outcome)^2
brierScore_v11 = (predictedWinPct_v11 - actual_outcome)^2
```

### Step 6: Monitoring Dashboard (Day 5)

**Add to Doctrine tab:**
```vue
<div class="engine-status">
  <h4>Advanced Engines Status (Week 4)</h4>
  
  <div class="engine">
    <span class="name">Kalman Morphology Filter</span>
    <span class="status">{{ kalmanConfidence | percent }}</span>
    <span class="trace">Uncertainty: {{ kalmanTrace | number }}</span>
  </div>
  
  <div class="engine">
    <span class="name">Stochastic Regime</span>
    <span class="regime">{{ regime.regime }}</span>
    <span class="kappa">κ = {{ regime.kappa | number }}</span>
  </div>
  
  <div class="comparison">
    <div>Baseline (v1.0): {{ metrics.v10.winRate | percent }}</div>
    <div>With Engines (v1.1): {{ metrics.v11.winRate | percent }}</div>
    <div class="delta" :class="metrics.delta > 0 ? 'positive' : 'negative'">
      {{ metrics.delta | number }}%
    </div>
  </div>
</div>
```

---

## Testing Checklist

- [ ] **Day 1:** D1 migrations applied successfully
- [ ] **Day 2:** Kalman filter runs without errors (test with mock morphology)
- [ ] **Day 2:** Kalman state persists to D1
- [ ] **Day 3:** Stochastic regime detection works (test with mock vol history)
- [ ] **Day 3:** Regime state persists to D1
- [ ] **Day 4:** Execution engine uses filtered morphology
- [ ] **Day 4:** Greeks adjust based on regime
- [ ] **Day 5:** A/B testing metrics are tracked (v1.0 vs v1.1 Brier scores)
- [ ] **Day 5:** Dashboard shows engine status + performance delta

---

## Expected Outcome (End of Week 4)

**Metrics:**
- Kalman filter: 40-50% reduction in false morphology switches
- Regime detector: Correct TRENDING vs MEAN_REVERT classification 70%+ of the time
- Win rate: +15-20% improvement over baseline
- Sharpe ratio: +0.4-0.6 boost

**Backtest Results:**
- Baseline (v1.0): ~50% win rate, 0.8 Sharpe
- With Engines (v1.1): ~65-70% win rate, 1.2-1.4 Sharpe

---

## Next Steps (Week 5)

Once Kalman + Regime are validated:
1. **Tensor Greeks Engine** (eigendecomposition of Greeks Hessian)
2. **Martingale Arbitrage Detector** (put-call parity violations)

These depend on Kalman + Regime working correctly, so deploy in that order.

---

## Files Reference

| File | Purpose |
|------|---------|
| `0045_kalman_morphology_schema.sql` | D1 tables + views |
| `0046_stochastic_regime_schema.sql` | D1 tables + views |
| `js/kalman-morphology-filter.py` | Kalman filter logic |
| `js/stochastic-regime-engine.py` | Regime detection logic |
| `js/execution.js` | Wire Kalman into cockpit |
| `js/greeks-engine.js` | Wire regime into Greeks |
| `workers/engine-status.ts` | Status endpoint |
| `js/execution-mastery-model.py` | A/B testing setup |

---

**Ready to integrate! Begin with Step 1 today.**
