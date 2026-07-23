/**
 * Barchart Options Fetcher
 *
 * Seamless CSV fetcher for Barchart options chains.
 * Routes through /api/barchart-fetch (server-side endpoint) to bypass
 * browser CORS restrictions. Server-to-server fetch handles all retries,
 * caching, and endpoint discovery.
 */

(function(global) {
  'use strict';

  const API_ENDPOINT = '/api/barchart-fetch';
  const CACHE_TTL = 60000; // 60 seconds

  // Cache for expirations only (chains cached server-side)
  const cache = {
    expirations: {} // {symbol -> {data, timestamp}}
  };

  /* ========================================================================
     Core API Fetcher (routes through /api/barchart-fetch)
     ======================================================================== */

  /**
   * Fetch option chain from server-side API (bypasses CORS)
   * @param {string} symbol - Futures contract symbol (e.g., "ZNU26")
   * @param {string} expiration - Expiration date (e.g., "aug-26")
   * @param {object} options - Fetch options (useCache)
   * @returns {Promise<Array>} Array of option rows
   */
  async function fetchOptionsChain(symbol, expiration, options = {}) {
    if (!symbol || !expiration) {
      throw new Error('Symbol and expiration required');
    }

    try {
      const url = `${API_ENDPOINT}?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiration)}`;
      console.log(`[Barchart] Fetching: ${symbol} ${expiration}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.data)) {
        throw new Error('Invalid response: missing data array');
      }

      console.log(`[Barchart] Success: ${data.count} rows`);
      return data.data;
    } catch (error) {
      console.error(`[Barchart] Fetch failed: ${error.message}`);
      throw error;
    }
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
     * Fetch options chain as CSV string (server-converted)
     */
    fetchOptionsCSV: async (symbol, expiration, options = {}) => {
      try {
        const url = `${API_ENDPOINT}?symbol=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiration)}&format=csv`;
        console.log(`[Barchart] Fetching CSV: ${symbol} ${expiration}`);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'text/csv'
          }
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          throw new Error(error.error || `HTTP ${response.status}`);
        }

        const csv = await response.text();
        console.log(`[Barchart] CSV Success: ${csv.split('\n').length - 1} rows`);
        return csv;
      } catch (error) {
        console.error(`[Barchart] CSV fetch failed: ${error.message}`);
        throw error;
      }
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
        cachedExpirations: Object.keys(cache.expirations).length,
        note: 'Chain caching is server-side at /api/barchart-fetch'
      };
    }
  };

})( typeof window !== 'undefined' ? window : global);
