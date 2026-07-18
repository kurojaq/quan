/* ==========================================================================
   Subscription state for the terminal.

   After Supabase sign-in (js/auth.js), this:
     • fetches /api/subscription and exposes window.__quanSub
     • shows a slim upgrade bar when the user has no active plan
     • completes the landing → sign-in → checkout hand-off (#plan=… in the URL)
     • refreshes state after a successful Stripe return (?checkout=success)
     • exposes window.__quanUpgrade(plan,cycle) and window.__quanPortal()

   It is intentionally non-blocking: it surfaces the upgrade path and publishes
   entitlement state for per-feature gating (window.__quanCan(feature)) without
   ripping the terminal out from under a signed-in user. Wire hard gates later
   off window.__quanSub / __quanCan.
   ========================================================================== */
(function () {
  'use strict';

  // Which plan unlocks what. Scout (free/no active sub) gets a limited set.
  // Ladder: scout < operator < prime < desk. Prime adds Execution + realtime;
  // Desk adds team seats + data export/API on top of Prime.
  var OPERATOR_VIEWS = ['detector', 'chart', 'report', 'polar', 'strike', 'heat', 'compass', 'sim', 'payload', 'split', 'cboe', 'rolling'];
  var PRIME_VIEWS = OPERATOR_VIEWS.concat(['exec']);
  var ENTITLEMENTS = {
    scout:    ['detector', 'chart'],
    operator: OPERATOR_VIEWS,
    prime:    PRIME_VIEWS,
    desk:     PRIME_VIEWS.concat(['team', 'export', 'wiki'])
  };

  // Upgrade direction — higher rank = more access. Used by the entitlement gate
  // to pick the right upsell target for a locked feature.
  var TIER_RANK = { scout: 0, operator: 1, prime: 2, desk: 3 };
  window.__quanTierRank = TIER_RANK;
  // Lowest tier that unlocks a given feature (for "Upgrade to X" copy).
  window.__quanTierFor = function (feature) {
    var order = ['scout', 'operator', 'prime', 'desk'];
    for (var i = 0; i < order.length; i++) {
      if ((ENTITLEMENTS[order[i]] || []).indexOf(feature) !== -1) return order[i];
    }
    return 'operator';
  };

  window.__quanSub = { loaded: false, active: false, plan: null, status: 'unknown' };
  window.__quanCan = function (feature) {
    var plan = (window.__quanSub && window.__quanSub.active && window.__quanSub.plan) || 'scout';
    return (ENTITLEMENTS[plan] || ENTITLEMENTS.scout).indexOf(feature) !== -1;
  };

  function token() { return (window.__authToken && window.__authToken()) || null; }

  // ---- API calls ---------------------------------------------------------
  function fetchState() {
    var t = token();
    if (!t) return Promise.resolve(null);
    return fetch('/api/subscription', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  window.__quanUpgrade = function (plan, cycle) {
    var t = token();
    if (!t) { location.href = '/app'; return; }
    if (plan === 'scout') { hideBar(); return; }
    return fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ plan: plan, cycle: cycle || 'monthly' })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d && res.d.url) location.href = res.d.url;
        else alert((res.d && res.d.error) || 'Checkout is not available yet.');
      })
      .catch(function () { alert('Could not start checkout.'); });
  };

  window.__quanPortal = function () {
    var t = token();
    if (!t) { location.href = '/app'; return; }
    return fetch('/api/portal', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.url) location.href = d.url; else alert(d && d.error || 'No billing account yet.'); })
      .catch(function () { alert('Could not open billing.'); });
  };

  // ---- upgrade bar UI ----------------------------------------------------
  var bar;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'quanUpgradeBar';
    bar.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:9998',
      'display:flex', 'align-items:center', 'gap:14px', 'flex-wrap:wrap',
      'padding:11px calc(16px + env(safe-area-inset-right)) calc(11px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))',
      'background:rgba(16,16,16,0.92)', 'backdrop-filter:saturate(180%) blur(18px)',
      '-webkit-backdrop-filter:saturate(180%) blur(18px)',
      'border-top:0.5px solid rgba(255,255,255,0.10)',
      'font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'color:#e6e6e6', 'font-size:13px'
    ].join(';');
    document.body.appendChild(bar);
    return bar;
  }
  function hideBar() { if (bar) bar.style.display = 'none'; }

  function renderBar(state) {
    var b = ensureBar();
    b.style.display = 'flex';
    if (state && state.status === 'trialing') {
      var planName = state.plan ? state.plan.charAt(0).toUpperCase() + state.plan.slice(1) : 'full';
      b.innerHTML =
        '<span style="letter-spacing:.02em">You’re on the <b>' + esc(planName) + '</b> free trial.</span>' +
        '<span style="flex:1"></span>' +
        '<button id="quGoPro" style="' + btnCss(true) + '">Subscribe</button>' +
        '<button id="quPortal" style="' + btnCss(false) + '">Manage</button>';
    } else if (state && (state.status === 'past_due' || state.status === 'canceled' || state.status === 'incomplete')) {
      b.innerHTML =
        '<span>Your subscription is <b>' + esc(state.status) + '</b> — some views are locked.</span>' +
        '<span style="flex:1"></span>' +
        '<button id="quGoPro" style="' + btnCss(true) + '">Fix billing</button>' +
        '<button id="quPortal" style="' + btnCss(false) + '">Manage</button>';
    } else {
      // no plan → free Scout
      b.innerHTML =
        '<span style="letter-spacing:.02em">Free <b>Scout</b> — Detector &amp; Chart only. Unlock the full terminal.</span>' +
        '<span style="flex:1"></span>' +
        '<button id="quGoPro" style="' + btnCss(true) + '">Upgrade to Operator — $99/mo</button>' +
        '<button id="quDismiss" style="' + btnCss(false) + '">Later</button>';
    }
    var go = b.querySelector('#quGoPro'); if (go) go.onclick = function () { window.__quanUpgrade('operator', 'monthly'); };
    var pt = b.querySelector('#quPortal'); if (pt) pt.onclick = function () { window.__quanPortal(); };
    var dm = b.querySelector('#quDismiss'); if (dm) dm.onclick = hideBar;
  }
  function btnCss(primary) {
    return (primary
      ? 'background:#fff;color:#000;'
      : 'background:transparent;color:#e6e6e6;border:0.5px solid #3a3a3a;') +
      'font:inherit;font-weight:600;font-size:12.5px;padding:8px 15px;border-radius:999px;cursor:pointer;';
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ---- apply fetched state ----------------------------------------------
  function apply(state) {
    if (!state) { window.__quanSub = { loaded: true, active: false, plan: null, status: 'none' }; renderBar(null); return; }
    window.__quanSub = {
      loaded: true,
      active: !!state.active,
      plan: state.plan || null,
      status: state.status || 'none',
      current_period_end: state.current_period_end || null,
      cancel_at_period_end: !!state.cancel_at_period_end
    };
    document.body.classList.toggle('has-plan', !!state.active);
    if (state.active && state.status === 'active') hideBar();     // fully paid → no nag
    else renderBar(state);
  }

  // ---- hand-off + return handling ---------------------------------------
  function parseHashPlan() {
    var m = /[#&]plan=([a-z]+)(?:&cycle=([a-z]+))?/.exec(location.hash || '');
    return m ? { plan: m[1], cycle: m[2] || 'monthly' } : null;
  }
  function cleanQuery() {
    if (/[?&]checkout=/.test(location.search)) {
      history.replaceState({}, '', location.pathname + location.hash.replace(/[#&]?plan=[^&]*(&cycle=[^&]*)?/, ''));
    }
  }

  // ---- boot: wait for an auth session, then load state ------------------
  var tries = 0;
  function boot() {
    // If auth isn't configured at all, there's nothing to gate.
    if (window.__authEnabled === false) return;
    var t = token();
    if (!t) {
      if (++tries > 200) return;        // ~20s: user simply hasn't signed in
      return void setTimeout(boot, 100);
    }

    var returning = /[?&]checkout=success/.test(location.search);
    var pending = parseHashPlan();

    fetchState().then(function (state) {
      apply(state);
      // came back from Stripe: state may lag the webhook by a moment — retry once
      if (returning && !(state && state.active)) {
        setTimeout(function () { fetchState().then(apply); }, 2500);
      }
      cleanQuery();
      // arrived from the landing page wanting a specific plan, and not already active
      if (pending && !(state && state.active) && pending.plan !== 'scout') {
        history.replaceState({}, '', location.pathname + location.search);
        window.__quanUpgrade(pending.plan, pending.cycle);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
