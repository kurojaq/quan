/* /api/execution — control plane for the EXECUTION runtime Worker (Tradovate).
   Auth: operator only (Authorization: Bearer <supabase access token>).

   The EXECUTION cockpit (js/execution.js) never talks to Tradovate directly — it
   POSTs a small { action, params } envelope here, and this function forwards it
   over the internal EXECUTION Service binding to the runtime Worker
   (workers/execution.js), which holds the broker credentials. No Tradovate secret
   or token is ever exposed to the browser.

     POST /api/execution   body { action, params }
       action ∈ health | connect | accounts | book
              | placeorder | bracket | cancelorder | modifyorder
       → { ok, result } from the runtime Worker, or { error } (+ status)

   Order-placing actions additionally require an explicit confirm flag AND, when
   the runtime resolves to the live book, a matching `live:true` — a second gate
   so a demo-shaped click can never route to real money by omission.
*/
import { json, badRequest, serverError, requireOperator } from './_shared.js';

// Actions that create/modify/cancel real broker state, or ARM an order that will
// later route on its own. Read-only actions skip the confirm gate so the cockpit
// can poll the book / launch queue freely.
const WRITE_ACTIONS = new Set(['placeorder', 'bracket', 'cancelorder', 'modifyorder', 'stage', 'arm']);

export async function onRequestPost({ request, env }) {
  const gate = await requireOperator(env, request);
  if (gate instanceof Response) return gate;
  try {
    const hasBinding = env.EXECUTION && typeof env.EXECUTION.fetch === 'function';
    if (!hasBinding) return serverError('EXECUTION service not bound (Pages → Settings → Bindings → Service binding EXECUTION → quan-execution)');

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    if (!action) return badRequest('action required');

    const headers = { 'Content-Type': 'application/json' };
    if (env.EXECUTION_KEY) headers['X-Execution-Key'] = env.EXECUTION_KEY;
    const call = (a, params) =>
      env.EXECUTION.fetch('https://execution.internal/rpc', {
        method: 'POST', headers, body: JSON.stringify({ action: a, params: params || {} }),
      });

    if (WRITE_ACTIONS.has(action)) {
      if (body.confirm !== true) return badRequest('write actions require confirm:true');
      // Resolve which book the runtime is on BEFORE routing the write, so a
      // live order can never slip through unacknowledged. `health` is read-only
      // and does not touch the broker beyond reporting the configured env.
      const hr = await call('health');
      const hd = await hr.json().catch(() => ({}));
      const onLive = hr.ok && hd && hd.result && hd.result.env === 'live';
      if (onLive && body.live !== true) {
        return json({ error: 'runtime is on the LIVE book — resend with live:true to acknowledge real-money routing' }, 409);
      }
    }

    const wr = await call(action, body.params || {});
    const data = await wr.json().catch(() => ({ error: `runtime ${wr.status}` }));
    return json(data, wr.ok ? 200 : (wr.status || 502));
  } catch (err) {
    return serverError(err.message);
  }
}
