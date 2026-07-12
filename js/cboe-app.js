/* ==========================================================================
   cboe-app.js — standalone CBOE app shell (cboe.html only).

   Runs BEFORE cboe-portfolio.js (document order) so the exchange is CBOE by the
   time the portfolio module boots and syncInstr() populates the ticker <select>.
   Wires the two views (Portfolio board / Heat Map) and boots + feeds the Deep
   Strike iframe when the Heat Map is opened.
   ========================================================================== */
(function () {
  "use strict";
  // Force CBOE at top level — this executes as soon as cboe-app.js runs (after
  // exchange.js, before cboe-portfolio.js), so the portfolio boot sees CBOE.
  if (window.QuanExchange) window.QuanExchange.set("CBOE");

  function boot() {
    if (window.__cboeBoot) window.__cboeBoot();               // mount the portfolio board (#cboeMount)

    var tabs = [].slice.call(document.querySelectorAll("[data-cbtab]"));
    var board = document.getElementById("cbBoard");
    var heat = document.getElementById("cbHeat");
    var heatBooted = false;

    function show(t) {
      tabs.forEach(function (x) { x.classList.toggle("on", x.dataset.cbtab === t); });
      if (board) board.style.display = t === "board" ? "flex" : "none";
      if (heat) heat.style.display = t === "heat" ? "flex" : "none";
      if (t === "heat") {
        if (window.__heatBoot) { window.__heatBoot(); heatBooted = true; }
        // give the iframe a beat to init (it also self-feeds on its 'quanReady')
        setTimeout(function () { if (window.__feedHeatmapCboe) window.__feedHeatmapCboe(); }, 400);
      }
    }
    tabs.forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.cbtab); }); });

    // if the active ticker changes while the Heat Map is open, re-feed it
    window.addEventListener("quan:cboe:changed", function () {
      if (heatBooted && heat && heat.style.display !== "none" && window.__feedHeatmapCboe) window.__feedHeatmapCboe();
    });
  }

  // Wait for DOMContentLoaded, which fires only AFTER every deferred script runs —
  // so cboe-portfolio.js has defined __cboeBoot by the time boot() calls it. (During
  // our own deferred execution readyState is already 'interactive', so an
  // !== 'loading' check would fire too early, before cboe-portfolio.js loads.)
  if (document.readyState === "complete") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
