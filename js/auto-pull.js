/* auto-pull.js — Auto-pull control panel + on-load ingest (Phase 5).

   Operator-only. Bridges the terminal to the Barchart auto-download Worker
   (workers/barchart-fetch.js) via /api/autopull:
     • Manage the SELECTION — which Barchart contracts the cloud Worker pulls
       each day (a toggle per contract, exactly as the ask framed it).
     • Show the last run's STATUS (ok/fail, auth mode, errors) so a silent
       bot-challenge surfaces as a bad run instead of empty days.
     • INGEST new CSVs the Worker dropped in R2, feeding them through the same
       load hooks a manual upload uses (__compassLoadChain / __polarLoadChain /
       __strikeLoadChain), so files appear with zero manual upload.

   The panel is hidden for anyone but the app owner: /api/autopull is gated by
   requireOperator server-side, so a non-operator (or signed-out) GET returns
   401/403 and we simply never reveal the slot.
*/
(function () {
  'use strict';
  var slot = document.getElementById('autopullSlot');
  var btn = document.getElementById('autopullBtn');
  var panel = document.getElementById('autopullPanel');
  if (!slot || !btn || !panel) return;

  var INGESTED_KEY = 'autopull:ingested'; // { "<r2key>": "<fetched ISO>" } already pulled into this browser
  var selection = []; // [{symbol,expiry,kind,url,on}]
  var lastStatus = null;
  var lastIndex = {};

  /* The button doesn't build option-symbol URLs (BG6N26 is opaque and rolls) —
     it sends the FUTURE + target DATE + tab, and the Worker picks the matching
     expiry from Barchart's own list. See resolveExpiryPage() in barchart-fetch.js. */
  // Quarterly delivery-month codes for index/most futures (front rolls Mar→Jun→Sep→Dec).
  var QCODE = { 2: 'H', 5: 'M', 8: 'U', 11: 'Z' };

  // ---- date helpers (reuse the terminal's holiday-aware calendar) -----------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayISO() {
    if (window.__sessionDateNow) { try { var s = window.__sessionDateNow(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; } catch (_) {} }
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function addDaysISO(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function isTradingDay(iso) {
    if (window.__isTradingDay) { try { return !!window.__isTradingDay(iso); } catch (_) {} }
    var wd = new Date(iso + 'T00:00:00Z').getUTCDay();
    return wd !== 0 && wd !== 6; // weekday fallback if the calendar isn't loaded
  }
  // The greeks pairing: the NEXT trading day after the chain's date.
  function nextTradingDay(iso) {
    var d = iso;
    for (var i = 0; i < 10; i++) { d = addDaysISO(d, 1); if (isTradingDay(d)) return d; }
    return d;
  }
  function mmddyy(iso) { var p = iso.split('-'); return p[1] + '_' + p[2] + '_' + p[0].slice(2); }

  // ---- contract resolution --------------------------------------------------
  function activeInst() {
    try { var a = window.__qActiveChain && window.__qActiveChain(); if (a && a.inst) return String(a.inst).toUpperCase(); } catch (_) {}
    var el = document.getElementById('cp_inst');
    return (el && el.value ? el.value : 'ES').toUpperCase();
  }
  // Front contract symbol, e.g. ESM25. Prefer the symbol the active chain was
  // loaded under (most reliable); otherwise compute the front quarterly month.
  function frontSymbol(inst, iso) {
    try {
      var a = window.__qActiveChain && window.__qActiveChain();
      var fn = a && a.fn ? String(a.fn).toLowerCase() : '';
      var m = fn.match(/^([a-z]{2}[a-z]?\d{2})/);
      if (m) return m[1].toUpperCase();
    } catch (_) {}
    var d = new Date(iso + 'T00:00:00Z');
    var y = d.getUTCFullYear(), mo = d.getUTCMonth();
    for (var i = 0; i < 12; i++) {
      var mm = (mo + i) % 12, yy = y + Math.floor((mo + i) / 12);
      if (QCODE[mm]) return inst + QCODE[mm] + String(yy).slice(2);
    }
    return inst;
  }

  function authHeaders() {
    var t = window.__authToken && window.__authToken();
    var h = { 'Content-Type': 'application/json' };
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function readIngested() {
    try { return JSON.parse(localStorage.getItem(INGESTED_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeIngested(m) {
    try { localStorage.setItem(INGESTED_KEY, JSON.stringify(m)); } catch (_) {}
  }

  // Feed a downloaded CSV through the same hooks a manual upload uses. The R2
  // key already encodes the app filename convention (symbol + exp-MM_DD_YY),
  // so we pass its basename as the "filename" and parseChain() does the rest.
  function ingestCsv(text, key, kind) {
    var name = String(key).split('/').pop(); // e.g. esm25-exp-01_16_26.csv
    if (kind === 'greeks') {
      if (window.__strikeLoadGreeks) { try { window.__strikeLoadGreeks(text, name); } catch (_) {} }
      return;
    }
    if (window.__polarLoadChain) { try { window.__polarLoadChain(text, name); } catch (_) {} }
    if (window.__strikeLoadChain) { try { window.__strikeLoadChain(text, name); } catch (_) {} }
    if (window.__compassLoadChain) { try { window.__compassLoadChain(text, name); } catch (_) {} }
  }

  // Pull every index entry newer than what this browser last ingested.
  async function ingestNew() {
    var already = readIngested();
    var keys = Object.keys(lastIndex || {});
    var got = 0;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var meta = lastIndex[key] || {};
      if (already[key] && already[key] === meta.fetched) continue; // unchanged since last ingest
      try {
        var r = await fetch('/api/autopull?file=' + encodeURIComponent(key), { headers: authHeaders() });
        if (!r.ok) continue;
        var text = await r.text();
        if (text && text.length > 32) {
          ingestCsv(text, key, meta.kind);
          already[key] = meta.fetched;
          got++;
        }
      } catch (_) {}
    }
    if (got) writeIngested(already);
    return got;
  }

  // Resolve the two contracts today's click should pull: front chain for today,
  // greeks for the next trading day (the day-of-week pairing).
  function resolveTodayJobs() {
    var inst = activeInst();
    var cDate = todayISO();
    var gDate = nextTradingDay(cDate);
    var cFut = frontSymbol(inst, cDate);
    var gFut = frontSymbol(inst, gDate);
    // symbol = the FUTURE (filename prefix, so parseChain recovers the instrument);
    // future+date+tab tell the Worker which expiry to pick from Barchart's list.
    return [
      { symbol: cFut, future: cFut, date: cDate, tab: 'options', kind: 'chain', expiry: mmddyy(cDate) },
      { symbol: gFut, future: gFut, date: gDate, tab: 'volatility-greeks', kind: 'greeks', expiry: mmddyy(gDate) },
    ];
  }

  // Re-read control state (selection/status/index) after a pull, then ingest.
  async function refreshState() {
    try {
      var r = await fetch('/api/autopull', { headers: authHeaders() });
      if (!r.ok) return;
      var d = await r.json().catch(function () { return {}; });
      selection = Array.isArray(d.selection) ? d.selection : selection;
      lastStatus = d.status || lastStatus;
      lastIndex = d.index || lastIndex;
    } catch (_) {}
  }

  // Pull the captured toolbar markup out of a debug run's status, if present.
  function debugMarkup(status) {
    var jobs = (status && status.jobs) || [];
    var out = [];
    for (var i = 0; i < jobs.length; i++) if (jobs[i] && jobs[i].toolbarHtml) out.push('# ' + jobs[i].id + '\n' + jobs[i].toolbarHtml);
    return out.join('\n\n');
  }

  async function doPull(msgEl, debug) {
    var jobs = resolveTodayJobs();
    if (msgEl) msgEl.textContent = 'pulling ' + jobs.map(function (j) { return j.symbol + ' ' + j.kind; }).join(' + ') + (debug ? ' (debug)…' : '…');
    try {
      var r = await fetch('/api/autopull', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ action: 'pull', jobs: jobs, debug: !!debug }),
      });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) { if (msgEl) msgEl.textContent = 'error: ' + (d.error || (d.status && d.status.error) || r.status); return; }
      await refreshState();
      var got = await ingestNew();
      var s = d.status || {};
      if (msgEl) msgEl.textContent = 'pulled ' + (s.ok || 0) + ' / failed ' + (s.fail || 0) + ' · ingested ' + got;
      // Surface captured debug (login diagnostics + toolbar markup) into the panel + console.
      var parts = [];
      if (s.loginDebug) parts.push('LOGIN DEBUG:\n' + JSON.stringify(s.loginDebug, null, 2));
      if (s.error) parts.push('SESSION ERROR: ' + s.error);
      var tm = debugMarkup(s);
      if (tm) parts.push(tm);
      var mk = parts.join('\n\n=====\n\n');
      var dbgEl = panel.querySelector('#apDebug');
      if (dbgEl) {
        if (mk) { dbgEl.style.display = 'block'; dbgEl.querySelector('textarea').value = mk; try { console.log('[auto-pull] captured toolbar markup:\n' + mk); } catch (_) {} }
        else { dbgEl.style.display = 'none'; }
      }
      if (panel.style.display === 'block' && !mk) render();
    } catch (e) {
      if (msgEl) msgEl.textContent = 'error: ' + e.message;
    }
  }

  function statusLine() {
    if (!lastStatus) return '<span style="color:var(--cream-dim)">No run recorded yet.</span>';
    var s = lastStatus;
    var when = s.finished || s.started || '';
    var tone = s.fail || s.error ? 'var(--warn, #d98f4e)' : 'var(--cream-dim)';
    var bits = [];
    bits.push((s.ok || 0) + ' ok');
    if (s.fail) bits.push(s.fail + ' failed');
    if (s.auth) bits.push('auth: ' + s.auth);
    if (s.note) bits.push(s.note);
    var head = '<span style="color:' + tone + '">Last run: ' + esc(bits.join(' · ')) + '</span>';
    var sub = when ? '<div style="color:var(--cream-dim);font-size:11px;">' + esc(when.replace('T', ' ').replace(/\..*/, '')) + ' UTC</div>' : '';
    var err = s.error ? '<div style="color:' + tone + ';font-size:11px;">' + esc(s.error) + '</div>' : '';
    return head + sub + err;
  }

  function rowHtml(r, i) {
    return (
      '<div class="ap-row" data-i="' + i + '" style="display:flex;align-items:center;gap:6px;">' +
      '<input type="checkbox" class="ap-on"' + (r.on !== false ? ' checked' : '') + ' title="Include in the daily pull">' +
      '<span style="min-width:64px;font-weight:600;">' + esc(r.symbol) + '</span>' +
      '<span style="min-width:64px;color:var(--cream-dim);">' + esc(r.expiry) + '</span>' +
      '<span style="min-width:48px;color:var(--cream-dim);">' + esc(r.kind || 'chain') + '</span>' +
      '<a href="' + esc(r.url) + '" target="_blank" rel="noopener" style="color:var(--cream-dim);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.url) + '">page</a>' +
      '<button class="ctool ap-del" type="button" title="Remove" style="padding:2px 6px;">&times;</button>' +
      '</div>'
    );
  }

  function render() {
    var rows = selection.map(rowHtml).join('') || '<div style="color:var(--cream-dim);">No contracts yet.</div>';
    var jobs = resolveTodayJobs();
    var preview = jobs.map(function (j) {
      return '<div style="color:var(--cream-dim);font-size:11px;">' + esc(j.kind) + ': ' + esc(j.symbol) + ' · exp ' + esc(j.expiry) + '</div>';
    }).join('');
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px;">Daily auto-pull</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
      '<button id="apPullNow" class="ctool" type="button" title="Download today’s front chain + the next trading day’s greeks">&#10515; Pull today</button>' +
      '<label style="color:var(--cream-dim);display:flex;align-items:center;gap:4px;" title="Dump Barchart’s toolbar markup on failure to help calibrate the dropdowns"><input type="checkbox" id="apDebugChk">debug</label>' +
      '<span id="apPullMsg" style="color:var(--cream-dim);"></span>' +
      '</div>' +
      '<div style="margin-bottom:10px;">' + preview + '</div>' +
      '<div id="apDebug" style="display:none;margin-bottom:10px;">' +
      '<div style="color:var(--cream-dim);font-size:11px;margin-bottom:4px;">Captured toolbar markup (also logged to console):</div>' +
      '<textarea readonly style="width:100%;height:120px;background:var(--fill);border:none;border-radius:8px;color:var(--cream);font-size:10px;font-family:monospace;padding:6px;"></textarea>' +
      '</div>' +
      '<div id="apStatus" style="margin-bottom:10px;">' + statusLine() + '</div>' +
      '<div id="apRows" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto;margin-bottom:10px;">' + rows + '</div>' +
      '<div style="border-top:0.5px solid var(--glass-line);margin:8px 0;"></div>' +
      '<div style="font-weight:600;margin-bottom:2px;">Session cookie</div>' +
      '<div style="color:var(--cream-dim);font-size:11px;margin-bottom:6px;">Log into barchart.com, export its cookies (Cookie-Editor → Export → JSON), and paste here. The Worker reuses this instead of logging in.</div>' +
      '<textarea id="apCookies" placeholder="[ { &quot;name&quot;:&quot;...&quot;, &quot;value&quot;:&quot;...&quot;, &quot;domain&quot;:&quot;.barchart.com&quot; }, ... ]" style="width:100%;height:80px;background:var(--fill);border:none;outline:none;border-radius:8px;color:var(--cream);font-size:10px;font-family:monospace;padding:6px;margin-bottom:6px;"></textarea>' +
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;">' +
      '<button id="apSeed" class="ctool" type="button">Seed cookie</button>' +
      '<button id="apClearCk" class="ctool" type="button">Clear</button>' +
      '<span id="apSeedMsg" style="color:var(--cream-dim);"></span>' +
      '</div>' +
      '<div style="border-top:0.5px solid var(--glass-line);margin:8px 0;"></div>' +
      '<div style="font-weight:600;margin-bottom:6px;">Add contract</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">' +
      '<input id="apSym" placeholder="Symbol (ESM25)" style="background:var(--fill);border:none;outline:none;border-radius:8px;color:var(--cream);padding:6px 8px;">' +
      '<input id="apExp" placeholder="Exp MM_DD_YY" style="background:var(--fill);border:none;outline:none;border-radius:8px;color:var(--cream);padding:6px 8px;">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr;gap:6px;margin-bottom:6px;">' +
      '<input id="apUrl" placeholder="Barchart options-page URL" style="background:var(--fill);border:none;outline:none;border-radius:8px;color:var(--cream);padding:6px 8px;">' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;">' +
      '<select id="apKind" style="background:var(--fill);border:none;outline:none;border-radius:8px;color:var(--cream);padding:6px 8px;"><option value="chain">Chain</option><option value="greeks">Greeks</option></select>' +
      '<button id="apAdd" class="ctool" type="button">Add</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
      '<button id="apSave" class="ctool" type="button">Save selection</button>' +
      '<span id="apSaveMsg" style="color:var(--cream-dim);"></span>' +
      '</div>';
    wire();
  }

  function wire() {
    var pull = panel.querySelector('#apPullNow');
    if (pull) pull.addEventListener('click', function () {
      var dbg = panel.querySelector('#apDebugChk');
      doPull(panel.querySelector('#apPullMsg'), dbg && dbg.checked);
    });
    var rowsEl = panel.querySelector('#apRows');
    if (rowsEl) {
      rowsEl.querySelectorAll('.ap-row').forEach(function (row) {
        var i = +row.getAttribute('data-i');
        var chk = row.querySelector('.ap-on');
        if (chk) chk.addEventListener('change', function () { if (selection[i]) selection[i].on = chk.checked; });
        var del = row.querySelector('.ap-del');
        if (del) del.addEventListener('click', function () { selection.splice(i, 1); render(); });
      });
    }
    var seed = panel.querySelector('#apSeed');
    if (seed) seed.addEventListener('click', async function () {
      var msg = panel.querySelector('#apSeedMsg');
      var ta = panel.querySelector('#apCookies');
      var raw = (ta && ta.value || '').trim();
      if (!raw) { if (msg) msg.textContent = 'paste exported cookies first'; return; }
      if (msg) msg.textContent = 'seeding…';
      try {
        var r = await fetch('/api/autopull', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'seed-cookies', cookies: raw }) });
        var d = await r.json().catch(function () { return {}; });
        if (msg) msg.textContent = r.ok ? ('seeded ' + (d.count != null ? d.count : '?') + ' cookies ✓') : ('error: ' + (d.error || r.status));
        if (r.ok && ta) ta.value = '';
      } catch (e) { if (msg) msg.textContent = 'error: ' + e.message; }
    });
    var clearCk = panel.querySelector('#apClearCk');
    if (clearCk) clearCk.addEventListener('click', async function () {
      var msg = panel.querySelector('#apSeedMsg');
      try {
        var r = await fetch('/api/autopull', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'clear-cookies' }) });
        if (msg) msg.textContent = r.ok ? 'cleared' : 'error';
      } catch (e) { if (msg) msg.textContent = 'error: ' + e.message; }
    });
    var add = panel.querySelector('#apAdd');
    if (add) add.addEventListener('click', function () {
      var sym = (panel.querySelector('#apSym').value || '').trim().toUpperCase();
      var exp = (panel.querySelector('#apExp').value || '').trim().replace(/[^0-9_]/g, '');
      var url = (panel.querySelector('#apUrl').value || '').trim();
      var kind = panel.querySelector('#apKind').value;
      var msg = panel.querySelector('#apSaveMsg');
      if (!/^[A-Z]{2}[A-Z]?\d/.test(sym) || !/^\d{2}_\d{2}_\d{2}$/.test(exp) || !/^https?:\/\//.test(url)) {
        if (msg) msg.textContent = 'need symbol (ESM25), exp MM_DD_YY, http(s) url';
        return;
      }
      selection.push({ symbol: sym, expiry: exp, kind: kind, url: url, on: true });
      render();
    });
    var save = panel.querySelector('#apSave');
    if (save) save.addEventListener('click', async function () {
      var msg = panel.querySelector('#apSaveMsg');
      if (msg) msg.textContent = 'saving…';
      try {
        var r = await fetch('/api/autopull', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ selection: selection }) });
        var d = await r.json().catch(function () { return {}; });
        if (msg) msg.textContent = r.ok ? ('saved (' + (d.count != null ? d.count : selection.length) + ')') : ('error: ' + (d.error || r.status));
      } catch (e) {
        if (msg) msg.textContent = 'error: ' + e.message;
      }
    });
  }

  function setOpen(o) {
    panel.style.display = o ? 'block' : 'none';
    if (o) render();
  }
  btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(panel.style.display !== 'block'); });
  document.addEventListener('click', function (e) {
    if (panel.style.display === 'block' && !panel.contains(e.target) && e.target !== btn) setOpen(false);
  });

  // Boot: fetch control state; reveal the slot only if the caller is the operator.
  async function boot() {
    var t = window.__authToken && window.__authToken();
    if (!t) return; // not signed in yet — a later boot() attempt will catch it
    try {
      var r = await fetch('/api/autopull', { headers: authHeaders() });
      if (!r.ok) return; // 401/403 → not the operator; leave the slot hidden
      var d = await r.json().catch(function () { return {}; });
      selection = Array.isArray(d.selection) ? d.selection : [];
      lastStatus = d.status || null;
      lastIndex = d.index || {};
      slot.style.display = '';
      await ingestNew();
    } catch (_) {}
  }

  // Auth may resolve after this script runs; retry a few times, then give up.
  var tries = 0;
  (function tryBoot() {
    if (window.__authToken && window.__authToken()) { boot(); return; }
    if (tries++ < 20) setTimeout(tryBoot, 500);
  })();
})();
