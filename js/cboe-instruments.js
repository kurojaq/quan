/* ==========================================================================
   cboe-instruments.js — the CBOE clone starts with an EMPTY instrument universe.

   Loaded as a BLOCKING <script> in cboe.html's <head>, before the deferred
   bundle, so it sets window.__QUAN_INSTRUMENTS__ = [] before instrument-registry.js
   builds from it (see the hook there). app.html never loads this, so the CME
   futures universe is untouched.

   The dropdown is CBOE-scoped and empty until data is ingested: js/cboe-ingest.js
   derives a ticker from each uploaded dataset, registers it (QuanInstruments.register)
   and adds it to the dropdown, then selects it. So the terminal only ever holds the
   tickers the user has actually uploaded CBOE data for.
   ========================================================================== */
(function (g) {
  "use strict";
  g.__QUAN_INSTRUMENTS__ = [];
})(typeof window !== "undefined" ? window : this);
