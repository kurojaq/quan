/**
 * Barchart UI Integration
 *
 * Adds import panel to the terminal for seamless Barchart CSV fetching.
 * Integrates with existing csv-session-manager.js for upload.
 */

(function(global) {
  'use strict';

  if (!global.__barchartFetcher) {
    console.error('[Barchart UI] Fetcher not loaded');
    return;
  }

  const FETCHER = global.__barchartFetcher;

  /* ========================================================================
     UI Panel Creation
     ======================================================================== */

  function createImportPanel() {
    const html = `
      <div id="barchartImportPanel" class="barchart-panel" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9995;
        width: 340px;
        background: var(--glass-strong);
        backdrop-filter: var(--blur);
        -webkit-backdrop-filter: var(--blur);
        border: 0.5px solid var(--glass-line);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow);
        font-size: 12px;
        color: var(--cream);
        font-family: ui-monospace, Menlo, monospace;
        display: none;
      ">
        <!-- Header -->
        <div style="
          padding: 12px 14px;
          border-bottom: 0.5px solid var(--glass-line);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        ">
          <span>📊 Barchart Importer</span>
          <button id="barchartClose" type="button" style="
            background: none;
            border: none;
            color: var(--cream-dim);
            cursor: pointer;
            font-size: 16px;
            padding: 0;
            width: 20px;
            height: 20px;
          ">✕</button>
        </div>

        <!-- Content -->
        <div style="padding: 12px 14px;">
          <!-- Symbol Input -->
          <div style="margin-bottom: 10px;">
            <label style="
              display: block;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              color: var(--cream-dim);
              margin-bottom: 4px;
              font-weight: 600;
            ">Symbol</label>
            <input id="barchartSymbol" type="text" placeholder="ZNU26" style="
              width: 100%;
              box-sizing: border-box;
              background: rgba(255,255,255,0.05);
              border: 0.5px solid rgba(255,255,255,0.1);
              border-radius: var(--radius-sm);
              color: var(--cream);
              padding: 8px 10px;
              font-size: 12px;
              font-family: ui-monospace, Menlo, monospace;
            ">
          </div>

          <!-- Expiration Dropdown -->
          <div style="margin-bottom: 10px;">
            <label style="
              display: block;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              color: var(--cream-dim);
              margin-bottom: 4px;
              font-weight: 600;
            ">Expiration</label>
            <select id="barchartExpiration" style="
              width: 100%;
              box-sizing: border-box;
              background: rgba(255,255,255,0.05);
              border: 0.5px solid rgba(255,255,255,0.1);
              border-radius: var(--radius-sm);
              color: var(--cream);
              padding: 8px 10px;
              font-size: 12px;
            ">
              <option value="">Loading expirations...</option>
            </select>
          </div>

          <!-- View Selector -->
          <div style="margin-bottom: 12px;">
            <label style="
              display: block;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              color: var(--cream-dim);
              margin-bottom: 4px;
              font-weight: 600;
            ">View</label>
            <select id="barchartView" style="
              width: 100%;
              box-sizing: border-box;
              background: rgba(255,255,255,0.05);
              border: 0.5px solid rgba(255,255,255,0.1);
              border-radius: var(--radius-sm);
              color: var(--cream);
              padding: 8px 10px;
              font-size: 12px;
            ">
              <option value="split">Split (Calls & Puts)</option>
              <option value="calls">Calls Only</option>
              <option value="puts">Puts Only</option>
            </select>
          </div>

          <!-- Buttons -->
          <div style="
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
          ">
            <button id="barchartDownloadBtn" type="button" style="
              flex: 1;
              background: rgba(111,163,255,0.2);
              border: 0.5px solid rgba(111,163,255,0.5);
              color: #6fa3ff;
              border-radius: var(--radius-sm);
              padding: 8px 10px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              transition: all 0.2s ease;
            ">
              ⬇ Download CSV
            </button>
            <button id="barchartImportBtn" type="button" style="
              flex: 1;
              background: rgba(95,208,138,0.2);
              border: 0.5px solid rgba(95,208,138,0.5);
              color: #5fd08a;
              border-radius: var(--radius-sm);
              padding: 8px 10px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              transition: all 0.2s ease;
            ">
              ⬆ Import
            </button>
          </div>

          <!-- Status Log -->
          <div id="barchartStatus" style="
            background: rgba(255,255,255,0.02);
            border: 0.5px solid rgba(255,255,255,0.05);
            border-radius: var(--radius-sm);
            padding: 8px;
            font-size: 10px;
            line-height: 1.4;
            color: var(--cream-dim);
            max-height: 100px;
            overflow-y: auto;
          ">
            Ready
          </div>
        </div>
      </div>

      <!-- Toggle Button (Fixed, always visible) -->
      <button id="barchartToggleBtn" type="button" title="Barchart Options Importer" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9994;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: rgba(111,163,255,0.2);
        border: 1px solid rgba(111,163,255,0.5);
        color: #6fa3ff;
        font-size: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      ">
        📊
      </button>
    `;

    // Insert into DOM
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
    document.body.appendChild(container.lastElementChild);

    // Wire up events
    wireUpEvents();
  }

  /* ========================================================================
     Event Handlers
     ======================================================================== */

  function wireUpEvents() {
    const panel = document.getElementById('barchartImportPanel');
    const toggleBtn = document.getElementById('barchartToggleBtn');
    const closeBtn = document.getElementById('barchartClose');
    const symbolInput = document.getElementById('barchartSymbol');
    const expirationSelect = document.getElementById('barchartExpiration');
    const viewSelect = document.getElementById('barchartView');
    const downloadBtn = document.getElementById('barchartDownloadBtn');
    const importBtn = document.getElementById('barchartImportBtn');
    const statusDiv = document.getElementById('barchartStatus');

    // Toggle panel visibility
    toggleBtn.addEventListener('click', () => {
      const isVisible = panel.style.display !== 'none';
      panel.style.display = isVisible ? 'none' : 'block';
      toggleBtn.style.display = isVisible ? 'flex' : 'none';
    });

    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
      toggleBtn.style.display = 'flex';
    });

    // Load expirations when symbol changes
    symbolInput.addEventListener('change', loadExpirations);
    symbolInput.addEventListener('blur', loadExpirations);

    // Download CSV
    downloadBtn.addEventListener('click', async () => {
      await handleDownload();
    });

    // Import to terminal
    importBtn.addEventListener('click', async () => {
      await handleImport();
    });

    // Status logging
    function log(message, type = 'info') {
      const timestamp = new Date().toLocaleTimeString();
      const color = type === 'error' ? '#e08a6a' : (type === 'success' ? '#5fd08a' : '#6fa3ff');
      statusDiv.innerHTML = `<span style="color: ${color}">[${timestamp}] ${message}</span>`;
      console.log(`[Barchart] ${message}`);
    }

    async function loadExpirations() {
      const symbol = symbolInput.value.trim().toUpperCase();
      if (!symbol) return;

      log('Loading expirations...');
      try {
        const expirations = await FETCHER.getAvailableExpirations(symbol);
        expirationSelect.innerHTML = expirations
          .map((exp, idx) => `<option value="${exp}">${exp}</option>`)
          .join('');
        log(`Loaded ${expirations.length} expirations`, 'success');
      } catch (error) {
        log(`Failed to load expirations: ${error.message}`, 'error');
      }
    }

    async function handleDownload() {
      const symbol = symbolInput.value.trim().toUpperCase();
      const expiration = expirationSelect.value;

      if (!symbol || !expiration) {
        log('Please select symbol and expiration', 'error');
        return;
      }

      downloadBtn.disabled = true;
      log(`Fetching ${symbol} ${expiration}...`);

      try {
        await FETCHER.downloadOptionsCSV(symbol, expiration);
        log(`Downloaded: ${symbol}_${expiration}.csv`, 'success');
      } catch (error) {
        log(`Download failed: ${error.message}`, 'error');
      } finally {
        downloadBtn.disabled = false;
      }
    }

    async function handleImport() {
      const symbol = symbolInput.value.trim().toUpperCase();
      const expiration = expirationSelect.value;

      if (!symbol || !expiration) {
        log('Please select symbol and expiration', 'error');
        return;
      }

      importBtn.disabled = true;
      log(`Importing ${symbol} ${expiration}...`);

      try {
        const csv = await FETCHER.fetchOptionsCSV(symbol, expiration);

        // Create blob and upload via csv-session-manager if available
        if (global.__csvSessionManager && global.__csvSessionManager.importCSV) {
          await global.__csvSessionManager.importCSV(csv, {
            type: 'option_data',
            symbol: symbol,
            expiration: expiration
          });
          log(`Imported to terminal: ${symbol}`, 'success');
        } else {
          // Fallback: trigger download
          log('CSV manager not available, downloading instead...', 'info');
          await FETCHER.downloadOptionsCSV(symbol, expiration);
        }
      } catch (error) {
        log(`Import failed: ${error.message}`, 'error');
      } finally {
        importBtn.disabled = false;
      }
    }

    // Initial load of expirations if symbol provided
    if (symbolInput.value.trim()) {
      loadExpirations();
    }
  }

  /* ========================================================================
     Initialize on DOM Ready
     ======================================================================== */

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createImportPanel);
    } else {
      createImportPanel();
    }
  }

  // Auto-init
  init();

  // Public API
  global.__barchartUI = {
    show: () => {
      const panel = document.getElementById('barchartImportPanel');
      if (panel) {
        panel.style.display = 'block';
        document.getElementById('barchartToggleBtn').style.display = 'none';
      }
    },
    hide: () => {
      const panel = document.getElementById('barchartImportPanel');
      if (panel) {
        panel.style.display = 'none';
        document.getElementById('barchartToggleBtn').style.display = 'flex';
      }
    }
  };

})( typeof window !== 'undefined' ? window : global);
