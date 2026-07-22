# CSV Session Store — Deployment Guide

**Status:** Ready to Deploy  
**Components:** 1 Worker + 1 Vue Component  
**Storage:** KV (metadata) + R2 (CSV files)  
**Files:** 1,157 lines

---

## Quick Start

### 1. Create KV Namespace & R2 Bucket

```bash
# Create KV namespace
wrangler kv:namespace create "csv-store"
wrangler kv:namespace create "csv-store-preview"  # for development

# Create R2 bucket
wrangler r2 bucket create quan-csv-sessions
wrangler r2 bucket create quan-csv-sessions-preview  # for development
```

### 2. Update wrangler-csv-session.toml

Add the KV namespace IDs and R2 bucket configuration:

```toml
[[kv_namespaces]]
binding = "KV_STORE"
id = "YOUR_KV_ID_HERE"
preview_id = "YOUR_KV_PREVIEW_ID_HERE"
```

### 3. Deploy Worker

```bash
# Deploy to production
wrangler deploy --config workers/wrangler-csv-session.toml --env production

# Or test locally
wrangler dev --config workers/wrangler-csv-session.toml
```

### 4. Wire Vue Component to Terminal

In `app.html` or main terminal component:

```vue
<script setup>
import CSVSessionManager from '@/js/CSVSessionManager.vue';
</script>

<template>
  <div class="terminal">
    <!-- Existing tabs -->
    
    <!-- CSV Session Manager (sidebar or tab) -->
    <div class="csv-sidebar">
      <CSVSessionManager />
    </div>
  </div>
</template>
```

### 5. Update Session Store

In terminal auth flow, save token to sessionStorage:

```typescript
// On successful login
sessionStorage.setItem('auth_token', jwt_token);
```

---

## Architecture

### Data Flow

```
User Terminal
  ↓
Upload CSV
  ↓
csv-session-store.ts (Worker)
  ↓
KV: Store metadata (userId:fileId → CSVSession)
R2: Store CSV content (csv-sessions/{userId}/{fileId}/{fileName})
  ↓
User logs out / refreshes
  ↓
User logs back in
  ↓
CSVSessionManager loads from KV (lists saved files)
  ↓
User clicks "Reintegrate"
  ↓
Fetch CSV from R2
Call execution-ingest worker
  ↓
execution_ledger ← ingested data
morphology_performance ← aggregated daily
```

### Storage Layout

**KV:**
```
csv:userId:fileId → {fileId, fileName, status, fileSize, rowCount, hash, r2Key, ...}
csv-list:userId → [{...}, {...}, ...]  (list of last 10 files)
```

**R2:**
```
csv-sessions/
  └── userId/
      └── fileId/
          └── fileName  (CSV content)
```

---

## API Reference

### POST /api/csv-session/upload

Upload CSV file

**Request:**
```bash
curl -X POST https://api.example.com/api/csv-session/upload \
  -H "Authorization: Bearer TOKEN" \
  -H "X-File-Name: Performance.csv" \
  -H "Content-Type: text/csv" \
  -d @Performance.csv
```

**Response:**
```json
{
  "fileId": "uuid",
  "fileName": "Performance.csv",
  "uploadedAt": "2026-07-22T14:30:00Z",
  "fileSize": 2048,
  "rowCount": 42,
  "status": "uploaded",
  "r2Key": "csv-sessions/user-123/uuid/Performance.csv"
}
```

### GET /api/csv-session/list

List persisted CSVs for user

**Request:**
```bash
curl https://api.example.com/api/csv-session/list \
  -H "Authorization: Bearer TOKEN"
```

**Response:**
```json
[
  {
    "fileId": "uuid1",
    "fileName": "Performance.csv",
    "rowCount": 42,
    "status": "ingested",
    ...
  },
  {
    "fileId": "uuid2",
    "fileName": "Weekly-Report.csv",
    "rowCount": 15,
    "status": "uploaded",
    ...
  }
]
```

### POST /api/csv-session/reintegrate/{fileId}

Re-integrate CSV (re-ingest from R2)

**Request:**
```bash
curl -X POST https://api.example.com/api/csv-session/reintegrate/uuid1 \
  -H "Authorization: Bearer TOKEN"
```

