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
        <!-- Header with Tabs -->
        <div style="
          padding: 0;
          border-bottom: 0.5px solid var(--glass-line);
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        ">
          <div style="flex: 1; display: flex;">
            <button id="barchartTabImport" class="barchart-tab" data-tab="import" style="
              flex: 1;
              background: transparent;
              border: none;
              border-bottom: 2px solid #6fa3ff;
              color: #6fa3ff;
              padding: 12px;
              cursor: pointer;
              font-size: 11px;
            ">Import</button>
            <button id="barchartTabAuth" class="barchart-tab" data-tab="auth" style="
              flex: 1;
              background: transparent;
              border: none;
              border-bottom: 2px solid transparent;
              color: var(--cream-dim);
              padding: 12px;
              cursor: pointer;
              font-size: 11px;
            ">Auth</button>
          </div>
          <button id="barchartClose" type="button" style="
            background: none;
            border: none;
            color: var(--cream-dim);
            cursor: pointer;
            font-size: 16px;
            padding: 12px 14px;
            width: auto;
            height: auto;
          ">✕</button>
        </div>

        <!-- Content (tabbed) -->
        <div id="barchartImportTab" class="barchart-content-tab" style="padding: 12px 14px; display: block;">
          <!-- Data Type Selector -->
          <div style="margin-bottom: 12px;">
            <label style="
              display: block;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              color: var(--cream-dim);
              margin-bottom: 4px;
              font-weight: 600;
            ">Data Type</label>
            <select id="barchartDataType" style="
              width: 100%;
              box-sizing: border-box;
              background: rgba(255,255,255,0.05);
              border: 0.5px solid rgba(255,255,255,0.1);
              border-radius: var(--radius-sm);
              color: var(--cream);
              padding: 8px 10px;
              font-size: 12px;
            ">
              <option value="prices">Option Prices</option>
              <option value="greeks">Volatility & Greeks</option>
            </select>
          </div>

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
            <input id="barchartSymbol" type="text" placeholder="ZNU26 (monthly) or BNIN26 (weekly)" style="
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
            <div id="barchartSymbolHint" style="
              display: none;
              font-size: 9px;
              color: var(--cream-dim);
              margin-top: 4px;
            ">Weeklies: root + week code + year (e.g., BNIN26 for T-Note week)</div>
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

          <!-- Type Selector (Monthlies vs Weeklies) -->
          <div style="margin-bottom: 12px;">
            <label style="
              display: block;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              color: var(--cream-dim);
              margin-bottom: 4px;
              font-weight: 600;
            ">Type</label>
            <select id="barchartType" style="
              width: 100%;
              box-sizing: border-box;
              background: rgba(255,255,255,0.05);
              border: 0.5px solid rgba(255,255,255,0.1);
              border-radius: var(--radius-sm);
              color: var(--cream);
              padding: 8px 10px;
              font-size: 12px;
            ">
              <option value="monthlies">Monthlies (Standard)</option>
              <option value="weeklies">Weeklies (Day-to-Day)</option>
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

        <!-- Auth Tab Content -->
        <div id="barchartAuthTab" class="barchart-content-tab" style="padding: 12px 14px; display: none;">
          <div style="margin-bottom: 12px;">
            <div style="color: var(--cream-dim); font-size: 10px; line-height: 1.5; margin-bottom: 8px;">
              To fetch options data, Barchart requires a valid session cookie.
            </div>
          </div>

          <!-- Cookie Instructions -->
          <div style="
            background: rgba(255,255,255,0.02);
            border: 0.5px solid rgba(255,255,255,0.05);
            border-radius: var(--radius-sm);
            padding: 8px;
            font-size: 9px;
            color: var(--cream-dim);
            margin-bottom: 12px;
            line-height: 1.6;
          ">
            <strong style="color: var(--cream);">Steps:</strong><br>
            1. Log into barchart.com<br>
            2. Open DevTools (F12)<br>
            3. Go to Application → Cookies<br>
            4. Install Cookie-Editor extension or export cookies as JSON<br>
            5. Paste JSON below and click "Seed"
          </div>

          <!-- Cookies Textarea -->
          <div style="margin-bottom: 12px;">
            <label style="
              display: block;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              color: var(--cream-dim);
              margin-bottom: 4px;
              font-weight: 600;
            ">Session Cookies (JSON)</label>
            <textarea id="barchartCookies" placeholder="[ { &quot;name&quot;:&quot;...&quot;, &quot;value&quot;:&quot;...&quot; }, ... ]" style="
              width: 100%;
              height: 80px;
              background: rgba(255,255,255,0.05);
              border: 0.5px solid rgba(255,255,255,0.1);
              outline: none;
              border-radius: var(--radius-sm);
              color: var(--cream);
              font-size: 10px;
              font-family: monospace;
              padding: 8px;
              box-sizing: border-box;
            "></textarea>
          </div>

          <!-- Seed Buttons -->
          <div style="
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
          ">
            <button id="barchartSeedBtn" type="button" style="
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
              ✓ Seed Cookies
            </button>
            <button id="barchartClearBtn" type="button" style="
              flex: 1;
              background: rgba(224,138,106,0.2);
              border: 0.5px solid rgba(224,138,106,0.5);
              color: #e08a6a;
              border-radius: var(--radius-sm);
              padding: 8px 10px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              transition: all 0.2s ease;
            ">
              ✕ Clear
            </button>
          </div>

          <!-- Status -->
          <div id="barchartAuthStatus" style="
            background: rgba(255,255,255,0.02);
            border: 0.5px solid rgba(255,255,255,0.05);
            border-radius: var(--radius-sm);
            padding: 8px;
            font-size: 10px;
            line-height: 1.4;
            color: var(--cream-dim);
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
    const importTab = document.getElementById('barchartImportTab');
    const authTab = document.getElementById('barchartAuthTab');
    const tabImportBtn = document.getElementById('barchartTabImport');
    const tabAuthBtn = document.getElementById('barchartTabAuth');
    const symbolInput = document.getElementById('barchartSymbol');
    const typeSelect = document.getElementById('barchartType');
    const dataTypeSelect = document.getElementById('barchartDataType');
    const expirationSelect = document.getElementById('barchartExpiration');
    const viewSelect = document.getElementById('barchartView');
    const downloadBtn = document.getElementById('barchartDownloadBtn');
    const importBtn = document.getElementById('barchartImportBtn');
    const statusDiv = document.getElementById('barchartStatus');
    const seedBtn = document.getElementById('barchartSeedBtn');
    const clearBtn = document.getElementById('barchartClearBtn');
    const cookiesTA = document.getElementById('barchartCookies');
    const authStatusDiv = document.getElementById('barchartAuthStatus');

    // Try to detect current instrument from terminal
    function detectCurrentInstrument() {
      // Check if there's a global instrument selector
      if (global.__quan && global.__quan.currentInstrument) {
        return global.__quan.currentInstrument.toUpperCase();
      }
      // Check for instrument in page state or URL
      try {
        const url = new URL(window.location);
        const pathMatch = url.pathname.match(/\/([A-Z]{2,6}\d{2,4})/);
        if (pathMatch) return pathMatch[1];
      } catch (_) {}
      return null;
    }

    // Auto-populate symbol if not set
    if (!symbolInput.value.trim()) {
      const detectedInstrument = detectCurrentInstrument();
      if (detectedInstrument) {
        symbolInput.value = detectedInstrument;
        log(`Auto-detected instrument: ${detectedInstrument}`, 'info');
        // Auto-load weeklies if that type is selected
        if (typeSelect.value === 'weeklies') {
          setTimeout(() => loadWeeklyCodes(detectedInstrument), 500);
        }
      }
    }

    // Tab switching
    const switchTab = (tab) => {
      if (tab === 'import') {
        importTab.style.display = 'block';
        authTab.style.display = 'none';
        tabImportBtn.style.borderBottomColor = '#6fa3ff';
        tabImportBtn.style.color = '#6fa3ff';
        tabAuthBtn.style.borderBottomColor = 'transparent';
        tabAuthBtn.style.color = 'var(--cream-dim)';
      } else {
        importTab.style.display = 'none';
        authTab.style.display = 'block';
        tabImportBtn.style.borderBottomColor = 'transparent';
        tabImportBtn.style.color = 'var(--cream-dim)';
        tabAuthBtn.style.borderBottomColor = '#6fa3ff';
        tabAuthBtn.style.color = '#6fa3ff';
      }
    };

    tabImportBtn.addEventListener('click', () => switchTab('import'));
    tabAuthBtn.addEventListener('click', () => switchTab('auth'));

    // Update labels and placeholders based on type selection
    typeSelect.addEventListener('change', () => {
      const isWeekly = typeSelect.value === 'weeklies';
      const hint = document.getElementById('barchartSymbolHint');
      const expLabel = expirationSelect.parentElement.querySelector('label');

      if (isWeekly) {
        hint.style.display = 'block';
        symbolInput.placeholder = 'ZNU26, ESZ26, etc. (then load weeklies)';
        if (expLabel) expLabel.textContent = 'Weekly Code';
        expirationSelect.innerHTML = '<option value="">Enter symbol above, then load weeklies</option>';
        log('Enter contract symbol to load available weekly codes', 'info');
      } else {
        hint.style.display = 'none';
        symbolInput.placeholder = 'ZNU26, ESZ26, etc.';
        if (expLabel) expLabel.textContent = 'Expiration';
        expirationSelect.innerHTML = '<option value="">Loading expirations...</option>';
        loadExpirations(); // Load monthly expirations
      }
    });

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

    // Load expirations when symbol or type changes
    symbolInput.addEventListener('change', loadExpirations);
    symbolInput.addEventListener('blur', loadExpirations);
    symbolInput.addEventListener('input', () => {
      // Auto-load weeklies as user types
      if (typeSelect.value === 'weeklies') {
        const symbol = symbolInput.value.trim().toUpperCase();
        if (symbol.length >= 2) {
          loadWeeklyCodes(symbol);
        }
      }
    });
    typeSelect.addEventListener('change', loadExpirations);

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

    function logAuth(message, type = 'info') {
      const timestamp = new Date().toLocaleTimeString();
      const color = type === 'error' ? '#e08a6a' : (type === 'success' ? '#5fd08a' : '#6fa3ff');
      authStatusDiv.innerHTML = `<span style="color: ${color}">[${timestamp}] ${message}</span>`;
      console.log(`[Barchart Auth] ${message}`);
    }

    // Seed cookies to KV
    seedBtn.addEventListener('click', async () => {
      const raw = (cookiesTA.value || '').trim();
      if (!raw) {
        logAuth('Please paste cookies JSON first', 'error');
        return;
      }

      logAuth('Seeding cookies...');
      seedBtn.disabled = true;
      try {
        const r = await fetch('/api/barchart-fetch?action=seed-cookies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies: raw })
        });
        const d = await r.json().catch(() => ({ error: 'Invalid response' }));
        if (r.ok) {
          logAuth(`Seeded ${d.count || '?'} cookies ✓`, 'success');
          cookiesTA.value = '';
        } else {
          logAuth(`Error: ${d.error || r.status}`, 'error');
        }
      } catch (e) {
        logAuth(`Network error: ${e.message}`, 'error');
      } finally {
        seedBtn.disabled = false;
      }
    });

    // Clear cookies
    clearBtn.addEventListener('click', async () => {
      logAuth('Clearing cookies...');
      clearBtn.disabled = true;
      try {
        const r = await fetch('/api/barchart-fetch?action=clear-cookies', {
          method: 'POST'
        });
        logAuth(r.ok ? 'Cleared ✓' : 'Error', r.ok ? 'success' : 'error');
      } catch (e) {
        logAuth(`Network error: ${e.message}`, 'error');
      } finally {
        clearBtn.disabled = false;
      }
    });

    async function loadExpirations() {
      const symbol = symbolInput.value.trim().toUpperCase();
      const type = typeSelect.value; // 'monthlies' or 'weeklies'
      if (!symbol) return;

      if (type === 'weeklies') {
        await loadWeeklyCodes(symbol);
        return;
      }

      log('Loading monthly expirations...');
      try {
        const expirations = await FETCHER.getAvailableExpirations(symbol, { type: 'monthlies' });
        if (expirations.length === 0) {
          expirationSelect.innerHTML = '<option value="">No expirations found</option>';
          log('No expirations found', 'error');
          return;
        }
        expirationSelect.innerHTML = expirations
          .map((exp, idx) => `<option value="${exp}" ${idx === 0 ? 'selected' : ''}>${exp}</option>`)
          .join('');
        log(`Loaded ${expirations.length} monthly expirations`, 'success');
      } catch (error) {
        log(`Failed to load expirations: ${error.message}`, 'error');
      }
    }

    async function loadWeeklyCodes(symbol) {
      if (!symbol) {
        log('Enter a symbol first', 'error');
        return;
      }

      log('Loading weekly codes for ' + symbol + '...');
      expirationSelect.innerHTML = '<option value="">Loading...</option>';

      try {
        const response = await fetch(`/api/barchart-fetch?symbol=${symbol}&action=get-weekly-codes`);
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          throw new Error(err.error || 'Failed to fetch weekly codes');
        }

        const result = await response.json();
        if (!result.codes || result.codes.length === 0) {
          expirationSelect.innerHTML = '<option value="">No weekly options found</option>';
          log('No weekly options found for ' + symbol, 'error');
          return;
        }

        expirationSelect.innerHTML = result.codes
          .map((item, idx) => `<option value="${item.code}" ${idx === 0 ? 'selected' : ''}>${item.label}</option>`)
          .join('');
        log(`Loaded ${result.codes.length} weekly codes`, 'success');
      } catch (error) {
        expirationSelect.innerHTML = '<option value="">Error loading codes</option>';
        log(`Failed to load weekly codes: ${error.message}`, 'error');
      }
    }

    async function handleDownload() {
      const symbol = symbolInput.value.trim().toUpperCase();
      const expiration = expirationSelect.value;
      const type = typeSelect.value;
      const dataType = dataTypeSelect.value;

      if (!symbol || (type === 'monthlies' && !expiration)) {
        log('Please select symbol and expiration', 'error');
        return;
      }

      downloadBtn.disabled = true;
      log(`Fetching ${symbol} ${expiration || type === 'weeklies' ? '' : 'N/A'} (${type}, ${dataType})...`);

      try {
        const csv = await FETCHER.fetchOptionsCSV(symbol, expiration, { type, dataType });
        const filename = expiration ? `${symbol}_${expiration}_${dataType}.csv` : `${symbol}_${dataType}.csv`;

        // Try to auto-import to terminal first
        if (global.__csvSessionManager && global.__csvSessionManager.importCSV) {
          try {
            await global.__csvSessionManager.importCSV(csv, {
              type: 'option_data',
              symbol: symbol,
              expiration: expiration,
              optionType: type,
              dataType: dataType,
              filename: filename
            });
            log(`Imported to terminal: ${filename}`, 'success');
            return;
          } catch (importErr) {
            console.warn('[Barchart] Auto-import failed, falling back to download:', importErr);
            log('Auto-import unavailable, downloading instead...', 'info');
          }
        }

        // Fallback: browser download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        log(`Downloaded: ${filename}`, 'success');
      } catch (error) {
        log(`Failed: ${error.message}`, 'error');
      } finally {
        downloadBtn.disabled = false;
      }
    }

    async function handleImport() {
      const symbol = symbolInput.value.trim().toUpperCase();
      const expiration = expirationSelect.value;
      const type = typeSelect.value;
      const dataType = dataTypeSelect.value;

      if (!symbol || !expiration) {
        log('Please select symbol and expiration', 'error');
        return;
      }

      importBtn.disabled = true;
      log(`Importing ${symbol} ${expiration} (${type}, ${dataType})...`);

      try {
        const csv = await FETCHER.fetchOptionsCSV(symbol, expiration, { type, dataType });

        // Create blob and upload via csv-session-manager if available
        if (global.__csvSessionManager && global.__csvSessionManager.importCSV) {
          await global.__csvSessionManager.importCSV(csv, {
            type: 'option_data',
            symbol: symbol,
            expiration: expiration,
            optionType: type,
            dataType: dataType
          });
          log(`Imported to terminal: ${symbol}`, 'success');
        } else {
          // Fallback: trigger download
          log('CSV manager not available, downloading instead...', 'info');
          await FETCHER.downloadOptionsCSV(symbol, expiration, { type, dataType });
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
