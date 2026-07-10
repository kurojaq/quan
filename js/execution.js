/* execution.js — EXECUTION cockpit (front-end half of the Execution Engine).
 *
 * The Execution Engine materializes analytical intent under bounded risk. This
 * module is the mission-control surface; it holds NO broker credentials. Every
 * broker action is a small { action, params } envelope POSTed to /api/execution,
 * which forwards it (operator-gated) to the route-less runtime Worker
 * (workers/execution.js) that actually talks to Tradovate.
 *
 * Phase 3a (this build) — the connection core + a functional order path:
 *   • Connect: authenticate the runtime, load accounts + balance, show DEMO/LIVE.
 *   • Pending Order Injector: stage tickets (dormant) or route them now.
 *   • Live Execution Monitor: working orders · positions · fills.
 *   • Risk Field: live position/order/P-L rollup (continuous metrics land in 3b).
 *
 * Lazy-booted once via window.__execBoot() the first time the tab is opened
 * (see js/tabs.js), matching every other module.
 */
(function () {
  var PENDING_KEY = 'exec:pending';
  var els = {}, booted = false, conn = null, pending = [], refreshTimer = null;

  /* ── small helpers ──────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { if (v == null || v === '') return null; v = Number(v); return isFinite(v) ? v : null; }
  function money(v) { v = num(v); if (v == null) return '—'; var neg = v < 0, a = Math.abs(v); return (neg ? '−$' : '$') + a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function authHeaders() { var t = window.__authToken && window.__authToken(); var h = { 'Content-Type': 'application/json' }; if (t) h.Authorization = 'Bearer ' + t; return h; }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function readPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') || []; } catch (_) { return []; } }
  function writePending() { try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (_) {} }

  /* ── runtime RPC (through the operator-gated Pages proxy) ────────────────── */
  function api(action, params, opts) {
    opts = opts || {};
    var body = { action: action, params: params || {} };
    if (opts.confirm) body.confirm = true;
    if (opts.live) body.live = true;
    return fetch('/api/execution', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); });
  }

  function setStatus(msg, kind) { if (!els.status) return; els.status.textContent = msg; els.status.className = 'exStatusBar' + (kind ? ' ' + kind : ''); }
  function setFormMsg(msg, kind) { if (!els.formMsg) return; els.formMsg.textContent = msg || ''; els.formMsg.className = 'exFormMsg' + (kind ? ' ' + kind : ''); }

  function setBadge(env) {
    if (!els.badge) return;
    if (env === 'live') { els.badge.textContent = 'LIVE'; els.badge.className = 'exbadge exbadge-live'; }
    else if (env === 'demo') { els.badge.textContent = 'DEMO'; els.badge.className = 'exbadge exbadge-demo'; }
    else { els.badge.textContent = 'OFFLINE'; els.badge.className = 'exbadge exbadge-idle'; }
  }

  /* ── connect — self-service sign-in popover ─────────────────────────────── */
  function setLoginMsg(msg, kind) { if (!els.loginMsg) return; els.loginMsg.textContent = msg || ''; els.loginMsg.className = 'exFormMsg' + (kind ? ' ' + kind : ''); }
  function openLogin() {
    if (!els.loginPanel) return;
    if (conn && conn.env && els.loginEnv) els.loginEnv.value = conn.env;
    els.loginPanel.classList.add('on'); els.loginPanel.setAttribute('aria-hidden', 'false');
    setLoginMsg(''); setTimeout(function () { els.loginUser && els.loginUser.focus(); }, 30);
  }
  function closeLogin() {
    if (!els.loginPanel) return;
    els.loginPanel.classList.remove('on'); els.loginPanel.setAttribute('aria-hidden', 'true');
    if (els.loginPass) els.loginPass.value = '';
  }
  function onConnectClick() { els.loginPanel.classList.contains('on') ? closeLogin() : openLogin(); }

  // Apply a connected session payload to the whole cockpit.
  function onConnected(c) {
    conn = c || {};
    setBadge(conn.env);
    renderAccounts(conn.accounts || []);
    var n = (conn.accounts || []).length;
    setStatus('Connected · ' + (conn.env || '?').toUpperCase() + ' · ' + esc(String(conn.name || conn.userId || '?')) + ' · ' + n + ' account' + (n === 1 ? '' : 's') + (conn.hasLive ? ' · live-enabled' : ''), 'ok');
    els.connectBtn.innerHTML = '&#9679; ' + (conn.env === 'live' ? 'LIVE' : 'Connected');
    refreshBook(); startAutoRefresh();
  }

  function doLogin() {
    if (!(window.__authToken && window.__authToken())) { setLoginMsg('Sign in to the terminal as the operator first.', 'err'); return; }
    var params = {
      env: els.loginEnv.value,
      name: (els.loginUser.value || '').trim(),
      password: els.loginPass.value,
      appId: (els.loginApp.value || '').trim() || undefined,
      cid: (els.loginCid.value || '').trim() || undefined,
      sec: els.loginSec.value || undefined,
    };
    if (!params.name || !params.password) { setLoginMsg('username + password required', 'err'); return; }
    if (params.env === 'live' && !window.confirm('Connect to the LIVE book?\n\nOrders routed here move REAL money. Continue?')) return;
    setLoginMsg('Connecting…'); els.loginGo.disabled = true;
    api('login', params).then(function (res) {
      els.loginGo.disabled = false;
      if (!res.ok) { setLoginMsg((res.data && res.data.error) || ('error ' + res.status), 'err'); return; }
      onConnected(res.data.result || {}); closeLogin();
    }).catch(function (e) { els.loginGo.disabled = false; setLoginMsg(e.message, 'err'); });
  }

  // Silent probe on boot: reuse an existing session token if one is still alive,
  // so a returning operator is connected without re-entering anything.
  function probeSession() {
    if (!(window.__authToken && window.__authToken())) return;
    api('connect').then(function (res) {
      if (res.ok && res.data.result && res.data.result.connected) onConnected(res.data.result);
    }).catch(function () {});
  }

  function renderAccounts(accts) {
    els.acct.innerHTML = accts.length
      ? accts.map(function (a) { return '<option value="' + a.id + '" data-spec="' + esc(a.name || '') + '">' + esc(a.nickname || a.name || ('#' + a.id)) + '</option>'; }).join('')
      : '<option value="">no accounts</option>';
    updateBalance();
  }
  function selectedAccount() {
    if (!conn || !conn.accounts) return null;
    var id = num(els.acct.value);
    return conn.accounts.filter(function (a) { return a.id === id; })[0] || conn.accounts[0] || null;
  }
  function updateBalance() { var a = selectedAccount(); els.balance.textContent = a && a.balance != null ? money(a.balance) : '—'; }

  /* ── order ticket ───────────────────────────────────────────────────────── */
  function readTicket() {
    var a = selectedAccount();
    var type = els.type.value;
    var t = {
      accountId: a ? a.id : null,
      accountSpec: a ? a.name : null,
      symbol: (els.sym.value || '').trim().toUpperCase(),
      action: els.side.value,
      orderQty: num(els.qty.value),
      orderType: type,
      price: (type === 'Limit' || type === 'StopLimit') ? num(els.price.value) : null,
      stopPrice: (type === 'Stop' || type === 'StopLimit') ? num(els.stopPrice.value) : null,
      timeInForce: els.tif.value,
    };
    if (els.bracket.checked) { t.bracket = true; t.stopLoss = num(els.sl.value); t.takeProfit = num(els.tp.value); }
    return t;
  }
  function validateTicket(t) {
    if (!t.symbol) return 'symbol required';
    if (!(t.orderQty > 0)) return 'quantity must be > 0';
    if ((t.orderType === 'Limit' || t.orderType === 'StopLimit') && t.price == null) return 'limit price required';
    if ((t.orderType === 'Stop' || t.orderType === 'StopLimit') && t.stopPrice == null) return 'stop price required';
    return null;
  }
  function ticketLabel(t) {
    var px = t.orderType === 'Market' ? 'MKT' : (t.orderType === 'Stop' ? '@stop ' + t.stopPrice : '@' + (t.price != null ? t.price : t.stopPrice));
    return t.action.toUpperCase() + ' ' + t.orderQty + ' ' + t.symbol + ' ' + t.orderType + ' ' + px + (t.bracket ? ' [OSO]' : '');
  }

  function syncTypeFields() {
    var type = els.type.value;
    els.priceWrap.style.display = (type === 'Limit' || type === 'StopLimit') ? 'flex' : 'none';
    els.stopWrap.style.display = (type === 'Stop' || type === 'StopLimit') ? 'flex' : 'none';
  }
  function syncBracket() { var on = els.bracket.checked; els.sl.disabled = !on; els.tp.disabled = !on; }

  function stageOrder() {
    var t = readTicket(); var err = validateTicket(t);
    if (err) { setFormMsg(err, 'err'); return; }
    pending.push({ id: uid(), ticket: t, status: 'staged', ts: Date.now() });
    writePending(); renderQueue(); setFormMsg('Staged — dormant until routed.', 'ok');
  }

  // Route a ticket to the broker. onDone(ok, message) reports the result.
  function routeTicket(t, onDone) {
    var err = validateTicket(t);
    if (err) { onDone(false, err); return; }
    if (t.accountId == null) { onDone(false, 'connect + select an account first'); return; }
    var action = t.bracket && (t.stopLoss != null || t.takeProfit != null) ? 'bracket' : 'placeorder';
    var send = function (live) {
      api(action, t, { confirm: true, live: live }).then(function (res) {
        if (res.status === 409 && res.data && /LIVE/.test(res.data.error || '')) {
          if (window.confirm('⚠ The runtime is on the LIVE book — this routes REAL money.\n\n' + ticketLabel(t) + '\n\nProceed?')) { send(true); }
          else { onDone(false, 'cancelled (live)'); }
          return;
        }
        if (!res.ok) { onDone(false, (res.data && res.data.error) || ('error ' + res.status)); return; }
        var r = res.data.result || {};
        onDone(true, 'routed · order ' + (r.orderId || r.orderid || '?'), r);
      }).catch(function (e) { onDone(false, e.message); });
    };
    send(false);
  }

  function routeNow() {
    var t = readTicket();
    setFormMsg('Routing…'); els.routeBtn.disabled = true;
    routeTicket(t, function (ok, msg) {
      els.routeBtn.disabled = false;
      setFormMsg((ok ? '✓ ' : '✗ ') + msg, ok ? 'ok' : 'err');
      if (ok) refreshBook();
    });
  }

  function renderQueue() {
    if (!els.queue) return;
    if (!pending.length) { els.queue.innerHTML = '<div class="exEmpty">No pending orders staged.</div>'; return; }
    els.queue.innerHTML = pending.map(function (p) {
      var t = p.ticket, sideCls = t.action.toLowerCase() === 'buy' ? 'buy' : 'sell';
      return '<div class="exOrder" data-id="' + p.id + '">' +
        '<span class="exOrderSide ' + sideCls + '">' + esc(t.action.toUpperCase()) + '</span>' +
        '<span class="exOrderMeta">' + esc(ticketLabel(t)) + '</span>' +
        '<span class="exOrderState ' + esc(p.status) + '">' + esc(p.status) + '</span>' +
        '<button class="exMini" data-act="route" data-id="' + p.id + '">Route</button>' +
        '<button class="exMini" data-act="remove" data-id="' + p.id + '">✕</button>' +
        '</div>';
    }).join('');
  }

  function onQueueClick(e) {
    var btn = e.target.closest('[data-act]'); if (!btn) return;
    var id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act');
    var idx = pending.map(function (p) { return p.id; }).indexOf(id); if (idx < 0) return;
    if (act === 'remove') { pending.splice(idx, 1); writePending(); renderQueue(); return; }
    if (act === 'route') {
      var p = pending[idx]; p.status = 'routing'; renderQueue();
      routeTicket(p.ticket, function (ok, msg, r) {
        p.status = ok ? 'sent' : 'rejected'; if (ok && r) p.orderId = r.orderId;
        p.note = msg; writePending(); renderQueue();
        if (ok) refreshBook();
      });
    }
  }

  /* ── live book + risk field ─────────────────────────────────────────────── */
  function refreshBook() {
    if (!conn) { setStatus('Connect first.', 'err'); return; }
    api('book').then(function (res) {
      if (!res.ok) { els.monSub.textContent = 'book error'; return; }
      var b = res.data.result || {};
      renderBook(b);
    }).catch(function () {});
  }

  function renderBook(b) {
    var orders = b.orders || [], positions = b.positions || [], fills = b.fills || [];
    els.monSub.textContent = new Date().toLocaleTimeString();
    // Working orders
    var working = orders.filter(function (o) { return /working|pending|new|accepted/i.test(o.ordStatus || o.status || ''); });
    els.orders.innerHTML = orders.length
      ? orders.slice(-12).reverse().map(function (o) {
          var st = String(o.ordStatus || o.status || '?');
          var stCls = /fill/i.test(st) ? 'filled' : (/reject|cancel/i.test(st) ? 'rejected' : 'working');
          return '<div class="exRow"><span class="exOrderMeta">' + esc(String(o.symbol || o.contractId || '')) + ' · #' + esc(String(o.id || o.orderId || '')) + '</span><span class="exOrderState ' + stCls + '">' + esc(st) + '</span></div>';
        }).join('')
      : '<div class="exEmpty">— none —</div>';
    // Positions
    var netQty = 0, openPl = 0, plKnown = false;
    els.positions.innerHTML = positions.length
      ? positions.map(function (p) {
          var q = num(p.netPos != null ? p.netPos : p.netpos) || 0; netQty += q;
          if (p.openPl != null || p.unrealizedPl != null) { plKnown = true; openPl += num(p.openPl != null ? p.openPl : p.unrealizedPl) || 0; }
          var sideCls = q > 0 ? 'buy' : (q < 0 ? 'sell' : '');
          return '<div class="exRow"><span class="exOrderSide ' + sideCls + '">' + (q > 0 ? 'LONG' : q < 0 ? 'SHORT' : 'FLAT') + '</span><span class="exOrderMeta">' + esc(String(p.symbol || p.contractId || '')) + ' × ' + Math.abs(q) + '</span></div>';
        }).join('')
      : '<div class="exEmpty">— flat —</div>';
    // Fills
    els.fills.innerHTML = fills.length
      ? fills.slice(-10).reverse().map(function (f) {
          var sideCls = /buy/i.test(f.action || '') ? 'buy' : 'sell';
          return '<div class="exRow"><span class="exOrderSide ' + sideCls + '">' + esc(String(f.action || '')) + '</span><span class="exOrderMeta">' + esc(String(f.symbol || f.contractId || '')) + ' × ' + esc(String(f.qty != null ? f.qty : '')) + ' @ ' + esc(String(f.price != null ? f.price : '')) + '</span></div>';
        }).join('')
      : '<div class="exEmpty">— none —</div>';
    // Risk field rollup
    els.rkPos.textContent = String(positions.length);
    els.rkOrd.textContent = String(working.length || orders.length);
    els.rkNet.textContent = (netQty > 0 ? '+' : '') + netQty;
    if (plKnown) { els.rkOpl.textContent = money(openPl); els.rkOpl.className = 'exRiskV ' + (openPl > 0 ? 'pos' : openPl < 0 ? 'neg' : ''); }
    else { els.rkOpl.textContent = '—'; els.rkOpl.className = 'exRiskV'; }
  }

  function startAutoRefresh() { stopAutoRefresh(); refreshTimer = setInterval(function () { if (els.sec && els.sec.classList.contains('on') && conn) refreshBook(); }, 6000); }
  function stopAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }

  /* ── boot ───────────────────────────────────────────────────────────────── */
  window.__execBoot = function () {
    if (booted) return; booted = true;
    els = {
      sec: $('tabExec'), badge: $('exEnvBadge'), acct: $('exAcct'), balance: $('exBalance'),
      connectBtn: $('exConnectBtn'), refreshBtn: $('exRefreshBtn'), status: $('exStatus'),
      connWrap: $('exConnWrap'), loginPanel: $('exLoginPanel'), loginEnv: $('exLoginEnv'),
      loginUser: $('exLoginUser'), loginPass: $('exLoginPass'), loginApp: $('exLoginApp'),
      loginCid: $('exLoginCid'), loginSec: $('exLoginSec'), loginGo: $('exLoginGo'),
      loginCancel: $('exLoginCancel'), loginMsg: $('exLoginMsg'),
      sym: $('exSym'), side: $('exSide'), qty: $('exQty'), type: $('exType'),
      price: $('exPrice'), priceWrap: $('exPriceWrap'), stopPrice: $('exStopPrice'), stopWrap: $('exStopWrap'),
      tif: $('exTif'), bracket: $('exBracket'), sl: $('exSL'), tp: $('exTP'),
      stageBtn: $('exStageBtn'), routeBtn: $('exRouteBtn'), formMsg: $('exFormMsg'), queue: $('exQueue'),
      monSub: $('exMonSub'), orders: $('exOrders'), positions: $('exPositions'), fills: $('exFills'),
      rkPos: $('exRkPos'), rkOrd: $('exRkOrd'), rkOpl: $('exRkOpl'), rkNet: $('exRkNet'),
    };
    if (!els.connectBtn) return;
    els.connectBtn.addEventListener('click', onConnectClick);
    els.loginGo.addEventListener('click', doLogin);
    els.loginCancel.addEventListener('click', closeLogin);
    els.loginPass.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    // Close the popover on an outside click.
    document.addEventListener('click', function (e) {
      if (els.loginPanel.classList.contains('on') && els.connWrap && !els.connWrap.contains(e.target)) closeLogin();
    });
    els.refreshBtn.addEventListener('click', refreshBook);
    els.acct.addEventListener('change', updateBalance);
    els.type.addEventListener('change', syncTypeFields);
    els.bracket.addEventListener('change', syncBracket);
    els.stageBtn.addEventListener('click', stageOrder);
    els.routeBtn.addEventListener('click', routeNow);
    els.queue.addEventListener('click', onQueueClick);
    // Seed the symbol from the terminal's active instrument, if present.
    var inst = ($('instA') || {}).value; if (inst && !els.sym.value) els.sym.value = inst;
    pending = readPending();
    syncTypeFields(); syncBracket(); renderQueue();
    probeSession(); // reuse a live session token, if any
  };
})();
