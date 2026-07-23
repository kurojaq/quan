<template>
  <div class="tensor-greeks-dashboard">
    <div class="header">
      <h3>📊 Tensor Greeks Analysis</h3>
      <p class="subtitle">6×6 Hessian matrix + eigenanalysis · non-linear Greeks interactions</p>
    </div>

    <!-- Status & Risk Indicators -->
    <div class="status-panel">
      <div class="status-item" :class="geometry_class.toLowerCase()">
        <span class="label">Market Geometry:</span>
        <span class="value">{{ geometry_class }}</span>
      </div>
      <div class="status-item">
        <span class="label">Condition Number:</span>
        <span class="value" :class="condition_number > 100 ? 'warning' : 'ok'">
          {{ condition_number.toFixed(1) }}
        </span>
      </div>
      <div class="status-item">
        <span class="label">Stability Score:</span>
        <span class="value">{{ (100 / (1 + condition_number / 100)).toFixed(1) }}%</span>
      </div>
    </div>

    <!-- Risk Alerts -->
    <div v-if="risk_alerts.length > 0" class="alerts-panel">
      <div v-for="(alert, i) in risk_alerts" :key="i" class="alert" :class="alert_class(alert)">
        <span class="alert-icon">⚠️</span>
        <span class="alert-text">{{ alert }}</span>
      </div>
    </div>

    <!-- Greeks Tensor (First & Second Order) -->
    <div class="greeks-section">
      <h4>Greeks Tensor</h4>

      <div class="greeks-grid">
        <div class="greek-card">
          <span class="name">Δ (Delta)</span>
          <span class="value">{{ greeks.delta?.toFixed(4) || '—' }}</span>
        </div>
        <div class="greek-card">
          <span class="name">Γ (Gamma)</span>
          <span class="value" :class="Math.abs(greeks.gamma) > 0.1 ? 'warning' : ''">
            {{ greeks.gamma?.toFixed(4) || '—' }}
          </span>
        </div>
        <div class="greek-card">
          <span class="name">ν (Vega)</span>
          <span class="value">{{ greeks.vega?.toFixed(4) || '—' }}</span>
        </div>
        <div class="greek-card">
          <span class="name">Θ (Theta)</span>
          <span class="value">{{ greeks.theta?.toFixed(4) || '—' }}</span>
        </div>
        <div class="greek-card">
          <span class="name">ρ (Rho)</span>
          <span class="value">{{ greeks.rho?.toFixed(4) || '—' }}</span>
        </div>
      </div>

      <!-- Second-Order Greeks (Cross-Partials) -->
      <h5>Cross-Partials (Second Order)</h5>
      <div class="cross-partials">
        <div class="partial">
          <span class="name">∂Γ/∂σ (Gamma-Vega)</span>
          <span class="value">{{ greeks.gamma_vega?.toFixed(6) || '—' }}</span>
          <span class="explanation">How gamma changes with volatility</span>
        </div>
        <div class="partial">
          <span class="name">∂ν/∂t (Vega-Theta)</span>
          <span class="value" :class="Math.abs(greeks.vega_theta) > 0.5 ? 'warning' : ''">
            {{ greeks.vega_theta?.toFixed(6) || '—' }}
          </span>
          <span class="explanation">Vega decay over time</span>
        </div>
        <div class="partial">
          <span class="name">∂Γ/∂t (Gamma-Theta)</span>
          <span class="value">{{ greeks.gamma_theta?.toFixed(6) || '—' }}</span>
          <span class="explanation">Gamma acceleration over time</span>
        </div>
        <div class="partial">
          <span class="name">∂Γ/∂dealer (Gamma-Dealer)</span>
          <span class="value">{{ greeks.gamma_dealer?.toFixed(6) || '—' }}</span>
          <span class="explanation">Dealer positioning feedback</span>
        </div>
      </div>
    </div>

    <!-- Eigenvalue Analysis (Market Geometry) -->
    <div class="eigenvalue-section">
      <h4>Principal Greeks (Eigenanalysis)</h4>

      <div class="spectrum">
        <div v-for="(lambda, i) in eigenvalues.slice(0, 3)" :key="i" class="eigenvalue">
          <span class="label">λ₍{{ i + 1 }}₎</span>
          <div class="bar" :style="eigenvalue_width(lambda)"></div>
          <span class="value">{{ lambda.toFixed(4) }}</span>
        </div>
      </div>

      <div class="principal-components">
        <div class="component">
          <span class="factor">Price (S)</span>
          <div class="bar" :style="component_width(principal_greeks.price_sensitivity)"></div>
          <span class="value">{{ principal_greeks.price_sensitivity?.toFixed(2) || '—' }}</span>
        </div>
        <div class="component">
          <span class="factor">Volatility (σ)</span>
          <div class="bar" :style="component_width(principal_greeks.vol_sensitivity)"></div>
          <span class="value">{{ principal_greeks.vol_sensitivity?.toFixed(2) || '—' }}</span>
        </div>
        <div class="component">
          <span class="factor">Time (t)</span>
          <div class="bar" :style="component_width(principal_greeks.time_sensitivity)"></div>
          <span class="value">{{ principal_greeks.time_sensitivity?.toFixed(2) || '—' }}</span>
        </div>
        <div class="component">
          <span class="factor">Dealer (γ_d)</span>
          <div class="bar" :style="component_width(principal_greeks.dealer_sensitivity)"></div>
          <span class="value">{{ principal_greeks.dealer_sensitivity?.toFixed(2) || '—' }}</span>
        </div>
      </div>
    </div>

    <!-- Hessian Metrics -->
    <div class="metrics-section">
      <h4>Hessian Metrics</h4>
      <div class="metrics-grid">
        <div class="metric">
          <span class="label">Trace(H)</span>
          <span class="value">{{ metrics.trace_H?.toFixed(4) || '—' }}</span>
          <span class="explanation">Sum of curvatures</span>
        </div>
        <div class="metric">
          <span class="label">Det(H)</span>
          <span class="value">{{ metrics.det_H?.toFixed(6) || '—' }}</span>
          <span class="explanation">Volume of ellipsoid</span>
        </div>
        <div class="metric">
          <span class="label">||H||_F</span>
          <span class="value">{{ metrics.frobenius_norm?.toFixed(4) || '—' }}</span>
          <span class="explanation">Frobenius norm</span>
        </div>
      </div>
    </div>

    <!-- Interpretation Guide -->
    <div class="guide-section">
      <h4>Interpretation</h4>
      <ul class="guide-items">
        <li>
          <strong>Condition Number:</strong>
          λ_max / λ_min. High values (>100) indicate ill-conditioning: small price moves → huge P&L swings.
        </li>
        <li>
          <strong>Gamma Spike:</strong>
          |Γ| > 0.1 indicates extreme curvature. Large convexity = non-linear risk.
        </li>
        <li>
          <strong>Vega-Theta Coupling:</strong>
          |∂ν/∂t| > 0.5 indicates strong time decay × volatility interaction.
        </li>
        <li>
          <strong>Principal Greeks:</strong>
          Eigenvector of largest eigenvalue: which factors matter most in market geometry.
        </li>
        <li>
          <strong>Market Geometry:</strong>
          STABLE (predictable), STRESSED (ill-conditioned), or DEGENERATE (near-singular).
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const geometry_class = ref('STABLE');
const condition_number = ref(0);
const greeks = ref({} as Record<string, number>);
const eigenvalues = ref([] as number[]);
const principal_greeks = ref({} as Record<string, number>);
const metrics = ref({} as Record<string, number>);
const risk_alerts = ref([] as string[]);

