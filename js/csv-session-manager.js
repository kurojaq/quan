/* CSV Session Manager — persists CSV files across sessions via Cloudflare KV + R2.
 *
 * Supports two types of CSV data:
 * 1. Execution Data: Tradovate performance exports (trades, entry/exit, P&L)
 *    - Can be re-ingested to re-populate execution_ledger
 *    - Flows through morphology_performance → learning loop
 * 2. Option Data: Chain data, Greeks, IV surfaces, historical snapshots
 *    - Stored as reference data (no re-ingest)
 *    - Supports download for use in charting/analysis
 *
 * Auth token is stored in sessionStorage on login.
 */

(function () {
  let manager = {
    apiBase: 'https://csv-session-store-production.jqnboggan.workers.dev',
    executionSessions: [],
    optionSessions: [],
    uploading: false,
    uploadType: 'execution', // 'execution' or 'option'
    reintegratingId: null,
  };

  // Get auth token from sessionStorage
  function getToken() {
    return sessionStorage.getItem('auth_token') || '';
  }

  // API call with auth header
  async function apiCall(endpoint, options = {}) {
    const token = getToken();
    if (!token) {
      showStatus('Not authenticated. Please log in first.', 'error');
      return null;
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    };

    try {
      const response = await fetch(`${manager.apiBase}${endpoint}`, {
        ...options,
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          showStatus('Authentication failed. Please log in again.', 'error');
          sessionStorage.removeItem('auth_token');
        }
        throw new Error(`API error: ${response.status}`);
      }

      return response;
    } catch (e) {
      showStatus(`API error: ${e.message}`, 'error');
      return null;
    }
  }

  // Load persisted CSV list (separate execution and option data)
  async function loadSessions() {
    const response = await apiCall('/api/csv-session/list', { method: 'GET' });
    if (!response) {
      manager.executionSessions = [];
      manager.optionSessions = [];
      return;
    }

    try {
      const allSessions = await response.json();
      // Separate by type
      manager.executionSessions = (allSessions || []).filter(s => s.type === 'execution' || !s.type); // default to execution for backward compat
      manager.optionSessions = (allSessions || []).filter(s => s.type === 'option');
      renderSessionsList();
    } catch (e) {
      showStatus(`Failed to load sessions: ${e.message}`, 'error');
    }
  }

  // Handle file upload
  async function handleUpload(file) {
    if (!file) return;

    manager.uploading = true;
    updateUploadUI();

    try {
      const csv = await file.text();
      const type = manager.uploadType || 'execution'; // default to execution

      const response = await apiCall('/api/csv-session/upload', {
        method: 'POST',
        headers: {
          'X-File-Name': file.name,
          'X-CSV-Type': type, // execution or option
          'Content-Type': 'text/csv',
        },
        body: csv,
      });

      if (!response) return;

      const session = await response.json();

      // Add to appropriate list
      if (type === 'option') {
        manager.optionSessions.unshift(session);
      } else {
        manager.executionSessions.unshift(session);
      }
      renderSessionsList();

      const typeLabel = type === 'option' ? 'Option Data' : 'Execution';
      showStatus(`✅ Uploaded: ${file.name} (${session.rowCount || '?'} rows) · ${typeLabel}`, 'success');
    } catch (e) {
      showStatus(`Upload failed: ${e.message}`, 'error');
    } finally {
      manager.uploading = false;
      updateUploadUI();
    }
  }

  // Re-integrate CSV (re-ingest from storage)
  async function reintegrate(fileId) {
    manager.reintegratingId = fileId;
    renderSessionsList();

    const response = await apiCall(`/api/csv-session/reintegrate/${fileId}`, { method: 'POST' });
    if (!response) {
      manager.reintegratingId = null;
      renderSessionsList();
      return;
    }

    try {
      const result = await response.json();
      const session = manager.sessions.find(s => s.fileId === fileId);
      if (session) session.status = 'ingested';
      renderSessionsList();

      showStatus(`✅ ${result.message}`, 'success');
    } catch (e) {
      showStatus(`Re-integration failed: ${e.message}`, 'error');
    } finally {
      manager.reintegratingId = null;
      renderSessionsList();
    }
  }

  // Download CSV file
  async function downloadCSV(fileId) {
    const session = manager.sessions.find(s => s.fileId === fileId);
    if (!session) return;

    const response = await apiCall(`/api/csv-session/download/${fileId}`, { method: 'GET' });
    if (!response) return;

    try {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = session.fileName;
      a.click();
      URL.revokeObjectURL(url);

      showStatus(`✅ Downloaded: ${session.fileName}`, 'success');
    } catch (e) {
      showStatus(`Download failed: ${e.message}`, 'error');
    }
  }

  // Delete session
  async function deleteSession(fileId, type) {
    type = type || 'execution'; // default to execution

    const sessions = type === 'option' ? manager.optionSessions : manager.executionSessions;
    const session = sessions.find(s => s.fileId === fileId);
    if (!session) return;

    if (!confirm(`Delete "${session.fileName}"? This cannot be undone.`)) return;

    const response = await apiCall(`/api/csv-session/delete/${fileId}`, { method: 'DELETE' });
    if (!response) return;

    if (type === 'option') {
      manager.optionSessions = manager.optionSessions.filter(s => s.fileId !== fileId);
    } else {
      manager.executionSessions = manager.executionSessions.filter(s => s.fileId !== fileId);
    }
    renderSessionsList();

    showStatus(`✅ Deleted: ${session.fileName}`, 'success');
  }

  // Render the UI
  function render() {
    const container = document.getElementById('csvSessionManager');
    if (!container) return;

    container.innerHTML = `
      <div class="csv-manager">
        <div class="csv-header">
          <h3>💾 CSV Session Store</h3>
          <p class="csv-hint">Execution + Option data · persist across logins · 30-day TTL</p>
        </div>

        <div class="csv-upload-section">
          <div class="upload-controls">
            <select id="csvTypeSelect" class="csv-type-select">
              <option value="execution">📊 Execution (Tradovate trades)</option>
              <option value="option">📈 Option Data (chains, Greeks, IV)</option>
            </select>
            <input type="file" accept=".csv" id="csvFileInput" style="display: none;">
            <button class="csv-upload-btn" id="csvUploadBtn">
              <span id="uploadBtnText">📤 Upload CSV</span>
            </button>
          </div>
        </div>

        <div class="csv-status" id="csvStatus" style="display: none;"></div>

        <div class="csv-sessions-section">
          <div class="csv-section">
            <h4>Execution Data</h4>
            <div id="csvExecutionList" class="csv-list"></div>
          </div>
          <div class="csv-section" style="margin-top: 20px;">
            <h4>Option Data</h4>
            <div id="csvOptionList" class="csv-list"></div>
          </div>
        </div>
      </div>
    `;

    // Wire up type selector
    document.getElementById('csvTypeSelect').addEventListener('change', (e) => {
      manager.uploadType = e.target.value;
    });

    // Wire up upload
    document.getElementById('csvFileInput').addEventListener('change', (e) => {
      if (e.target.files[0]) handleUpload(e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('csvUploadBtn').addEventListener('click', () => {
      document.getElementById('csvFileInput').click();
    });

    // Initial load
    loadSessions();
  }

  // Render sessions list (separate execution and option data)
  function renderSessionsList() {
    const execList = document.getElementById('csvExecutionList');
    const optList = document.getElementById('csvOptionList');
    if (!execList || !optList) return;

    // Render execution data
    if (manager.executionSessions.length === 0) {
      execList.innerHTML = '<div class="csv-empty">No execution CSVs yet.</div>';
    } else {
      execList.innerHTML = manager.executionSessions.map(session => renderSessionItem(session, 'execution')).join('');
    }

    // Render option data
    if (manager.optionSessions.length === 0) {
      optList.innerHTML = '<div class="csv-empty">No option data CSVs yet.</div>';
    } else {
      optList.innerHTML = manager.optionSessions.map(session => renderSessionItem(session, 'option')).join('');
    }
  }

  // Render a single session item
  function renderSessionItem(session, type) {
    const isExecution = type === 'execution';
    const canReintegrate = isExecution && (session.status === 'uploaded' || session.status === 'failed');
    const canDownload = isExecution ? (session.status === 'ingested') : true; // option data can always download

    return `
      <div class="csv-item csv-item-${session.status}">
        <div class="csv-item-icon">
          ${session.status === 'uploaded' ? '📤' :
            session.status === 'ingesting' ? '⏳' :
            session.status === 'ingested' ? '✅' :
            session.status === 'failed' ? '❌' : ''}
        </div>
        <div class="csv-item-info">
          <div class="csv-item-name">${escapeHtml(session.fileName)}</div>
          <div class="csv-item-meta">
            ${session.rowCount || '?'} rows · ${formatBytes(session.fileSize)} · ${formatDate(session.uploadedAt)}
          </div>
          ${session.errorMessage ? `<div class="csv-item-error">${escapeHtml(session.errorMessage)}</div>` : ''}
        </div>
        <div class="csv-item-actions">
          ${canReintegrate ? `
            <button class="csv-btn csv-btn-reintegrate" onclick="window.__csvSessionManager.reintegrate('${session.fileId}')" ${manager.reintegratingId === session.fileId ? 'disabled' : ''}>
              ${manager.reintegratingId === session.fileId ? '⏳' : '🔄'} Reintegrate
            </button>
          ` : ''}
          ${canDownload ? `
            <button class="csv-btn csv-btn-download" onclick="window.__csvSessionManager.downloadCSV('${session.fileId}')">
              ⬇️ Download
            </button>
          ` : ''}
          <button class="csv-btn csv-btn-delete" onclick="window.__csvSessionManager.deleteSession('${session.fileId}', '${type}')">
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
  }

  // Update upload button state
  function updateUploadUI() {
    const btn = document.getElementById('csvUploadBtn');
    if (btn) {
      btn.disabled = manager.uploading;
      document.getElementById('uploadBtnText').textContent = manager.uploading ? '⏳ Uploading...' : '📤 Upload CSV';
    }
  }

  // Show status message
  function showStatus(msg, type = 'info') {
    const status = document.getElementById('csvStatus');
    if (!status) return;

    status.textContent = msg;
    status.className = `csv-status csv-status-${type}`;
    status.style.display = 'block';

    setTimeout(() => {
      status.style.display = 'none';
    }, 4000);
  }

  // Utility: escape HTML
  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => map[c]);
  }

  // Utility: format bytes
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
  }

  // Utility: format date
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Public API
  window.__csvSessionManager = {
    render,
    reintegrate,
    downloadCSV,
    deleteSession,
    getToken,
  };

  // Auto-boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
