/**
 * CSV Session Store Worker
 *
 * Persists CSV files across terminal sessions via Cloudflare KV + R2
 *
 * Flow:
 *   1. User uploads CSV (in-terminal)
 *   2. Store in KV (metadata) + R2 (file content)
 *   3. User logs out / refreshes
 *   4. On re-login: list persisted CSVs from KV
 *   5. User clicks "re-integrate" → re-ingest from R2
 *   6. Data flows through execution_ledger (morphology_performance)
 */

interface CSVSession {
  fileId: string;           // uuid
  fileName: string;         // "Performance.csv"
  userId: string;           // from session token
  uploadedAt: Date;
  fileSize: number;         // bytes
  rowCount: number;         // # trades in file
  hash: string;             // SHA-256 for deduplication
  status: 'uploaded' | 'ingesting' | 'ingested' | 'failed';
  errorMessage?: string;
  r2Key: string;            // R2 object key for retrieval
}

interface CSVSessionStore {
  sessions: CSVSession[];
  lastSync: Date;
}

/**
 * Store CSV in KV + R2
 */
export async function storeCSV(
  userId: string,
  fileName: string,
  csvContent: string,
  env: Env
): Promise<CSVSession> {
  const fileId = crypto.randomUUID();
  const hash = await hashString(csvContent);
  const fileSize = new Blob([csvContent]).size;
  const rowCount = csvContent.split('\n').length - 1;  // Minus header
  const r2Key = `csv-sessions/${userId}/${fileId}/${fileName}`;

  // Store file in R2
  await env.R2_BUCKET.put(r2Key, csvContent, {
    httpMetadata: {
      contentType: 'text/csv',
    },
    customMetadata: {
      userId,
      fileName,
      uploadedAt: new Date().toISOString(),
      hash,
    },
  });

  // Create session record
  const session: CSVSession = {
    fileId,
    fileName,
    userId,
    uploadedAt: new Date(),
    fileSize,
    rowCount,
    hash,
    status: 'uploaded',
    r2Key,
  };

  // Store in KV (index by userId + fileId)
  const kvKey = `csv:${userId}:${fileId}`;
  await env.KV_STORE.put(kvKey, JSON.stringify(session), {
    expirationTtl: 2592000,  // 30 days
  });

  // Add to user's session list
  await addToSessionList(userId, session, env);

  return session;
}

/**
 * List persisted CSV files for user
 */
export async function listCSVs(userId: string, env: Env): Promise<CSVSession[]> {
  const kvKey = `csv-list:${userId}`;
  const stored = await env.KV_STORE.get(kvKey);

  if (!stored) return [];

  const list: CSVSession[] = JSON.parse(stored);

  // Filter out expired entries
  return list.filter(s => {
    const age = Date.now() - new Date(s.uploadedAt).getTime();
    return age < 2592000000;  // 30 days in ms
  });
}

/**
 * Get CSV content from R2
 */
export async function getCSV(r2Key: string, env: Env): Promise<string | null> {
  const obj = await env.R2_BUCKET.get(r2Key);
  if (!obj) return null;

  return obj.text();
}

/**
 * Re-integrate CSV (trigger ingestion)
 */
