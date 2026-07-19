/* ==========================================================================
   cboe-ingest.js — dynamic, upload-driven instrument dropdown for the CBOE clone.

   The CBOE terminal starts CBOE-scoped and EMPTY (cboe-instruments.js). This file
   makes the dropdown build itself from what the user ingests: on each upload it
   derives the ticker from the filename, registers it (QuanInstruments.register),
   adds it to the #instA dropdown, and selects it — so the chain/greeks land under
   the right ticker. Tickers persist (namespaced localStorage) across sessions.

   The upload listener is registered on `document` in the CAPTURE phase, so it runs
   BEFORE the warehouse's own change-handler on the file input (at the target, both
   fire in registration order and the warehouse registered first — capturing on an
   ancestor guarantees we set the ticker first).
   ========================================================================== */
(function () {
  "use strict";
  var KEY = "cboeUploadedTickers";
  var FILE_IDS = ["gFile", "fileA", "skFile", "skGFile", "pFile", "pGFile", "gGreeksFile"];

  function persisted() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function persist(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }

  // Ticker from a CBOE/Barchart filename:
  //   aapl-options-exp-…      → AAPL      ndx_quotedata.csv → NDX
  //   aapl-volatility-greeks… → AAPL      brk.b-options-…   → BRK.B
  function tickerFromName(name) {
    var b = String(name || "").split(/[\/\\]/).pop().replace(/\.csv$/i, "");
    var m = /^([a-z]{1,6}(?:\.[a-z])?)(?=[-_. ]|$)/i.exec(b);
    return m ? m[1].toUpperCase() : null;
  }

  function addOption(sym) {
    var sel = document.getElementById("instA"); if (!sel) return;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === sym) return;
    var o = document.createElement("option"); o.value = sym; o.textContent = sym; sel.appendChild(o);
  }
  function registerTicker(sym) {
    if (!sym) return;
    if (window.QuanInstruments && window.QuanInstruments.register) window.QuanInstruments.register(sym, "Uploaded", 100, "INDEX");
    addOption(sym);
    var list = persisted(); if (list.indexOf(sym) < 0) { list.push(sym); persist(list); }
  }
  function selectTicker(sym) {
    var sel = document.getElementById("instA"); if (!sel || sel.value === sym) return;
    sel.value = sym; sel.dispatchEvent(new Event("change"));   // sync → curInst updates before the upload is read
  }

  function onUpload(e) {
    var t = e.target;
    if (!t || t.tagName !== "INPUT" || t.type !== "file" || FILE_IDS.indexOf(t.id) < 0) return;
    var f = t.files && t.files[0]; if (!f) return;
    var sym = tickerFromName(f.name);
    if (sym) { registerTicker(sym); selectTicker(sym); }
  }

  function boot() {
    persisted().forEach(registerTicker);                 // restore prior-session tickers
    document.addEventListener("change", onUpload, true); // capture: before the warehouse's target handler
    window.__cboeRegisterTicker = registerTicker;        // programmatic hook (used by the quotedata proxy)
  }
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
