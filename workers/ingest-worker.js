/* Qu'an ingestion Worker — Spec #1: Google Drive -> Cloudflare pipeline.
 * Cron-triggered (see wrangler-ingest.toml). Polls a Drive folder, classifies
 * Barchart CSVs, applies session-date rules, stores to R2, indexes in D1.
 *
 * Required secrets (wrangler secret put ...):
 *   GDRIVE_SA_JSON   - Google service-account key JSON (Drive API, read-only scope)
 *   GDRIVE_FOLDER_ID - the watched Drive folder ID
 * Bindings (wrangler-ingest.toml):
 *   QUAN_INGEST_BUCKET (R2)  QUAN_INGEST_DB (D1)
 */

// Side-effect import: the registry file is a classic script (also valid ESM) that
// assigns globalThis.QuanInstruments — the same table the terminal uses, so the
// Worker and the client can never disagree about what a filename root means.
import '../js/instrument-registry.js';
const REG = globalThis.QuanInstruments;

async function getAccessToken(env) {
  const sa = JSON.parse(env.GDRIVE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const enc = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsigned = `${enc(header)}.${enc(claim)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Google auth failed: ' + JSON.stringify(d));
  return d.access_token;
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Recursively walks the watched folder AND every subfolder inside it (the
// operator organizes the Drive by instrument category, one subfolder per
// instrument), returning every non-folder file found across the whole tree.
async function listFolderChildren(folderId, token) {
  let pageToken = null, out = [];
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)&pageSize=1000`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!d.files) throw new Error('Drive list failed for folder ' + folderId + ': ' + JSON.stringify(d));
    out = out.concat(d.files);
    pageToken = d.nextPageToken || null;
  } while (pageToken);
  return out;
}