onMounted(async () => {
  const userId = sessionStorage.getItem('user_id') || 'user-123';
  const sessionId = sessionStorage.getItem('session_id') || 'session-current';

  try {
    // Fetch latest tensor Greeks
    const response = await fetch(
      `/api/tensor-greeks/latest?userId=${userId}&sessionId=${sessionId}`
    );

    if (response.ok) {
      const data = await response.json();
      geometry_class.value = data.geometry_class || 'STABLE';
      condition_number.value = data.condition_number || 0;
      greeks.value = data.greeks || {};
      eigenvalues.value = JSON.parse(data.eigenvalues || '[]');
      principal_greeks.value = JSON.parse(data.principal_greeks || '{}');
      metrics.value = data.metrics || {};
    }

    // Fetch alerts
    const alertsResponse = await fetch(
      `/api/tensor-greeks/alerts?userId=${userId}&sessionId=${sessionId}`
    );

    if (alertsResponse.ok) {
      const alertsData = await alertsResponse.json();
      risk_alerts.value = alertsData.alerts?.map((a: any) => a.alert) || [];
    }
  } catch (error) {
    console.error('Failed to load tensor Greeks:', error);
  }
});

function eigenvalue_width(lambda: number) {
  const maxLambda = Math.max(...eigenvalues.value);
  const width = (Math.abs(lambda) / Math.abs(maxLambda)) * 100;
  return `width: ${Math.min(width, 100)}%`;
}

function component_width(value: number) {
  const width = Math.abs(value) * 50;
  return `width: ${Math.min(width, 100)}%`;
}

function alert_class(alert: string) {
  if (alert.includes('CRITICAL')) return 'critical';
  if (alert.includes('DEGENERATE')) return 'degenerate';
  if (alert.includes('WARNING')) return 'warning';
  return 'info';
}
</script>

<style scoped>
.tensor-greeks-dashboard {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  font-size: 12px;
  color: var(--cream);
}

.header {
  margin-bottom: 8px;
}

.header h3 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--cream);
}

.subtitle {
  margin: 0;
  font-size: 11px;
  color: var(--cream-dim);
}

