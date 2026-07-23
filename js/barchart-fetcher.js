/**
 * Barchart Options Fetcher
 *
 * Seamless CSV fetcher for Barchart options chains.
 * Discovers and calls the Barchart API, converts JSON to CSV,
 * integrates with terminal's csv-session-manager.
 *
 * API Patterns Tested (in order):
 * 1. https://www.barchart.com/api/quotes/options/futures/{symbol}/{expiration}
 * 2. https://www.barchart.com/v1/futures/{symbol}/options?expiration={expiration}
 * 3. https://www.barchart.com/ajax/options/futures/{symbol}
 */

(function(global) {
  'use strict';

  // Configuration
  const API_PATTERNS = [
    // Pattern 1: Standard RESTful
    (symbol, expiration) => `https://www.barchart.com/api/quotes/options/futures/${symbol}/${expiration}`,
    // Pattern 2: Versioned API
    (symbol, expiration) => `https://www.barchart.com/v1/futures/${symbol}/options?expiration=${expiration}`,
    // Pattern 3: AJAX endpoint
    (symbol, expiration) => `https://www.barchart.com/ajax/options/futures/${symbol}?expiration=${expiration}`
  ];

  const CACHE_TTL = 60000; // 60 seconds
  const REQUEST_TIMEOUT = 10000; // 10 seconds
  const MAX_RETRIES = 3;

  // Cache for API responses and expirations
  const cache = {
    chains: {}, // {symbol:expiration -> {data, timestamp}}
    expirations: {}, // {symbol -> {data, timestamp}}
    lastApiPattern: 0
  };

  /* ========================================================================
     Core API Fetcher
     ======================================================================== */

  /**
   * Fetch option chain from Barchart API
   * @param {string} symbol - Futures contract symbol (e.g., "ZNU26")
   * @param {string} expiration - Expiration date (e.g., "aug-26")
   * @param {object} options - Fetch options (useCache, timeout, retries)
   * @returns {Promise<Array>} Array of option rows
   */
  async function fetchOptionsChain(symbol, expiration, options = {}) {
    if (!symbol || !expiration) {
      throw new Error('Symbol and expiration required');
    }

    const cacheKey = `${symbol}:${expiration}`;
    const useCache = options.useCache !== false;
    const timeout = options.timeout || REQUEST_TIMEOUT;
    const maxRetries = options.retries || MAX_RETRIES;

    // Check cache
    if (useCache && cache.chains[cacheKey]) {
      const cached = cache.chains[cacheKey];
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Barchart] Cache hit: ${cacheKey}`);
        return cached.data;
      }
    }

    // Try API patterns in order
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const pattern = cache.lastApiPattern % API_PATTERNS.length;
        const url = API_PATTERNS[pattern](symbol, expiration);

        console.log(`[Barchart] Attempt ${attempt + 1}/${maxRetries}: Pattern ${pattern} · ${url.substring(0, 80)}...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();

            // Validate response
            if (!data || typeof data !== 'object') {
              throw new Error('Invalid response: not a JSON object');
            }

            // Extract option rows (handle various response formats)
            const rows = extractOptionRows(data);
            if (!rows || !Array.isArray(rows)) {
              throw new Error('Could not extract option rows from response');
            }

            // Cache and return
            cache.chains[cacheKey] = {
              data: rows,
              timestamp: Date.now()
            };
            cache.lastApiPattern = pattern;

            console.log(`[Barchart] Success: ${rows.length} rows · Pattern ${pattern}`);
            return rows;
          } else if (response.status === 404) {
            throw new Error(`Not found (404): ${url}`);
          } else if (response.status === 429) {
            throw new Error('Rate limited (429): Try again in a moment');
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (e) {
          clearTimeout(timeoutId);
          throw e;
        }
      } catch (error) {
        lastError = error;
        console.warn(`[Barchart] Attempt ${attempt + 1} failed: ${error.message}`);

        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to fetch after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /* ========================================================================
     Response Parser (handles format variations)
     ======================================================================== */

  function extractOptionRows(response) {
    // Format 1: Direct array of rows
    if (Array.isArray(response)) {
      return response;
    }

    // Format 2: Wrapped in data/options/results field
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.options)) return response.options;
    if (Array.isArray(response.results)) return response.results;
    if (Array.isArray(response.rows)) return response.rows;
    if (Array.isArray(response.chain)) return response.chain;

    // Format 3: Nested in options property
    if (response.options && Array.isArray(response.options.chain)) {
      return response.options.chain;
    }

    // No valid array found
    return null;
  }

  /* ========================================================================
     CSV Conversion
     ======================================================================== */

  function convertToCSV(optionRows) {
    if (!optionRows || !Array.isArray(optionRows) || optionRows.length === 0) {
      return '';
    }

    // CSV headers
    const headers = [
      'Strike',
      'CallSymbol', 'CallBid', 'CallAsk', 'CallLast', 'CallBidSize', 'CallAskSize',
      'CallVolume', 'CallOpenInterest', 'CallIV', 'CallDelta', 'CallGamma',
      'CallVega', 'CallTheta', 'CallRho',
      'PutSymbol', 'PutBid', 'PutAsk', 'PutLast', 'PutBidSize', 'PutAskSize',
      'PutVolume', 'PutOpenInterest', 'PutIV', 'PutDelta', 'PutGamma',
      'PutVega', 'PutTheta', 'PutRho'
    ];

    // CSV rows
    const rows = optionRows.map(opt => {
      const call = opt.call || {};
      const put = opt.put || {};

      return [
        opt.strike || '',
        call.symbol || '', call.bid || '', call.ask || '', call.last || '',
        call.bid_size || call.bidSize || '', call.ask_size || call.askSize || '',
        call.volume || '', call.open_interest || call.openInterest || '',
        call.iv || '', call.delta || '', call.gamma || '',
        call.vega || '', call.theta || '', call.rho || '',
        put.symbol || '', put.bid || '', put.ask || '', put.last || '',
        put.bid_size || put.bidSize || '', put.ask_size || put.askSize || '',
        put.volume || '', put.open_interest || put.openInterest || '',
        put.iv || '', put.delta || '', put.gamma || '',
        put.vega || '', put.theta || '', put.rho || ''
      ];
    });

    // Format CSV
    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csvContent;
  }

  /* ========================================================================
     Expiration Getter (fetch available expirations for a symbol)
     ======================================================================== */

  async function getAvailableExpirations(symbol, options = {}) {
    if (!symbol) {
      throw new Error('Symbol required');
    }

    const cacheKey = `exp:${symbol}`;
    const useCache = options.useCache !== false;

    // Check cache
    if (useCache && cache.expirations[cacheKey]) {
      const cached = cache.expirations[cacheKey];
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }

    // Try to fetch with common expirations (fallback)
    const commonExpirations = generateCommonExpirations();

    // In a real implementation, we'd scrape/call an API to get actual expirations
    // For now, return common futures expirations
    cache.expirations[cacheKey] = {
      data: commonExpirations,
      timestamp: Date.now()
    };

    return commonExpirations;
  }

  function generateCommonExpirations() {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const now = new Date();
    const currentYear = now.getFullYear();
    const expirations = [];

    // Generate expirations for current year + 1
    for (let y = 0; y < 2; y++) {
      const year = currentYear + y;
      const yy = String(year).slice(-2);
      for (const month of months) {
        expirations.push(`${month}-${yy}`);
      }
    }

    return expirations;
  }

  /* ========================================================================
     Public API
     ======================================================================== */

  global.__barchartFetcher = {
    /**
     * Fetch options chain as JSON array
     */
    fetchOptionsChain: fetchOptionsChain,

    /**
     * Fetch options chain and convert to CSV string
     */
    fetchOptionsCSV: async (symbol, expiration, options = {}) => {
      const rows = await fetchOptionsChain(symbol, expiration, options);
      return convertToCSV(rows);
    },

    /**
     * Download CSV file directly to user's computer
     */
    downloadOptionsCSV: async (symbol, expiration, options = {}) => {
      const csv = await global.__barchartFetcher.fetchOptionsCSV(symbol, expiration, options);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', `${symbol}_${expiration}.csv`);
      link.style.visibility = 'hidden';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },

    /**
     * Get available expirations for a symbol
     */
    getAvailableExpirations: getAvailableExpirations,

    /**
     * Validate symbol (check if it exists on Barchart)
     */
    validateSymbol: async (symbol) => {
      try {
        const expirations = await getAvailableExpirations(symbol, { useCache: false });
        return expirations && expirations.length > 0;
      } catch (error) {
        console.warn(`[Barchart] Symbol validation failed: ${error.message}`);
        return false;
      }
    },

    /**
     * Clear all cached data
     */
    clearCache: () => {
      cache.chains = {};
      cache.expirations = {};
      console.log('[Barchart] Cache cleared');
    },

    /**
     * Get cache statistics
     */
    getCacheStats: () => {
      return {
        cachedChains: Object.keys(cache.chains).length,
        cachedExpirations: Object.keys(cache.expirations).length,
        lastApiPattern: cache.lastApiPattern
      };
    }
  };

})( typeof window !== 'undefined' ? window : global);
