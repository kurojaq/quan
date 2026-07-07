/* ==========================================================================
   Brief history / archive (Phase 3).

   Silently archives each computed Report to durable storage (/api/archive) so the
   operator builds a day-by-day record of the field, and adds a "History" control
   to browse and re-open past briefs read-only. Self-contained: it injects its own
   DOM and reuses view-report.js's renderer, so app.html only needs to load this
   file (and view-report.js) — no changes to the terminal's markup.

   Auto-archive trigger: the Report classification banner (#rptClass) flipping to a
   real classification means a brief just computed. We debounce + de-dupe by
   content so re-renders of the same brief don't spam the API. Report-only by
   default (light); the Heat Map grid is added when you open History → "Save + heat".
   ========================================================================== */
(function () {
  'use strict';

  var API = '/api/archive';
  function token() { return (window.__authToken && window.__authToken()) || null; }
  function authHeaders() { var t = token(), h = { 'Content-Type': 'application/json' }; if (t) h.Authorization = 'Bearer ' + t; return h; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function curInst() { var e = $('instA'); return (e && e.value) || ''; }
  function curDate() { var e = $('dayDate'); return (e && e.value) || ''; }

  function hash(str) { var h = 5381, i = str.length; while (i) h = (h * 33) ^ str.charCodeAt(--i); return h >>> 0; }

  // ---- gather the current Heat Map grid (same postMessage dance as publish) ---
  function requestHeatmapData() {
    return new Promise(function (resolve) {
      var frame = $('heatFrame');
      if (!frame || !window.__heatBoot) { resolve(null); return; }
      try { window.__heatBoot(); } catch (_) {}
      var reqId = Math.random().toString(36).slice(2), done = false;
      function onMsg(ev) {
        if (ev.data && ev.data.type === 'quanHeatmapData' && ev.data.reqId === reqId) {
          done = true; window.removeEventListener('message', onMsg); resolve(ev.data.data || null);
        }
      }
      window.addEventListener('message', onMsg);
      var n = 0, iv = setInterval(function () {
        n++; try { frame.contentWindow.postMessage({ type: 'quanGetHeatmap', reqId: reqId }, '*'); } catch (_) {}
        if (done || n >= 8) { clearInterval(iv); if (!done) { window.removeEventListener('message', onMsg); resolve(null); } }
      }, 350);
    });
  }

  // ---- public API --------------------------------------------------------
  var Archive = {
    list: function (inst) {
      var t = token(); if (!t) return Promise.resolve([]);
      return fetch(API + (inst ? '?inst=' + encodeURIComponent(inst) : ''), { headers: { Authorization: 'Bearer ' + t } })
        .then(function (r) { return r.ok ? r.json() : { items: [] }; })
        .then(function (d) { return d.items || []; }).catch(function () { return []; });
    },
    get: function (inst, date) {
      var t = token(); if (!t) return Promise.resolve(null);
      return fetch(API + '?inst=' + encodeURIComponent(inst) + '&date=' + encodeURIComponent(date), { headers: { Authorization: 'Bearer ' + t } })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    },
    remove: function (inst, date) {
      var t = token(); if (!t) return Promise.resolve(false);
      return fetch(API + '?inst=' + encodeURIComponent(inst) + '&date=' + encodeURIComponent(date), { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    },
    // gather + POST. withHeatmap pulls the current grid too.
    saveNow: function (inst, date, withHeatmap) {
      inst = inst || curInst(); date = date || curDate();
      if (!token() || !inst || !date) return Promise.resolve(false);
      var report = null; try { report = window.__reportData ? window.__reportData(inst, date) : null; } catch (_) {}
      if (!report) return Promise.resolve(false);
      var classification = ($('rptClass') && $('rptClass').textContent || '').trim();
      var summary = ($('rptSub') && $('rptSub').textContent || '').trim();
      var go = function (heatmap) {
        return fetch(API, { method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ inst: inst, date: date, report: report, heatmap: heatmap || null, classification: classification, summary: summary }) })
          .then(function (r) { return r.ok; }).catch(function () { return false; });
      };
      return withHeatmap ? requestHeatmapData().then(go) : go(null);
    }
  };
  window.__quanArchive = Archive;

  // ---- auto-archive on brief compute (debounced + de-duped) ---------------
  var lastHash = {};       // "inst|date" -> content hash
  var saveTimer = null;
  function scheduleAutoSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      if (!token()) return;
      var inst = curInst(), date = curDate();
      var cls = $('rptClass');
      if (!inst || !date || !cls) return;
      if (cls.classList.contains('rwait') || /awaiting/i.test(cls.textContent || '')) return;   // no brief yet
      var report = null; try { report = window.__reportData ? window.__reportData(inst, date) : null; } catch (_) {}
      if (!report) return;
      var key = inst + '|' + date, h = hash(JSON.stringify(report));
      if (lastHash[key] === h) return;                    // unchanged brief — skip
      lastHash[key] = h;
      Archive.saveNow(inst, date, false);
    }, 3000);
  }

  function watchReport() {
    var cls = $('rptClass'); if (!cls) return;
    try { new MutationObserver(scheduleAutoSave).observe(cls, { childList: true, characterData: true, subtree: true }); } catch (_) {}
  }

  // ---- History button + read-only viewer ---------------------------------
  function ensureViewer() {
    var ov = $('archiveOverlay'); if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'archiveOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;display:none;background:rgba(6,6,6,0.86);' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:5vh 4vw;box-sizing:border-box;';
    ov.innerHTML =
      '<div style="max-width:960px;margin:0 auto;height:100%;display:flex;flex-direction:column;' +
      'background:#0f0f0f;border:0.5px solid #2a2a2a;border-radius:14px;overflow:hidden;">' +
        '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:0.5px solid #232323;">' +
          '<b id="avTitle" style="font-size:13px;letter-spacing:.02em;">Brief history</b>' +
          '<span id="avMeta" style="color:#8a8a8a;font-size:12px;"></span>' +
          '<span style="flex:1"></span>' +
          '<button id="avClose" class="ctool" type="button">✕ Close</button>' +
        '</div>' +
        '<div style="display:flex;min-height:0;flex:1;">' +
          '<div id="avList" style="width:210px;flex:0 0 auto;border-right:0.5px solid #232323;overflow:auto;padding:8px;"></div>' +
          '<div id="avBody" class="rptBody" style="flex:1;overflow:auto;padding:14px 18px;"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#avClose').addEventListener('click', function () { ov.style.display = 'none'; });
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; });
    return ov;
  }

  function openViewer() {
    var ov = ensureViewer();
    ov.style.display = 'block';
    var inst = curInst();
    ov.querySelector('#avMeta').textContent = inst ? '· ' + inst : '';
    var listEl = ov.querySelector('#avList'), bodyEl = ov.querySelector('#avBody');
    listEl.textContent = 'loading…';
    bodyEl.innerHTML = '<div class="rptSub">Select a date on the left.</div>';
    Archive.list(inst).then(function (items) {
      if (!items.length) { listEl.innerHTML = '<div style="color:#8a8a8a;padding:6px;">No archived briefs' + (inst ? ' for ' + esc(inst) : '') + ' yet.</div>'; return; }
      listEl.innerHTML = items.map(function (it) {
        return '<button class="ctool av-item" data-inst="' + esc(it.inst) + '" data-date="' + esc(it.date) + '" type="button" ' +
          'style="display:block;width:100%;text-align:left;margin-bottom:6px;">' +
          '<b>' + esc(it.date) + '</b>' + (it.inst && !inst ? ' · ' + esc(it.inst) : '') +
          '<div style="color:#8a8a8a;font-size:11px;">' + esc(it.classification || '—') + '</div></button>';
      }).join('');
      [].slice.call(listEl.querySelectorAll('.av-item')).forEach(function (b) {
        b.addEventListener('click', function () {
          [].slice.call(listEl.querySelectorAll('.av-item')).forEach(function (x) { x.classList.remove('rptbtn-on'); });
          b.classList.add('rptbtn-on');
          bodyEl.innerHTML = '<div class="rptSub">loading…</div>';
          Archive.get(b.dataset.inst, b.dataset.date).then(function (snap) {
            ov.querySelector('#avTitle').textContent = 'Brief · ' + b.dataset.inst + ' · ' + b.dataset.date;
            if (window.__viewRenderReport) window.__viewRenderReport(bodyEl, snap && snap.report);
            else bodyEl.innerHTML = '<div class="rptSub">viewer unavailable</div>';
          });
        });
      });
    });
  }

  function injectButton() {
    var host = document.querySelector('#tabReport .hdr-right');
    if (!host || $('historyBtn')) return;
    var b = document.createElement('button');
    b.id = 'historyBtn'; b.className = 'rptbtn'; b.type = 'button';
    b.title = 'Browse archived briefs for this instrument';
    b.textContent = '🕘 History';
    b.addEventListener('click', openViewer);
    host.insertBefore(b, host.firstChild);
  }

  function boot() { injectButton(); watchReport(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
