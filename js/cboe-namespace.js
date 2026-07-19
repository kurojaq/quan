/* ==========================================================================
   cboe-namespace.js — storage isolation for the standalone CBOE terminal.

   MUST be the FIRST script on cboe.html (a blocking <script> in <head>, before
   the deferred bundle), so localStorage is namespaced BEFORE any other script
   reads or writes.

   cboe.html is a clone of the CME terminal (app.html) on the SAME origin, so
   without this it would share localStorage — warehouse, compass state, selected
   instrument, greeks cache — with the CME terminal and the two would corrupt each
   other. This REPLACES window.localStorage with a thin wrapper that prefixes every
   key with "cboe:", giving the clone its own private store with ZERO changes to the
   shared engine/JS. app.html never loads this file, so its storage is untouched.

   Why replace, not patch: a Storage object's property setter treats
   `localStorage.setItem = fn` as setItem('setItem', fn) — it stores a junk key
   instead of overriding the method. A plain wrapper object avoids that entirely.
   cloud-storage.js later wraps THIS wrapper's setItem/removeItem for cloud sync,
   which composes cleanly.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__cboeStorageNamespaced) return;   // window guard — never written to storage
  var P = "cboe:";
  var real;
  try { real = window.localStorage; if (!real) return; } catch (e) { return; }   // storage blocked → fail open

  var oGet = real.getItem.bind(real), oSet = real.setItem.bind(real),
      oRemove = real.removeItem.bind(real), oKey = real.key.bind(real);

  function ours() {
    var out = [];
    for (var i = 0, n = real.length; i < n; i++) { var k = oKey(i); if (k && k.indexOf(P) === 0) out.push(k); }
    return out;
  }
  var wrapper = {
    getItem: function (k) { return oGet(P + k); },
    setItem: function (k, v) { return oSet(P + k, v); },
    removeItem: function (k) { return oRemove(P + k); },
    key: function (i) { var o = ours(); return o[i] ? o[i].slice(P.length) : null; },
    clear: function () { ours().forEach(function (k) { oRemove(k); }); },
    get length() { return ours().length; }
  };

  try {
    Object.defineProperty(window, "localStorage", { configurable: true, get: function () { return wrapper; } });
    window.__cboeStorageNamespaced = true;
    // clean up junk keys any earlier method-override build may have left in the shared store
    ["getItem", "setItem", "removeItem", "key", "clear", "__cboeNamespaced"].forEach(function (k) {
      try { oRemove(k); } catch (_) {}
    });
  } catch (e) { /* window.localStorage not redefinable → fail open (shared) rather than crash */ }
})();
