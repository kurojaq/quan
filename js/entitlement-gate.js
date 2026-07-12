/* ==========================================================================
   Hard paywall — tab-level entitlement enforcement.

   subscription-gate.js publishes window.__quanSub / __quanCan(feature). This
   module turns those entitlements into an actual gate on the terminal's tabs:
   locked tabs are visibly disabled, and clicking one is intercepted in the
   CAPTURE phase (before tabs.js's own bubble-phase handler) so it never opens —
   instead an upgrade sheet is shown.

   Honest scope note: this is client-side UX enforcement. The hard security
   boundary is the DATA plane — /api/quote, /api/history, /api/state,
   /api/execution all gate by identity+tier server-side (resolveIdentity in
   functions/api/_shared.js). Feature-tab gating protects a browser terminal
   whose analytical inputs are the user's OWN uploaded chains; there is no
   server secret behind most tabs to protect, so a determined user bypassing JS
   only re-enables views of their own data — not anyone else's, and not the
   rate-limited/tiered market-data or execution endpoints.
   ========================================================================== */
(function () {
  'use strict';

  var TIER_LABEL = { operator: 'Operator', prime: 'Prime', desk: 'Desk' };
  var TIER_PRICE = { operator: '$99/mo', prime: '$249/mo', desk: '$699/mo' };

  function can(tab) { return !window.__quanCan || window.__quanCan(tab); }
  function tierFor(tab) { return (window.__quanTierFor && window.__quanTierFor(tab)) || 'operator'; }

  // ---- lock badges on the tab buttons -----------------------------------
  function applyLocks() {
    var btns = document.querySelectorAll('.tabbtn[data-tab]');
    btns.forEach(function (b) {
      var tab = b.dataset.tab;
      if (!tab) return;
      var locked = !can(tab);
      b.classList.toggle('locked', locked);
      b.setAttribute('aria-disabled', locked ? 'true' : 'false');
      if (locked && !b.querySelector('.tablock')) {
        var g = document.createElement('span');
        g.className = 'tablock';
        g.setAttribute('aria-hidden', 'true');
        g.textContent = '🔒';
        b.appendChild(g);
      } else if (!locked) {
        var ex = b.querySelector('.tablock');
        if (ex) ex.remove();
      }
    });
  }

  // ---- capture-phase click interception ---------------------------------
  function onCapture(e) {
    var b = e.target.closest ? e.target.closest('.tabbtn[data-tab]') : null;
    if (!b) return;
    var tab = b.dataset.tab;
    if (can(tab)) return;                 // allowed → let tabs.js handle it
    e.preventDefault();
    e.stopImmediatePropagation();         // block tabs.js's own listener
    showSheet(tab);
  }

  // ---- upgrade sheet -----------------------------------------------------
  var sheet;
  function showSheet(tab) {
    var tier = tierFor(tab);
    var label = TIER_LABEL[tier] || 'a paid plan';
    var price = TIER_PRICE[tier] || '';
    var tabName = (function () {
      var b = document.querySelector('.tabbtn[data-tab="' + tab + '"]');
      return (b && b.textContent.replace('🔒', '').trim()) || 'This view';
    })();
    var isExec = (tab === 'exec');

    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'quGateSheet';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    }
    sheet.innerHTML =
      '<div class="qg-card" role="dialog" aria-modal="true" aria-label="Upgrade required">' +
        '<div class="qg-lock">🔒</div>' +
        '<div class="qg-title">' + esc(tabName) + ' unlocks on <b>' + esc(label) + '</b></div>' +
        '<div class="qg-sub">' +
          (isExec
            ? 'The Execution engine is included with Prime. It’s rolling out to subscribers in a controlled onboarding — start your trial to join.'
            : 'Unlock this view and the full terminal on ' + esc(label) + ' — ' + esc(price) + ', 14-day free trial.') +
        '</div>' +
        '<div class="qg-actions">' +
          '<button class="qg-btn qg-primary" id="qgUp">Start ' + esc(label) + ' trial — ' + esc(price) + '</button>' +
          '<button class="qg-btn" id="qgClose">Not now</button>' +
        '</div>' +
      '</div>';
    sheet.style.display = 'flex';
    var up = sheet.querySelector('#qgUp');
    if (up) up.onclick = function () {
      if (window.__quanUpgrade) window.__quanUpgrade(tier, 'monthly');
      else location.href = '/#pricing';
    };
    var cl = sheet.querySelector('#qgClose'); if (cl) cl.onclick = close;
    document.addEventListener('keydown', onEsc);
  }
  function close() { if (sheet) sheet.style.display = 'none'; document.removeEventListener('keydown', onEsc); }
  function onEsc(e) { if (e.key === 'Escape') close(); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ---- boot: wait for entitlements, then gate + keep in sync ------------
  var lastKey = null;
  function subKey() {
    var s = window.__quanSub || {};
    return (s.loaded ? '1' : '0') + ':' + (s.active ? '1' : '0') + ':' + (s.plan || '') + ':' + (s.status || '');
  }
  function tick() {
    if (window.__authEnabled === false) return;   // auth off → nothing to gate
    var k = subKey();
    if (k !== lastKey) { lastKey = k; applyLocks(); }
  }

  function start() {
    // capture-phase, so we win the race with tabs.js regardless of load order
    document.addEventListener('click', onCapture, true);
    tick();
    setInterval(tick, 600);   // cheap; re-applies after Stripe-return refresh / plan change
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
