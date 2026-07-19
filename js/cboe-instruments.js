/* ==========================================================================
   cboe-instruments.js — the CBOE clone's instrument universe.

   Loaded as a BLOCKING <script> in cboe.html's <head>, before the deferred
   bundle, so it sets window.__QUAN_INSTRUMENTS__ before instrument-registry.js
   builds the registry from it (see the hook in instrument-registry.js). app.html
   never loads this, so the CME futures universe is untouched.

   Format per row: [group, symbol, contractMultiplier, family, extraBarchartRoots].
   Options are 100 shares/contract (indices are $100 × index), family INDEX so the
   decimal-strike normalization path is used (no fractional/rates handling). The
   Barchart filename root equals the lowercase symbol (aapl-…, ndx-…), so no extra
   roots are needed — parseContract/fromRoot resolve them from the symbol.
   ========================================================================== */
(function (g) {
  "use strict";
  g.__QUAN_INSTRUMENTS__ = [
    // ── Cash indices (CBOE quotedata → reconstructed energy premium) ──
    ["Index", "NDX", 100, "INDEX", []],
    ["Index", "SPX", 100, "INDEX", []],
    ["Index", "RUT", 100, "INDEX", []],
    ["Index", "VIX", 100, "INDEX", []],
    ["Index", "XSP", 100, "INDEX", []],
    // ── Mega-cap equities (Barchart chain+greeks → observed premium) ──
    ["Mega Cap", "AAPL", 100, "INDEX", []],
    ["Mega Cap", "MSFT", 100, "INDEX", []],
    ["Mega Cap", "NVDA", 100, "INDEX", []],
    ["Mega Cap", "AMZN", 100, "INDEX", []],
    ["Mega Cap", "GOOGL", 100, "INDEX", []],
    ["Mega Cap", "META", 100, "INDEX", []],
    ["Mega Cap", "TSLA", 100, "INDEX", []],
    ["Mega Cap", "AVGO", 100, "INDEX", []],
    // ── Semis / high-options-volume names ──
    ["Semis", "AMD", 100, "INDEX", []],
    ["Semis", "MU", 100, "INDEX", []],
    ["Semis", "SMCI", 100, "INDEX", []],
    ["Semis", "INTC", 100, "INDEX", []],
    ["Semis", "TSM", 100, "INDEX", []],
    ["Semis", "ARM", 100, "INDEX", []],
    // ── Other liquid single-names ──
    ["Equities", "NFLX", 100, "INDEX", []],
    ["Equities", "CRM", 100, "INDEX", []],
    ["Equities", "COIN", 100, "INDEX", []],
    ["Equities", "PLTR", 100, "INDEX", []],
    ["Equities", "BABA", 100, "INDEX", []],
    ["Equities", "JPM", 100, "INDEX", []],
    ["Equities", "NKE", 100, "INDEX", []],
    ["Equities", "DIS", 100, "INDEX", []],
    ["Equities", "BA", 100, "INDEX", []],
    // ── Popular ETFs ──
    ["ETFs", "SPY", 100, "INDEX", []],
    ["ETFs", "QQQ", 100, "INDEX", []],
    ["ETFs", "IWM", 100, "INDEX", []],
    ["ETFs", "GLD", 100, "INDEX", []],
    ["ETFs", "TLT", 100, "INDEX", []],
    ["ETFs", "HYG", 100, "INDEX", []]
  ];
})(typeof window !== "undefined" ? window : this);
