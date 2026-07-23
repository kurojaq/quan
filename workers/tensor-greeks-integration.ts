/**
 * Tensor Greeks Integration Worker
 *
 * Computes Tensor Greeks via Pyodide and stores results to D1
 * for display in Doctrine tab and execution risk management
 */

interface TensorGreeksResult {
  status: string;
  greeks: Record<string, number>;
  hessian: number[][];
  eigenvalues: number[];
  eigenvectors: number[][];
  condition_number: number;
  geometry_class: string;
  principal_greeks: Record<string, number>;
  risk_indicators: {
    is_ill_conditioned: boolean;
    has_gamma_spike: boolean;
    has_vega_theta_coupling: boolean;
    is_degenerate: boolean;
  };
  metrics: {
    trace_H: number;
    det_H: number;
    frobenius_norm: number;
  };
}

interface TensorGreeksRequest {
  userId: string;
  sessionId: string;
  instrumentSymbol: string;
  S: number;        // Spot price
  K: number;        // Strike
  T: number;        // Time to expiration (years)
  r: number;        // Risk-free rate
  vol: number;      // Implied volatility
  dealer_gamma?: number;  // Dealer gamma positioning
}

/**
 * Compute Tensor Greeks via Pyodide
 */
async function computeTensorGreeks(env: any, request: TensorGreeksRequest): Promise<TensorGreeksResult> {
  // Load Pyodide if not already loaded
  if (!globalThis.pyodide) {
    // In worker context, load via dynamic import or fetch
    const pyodideUrl = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
    const PyodideModule = await import(pyodideUrl);
    globalThis.pyodide = await PyodideModule.loadPyodide();
  }

  const pyodide = globalThis.pyodide;

  // Load tensor Greeks module
  await pyodide.runPythonAsync(`
    import sys
    # Load tensor-greeks-engine.py from storage
    # In production, this would be bundled or fetched from R2
    exec(open('/tensor-greeks-engine.py').read())
  `);

  // Call tensor Greeks computation
  const result = await pyodide.runPythonAsync(`
    import json
    engine = TensorGreeksEngine()
    result = engine.compute(
      S=${request.S},
      K=${request.K},
      T=${request.T},
      r=${request.r},
      vol=${request.vol},
      dealer_gamma=${request.dealer_gamma || 0}
    )
    json.dumps(result)
  `);

  return JSON.parse(result) as TensorGreeksResult;
}

/**
 * Store Tensor Greeks to D1
 */
