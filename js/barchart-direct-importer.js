/**
 * Barchart Direct Importer
 *
 * Direct API calls to Barchart (no browser rendering).
 * UI matches Barchart's layout: GO TO → Options Type → Week → Moneyness → View
 */

(function(global) {
  'use strict';

  const API_ENDPOINT = '/api/barchart-api';
  const CACHE_TTL = 60000;

  const cache = {
    weeklyCodes: {}
  };

  // Weekly codes for common contracts (hardcoded fallback)
  const WEEKLY_CODES_BY_CONTRACT = {
    'ZN': ['BN1Q26', 'BG6Q26', 'BNDN26', 'BN0N26', 'BNIN26'], // T-Note: Fri, Mon, Tue, Wed, Thu
    'ES': ['ES1Q26', 'ES6Q26', 'ESDN26', 'ES0N26', 'ESIN26'],  // E-mini S&P: Similar pattern
    'NQ': ['NQ1Q26', 'NQ6Q26', 'NQDN26', 'NQ0N26', 'NQIN26'],  // Nasdaq
    'GC': ['GC1Q26', 'GC6Q26', 'GCDN26', 'GC0N26', 'GCIN26'],  // Gold
    'CL': ['CL1Q26', 'CL6Q26', 'CLDN26', 'CL0N26', 'CLIN26']   // Crude Oil
  };

  function createImportPanel() {
    const html = `
      <div id="barchartDirectPanel" class="barchart-panel" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9995;
        width: 380px;
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
          padding: 0;
          border-bottom: 0.5px solid var(--glass-line);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        ">
          <div style="flex: 1; padding: 12px 14px;">📊 Barchart Importer</div>
          <button id="barchartDirectClose" type="button" style="
            background: none;
            border: none;
            color: var(--cream-dim);
            cursor: pointer;
            padding: 12px 14px;
          ">✕</button>
        </div>

        <!-- Controls -->
        <div style="padding: 14px; display: flex; flex-direction: column; gap: 10px;">

          <!-- Row 1: GO TO + Symbol -->
          <div style="display: flex; gap: 8px;">
            <div style="flex: 1;">
              <label style="display: block; font-size: 10px; color: var(--cream-dim); margin-bottom: 4px; font-weight: 600; text-transform: uppercase;">GO TO</label>
              <select id="barchartGoTo" style="
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
            <div style="flex: 1;">
              <label style="display: block; font-size: 10px; color: var(--cream-dim); margin-bottom: 4px; font-weight: 600; text-transform: uppercase;">SYMBOL</label>
              <input id="barchartSymbol" type="text" placeholder="ZNU26, ESZ26" style="
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
          </div>

          <!-- Row 2: Options Type + Week -->
          <div style="display: flex; gap: 8px;">
            <div style="flex: 1;">
              <label style="display: block; font-size: 10px; color: var(--cream-dim); margin-bottom: 4px; font-weight: 600; text-transform: uppercase;">OPTIONS TYPE</label>
              <select id="barchartOptionsType" style="
                width: 100%;
                box-sizing: border-box;
                background: rgba(255,255,255,0.05);
                border: 0.5px solid rgba(255,255,255,0.1);
                border-radius: var(--radius-sm);
                color: var(--cream);
                padding: 8px 10px;
                font-size: 12px;
              ">
                <option value="monthly">Monthly Options</option>
                <option value="weekly">Weekly Options</option>
              </select>
            </div>
            <div style="flex: 1;">
              <label style="display: block; font-size: 10px; color: var(--cream-dim); margin-bottom: 4px; font-weight: 600; text-transform: uppercase;">WEEK</label>
              <select id="barchartWeek" style="
                width: 100%;
                box-sizing: border-box;
                background: rgba(255,255,255,0.05);
                border: 0.5px solid rgba(255,255,255,0.1);
                border-radius: var(--radius-sm);
                color: var(--cream);
                padding: 8px 10px;
                font-size: 12px;
              ">
                <option value="">Select week...</option>
              </select>
            </div>
          </div>

          <!-- Row 3: Moneyness + View -->
          <div style="display: flex; gap: 8px;">
            <div style="flex: 1;">
              <label style="display: block; font-size: 10px; color: var(--cream-dim); margin-bottom: 4px; font-weight: 600; text-transform: uppercase;">SHOW ALL</label>
              <select id="barchartMoneyness" style="
                width: 100%;
                box-sizing: border-box;
                background: rgba(255,255,255,0.05);
                border: 0.5px solid rgba(255,255,255,0.1);
                border-radius: var(--radius-sm);
                color: var(--cream);
                padding: 8px 10px;
                font-size: 12px;
              ">
                <option value="allRows" selected>All Strikes</option>
                <option value="5">5 Strikes +/-</option>
                <option value="10">Near the Money</option>
                <option value="20">20 Strikes +/-</option>
                <option value="50">50 Strikes +/-</option>
              </select>
            </div>
            <div style="flex: 1;">
              <label style="display: block; font-size: 10px; color: var(--cream-dim); margin-bottom: 4px; font-weight: 600; text-transform: uppercase;">VIEW</label>
              <select id="barchartViewType" style="
                width: 100%;
                box-sizing: border-box;
                background: rgba(255,255,255,0.05);
                border: 0.5px solid rgba(255,255,255,0.1);
                border-radius: var(--radius-sm);
                color: var(--cream);
                padding: 8px 10px;
                font-size: 12px;
              ">
                <option value="split">Side-by-Side</option>
                <option value="stacked">Stacked</option>
              </select>
            </div>
          </div>

          <!-- Status -->
          <div id="barchartStatus" style="
            background: rgba(255,255,255,0.02);
            border: 0.5px solid rgba(255,255,255,0.05);
            border-radius: var(--radius-sm);
            padding: 8px;
            font-size: 10px;
            line-height: 1.4;
            color: var(--cream-dim);
            min-height: 30px;
          ">Ready</div>

          <!-- Buttons -->
          <div style="display: flex; gap: 8px;">
            <button id="barchartDownloadDirect" type="button" style="
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
            <button id="barchartImportDirect" type="button" style="
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
        </div>
      </div>

      <!-- Toggle Button -->
      <button id="barchartDirectToggle" type="button" title="Barchart Importer (Direct API)" style="
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
      ">📊</button>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
    document.body.appendChild(container.lastElementChild);

    wireUpEvents();
  }

  function wireUpEvents() {
    const panel = document.getElementById('barchartDirectPanel');
    const toggleBtn = document.getElementById('barchartDirectToggle');
    const closeBtn = document.getElementById('barchartDirectClose');
    const symbolInput = document.getElementById('barchartSymbol');
    const goToSelect = document.getElementById('barchartGoTo');
    const optionsTypeSelect = document.getElementById('barchartOptionsType');
    const weekSelect = document.getElementById('barchartWeek');
    const moneynessSelect = document.getElementById('barchartMoneyness');
    const viewSelect = document.getElementById('barchartViewType');
    const statusDiv = document.getElementById('barchartStatus');
    const downloadBtn = document.getElementById('barchartDownloadDirect');
    const importBtn = document.getElementById('barchartImportDirect');

    function log(message, type = 'info') {
      const timestamp = new Date().toLocaleTimeString();
      const color = type === 'error' ? '#e08a6a' : (type === 'success' ? '#5fd08a' : '#6fa3ff');
      statusDiv.innerHTML = `<span style="color: ${color}">[${timestamp}] ${message}</span>`;
      console.log(`[Barchart Direct] ${message}`);
    }

    // Toggle panel
    toggleBtn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      toggleBtn.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    });

    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
      toggleBtn.style.display = 'flex';
    });

    // Update week dropdown when options type changes
    optionsTypeSelect.addEventListener('change', () => {
      const isWeekly = optionsTypeSelect.value === 'weekly';
      weekSelect.innerHTML = '<option value="">Loading...</option>';

      if (isWeekly) {
        loadWeeklyOptions();
      } else {
        loadMonthlyOptions();
      }
    });

    function loadWeeklyOptions() {
      const symbol = symbolInput.value.trim().toUpperCase();
      if (!symbol) {
        weekSelect.innerHTML = '<option value="">Enter symbol first</option>';
        return;
      }

      log('Loading weekly options...');
      const root = symbol.replace(/\d+$/, ''); // Extract root (ZN from ZNU26)
      const codes = WEEKLY_CODES_BY_CONTRACT[root] || [];

      if (codes.length === 0) {
        weekSelect.innerHTML = '<option value="">No weeklies found for ' + root + '</option>';
        log('No weekly codes found for ' + root, 'error');
        return;
      }

      weekSelect.innerHTML = codes
        .map((code, i) => `<option value="${code}" ${i === 0 ? 'selected' : ''}>${code}</option>`)
        .join('');
      log(`Loaded ${codes.length} weekly options`, 'success');
    }

    function loadMonthlyOptions() {
      const symbol = symbolInput.value.trim().toUpperCase();
      if (!symbol) {
        weekSelect.innerHTML = '<option value="">Enter symbol first</option>';
        return;
      }

      log('Monthly options: select any expiration month');
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const year = new Date().getFullYear();
      const options = [];

      for (let y = 0; y < 2; y++) {
        for (const m of months) {
          options.push(`${m}-${String(year + y).slice(-2)}`);
        }
      }

      weekSelect.innerHTML = options
        .map((opt, i) => `<option value="${opt}" ${i === 0 ? 'selected' : ''}>${opt}</option>`)
        .join('');
      log(`Loaded ${options.length} monthly options`, 'success');
    }

    // Auto-load weeklies when symbol changes
    symbolInput.addEventListener('input', () => {
      if (optionsTypeSelect.value === 'weekly' && symbolInput.value.trim().length >= 2) {
        loadWeeklyOptions();
      }
    });

    // Download handler
    downloadBtn.addEventListener('click', async () => {
      const symbol = symbolInput.value.trim().toUpperCase();
      const week = weekSelect.value;
      const dataType = goToSelect.value;

      if (!symbol || !week) {
        log('Select symbol and week/month', 'error');
        return;
      }

      downloadBtn.disabled = true;
      log(`Fetching ${symbol} ${week} (${dataType})...`);

      try {
        const url = `${API_ENDPOINT}?symbol=${symbol}&dataType=${dataType}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const csv = await response.text();
        if (!csv || csv.trim().length === 0) {
          throw new Error('Empty response');
        }

        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${symbol}_${week}_${dataType}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        log(`Downloaded: ${link.download}`, 'success');
      } catch (error) {
        log(`Failed: ${error.message}`, 'error');
      } finally {
        downloadBtn.disabled = false;
      }
    });

    // Import handler
    importBtn.addEventListener('click', async () => {
      const symbol = symbolInput.value.trim().toUpperCase();
      const week = weekSelect.value;
      const dataType = goToSelect.value;

      if (!symbol || !week) {
        log('Select symbol and week/month', 'error');
        return;
      }

      importBtn.disabled = true;
      log(`Importing ${symbol} ${week}...`);

      try {
        const url = `${API_ENDPOINT}?symbol=${symbol}&dataType=${dataType}`;
        const response = await fetch(url);
        const csv = await response.text();

        if (global.__csvSessionManager && global.__csvSessionManager.importCSV) {
          await global.__csvSessionManager.importCSV(csv, {
            type: 'option_data',
            symbol: symbol,
            week: week,
            dataType: dataType
          });
          log(`Imported to terminal: ${symbol}`, 'success');
        } else {
          log('CSV manager not available', 'error');
        }
      } catch (error) {
        log(`Import failed: ${error.message}`, 'error');
      } finally {
        importBtn.disabled = false;
      }
    });

    // Initial load
    loadMonthlyOptions();
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createImportPanel);
  } else {
    createImportPanel();
  }
})( typeof window !== 'undefined' ? window : global);
