<template>
  <div class="csv-session-manager">
    <!-- Upload Section -->
    <div class="section upload">
      <h3>📁 Upload Performance Data</h3>

      <div class="upload-area" @dragover.prevent @drop="handleDrop" :class="{ dragging }">
        <input
          type="file"
          ref="fileInput"
          @change="handleFileSelect"
          accept=".csv"
          class="hidden"
        />

        <button @click="$refs.fileInput?.click()" class="upload-button">
          <span v-if="!uploading">📤 Click to upload CSV or drag here</span>
          <span v-else>⏳ Uploading... {{ uploadProgress }}%</span>
        </button>
      </div>

      <p class="hint">
        Tradovate performance export (symbol, qty, prices, timestamps)
      </p>
    </div>

    <!-- Persisted Sessions -->
    <div class="section sessions">
      <h3>💾 Persisted Sessions (Auto-restored on login)</h3>

      <div v-if="sessions.length === 0" class="empty">
        No saved CSV files yet. Upload one above.
      </div>

      <div v-else class="sessions-list">
        <div
          v-for="session in sessions"
          :key="session.fileId"
          class="session-item"
          :class="session.status"
        >
          <!-- Status Indicator -->
          <span class="status-icon">
            <span v-if="session.status === 'uploaded'">📤</span>
            <span v-else-if="session.status === 'ingesting'">⏳</span>
            <span v-else-if="session.status === 'ingested'">✅</span>
            <span v-else-if="session.status === 'failed'">❌</span>
          </span>

          <!-- File Info -->
          <div class="info">
            <strong>{{ session.fileName }}</strong>
            <span class="meta">
              {{ session.rowCount }} trades • {{ formatBytes(session.fileSize) }}
              • {{ formatDate(session.uploadedAt) }}
            </span>
            <span v-if="session.errorMessage" class="error">
              {{ session.errorMessage }}
            </span>
          </div>

          <!-- Actions -->
          <div class="actions">
            <button
              v-if="session.status === 'uploaded' || session.status === 'failed'"
              @click="reintegrate(session.fileId)"
              :disabled="reintegratingId === session.fileId"
              class="btn-reintegrate"
            >
              {{ reintegratingId === session.fileId ? '⏳' : '🔄' }} Reintegrate
            </button>

            <button
              v-if="session.status === 'ingested'"
              @click="openDownload(session.fileId)"
              class="btn-download"
            >
              ⬇️ Download
            </button>

            <button
              @click="deleteSession(session.fileId)"
              :disabled="deletingId === session.fileId"
              class="btn-delete"
            >
              {{ deletingId === session.fileId ? '⏳' : '🗑️' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Statistics -->
      <div v-if="sessions.length > 0" class="statistics">
        <div class="stat">
          <strong>Total Trades:</strong> {{ totalTrades }}
        </div>
        <div class="stat">
          <strong>Ingested:</strong> {{ ingestedCount }} / {{ sessions.length }}
        </div>
        <div class="stat">
          <strong>Storage:</strong> {{ formatBytes(totalSize) }}
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="section actions">
      <h3>⚡ Quick Actions</h3>

      <button
        @click="reintegrateAll"
        :disabled="!hasUnprocessed || reintegratingAll"
        class="btn-primary"
      >
        {{ reintegratingAll ? '⏳ Re-integrating all...' : '🔄 Re-integrate All Unprocessed' }}
      </button>

      <button
        @click="deleteExpired"
        :disabled="expiredCount === 0"
        class="btn-secondary"
      >
        🗑️ Delete Expired ({{ expiredCount }})
      </button>

      <button
        @click="refreshList"
        class="btn-secondary"
      >
        🔄 Refresh List
      </button>
    </div>

    <!-- Status Messages -->
    <transition name="fade">
      <div v-if="statusMessage" :class="['status-message', statusType]">
        {{ statusMessage }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

interface CSVSession {
  fileId: string;
  fileName: string;
  userId: string;
  uploadedAt: string;
  fileSize: number;
  rowCount: number;
  hash: string;
  status: 'uploaded' | 'ingesting' | 'ingested' | 'failed';
  errorMessage?: string;
  r2Key: string;
}

const fileInput = ref<HTMLInputElement>();
const dragging = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const sessions = ref<CSVSession[]>([]);
const statusMessage = ref('');
const statusType = ref<'success' | 'error' | 'info'>('info');
const reintegratingId = ref('');
const deletingId = ref('');
const reintegratingAll = ref(false);

// Get token from session storage
const getToken = (): string => {
  return sessionStorage.getItem('auth_token') || '';
};

// Load persisted sessions
const refreshList = async () => {
  try {
    const response = await fetch('/api/csv-session/list', {
      headers: { 'Authorization': `Bearer ${getToken()}` },
    });

    if (!response.ok) throw new Error('Failed to load sessions');

    sessions.value = await response.json();
  } catch (e) {
    showMessage(`Error loading sessions: ${String(e)}`, 'error');
  }
};

// Handle file selection
const handleFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) {
    await uploadCSV(input.files[0]);
  }
};

// Handle drag & drop
const handleDrop = async (event: DragEvent) => {
  dragging.value = false;
  if (event.dataTransfer?.files?.[0]) {
    await uploadCSV(event.dataTransfer.files[0]);
  }
};

// Upload CSV file
const uploadCSV = async (file: File) => {
  try {
    uploading.value = true;
    uploadProgress.value = 0;

    const csv = await file.text();

    const response = await fetch('/api/csv-session/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'X-File-Name': file.name,
      },
      body: csv,
    });

    if (!response.ok) throw new Error('Upload failed');

    uploadProgress.value = 100;
    showMessage(`✅ Uploaded ${file.name}`, 'success');

    // Refresh list
    await refreshList();
  } catch (e) {
    showMessage(`Upload error: ${String(e)}`, 'error');
  } finally {
    uploading.value = false;
    uploadProgress.value = 0;
  }
};

