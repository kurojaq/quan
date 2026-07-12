/* ==========================================================================
   Pricing UI + Stripe checkout hand-off for the landing page.

   PLANS is the single source of truth for what the pricing cards show. Edit the
   amounts / copy here and the cards + billing toggle update automatically.

   The Stripe *price IDs* are NOT stored in the client — the server (Pages Function
   at /api/checkout) maps a plan+cycle to the correct Stripe price and creates the
   Checkout Session. The client only ever sends { plan, cycle }. See STRIPE_SETUP.md.
   ========================================================================== */
(function () {
  'use strict';

  // ---- editable pricing model -------------------------------------------
  // annual is shown as an equivalent monthly figure (billed yearly). "2 months
  // free" => annual = monthly * 10.
  var PLANS = {
    scout: {
      monthly: { amt: '$0', per: '/forever', note: '14-day full-access trial included' },
      annual:  { amt: '$0', per: '/forever', note: '14-day full-access trial included' }
    },
    operator: {
      monthly: { amt: '$99',  per: '/month', note: 'Billed monthly · cancel anytime' },
      annual:  { amt: '$83',  per: '/month', note: '$990 billed yearly · 2 months free' }
    },
    prime: {
      monthly: { amt: '$249', per: '/month', note: 'Billed monthly · cancel anytime' },
      annual:  { amt: '$208', per: '/month', note: '$2,490 billed yearly · 2 months free' }
    },
    desk: {
      monthly: { amt: '$699', per: '/month', note: 'Up to 5 seats · billed monthly' },
      annual:  { amt: '$583', per: '/month', note: '$6,990 billed yearly · 2 months free' }
    }
  };

  var CHECKOUT_ENDPOINT = '/api/checkout';   // Cloudflare Pages Function
  var APP_URL = '/app';

  var cycle = 'monthly';

  // ---- render prices for the active billing cycle -----------------------
  function render() {
    Object.keys(PLANS).forEach(function (plan) {
      var card = document.querySelector('.plan[data-plan="' + plan + '"]');
      if (!card) return;
      var model = PLANS[plan][cycle];
      var amt = card.querySelector('[data-price]');
      var per = card.querySelector('[data-per]');
      var note = card.querySelector('[data-note]');
      if (amt) amt.textContent = model.amt;
      if (per) per.textContent = model.per;
      if (note) note.textContent = model.note;
    });
  }

  // ---- billing toggle ----------------------------------------------------
  var toggle = document.getElementById('billToggle');
  if (toggle) {
    toggle.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-cycle]');
      if (!btn) return;
      cycle = btn.getAttribute('data-cycle');
      toggle.querySelectorAll('button').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      render();
    });
  }

  // ---- checkout hand-off -------------------------------------------------
  // Scout is free: send straight to the app (sign up / sign in there).
  // Paid plans: ask the server for a Stripe Checkout Session and redirect.
  function startCheckout(plan, trigger) {
    if (plan === 'scout') { window.location.href = APP_URL; return; }

    var original = trigger ? trigger.textContent : '';
    if (trigger) { trigger.textContent = 'Redirecting…'; trigger.style.pointerEvents = 'none'; }

    fetch(CHECKOUT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: plan, cycle: cycle })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d && res.d.url) { window.location.href = res.d.url; return; }
        // Not wired yet (no Stripe keys) or the user needs to sign in first —
        // fall back to the app, which owns auth + the in-app upgrade flow.
        window.location.href = APP_URL + '#plan=' + plan + '&cycle=' + cycle;
      })
      .catch(function () {
        window.location.href = APP_URL + '#plan=' + plan + '&cycle=' + cycle;
      })
      .finally(function () {
        if (trigger) { trigger.textContent = original; trigger.style.pointerEvents = ''; }
      });
  }

  document.querySelectorAll('[data-checkout]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      startCheckout(btn.getAttribute('data-checkout'), btn);
    });
  });

  render();
})();