/* Status Panel */
.status-panel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.status-item {
  background: var(--fill);
  border: 1px solid var(--glass-line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-item.stable {
  border-color: #5fd08a;
  background: rgba(95, 208, 138, 0.1);
}

.status-item.stressed {
  border-color: #f5a623;
  background: rgba(245, 166, 35, 0.1);
}

.status-item.degenerate {
  border-color: #e08a6a;
  background: rgba(224, 138, 106, 0.1);
}

.status-item .label {
  font-size: 10px;
  color: var(--cream-dim);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.status-item .value {
  font-size: 12px;
  font-weight: 600;
  color: var(--cream);
  font-family: var(--font-mono);
}

.status-item .value.ok {
  color: #5fd08a;
}

.status-item .value.warning {
  color: #f5a623;
}

/* Alerts */
.alerts-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alert {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border-left: 3px solid;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.alert.critical {
  background: rgba(224, 138, 106, 0.15);
  border-left-color: #e08a6a;
  color: #e08a6a;
}

.alert.warning {
  background: rgba(245, 166, 35, 0.15);
  border-left-color: #f5a623;
  color: #f5a623;
}

.alert.info {
  background: rgba(111, 163, 255, 0.15);
  border-left-color: #6fa3ff;
  color: #6fa3ff;
}

.alert-icon {
  flex-shrink: 0;
  font-size: 13px;
}

/* Greeks Section */
.greeks-section {
  border-top: 1px solid var(--glass-line);
  padding-top: 12px;
}

.greeks-section h4,
.eigenvalue-section h4,
.metrics-section h4 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cream);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.greeks-section h5 {
  margin: 12px 0 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--cream-dim);
}

.greeks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.greek-card {
  background: var(--fill);
  border: 1px solid var(--glass-line);
  border-radius: var(--radius-sm);
  padding: 8px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.greek-card .name {
  font-size: 10px;
  color: var(--cream-dim);
  font-weight: 500;
}

.greek-card .value {
  font-size: 12px;
  font-weight: 600;
  color: var(--cream);
  font-family: var(--font-mono);
}

.greek-card .value.warning {
  color: #f5a623;
}

/* Cross-Partials */
.cross-partials {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.partial {
  background: var(--fill);
  border: 1px solid var(--glass-line);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.partial .name {
  font-size: 10px;
  font-weight: 600;
  color: var(--cream);
  font-family: var(--font-mono);
}

.partial .value {
  font-size: 11px;
  font-weight: 600;
  color: #6fa3ff;
  font-family: var(--font-mono);
}

.partial .value.warning {
  color: #f5a623;
}

.partial .explanation {
  font-size: 9px;
  color: var(--cream-dim);
  font-style: italic;
}

/* Eigenvalue Section */
.eigenvalue-section {
  border-top: 1px solid var(--glass-line);
  padding-top: 12px;
}

.spectrum {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.eigenvalue {
  display: flex;
  align-items: center;
  gap: 8px;
}

.eigenvalue .label {
  font-size: 10px;
  font-weight: 600;
  color: var(--cream-dim);
  width: 40px;
  font-family: var(--font-mono);
}

.eigenvalue .bar {
  flex: 1;
  height: 6px;
  background: linear-gradient(90deg, #6fa3ff, #5fd08a);
  border-radius: 3px;
}

.eigenvalue .value {
  font-size: 10px;
  font-weight: 600;
  color: var(--cream);
  font-family: var(--font-mono);
  width: 50px;
  text-align: right;
}

/* Principal Components */
.principal-components {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.component {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
}

.component .factor {
  width: 80px;
  color: var(--cream-dim);
  font-weight: 500;
}

.component .bar {
  flex: 1;
  height: 4px;
  background: rgba(111, 163, 255, 0.5);
  border-radius: 2px;
}

.component .value {
  width: 40px;
  text-align: right;
  color: var(--cream);
  font-weight: 600;
  font-family: var(--font-mono);
}

/* Metrics Section */
.metrics-section {
  border-top: 1px solid var(--glass-line);
  padding-top: 12px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.metric {
  background: var(--fill);
  border: 1px solid var(--glass-line);
  border-radius: var(--radius-sm);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric .label {
  font-size: 10px;
  font-weight: 600;
  color: var(--cream);
  font-family: var(--font-mono);
}

.metric .value {
  font-size: 12px;
  font-weight: 600;
  color: #6fa3ff;
  font-family: var(--font-mono);
}

.metric .explanation {
  font-size: 9px;
  color: var(--cream-dim);
}

/* Guide Section */
.guide-section {
  border-top: 1px solid var(--glass-line);
  padding-top: 12px;
}

.guide-section h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cream);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.guide-items {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.guide-items li {
  font-size: 10px;
  color: var(--cream-dim);
  line-height: 1.4;
}

.guide-items strong {
  color: var(--cream);
  font-weight: 600;
}
</style>
