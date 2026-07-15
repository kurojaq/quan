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

/* ---- classification (Rule 1 / Rule 2 from the ingestion spec) ---- */
const INSTR_RE = /^([A-Z0-9]{1,4})[-_ ]?(?:options?|opt)?/i;
function classifyName(name) {
  const n = name.toLowerCase();
  const dataType = /vol(atility)?/.test(n) ? 'volatility'
    : /greek/.test(n) ? 'greeks'
    : 'optionPrices';
  const instMatch = name.match(/\b(ES|MES|NQ|MNQ|YM|MYM|RTY|M2K|ZT|ZF|ZN|ZB|UB|SR3|6E|6B|6J|6A|6C|6S|6N|GC|MGC|SI|SIL|HG|PL|PA|CL|QM|NG|RB|HO|BZ|ZC|ZW|ZS|ZM|ZL|KE|ZO|ZR|LE|GF|HE|DC|BTC|MBT|ETH)\b/i);
  const instrument = instMatch ? instMatch[1].toUpperCase() : null;
  const expMatch = name.match(/exp[-_]?(\d{2})[-_](\d{2})[-_](\d{2,4})/i);
  const expiration = expMatch ? `${expMatch[3].length === 2 ? '20' + expMatch[3] : expMatch[3]}-${expMatch[1]}-${expMatch[2]}` : null;
  const dateAll = name.match(/(\d{8})/g);
  const downloadDate = dateAll ? isoFromMMDDYYYY(dateAll[dateAll.length - 1]) : null;
  return { instrument, dataType, expiration, downloadDate };
}
function isoFromMMDDYYYY(s) {
  if (s.length !== 8) return null;
  const mm = s.slice(0, 2), dd = s.slice(2, 4), yyyy = s.slice(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}
function sessionDateFor(dataType, downloadDate) {
  if (!downloadDate) return null;
  if (dataType !== 'optionPrices') return downloadDate; // Rule 2: no offset
  const d = new Date(downloadDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1); // Rule 1: sessionDate = downloadDate + 1
  return d.toISOString().slice(0, 10);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ingest_files (drive_id TEXT PRIMARY KEY, instrument TEXT, expiration TEXT, download_date TEXT, session_date TEXT, data_type TEXT, file_hash TEXT, original_filename TEXT, storage_key TEXT, upload_ts TEXT, processed_ts TEXT, version INTEGER DEFAULT 1, status TEXT)`).run();
}

async function processFile(env, token, file) {
  const meta = classifyName(file.name);
  if (!meta.instrument || !meta.downloadDate) {
    return { file: file.name, status: 'skipped', reason: 'could not classify instrument/date from filename' };
  }
  meta.sessionDate = sessionDateFor(meta.dataType, meta.downloadDate);

  const existing = await env.QUAN_INGEST_DB.prepare('SELECT file_hash FROM ingest_files WHERE drive_id = ?')
    .bind(file.id).first();
  const hash = file.md5Checksum || (await sha256Hex(file.id + file.modifiedTime));
  if (existing && existing.file_hash === hash) {
    return { file: file.name, status: 'unchanged' };
  }

  const text = await downloadDriveFile(file.id, token);
  const storageKey = `${meta.instrument}/${meta.expiration || 'unknown-exp'}/${meta.sessionDate}/${meta.dataType}.csv`;
  await env.QUAN_INGEST_BUCKET.put(storageKey, text, { httpMetadata: { contentType: 'text/csv' } });

  await env.QUAN_INGEST_DB.prepare(`
    INSERT INTO ingest_files (drive_id, instrument, expiration, download_date, session_date, data_type,
      file_hash, original_filename, storage_key, upload_ts, processed_ts, version, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT version FROM ingest_files WHERE drive_id=?)+1,1),'ok')
    ON CONFLICT(drive_id) DO UPDATE SET
      instrument=excluded.instrument, expiration=excluded.expiration, download_date=excluded.download_date,
      session_date=excluded.session_date, data_type=excluded.data_type, file_hash=excluded.file_hash,
      storage_key=excluded.storage_key, processed_ts=excluded.processed_ts, version=excluded.version, status='ok'
  `).bind(file.id, meta.instrument, meta.expiration, meta.downloadDate, meta.sessionDate, meta.dataType,
    hash, file.name, storageKey, file.modifiedTime, new Date().toISOString(), file.id).run();

  return { file: file.name, status: 'ingested', instrument: meta.instrument, sessionDate: meta.sessionDate, dataType: meta.dataType, storageKey };
}

async function runSync(env) {
  await ensureSchema(env.QUAN_INGEST_DB);
  const token = await getAccessToken(env);
  const files = await listDriveFiles(env, token);
  const results = [];
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.csv')) continue;
    try { results.push(await processFile(env, token, f)); }
    catch (e) { results.push({ file: f.name, status: 'error', reason: String(e && e.message || e) }); }
  }
  return { scanned: files.length, results };
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