// Re-integrate single CSV
const reintegrate = async (fileId: string) => {
  try {
    reintegratingId.value = fileId;

    const response = await fetch(`/api/csv-session/reintegrate/${fileId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
    });

    const result = await response.json() as { status: string; message: string; tradeCount?: number };

    if (result.status === 'success') {
      showMessage(`✅ Re-integrated ${result.tradeCount} trades`, 'success');
      await refreshList();
    } else {
      showMessage(`Error: ${result.message}`, 'error');
    }
  } catch (e) {
    showMessage(`Reintegration error: ${String(e)}`, 'error');
  } finally {
    reintegratingId.value = '';
  }
};

// Re-integrate all unprocessed
const reintegrateAll = async () => {
  try {
    reintegratingAll.value = true;

    const unprocessed = sessions.value.filter(s => s.status === 'uploaded' || s.status === 'failed');

    for (const session of unprocessed) {
      await reintegrate(session.fileId);
    }

    showMessage(`✅ Re-integrated all files`, 'success');
  } finally {
    reintegratingAll.value = false;
  }
};

// Delete session
const deleteSession = async (fileId: string) => {
  if (!confirm('Delete this CSV session? (File will be removed from storage)')) return;

  try {
    deletingId.value = fileId;

    const response = await fetch(`/api/csv-session/delete/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` },
    });

    if (!response.ok) throw new Error('Delete failed');

    showMessage('✅ CSV deleted', 'success');
    await refreshList();
  } catch (e) {
    showMessage(`Delete error: ${String(e)}`, 'error');
  } finally {
    deletingId.value = '';
  }
};

// Delete expired sessions
const deleteExpired = async () => {
  if (!confirm(`Delete ${expiredCount.value} expired sessions?`)) return;

  try {
    const expired = sessions.value.filter(isExpired);
    for (const session of expired) {
      await deleteSession(session.fileId);
    }
  } catch (e) {
    showMessage(`Error: ${String(e)}`, 'error');
  }
};

// Download CSV
const openDownload = async (fileId: string) => {
  const session = sessions.value.find(s => s.fileId === fileId);
  if (!session) return;

  // Trigger download
  const url = `/api/csv-session/download/${fileId}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = session.fileName;
  a.click();
};

// Show status message
const showMessage = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
  statusMessage.value = msg;
  statusType.value = type;

  setTimeout(() => {
    statusMessage.value = '';
  }, 3000);
};

// Computed properties
const isExpired = (session: CSVSession): boolean => {
  const age = Date.now() - new Date(session.uploadedAt).getTime();
  return age > 2592000000;  // 30 days in ms
};

const expiredCount = computed(() => sessions.value.filter(isExpired).length);
const totalTrades = computed(() => sessions.value.reduce((sum, s) => sum + s.rowCount, 0));
const ingestedCount = computed(() => sessions.value.filter(s => s.status === 'ingested').length);
const totalSize = computed(() => sessions.value.reduce((sum, s) => sum + s.fileSize, 0));
const hasUnprocessed = computed(() => sessions.value.some(s => s.status === 'uploaded' || s.status === 'failed'));

// Utility functions
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString();
};

