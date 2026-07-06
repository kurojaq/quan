/* ==========================================================================
   Cloud-backed workspace sync (Phase 2 — stateful workspaces).

   The terminal's modules (warehouse, compass, detector, …) already persist through
   an optional async KV called `window.storage`, falling back to localStorage when
   it's absent. This file *provides* that `window.storage`, backed by the user's
   cloud state (/api/state → Supabase + R2), so a workspace — uploaded chains,
   greeks warehouse, compass state, layout, theme, selected instrument/date —
   follows the user across devices.

   Design goals:
     • Zero changes to existing modules (they already speak window.storage).
     • Never slower/flakier than today: localStorage stays the synchronous source
       of truth (write-through cache). The cloud is an async mirror + boot-time
       seed. If the network/API fails, the app behaves exactly as before.
     • Last-write-wins per key, using timestamps, so multiple devices converge.

   Must load BEFORE the modules that use window.storage (i.e. before detector.js).
   ========================================================================== */
(function () {
  'use strict';

  var ENDPOINT = '/api/state';
  var TSKEY = '__cloudTs';                    // { key: lastWriteMs } shadow map
  var DENY = ['sb-', 'supabase', '__cloud'];  // never sync these (Supabase auth session, our own internals)
  var FLUSH_MS = 1500;
  var BATCH_LIMIT = 512 * 1024;               // ~chars per PUT body; oversize values go alone

  // capture native accessors up-front so our write-through never recurses
  var _origSet = localStorage.setItem.bind(localStorage);
  var _origRemove = localStorage.removeItem.bind(localStorage);

  function synced(k) {
    if (!k || k === TSKEY) return false;
    for (var i = 0; i < DENY.length; i++) if (k.indexOf(DENY[i]) === 0) return false;
    return true;
  }
  function tsMap() { try { return JSON.parse(localStorage.getItem(TSKEY) || '{}'); } catch (_) { return {}; } }
  function saveTs(m) { try { _origSet(TSKEY, JSON.stringify(m)); } catch (_) {} }
  function setTs(k, ms) { var m = tsMap(); m[k] = ms; saveTs(m); }
  function getTs(k) { return tsMap()[k] || 0; }
  function token() { return (window.__authToken && window.__authToken()) || null; }

  // ---- dirty queue + scheduler ------------------------------------------
  var dirty = {};
  var flushTimer = null;
  function markDirty(k) { if (synced(k)) { dirty[k] = true; schedule(); } }
  function schedule() { if (!flushTimer) flushTimer = setTimeout(function () { flushTimer = null; flush(); }, FLUSH_MS); }

  // ---- window.storage: the interface the modules already expect ----------
  // get(k) -> { value: <string|null> }   set(k, jsonString) -> true
  window.storage = {
    get: function (k) { return Promise.resolve({ value: localStorage.getItem(k) }); },
    set: function (k, j) {
      try { _origSet(k, j); } catch (_) { /* quota — cloud still gets it */ }
      setTs(k, Date.now()); markDirty(k);
      return Promise.resolve(true);
    }
  };

  // Also capture DIRECT localStorage writes (theme-toggle, session-calendar, …)
  // that bypass window.storage. Best-effort: if the override is refused, heavy
  // state still syncs through window.storage above.
  try {
    localStorage.setItem = function (k, v) {
      _origSet(k, v);
      if (synced(k)) { setTs(k, Date.now()); markDirty(k); }
    };
    localStorage.removeItem = function (k) {
      _origRemove(k);
      if (synced(k)) { var m = tsMap(); delete m[k]; saveTs(m); cloudDelete(k); }
    };
  } catch (_) {}

  // ---- push dirty keys to the cloud (chunked, best-effort) ---------------
  function flush() {
    if (window.__authEnabled === false) { dirty = {}; return; }   // auth off → local-only, stop looping
    var t = token();
    var keys = Object.keys(dirty).filter(synced);
    if (!keys.length) return;
    if (!t) { schedule(); return; }             // not signed in yet — hold the queue
    dirty = {};

    var batches = [], cur = [], curSize = 0;
    keys.forEach(function (k) {
      var v = localStorage.getItem(k); if (v == null) return;
      var when = getTs(k) || Date.now();
      // record the ts we're sending so the manifest doesn't see this key as
      // "cloud-newer" next boot and needlessly re-pull/reload it
      setTs(k, when);
      var item = { key: k, value: v, updated_at: when };
      if (v.length > BATCH_LIMIT) { batches.push([item]); return; }   // oversize alone
      if (curSize + v.length > BATCH_LIMIT && cur.length) { batches.push(cur); cur = []; curSize = 0; }
      cur.push(item); curSize += v.length;
    });
    if (cur.length) batches.push(cur);
    batches.forEach(function (items) { pushBatch(items, t); });
  }
  function pushBatch(items, t) {
    fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ items: items })
    }).catch(function () { items.forEach(function (it) { dirty[it.key] = true; }); schedule(); }); // requeue on failure
  }
  function cloudDelete(k) {
    var t = token(); if (!t) return;
    fetch(ENDPOINT + '?key=' + encodeURIComponent(k), {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + t }
    }).catch(function () {});
  }

  // ---- boot hydration: pull the user's state, seed localStorage ----------
  function maybeReload() {
    // reload once so already-initialised modules re-read the hydrated localStorage
    try { if (sessionStorage.getItem('__cloudReloaded')) return; sessionStorage.setItem('__cloudReloaded', '1'); } catch (_) {}
    setTimeout(function () { location.reload(); }, 300);
  }

  function hydrate() {
    var t = token(); if (!t) return;
    fetch(ENDPOINT, { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        if (!res || !res.keys) return;
        var cloud = res.keys, local = tsMap();
        var toPull = [];

        Object.keys(cloud).forEach(function (k) {
          if (!synced(k)) return;
          var newer = cloud[k] > (local[k] || 0);
          var missing = localStorage.getItem(k) == null;
          if (missing || newer) toPull.push(k);
        });
        // local keys strictly newer than cloud (or never uploaded) → push them up
        Object.keys(local).forEach(function (k) { if (synced(k) && local[k] > (cloud[k] || 0)) markDirty(k); });
        for (var i = 0; i < localStorage.length; i++) {
          var lk = localStorage.key(i);
          if (synced(lk) && !(lk in local)) markDirty(lk);   // pre-cloud data → upload
        }
        flush();

        if (!toPull.length) { window.__quanCloud.ready = true; return; }
        var changed = false;
        Promise.all(toPull.map(function (k) {
          return fetch(ENDPOINT + '?key=' + encodeURIComponent(k), { headers: { Authorization: 'Bearer ' + t } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
              if (d && d.value != null) {
                try { _origSet(k, d.value); } catch (_) {}   // write WITHOUT re-marking dirty
                setTs(k, cloud[k]); changed = true;
              }
            }).catch(function () {});
        })).then(function () {
          window.__quanCloud.ready = true;
          if (changed) maybeReload();
        });
      }).catch(function () {});
  }

  // public handle: manual sync + status (also useful for a future indicator)
  window.__quanCloud = {
    ready: false,
    sync: function () { flush(); },
    pull: function () { hydrate(); },
    pending: function () { return Object.keys(dirty).length; }
  };

  // ---- start: wait for a Supabase session, then hydrate ------------------
  var tries = 0;
  (function boot() {
    if (window.__authEnabled === false) return;      // auth off → pure local cache, still fine
    if (!token()) { if (++tries > 300) return; return void setTimeout(boot, 100); }
    hydrate();
  })();
})();
