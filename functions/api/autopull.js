/* /api/autopull — control plane for the Barchart auto-download Worker (Phase 5).
   Auth: operator only (Authorization: Bearer <supabase access token>).

   The terminal's Auto-pull panel (js/auto-pull.js) manages WHICH contracts get
   downloaded and ingests the CSVs the Worker (workers/barchart-fetch.js) drops
   into R2. This function is the bridge between them: the panel reads/writes the
   selection here, and reads back the last run's status + the index of fetched
   files. The Worker itself never touches this endpoint — it reads the same KV
   keys directly.

     GET  /api/autopull            -> { selection:[...], status:{...}, index:{...} }
     PUT  /api/autopull   body { selection:[{symbol,expiry,kind,url,on}] }
     POST /api/autopull   body { action:"pull", jobs:[{symbol,expiry,kind,url}] }
                          -> triggers an on-demand pull of exactly those jobs on
                             the Browser Rendering Worker; returns its run status.
     GET  /api/autopull?file=KEY   -> streams the stored CSV (text/csv) for ingest

   Storage: selection/status/index are JSON in the shared QUAN_PUBLISH KV under
   the autopull: prefix (the exact keys the Worker uses); CSVs live in the
   QUAN_STATE R2 bucket under the autopull/ prefix.
*/
import { json, badRequest, serverError, requireOperator } from './_shared.js';

const K = { selection: 'autopull:selection', status: 'autopull:status', index: 'autopull:index' };

const readJSON = async (env, key, fallback) => {
  if (!env.QUAN_PUBLISH) return fallback;
  try {
    const raw = await env.QUAN_PUBLISH.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
};

// Only allow serving keys the Worker actually wrote — never arbitrary R2 paths.
const isAutopullKey = (k) => typeof k === 'string' && k.startsWith('autopull/') && !k.includes('..');

export async function onRequestGet({ request, env }) {
  const gate = await requireOperator(env, request);
  if (gate instanceof Response) return gate;
  try {
    const file = new URL(request.url).searchParams.get('file');
    if (file) {
      if (!isAutopullKey(file)) return badRequest('bad file key');
      if (!env.QUAN_STATE) return serverError('R2 bucket not bound');
      const obj = await env.QUAN_STATE.get(file);
      if (!obj) return json({ error: 'not found' }, 404);
      return new Response(obj.body, {
        headers: { 'Content-Type': 'text/csv', 'Cache-Control': 'no-store' },
      });
    }
    const [selection, status, index] = await Promise.all([
      readJSON(env, K.selection, []),
      readJSON(env, K.status, null),
      readJSON(env, K.index, {}),
    ]);
    return json({ selection, status, index });
  } catch (err) {
    return serverError(err.message);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await requireOperator(env, request);
  if (gate instanceof Response) return gate;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'pull') return badRequest('unknown action');
    if (!Array.isArray(body.jobs) || !body.jobs.length) return badRequest('jobs[] required');
    if (!env.BARCHART_WORKER_URL || !env.AUTOPULL_KEY) {
      return serverError('on-demand pull not configured (set BARCHART_WORKER_URL + AUTOPULL_KEY)');
    }
    // Normalize + validate. A job lands on its expiry page one of two ways:
    //   • a fixed url, or
    //   • future + date (YYYY-MM-DD) + tab → the Worker picks the expiry by date.
    const jobs = body.jobs.map((r) => ({
      symbol: String(r.symbol || '').trim().toUpperCase(),
      expiry: String(r.expiry || '').replace(/[^0-9_]/g, ''),
      kind: r.kind === 'greeks' ? 'greeks' : 'chain',
      url: String(r.url || '').trim(),
      future: String(r.future || '').trim().toUpperCase(),
      date: String(r.date || '').trim(),
      tab: r.tab === 'volatility-greeks' ? 'volatility-greeks' : r.tab === 'options' ? 'options' : '',
      on: true,
    }));
    const bad = jobs.find(
      (r) =>
        !/^[A-Z]{2}[A-Z]?\d/.test(r.symbol) ||
        !/^\d{2}_\d{2}_\d{2}$/.test(r.expiry) ||
        !(
          /^https?:\/\//.test(r.url) ||
          (/^[A-Z]{2}[A-Z]?\d/.test(r.future) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.tab)
        )
    );
    if (bad) return badRequest('each job needs symbol + expiry MM_DD_YY, and either a url or future+date+tab');

    // The Worker's URL + shared key live server-side only — the browser never sees them.
    const wr = await fetch(env.BARCHART_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Autopull-Key': env.AUTOPULL_KEY },
      body: JSON.stringify({ jobs, debug: !!body.debug }),
    });
    const status = await wr.json().catch(() => ({ error: `worker ${wr.status}` }));
    return json({ ok: wr.ok, status }, wr.ok ? 200 : 502);
  } catch (err) {
    return serverError(err.message);
  }
}

export async function onRequestPut({ request, env }) {
  const gate = await requireOperator(env, request);
  if (gate instanceof Response) return gate;
  try {
    if (!env.QUAN_PUBLISH) return serverError('KV not bound');
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.selection)) return badRequest('selection[] required');

    // Normalize + validate each row; keep only fields the Worker consumes.
    // `symbol` is the Barchart contract symbol (e.g. ESM25) — it becomes the
    // downloaded filename's prefix, which is how the terminal's parseChain()
    // recovers the instrument, so it must lead with two letters + a digit.
    const selection = body.selection.map((r) => ({
      symbol: String(r.symbol || '').trim().toUpperCase(),
      expiry: String(r.expiry || '').replace(/[^0-9_]/g, ''), // MM_DD_YY
      kind: r.kind === 'greeks' ? 'greeks' : 'chain',
      url: String(r.url || '').trim(),
      on: r.on !== false,
    }));
    const bad = selection.find(
      (r) =>
        !/^[A-Z]{2}[A-Z]?\d/.test(r.symbol) ||
        !/^\d{2}_\d{2}_\d{2}$/.test(r.expiry) ||
        !/^https?:\/\//.test(r.url)
    );
    if (bad) return badRequest('each row needs symbol (e.g. ESM25), expiry MM_DD_YY, and an http(s) url');

    await env.QUAN_PUBLISH.put(K.selection, JSON.stringify(selection));
    return json({ ok: true, count: selection.length });
  } catch (err) {
    return serverError(err.message);
  }
}