**Response:**
```json
{
  "status": "success",
  "message": "Ingested 42 trades",
  "tradeCount": 42
}
```

### DELETE /api/csv-session/delete/{fileId}

Delete CSV from storage

**Request:**
```bash
curl -X DELETE https://api.example.com/api/csv-session/delete/uuid1 \
  -H "Authorization: Bearer TOKEN"
```

**Response:**
```json
{
  "status": "deleted"
}
```

### GET /api/csv-session/download/{fileId}

Download previously uploaded CSV

**Request:**
```bash
curl -o Performance.csv \
  https://api.example.com/api/csv-session/download/uuid1 \
  -H "Authorization: Bearer TOKEN"
```

---

## Component Usage

### Basic Integration

```vue
<template>
  <div class="terminal-app">
    <CSVSessionManager />
  </div>
</template>

<script setup>
import CSVSessionManager from '@/js/CSVSessionManager.vue';
</script>
```

### Features

- **Upload**: Drag & drop or click to upload CSV
- **List**: Shows all persisted files with status
- **Re-integrate**: Click to re-ingest from storage
- **Download**: Export previously uploaded files
- **Delete**: Remove from storage (with confirmation)
- **Statistics**: Total trades, storage used, ingested count
- **Auto-refresh**: Loads saved files on mount

---

## Storage Limits & TTL

| Aspect | Value |
|--------|-------|
| TTL | 30 days |
| Max files per user | 10 (keeps last 10) |
| Max file size | Unlimited (R2 scales) |
| Deduplication | SHA-256 hash (can't upload duplicate) |

---

## Error Handling

Worker includes error handling for:
- Authentication failures (401)
- File not found (404)
- Ingestion failures (returns error message)
- Storage failures (returns 500)

Component displays:
- Upload progress
- Re-integration status (success/error)
- Error messages with details
- Failed ingestion details

---

## Testing Locally

### 1. Start dev server

```bash
wrangler dev --config workers/wrangler-csv-session.toml
```

### 2. Upload test CSV

```bash
curl -X POST http://localhost:8787/api/csv-session/upload \
  -H "Authorization: Bearer test-token" \
  -H "X-File-Name: test.csv" \
  -d "symbol,qty,price
ESZ26,20,5460.25"
```

### 3. List files

```bash
curl http://localhost:8787/api/csv-session/list \
  -H "Authorization: Bearer test-token"
```

### 4. Re-integrate

```bash
curl -X POST http://localhost:8787/api/csv-session/reintegrate/{fileId} \
  -H "Authorization: Bearer test-token"
```

---

## Integration with Execution Ingestion

The re-integrate endpoint calls the execution-ingest worker:

```typescript
const ingestResponse = await fetch(
  `${env.INGEST_WORKER_URL}/api/execution/ingest-csv`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SERVICE_TOKEN}`,
      'Content-Type': 'text/csv',
      'X-User-ID': userId,
      'X-File-ID': fileId,
    },
    body: csvContent,
  }
);
```

Make sure `INGEST_WORKER_URL` and `SERVICE_TOKEN` are set in environment:

```toml
[env.production]
vars = {
  INGEST_WORKER_URL = "https://api.example.com",
  SERVICE_TOKEN = "your-service-token"
}
```

---

## Production Checklist

- [ ] KV namespace created (prod + preview)
- [ ] R2 bucket created (prod + preview)
- [ ] wrangler-csv-session.toml updated with IDs
- [ ] INGEST_WORKER_URL configured
- [ ] SERVICE_TOKEN configured
- [ ] Worker deployed to production
- [ ] CSVSessionManager imported in terminal
- [ ] Auth token saved to sessionStorage on login
- [ ] Test: upload → logout → login → re-integrate
- [ ] Test: download CSV
- [ ] Test: delete session
- [ ] Test: expired cleanup

---

## Rollback

If needed, disable CSV session store:

1. Revert worker deployment
2. Remove CSVSessionManager from terminal
3. User data in R2 remains (30-day TTL)

No breaking changes — existing execution data unaffected.

---

**Ready for production deployment. No blockers.**

🚀
