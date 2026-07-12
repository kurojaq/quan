/* /api/execution — control plane for the EXECUTION runtime Worker (Tradovate).
   Auth: the operator OR a Prime/Desk subscriber (Authorization: Bearer <supabase
   access token>). The operator gets live + the unattended secret-fallback; a
   subscriber is a demo-clamped tenant. Everyone else → 403.

   The EXECUTION cockpit (js/execution.js) never talks to Tradovate directly — it
   POSTs a small { action, params } envelope here, and this function verifies the
   caller, then forwards { action, params, uid, role } over the internal EXECUTION
   Service binding to the runtime Worker (workers/execution.js), which keys every
   broker session + launch queue by uid. No Tradovate secret or token is ever
   exposed to the browser.

     POST /api/execution   body { action, params }
       action ∈ health | connect | accounts | book
              | placeorder | bracket | cancelorder | modifyorder
       → { ok, result } from the runtime Worker, or { error } (+ status)

   Order-placing actions additionally require an explicit confirm flag AND, when
   the runtime resolves to the live book, a matching `live:true` — a second gate
   so a demo-shaped click can never route to real money by omission.
*/
import { json, badRequest, serverError, unauthorized, getUserFromRequest, planForUser } from './_shared.js';

// Tiers that may reach the Execution engine. The app owner is always the operator
// (live + secret-fallback allowed); a Prime/Desk subscriber (incl. trialing) is a
// demo-clamped tenant. Anyone else is refused. Returns { user, uid, role } or a
// Response to return as-is.
const EXEC_TIERS = new Set(['prime', 'desk']);
async function resolveExecCaller(env, request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return unauthorized();
  if (env.OPERATOR_EMAIL && user.email === env.OPERATOR_EMAIL) {
    return { user, uid: user.id, role: 'operator' };
  }
  const plan = await planForUser(env, user.id);
  if (EXEC_TIERS.has(plan)) return { user, uid: user.id, role: 'subscriber' };
  return json({ error: 'Execution is a Prime feature' }, 403);
}

// Every action the runtime Worker (workers/execution.js) actually dispatches —
// broker RPCs + Durable-Object launch-queue ops. The proxy rejects anything
// outside this set so a typo or a crafted payload can't probe the runtime.
const ALLOWED_ACTIONS = new Set([
  'health', 'login', 'logout', 'connect', 'accounts', 'book',
  'placeorder', 'bracket', 'cancelorder', 'modifyorder',
  'stage', 'listPending', 'cancelPending', 'arm', 'disarm', 'pushState', 'clearTerminal'
]);

// Actions that create/modify/cancel real broker state, or ARM an order that will
// later route on its own. Read-only actions skip the confirm gate so the cockpit
// can poll the book / launch queue freely.
const WRITE_ACTIONS = new Set(['placeorder', 'bracket', 'cancelorder', 'modifyorder', 'stage', 'arm']);

export async function onRequestPost({ request, env }) {
  const gate = await resolveExecCaller(env, request);
  if (gate instanceof Response) return gate;
  const { uid, role } = gate;
  try {
    const hasBinding = env.EXECUTION && typeof env.EXECUTION.fetch === 'function';
    if (!hasBinding) return serverError('EXECUTION service not bound (Pages → Settings → Bindings → Service binding EXECUTION → quan-execution)');

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    if (!action) return badRequest('action required');
    if (!ALLOWED_ACTIONS.has(action)) return badRequest('unknown action');

    const headers = { 'Content-Type': 'application/json' };
    if (env.EXECUTION_KEY) headers['X-Execution-Key'] = env.EXECUTION_KEY;
    // Identity is forwarded to the runtime so it can key every session/queue by
    // user and clamp subscribers to demo. The internal Service binding is the
    // trust boundary — the Worker trusts uid/role because only this gated proxy
    // can reach it.
    const call = (a, params) =>
      env.EXECUTION.fetch('https://execution.internal/rpc', {
        method: 'POST', headers, body: JSON.stringify({ action: a, params: params || {}, uid, role }),
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