export async function reintegrateCSV(
  userId: string,
  fileId: string,
  env: Env
): Promise<{ status: 'success' | 'error'; message: string; tradeCount?: number }> {
  try {
    // Get session from KV
    const kvKey = `csv:${userId}:${fileId}`;
    const sessionStr = await env.KV_STORE.get(kvKey);
    if (!sessionStr) {
      return { status: 'error', message: 'CSV session not found' };
    }

    const session: CSVSession = JSON.parse(sessionStr);

    // Get CSV from R2
    const csvContent = await getCSV(session.r2Key, env);
    if (!csvContent) {
      return { status: 'error', message: 'CSV file not found in storage' };
    }

    // Update status to 'ingesting'
    session.status = 'ingesting';
    await env.KV_STORE.put(kvKey, JSON.stringify(session));

    // Call ingestion worker
    const ingestResponse = await fetch(`${env.INGEST_WORKER_URL}/api/execution/ingest-csv`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SERVICE_TOKEN}`,
        'Content-Type': 'text/csv',
        'X-User-ID': userId,
        'X-File-ID': fileId,
      },
      body: csvContent,
    });

    const result = await ingestResponse.json() as { inserted: number; failed: number; errors: string[] };

    // Update status
    if (ingestResponse.ok) {
      session.status = 'ingested';
      await env.KV_STORE.put(kvKey, JSON.stringify(session));

      return {
        status: 'success',
        message: `Ingested ${result.inserted} trades`,
        tradeCount: result.inserted,
      };
    } else {
      session.status = 'failed';
      session.errorMessage = result.errors[0] || 'Ingestion failed';
      await env.KV_STORE.put(kvKey, JSON.stringify(session));

      return {
        status: 'error',
        message: session.errorMessage,
      };
    }
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

/**
 * Delete CSV session
 */
export async function deleteCSV(userId: string, fileId: string, env: Env): Promise<void> {
  // Delete from KV
  const kvKey = `csv:${userId}:${fileId}`;
  await env.KV_STORE.delete(kvKey);

  // Delete from R2
  const sessionStr = await env.KV_STORE.get(kvKey);
  if (sessionStr) {
    const session: CSVSession = JSON.parse(sessionStr);
    await env.R2_BUCKET.delete(session.r2Key);
  }

  // Remove from user's session list
  await removeFromSessionList(userId, fileId, env);
}

/**
 * Add to user's session list (KV index)
 */
async function addToSessionList(userId: string, session: CSVSession, env: Env): Promise<void> {
  const kvKey = `csv-list:${userId}`;
  let list: CSVSession[] = [];

  const stored = await env.KV_STORE.get(kvKey);
  if (stored) {
    list = JSON.parse(stored);
  }

  // Add new session (dedupe by fileId)
  list = list.filter(s => s.fileId !== session.fileId);
  list.push(session);

  // Keep only last 10 files
  list = list.slice(-10);

  await env.KV_STORE.put(kvKey, JSON.stringify(list), {
    expirationTtl: 2592000,  // 30 days
  });
}

/**
 * Remove from user's session list
 */
async function removeFromSessionList(userId: string, fileId: string, env: Env): Promise<void> {
  const kvKey = `csv-list:${userId}`;
  const stored = await env.KV_STORE.get(kvKey);

  if (!stored) return;

  let list: CSVSession[] = JSON.parse(stored);
  list = list.filter(s => s.fileId !== fileId);

  await env.KV_STORE.put(kvKey, JSON.stringify(list));
}

/**
 * Hash string (SHA-256)
 */
async function hashString(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Cloudflare Pages Function Handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auth check
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401 });
    }

    const token = auth.slice(7);
    const userId = await verifyToken(token, env);
    if (!userId) {
      return new Response('Invalid token', { status: 401 });
    }

    // Routes
    if (path === '/api/csv-session/upload' && request.method === 'POST') {
      return handleUpload(request, userId, env);
    }

    if (path === '/api/csv-session/list' && request.method === 'GET') {
      return handleList(userId, env);
    }

    if (path.startsWith('/api/csv-session/reintegrate/') && request.method === 'POST') {
      const fileId = path.split('/').pop();
      if (!fileId) return new Response('File ID required', { status: 400 });
      return handleReintegrate(userId, fileId, env);
    }

    if (path.startsWith('/api/csv-session/delete/') && request.method === 'DELETE') {
      const fileId = path.split('/').pop();
      if (!fileId) return new Response('File ID required', { status: 400 });
      return handleDelete(userId, fileId, env);
    }

    if (path.startsWith('/api/csv-session/download/') && request.method === 'GET') {
      const fileId = path.split('/').pop();
      if (!fileId) return new Response('File ID required', { status: 400 });
      return handleDownload(userId, fileId, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

/**
 * Handle CSV upload
 */
async function handleUpload(request: Request, userId: string, env: Env): Promise<Response> {
  try {
    const csv = await request.text();
    const fileName = request.headers.get('X-File-Name') || 'upload.csv';

    const session = await storeCSV(userId, fileName, csv, env);

    return new Response(JSON.stringify(session), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle list CSVs
 */
async function handleList(userId: string, env: Env): Promise<Response> {
  const csvs = await listCSVs(userId, env);

  return new Response(JSON.stringify(csvs), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle re-integrate CSV
 */
async function handleReintegrate(userId: string, fileId: string, env: Env): Promise<Response> {
  const result = await reintegrateCSV(userId, fileId, env);

  return new Response(JSON.stringify(result), {
    status: result.status === 'success' ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle delete CSV
 */
async function handleDelete(userId: string, fileId: string, env: Env): Promise<Response> {
  await deleteCSV(userId, fileId, env);

  return new Response(JSON.stringify({ status: 'deleted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle download CSV
 */
async function handleDownload(userId: string, fileId: string, env: Env): Promise<Response> {
  const kvKey = `csv:${userId}:${fileId}`;
  const sessionStr = await env.KV_STORE.get(kvKey);

  if (!sessionStr) {
    return new Response('CSV not found', { status: 404 });
  }

  const session: CSVSession = JSON.parse(sessionStr);
  const csv = await getCSV(session.r2Key, env);

  if (!csv) {
    return new Response('CSV file not found', { status: 404 });
  }

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${session.fileName}"`,
    },
  });
}

/**
 * Verify token (stub)
 */
async function verifyToken(token: string, env: Env): Promise<string | null> {
  // TODO: implement JWT verification
  return 'user-123';  // Stub
}

// Environment
interface Env {
  KV_STORE: KVNamespace;
  R2_BUCKET: R2Bucket;
  INGEST_WORKER_URL: string;
  SERVICE_TOKEN: string;
}