async function listDriveFiles(env, token, maxDepth) {
  maxDepth = maxDepth == null ? 6 : maxDepth;
  const files = [];
  let queue = [{ id: env.GDRIVE_FOLDER_ID, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift();
    const children = await listFolderChildren(id, token);
    for (const c of children) {
      if (c.mimeType === FOLDER_MIME) {
        if (depth < maxDepth) queue.push({ id: c.id, depth: depth + 1 });
      } else {
        files.push(c);
      }
    }
  }
  return files;
}

async function downloadDriveFile(id, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Drive download ${id} failed: ${r.status}`);
  return r.text();
}

/* ---- classification (Rule 1 / Rule 2 from the ingestion spec) ----
   Matches the operator's real Barchart naming, e.g.
     nqu5-options-monday-weekly-options-exp-06_16_25-show-all-side-by-side-intraday-06-16-2025.csv
     e6u26-volatility-greeks-exp-07_13_26-show-all-07-12-2026.csv
   Symbol is a leading {root}{monthCode}{yearDigit(s)} token; the date is the
   trailing dash-delimited M-D-Y (tolerant of " (1)" / "_IV_CANONICAL" suffixes). */
function isoDate(y, mo, da) { y = String(y); if (y.length === 2) y = '20' + y;
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`; }
function classifyName(name) {
  const n = String(name).toLowerCase();
  const contract = REG.parseContract(n);
  const instrument = contract ? contract.inst : null;
  const dataType = /volatility-greeks|[-_]greeks[-_.]/.test(n) ? 'greeks'
    : /side-by-side/.test(n) ? 'optionPrices'
    : /[-_]options[-_]/.test(n) ? 'optionPrices'
    : /volatility/.test(n) ? 'volatility'
    : null;
  const em = n.match(/exp-(\d{1,2})_(\d{1,2})_(\d{2,4})/);
  const expiration = em ? isoDate(em[3], em[1], em[2]) : null;
  const dms = [...n.matchAll(/-(\d{1,2})-(\d{1,2})-(\d{2,4})(?!\d)/g)];
  const dm = dms.length ? dms[dms.length - 1] : null;
  const downloadDate = dm ? isoDate(dm[3], dm[1], dm[2]) : null;
  return { instrument, dataType, expiration, downloadDate };
}
function sessionDateFor(dataType, downloadDate) {
  if (!downloadDate) return null;
  if (dataType !== 'optionPrices') return downloadDate; // Rule 2: no offset
  const d = new Date(downloadDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1); // Rule 1: sessionDate = the NEXT session
  // The next session is a trading day: a Friday download's chain belongs to
  // Monday, not Saturday (weekend-dated rows can never be found by the
  // terminal, which only asks for trading days).
  while (d.getUTCDay() === 6 || d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* Storage-stage validation (spec: no stage stores unvalidated data). A Drive
 * download can come back as an HTML error page, an empty body, or a truncated
 * file — none of which may reach R2, where they would poison every consumer
 * downstream. Returns null when valid, else a human reason. */
function validateCsv(text) {
  if (!text || !text.trim()) return 'empty file';
  const head = text.slice(0, 512).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return 'HTML page, not CSV (Drive error/login page?)';
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return 'no data rows (header only)';
  if (lines[0].indexOf(',') < 0) return 'header has no columns';
  return null;
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ingest_files (drive_id TEXT PRIMARY KEY, instrument TEXT, expiration TEXT, download_date TEXT, session_date TEXT, data_type TEXT, file_hash TEXT, original_filename TEXT, storage_key TEXT, upload_ts TEXT, processed_ts TEXT, version INTEGER DEFAULT 1, status TEXT)`).run();
  // `error` records WHY a row is status='invalid'/'error' (additive migration —
  // ALTER fails harmlessly once the column exists).
  try { await db.prepare(`ALTER TABLE ingest_files ADD COLUMN error TEXT`).run(); } catch (_) {}
}

// Cloudflare caps a Worker at ~1000 subrequests / D1 queries per invocation, and
// each new file costs a Drive download + an R2 put. So we cap downloads per run,
// dedupe against a single up-front hash query, and batch the D1 writes. Repeated
// /sync calls (or the 15-min cron) chip through any backlog; steady state only
// touches genuinely new/changed files.
const MAX_PER_RUN = 200;

async function runSync(env) {
  await ensureSchema(env.QUAN_INGEST_DB);
  const token = await getAccessToken(env);
  const files = await listDriveFiles(env, token);

  const known = new Map();
  const { results: existRows } = await env.QUAN_INGEST_DB.prepare('SELECT drive_id, file_hash FROM ingest_files').all();
  for (const r of (existRows || [])) known.set(r.drive_id, r.file_hash);

  const sum = { scanned: files.length, ingested: 0, unchanged: 0, skipped: 0, invalid: 0, errors: 0, remaining: 0 };
  const stmts = [], sample = [], now = new Date().toISOString();
  const INSERT = env.QUAN_INGEST_DB.prepare(
    `INSERT INTO ingest_files (drive_id, instrument, expiration, download_date, session_date, data_type, file_hash, original_filename, storage_key, upload_ts, processed_ts, version, status, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)
     ON CONFLICT(drive_id) DO UPDATE SET instrument=excluded.instrument, expiration=excluded.expiration, download_date=excluded.download_date, session_date=excluded.session_date, data_type=excluded.data_type, file_hash=excluded.file_hash, storage_key=excluded.storage_key, processed_ts=excluded.processed_ts, version=ingest_files.version+1, status=excluded.status, error=excluded.error`
  );

  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.csv')) continue;
    const meta = classifyName(f.name);
    if (!meta.instrument || !meta.downloadDate || !meta.dataType) { sum.skipped++; continue; }
    const hash = f.md5Checksum || `${f.id}|${f.modifiedTime}`;
    if (known.get(f.id) === hash) { sum.unchanged++; continue; }
    if (sum.ingested >= MAX_PER_RUN) { sum.remaining++; continue; }
    const sessionDate = sessionDateFor(meta.dataType, meta.downloadDate);
    const storageKey = `${meta.instrument}/${meta.expiration || 'unknown-exp'}/${sessionDate}/${meta.dataType}.csv`;
    try {
      const text = await downloadDriveFile(f.id, token);
      const invalid = validateCsv(text);
      if (invalid) {
        // Index the failure (so it is visible and diagnosable) but keep the
        // poisoned body out of R2.
        stmts.push(INSERT.bind(f.id, meta.instrument, meta.expiration, meta.downloadDate, sessionDate, meta.dataType, hash, f.name, storageKey, f.modifiedTime, now, 'invalid', invalid));
        sum.invalid++;
        if (sample.length < 6) sample.push({ file: f.name, invalid });
        continue;
      }
      await env.QUAN_INGEST_BUCKET.put(storageKey, text, { httpMetadata: { contentType: 'text/csv' } });
      stmts.push(INSERT.bind(f.id, meta.instrument, meta.expiration, meta.downloadDate, sessionDate, meta.dataType, hash, f.name, storageKey, f.modifiedTime, now, 'ok', null));
      sum.ingested++;
      if (sample.length < 6) sample.push({ instrument: meta.instrument, sessionDate, dataType: meta.dataType, storageKey });
    } catch (e) {
      sum.errors++;
      // hash=null so the next run does NOT dedupe this row — transient download
      // failures retry until they succeed. ('invalid' rows keep their hash: the
      // content is deterministic, so retrying is pointless until Drive changes.)
      stmts.push(INSERT.bind(f.id, meta.instrument, meta.expiration, meta.downloadDate, sessionDate, meta.dataType, null, f.name, storageKey, f.modifiedTime, now, 'error', String(e && e.message || e)));
      if (sample.length < 6) sample.push({ file: f.name, error: String(e && e.message || e) });
    }
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await env.QUAN_INGEST_DB.batch(stmts.slice(i, i + 50));
  }
  return { ...sum, sample };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/debug') {
      const auth = request.headers.get('Authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) return new Response('unauthorized', { status: 401 });
      try {
        const token = await getAccessToken(env);
        if (url.searchParams.get('deep')) {
          let folders = 0, listCalls = 0, files = 0;
          let queue = [env.GDRIVE_FOLDER_ID];
          while (queue.length) {
            const id = queue.shift(); listCalls++;
            const kids = await listFolderChildren(id, token);
            for (const c of kids) { if (c.mimeType === FOLDER_MIME) { folders++; queue.push(c.id); } else files++; }
          }
          return new Response(JSON.stringify({ folders, listCalls, files, note: 'listCalls ≈ subrequests spent just crawling' }, null, 2), { headers: { 'Content-Type': 'application/json' } });
        }
        const top = await listFolderChildren(env.GDRIVE_FOLDER_ID, token);
        return new Response(JSON.stringify(top.map((f) => ({ name: f.name, mimeType: f.mimeType, id: f.id })), null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500 });
      }
    }
    if (url.pathname === '/sync' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      if (!env.INGEST_ADMIN_TOKEN || auth !== `Bearer ${env.INGEST_ADMIN_TOKEN}`) {
        return new Response('unauthorized', { status: 401 });
      }
      try {
        const out = await runSync(env);
        return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e), stack: e && e.stack }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('Qu\'an ingest worker. POST /sync (Bearer INGEST_ADMIN_TOKEN) to run manually; also runs on cron.', { status: 200 });
  },
};