// Load on mount
onMounted(() => {
  refreshList();
});
</script>

<style scoped>
.csv-session-manager {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #000);
}

@media (prefers-color-scheme: dark) {
  .csv-session-manager {
    background: #1a1a1a;
    color: #e0e0e0;
  }
}

.section {
  margin-bottom: 30px;
  padding: 20px;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
  border: 1px solid var(--border-color, #ddd);
}

@media (prefers-color-scheme: dark) {
  .section {
    background: #2a2a2a;
    border-color: #444;
  }
}

h3 {
  margin: 0 0 15px 0;
  font-size: 18px;
  font-weight: 600;
}

/* Upload Area */
.upload-area {
  padding: 40px 20px;
  border: 2px dashed var(--border-color, #ddd);
  border-radius: 8px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-tertiary, #fafafa);
}

.upload-area:hover {
  border-color: #0066cc;
  background: var(--bg-hover, #f0f0f0);
}

.upload-area.dragging {
  border-color: #0066cc;
  background: var(--bg-active, #e6f2ff);
}

@media (prefers-color-scheme: dark) {
  .upload-area {
    background: #333;
  }

  .upload-area:hover {
    background: #3a3a3a;
  }

  .upload-area.dragging {
    background: #1a3a5a;
  }
}

.hidden {
  display: none;
}

.upload-button {
  padding: 12px 24px;
  background: #0066cc;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
}

.upload-button:hover {
  background: #0052a3;
}

.hint {
  margin: 10px 0 0 0;
  font-size: 12px;
  color: var(--text-secondary, #666);
}

/* Sessions List */
.sessions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-primary, white);
  border-radius: 6px;
  border-left: 4px solid #999;
}

.session-item.uploaded {
  border-left-color: #ffa500;
}

.session-item.ingesting {
  border-left-color: #0066cc;
}

.session-item.ingested {
  border-left-color: #28a745;
}

.session-item.failed {
  border-left-color: #dc3545;
}

@media (prefers-color-scheme: dark) {
  .session-item {
    background: #2a2a2a;
  }
}

.status-icon {
  font-size: 20px;
  min-width: 24px;
}

.info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info strong {
  font-size: 14px;
  font-weight: 600;
}

.meta {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.error {
  color: #dc3545;
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 6px;
}

.actions button {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--btn-bg, #e0e0e0);
  color: var(--btn-text, #000);
}

.actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-reintegrate {
  background: #0066cc;
  color: white;
}

.btn-reintegrate:hover:not(:disabled) {
  background: #0052a3;
}

.btn-download {
  background: #28a745;
  color: white;
}

.btn-download:hover:not(:disabled) {
  background: #218838;
}

.btn-delete {
  background: #dc3545;
  color: white;
}

.btn-delete:hover:not(:disabled) {
  background: #c82333;
}

/* Statistics */
.statistics {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid var(--border-color, #ddd);
  display: flex;
  gap: 20px;
  font-size: 14px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat strong {
  font-weight: 600;
}

/* Quick Actions */
.section.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section.actions button {
  padding: 12px 24px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary {
  background: #0066cc;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #0052a3;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--btn-bg, #e0e0e0);
  color: var(--btn-text, #000);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--btn-hover, #d0d0d0);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Status Message */
.status-message {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 12px 20px;
  border-radius: 6px;
  font-size: 14px;
  z-index: 1000;
}

.status-message.success {
  background: #28a745;
  color: white;
}

.status-message.error {
  background: #dc3545;
  color: white;
}

.status-message.info {
  background: #0066cc;
  color: white;
}

/* Animations */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.empty {
  padding: 30px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-style: italic;
}

@media (prefers-color-scheme: dark) {
  .empty {
    color: #999;
  }
}
</style>
