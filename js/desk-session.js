/* ==========================================================================
   Desk shared session (Phase 4, beta). Desk-tier teams watch the same field:
   one seat's instrument / date / anchor selection is relayed to the others via
   the realtime Worker's DeskRoom. Live *price* is not relayed — each seat gets it
   straight from its own PriceRoom, so everyone stays real-time.

   Inert unless realtime is configured (js/realtime-config.js) AND the signed-in
   user is on the Desk plan. Injects its own control; no app.html markup needed.
   Self-contained and guarded so applying a remote change never re-broadcasts.
   ========================================================================== */
(function () {
  'use strict';

  function rtReady() { return window.__quanRealtime && window.__quanRealtime.enabled; }
  function isDesk() { return window.__quanSub && window.__quanSub.plan === 'desk'; }
  function $(id) { return document.getElementById(id); }
  function seatName() {
    try { return (window.__authSession && window.__authSession.user && window.__authSession.user.email) || 'seat'; } catch (_) { return 'seat'; }
  }

  var desk = null;            // realtime desk handle
  var applyingRemote = false; // echo guard
  var room = null;
  var btn, statusEl;

  // ---- broadcast local changes ------------------------------------------
  function send(type, value) { if (desk && !applyingRemote) desk.send({ type: type, value: value }); }
  function wireLocal() {
    var inst = $('instA'); if (inst) inst.addEventListener('change', function () { send('instr', inst.value); });
    var date = $('dayDate'); if (date) date.addEventListener('change', function () { send('date', date.value); });
    var anc = $('gAnchor'); if (anc) anc.addEventListener('change', function () { send('anchor', anc.value); });
  }

  // ---- apply remote changes (guarded) -----------------------------------
  function applyRemote(m) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'presence') { setStatus('· ' + (m.count || 1) + ' seat' + ((m.count || 1) === 1 ? '' : 's')); return; }
    applyingRemote = true;
    try {
      if (m.type === 'instr' && $('instA')) { $('instA').value = m.value; $('instA').dispatchEvent(new Event('change')); }
      else if (m.type === 'date' && $('dayDate')) { $('dayDate').value = m.value; $('dayDate').dispatchEvent(new Event('change')); }
      else if (m.type === 'anchor') {
        if ($('gAnchor')) { $('gAnchor').value = m.value; $('gAnchor').dispatchEvent(new Event('change')); }
        var n = parseFloat(m.value); if (!isNaN(n) && window.__qSetAnchor) window.__qSetAnchor(n);
      }
    } catch (_) {}
    setTimeout(function () { applyingRemote = false; }, 0);
  }

  // ---- join / leave ------------------------------------------------------
  function join() {
    var r = window.prompt('Desk session — room name (share this with your seats):', room || '');
    if (!r) return;
    room = r.trim(); if (!room) return;
    leave();
    desk = window.__quanRealtime.connectDesk(room, seatName(), applyRemote, function (st) {
      if (st === 'open') setStatus('· connected'); else if (st === 'reconnecting') setStatus('· reconnecting…');
    });
    if (btn) btn.classList.add('on');
    setStatus('· joining…');
    // push our current selection so a newly-joined seat converges to it
    setTimeout(function () {
      if ($('instA')) send('instr', $('instA').value);
      if ($('dayDate')) send('date', $('dayDate').value);
      if ($('gAnchor') && $('gAnchor').value) send('anchor', $('gAnchor').value);
    }, 400);
  }
  function leave() {
    if (desk) { desk.close(); desk = null; }
    if (btn) btn.classList.remove('on');
    setStatus('');
  }
  function setStatus(t) { if (statusEl) statusEl.textContent = t || ''; }

  // ---- inject the control into the toolbar -------------------------------
  function injectControl() {
    var host = document.querySelector('.tabbar .gctrls');
    if (!host || $('deskBtn')) return;
    var slot = document.createElement('div');
    slot.className = 'slot';
    slot.innerHTML = '<button class="ctool" id="deskBtn" type="button" title="Share this instrument/date/anchor with your desk seats">⇄ Desk</button>' +
                     '<span class="expnote" id="deskStatus"></span>';
    host.appendChild(slot);
    btn = $('deskBtn'); statusEl = $('deskStatus');
    btn.addEventListener('click', function () { if (desk) leave(); else join(); });
  }

  // ---- boot: only when realtime + Desk tier are both available -----------
  var tries = 0;
  (function boot() {
    if (!rtReady()) return;                                   // realtime not configured → stay inert
    if (!(window.__quanSub && window.__quanSub.loaded)) {     // wait for subscription state
      if (++tries > 300) return; return void setTimeout(boot, 200);
    }
    if (!isDesk()) return;                                    // not a Desk plan → no shared sessions
    injectControl();
    wireLocal();
  })();
})();