async function storeTensorGreeks(env: any, request: TensorGreeksRequest, result: TensorGreeksResult): Promise<void> {
  const principal = result.principal_greeks;

  // Insert into tensor_greeks_state
  await env.DB.prepare(`
    INSERT INTO tensor_greeks_state (
      userId, sessionId, instrumentSymbol,
      delta, gamma, vega, theta, rho, dealer_sensitivity,
      gamma_vega, vega_theta, gamma_theta, gamma_dealer, vega_dealer, theta_rho,
      eigenvalues, principal_eigenvector, condition_number,
      hessian_matrix,
      trace_H, det_H, frobenius_norm,
      geometry_class,
      is_ill_conditioned, has_gamma_spike, has_vega_theta_coupling, is_degenerate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    request.userId, request.sessionId, request.instrumentSymbol,
    result.greeks.delta,
    result.greeks.gamma,
    result.greeks.vega,
    result.greeks.theta,
    result.greeks.rho,
    result.greeks.dealer_sensitivity,
    result.greeks.gamma_vega || 0,
    result.greeks.vega_theta || 0,
    result.greeks.gamma_theta || 0,
    result.greeks.gamma_dealer || 0,
    result.greeks.vega_dealer || 0,
    result.greeks.theta_rho || 0,
    JSON.stringify(result.eigenvalues),
    JSON.stringify(result.eigenvectors[0] || []),
    result.condition_number,
    JSON.stringify(result.hessian),
    result.metrics.trace_H,
    result.metrics.det_H,
    result.metrics.frobenius_norm,
    result.geometry_class,
    result.risk_indicators.is_ill_conditioned ? 1 : 0,
    result.risk_indicators.has_gamma_spike ? 1 : 0,
    result.risk_indicators.has_vega_theta_coupling ? 1 : 0,
    result.risk_indicators.is_degenerate ? 1 : 0
  ).run();

  // Insert into tensor_greeks_diagnostics
  await env.DB.prepare(`
    INSERT INTO tensor_greeks_diagnostics (
      userId, sessionId, instrumentSymbol,
      lambda_1, lambda_2, lambda_3, lambda_4, lambda_5, lambda_6,
      principal_component_S, principal_component_vol, principal_component_time,
      principal_component_strike, principal_component_rate, principal_component_dealer,
      condition_number, stability_score,
      event_gamma_spike, event_ill_conditioning, event_theta_acceleration, event_dealer_feedback
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    request.userId, request.sessionId, request.instrumentSymbol,
    result.eigenvalues[0] || 0,
    result.eigenvalues[1] || 0,
    result.eigenvalues[2] || 0,
    result.eigenvalues[3] || 0,
    result.eigenvalues[4] || 0,
    result.eigenvalues[5] || 0,
    principal.price_sensitivity || 0,
    principal.vol_sensitivity || 0,
    principal.time_sensitivity || 0,
    principal.rate_sensitivity || 0,
    principal.dealer_sensitivity || 0,
    principal.gamma_sensitivity || 0,
    result.condition_number,
    1.0 / (1.0 + result.condition_number / 100),  // Stability score: 1 - ill-conditioning
    result.risk_indicators.has_gamma_spike ? 1 : 0,
    result.risk_indicators.is_ill_conditioned ? 1 : 0,
    0,  // theta_acceleration (placeholder)
    result.risk_indicators.is_ill_conditioned && result.risk_indicators.has_gamma_spike ? 1 : 0
  ).run();
}

/**
 * HTTP Handler: POST /api/tensor-greeks/compute
 */
export async function onRequestComputeTensorGreeks(context: any) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as TensorGreeksRequest;

    // Validate request
    if (!body.userId || !body.sessionId || !body.instrumentSymbol) {
      return new Response('Missing required fields', { status: 400 });
    }

    // Compute tensor Greeks
    const result = await computeTensorGreeks(env, body);

    // Store to D1
    await storeTensorGreeks(env, body, result);

    return new Response(JSON.stringify({
      status: 'success',
      data: result,
      warnings: result.risk_indicators.is_ill_conditioned ? ['Ill-conditioned Greeks detected'] : [],
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      message: String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * HTTP Handler: GET /api/tensor-greeks/latest
 * Get latest tensor Greeks for session
 */
export async function onRequestGetLatestTensorGreeks(context: any) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const sessionId = url.searchParams.get('sessionId');

    if (!userId || !sessionId) {
      return new Response('Missing userId or sessionId', { status: 400 });
    }

    const result = await env.DB.prepare(`
      SELECT * FROM v_tensor_greeks_current
      WHERE userId = ? AND sessionId = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).bind(userId, sessionId).first();

    if (!result) {
      return new Response('No tensor Greeks found', { status: 404 });
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      message: String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * HTTP Handler: GET /api/tensor-greeks/alerts
 * Get active risk alerts
 */
export async function onRequestGetTensorGreeksAlerts(context: any) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const sessionId = url.searchParams.get('sessionId');

    if (!userId || !sessionId) {
      return new Response('Missing userId or sessionId', { status: 400 });
    }

    const alerts = await env.DB.prepare(`
      SELECT * FROM v_tensor_greeks_alerts
      WHERE userId = ? AND sessionId = ?
      ORDER BY timestamp DESC
    `).bind(userId, sessionId).all();

    return new Response(JSON.stringify({
      alerts: alerts.results || [],
      count: alerts.results?.length || 0,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      message: String(error),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);

    if (url.pathname === '/api/tensor-greeks/compute') {
      return onRequestComputeTensorGreeks({ request, env });
    } else if (url.pathname === '/api/tensor-greeks/latest') {
      return onRequestGetLatestTensorGreeks({ request, env });
    } else if (url.pathname === '/api/tensor-greeks/alerts') {
      return onRequestGetTensorGreeksAlerts({ request, env });
    }

    return new Response('Not found', { status: 404 });
  },
};
