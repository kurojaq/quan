/* execution.js — EXECUTION cockpit (front-end half of the Execution Engine).
 *
 * The Execution Engine materializes analytical intent under bounded risk. This
 * module is the mission-control surface; it holds NO broker credentials. Every
 * broker action is a small { action, params } envelope POSTed to /api/execution,
 * which forwards it (operator-gated) to the route-less runtime Worker
 * (workers/execution.js) that talks to Tradovate.
 *
 * Phase 3a — connection core + immediate order path.
 * Phase 3b — the launch queue is SERVER-SIDE: staged orders live in the runtime's
 *   Durable Object and its alarm() loop fires them when their activation
 *   conditions qualify, even with the browser closed. This cockpit stages/arms
 *   orders, pushes the terminal's analysis snapshot for condition evaluation, and
 *   renders the launch queue's live lifecycle.
 *
 * Lazy-booted once via window.__execBoot() the first time the tab is opened.
 */
(function () {
  var els = {}, booted = false, conn = null, refreshTimer = null, conds = [];

  /* ── helpers ────────────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { if (v == null || v === '') return null; v = Number(v); return isFinite(v) ? v : null; }
  function money(v) { v = num(v); if (v == null) return '—'; var neg = v < 0, a = Math.abs(v); return (neg ? '−$' : '$') + a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function authHeaders() { var t = window.__authToken && window.__authToken(); var h = { 'Content-Type': 'application/json' }; if (t) h.Authorization = 'Bearer ' + t; return h; }

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
  function closeLogin() { if (!els.loginPanel) return; els.loginPanel.classList.remove('on'); els.loginPanel.setAttribute('aria-hidden', 'true'); if (els.loginPass) els.loginPass.value = ''; }
  function onConnectClick() { els.loginPanel.classList.contains('on') ? closeLogin() : openLogin(); }

  function onConnected(c) {
    conn = c || {};
    setBadge(conn.env);
    renderAccounts(conn.accounts || []);
    var n = (conn.accounts || []).length;
    setStatus('Connected · ' + (conn.env || '?').toUpperCase() + ' · ' + esc(String(conn.name || conn.userId || '?')) + ' · ' + n + ' account' + (n === 1 ? '' : 's') + (conn.hasLive ? ' · live-enabled' : ''), 'ok');
    els.connectBtn.innerHTML = '&#9679; ' + (conn.env === 'live' ? 'LIVE' : 'Connected');
    refreshBook(); refreshPending(); pushState(); startAutoRefresh();
  }

  function doLogin() {
    if (!(window.__authToken && window.__authToken())) { setLoginMsg('Sign in to the terminal as the operator first.', 'err'); return; }
    var params = { env: els.loginEnv.value, name: (els.loginUser.value || '').trim(), password: els.loginPass.value, appId: (els.loginApp.value || '').trim() || undefined, cid: (els.loginCid.value || '').trim() || undefined, sec: els.loginSec.value || undefined };
    if (!params.name || !params.password) { setLoginMsg('username + password required', 'err'); return; }
    if (params.env === 'live' && !window.confirm('Connect to the LIVE book?\n\nOrders routed here move REAL money. Continue?')) return;
    setLoginMsg('Connecting…'); els.loginGo.disabled = true;
    api('login', params).then(function (res) {
      els.loginGo.disabled = false;
      if (!res.ok) { setLoginMsg((res.data && res.data.error) || ('error ' + res.status), 'err'); return; }
      onConnected(res.data.result || {}); closeLogin();
    }).catch(function (e) { els.loginGo.disabled = false; setLoginMsg(e.message, 'err'); });
  }

  function probeSession() {
    if (!(window.__authToken && window.__authToken())) return;
    api('connect').then(function (res) { if (res.ok && res.data.result && res.data.result.connected) onConnected(res.data.result); }).catch(function () {});
  }

  function renderAccounts(accts) {
    els.acct.innerHTML = accts.length
      ? accts.map(function (a) { return '<option value="' + a.id + '">' + esc(a.nickname || a.name || ('#' + a.id)) + '</option>'; }).join('')
      : '<option value="">no accounts</option>';
    updateBalance();
  }
  function selectedAccount() { if (!conn || !conn.accounts) return null; var id = num(els.acct.value); return conn.accounts.filter(function (a) { return a.id === id; })[0] || conn.accounts[0] || null; }
  function updateBalance() { var a = selectedAccount(); els.balance.textContent = a && a.balance != null ? money(a.balance) : '—'; }

  /* ── order ticket ───────────────────────────────────────────────────────── */
  function readTicket() {
    var a = selectedAccount(), type = els.type.value;
    var t = {
      accountId: a ? a.id : null, accountSpec: a ? a.name : null,
      symbol: (els.sym.value || '').trim().toUpperCase(), action: els.side.value, orderQty: num(els.qty.value), orderType: type,
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
    return String(t.action).toUpperCase() + ' ' + t.orderQty + ' ' + t.symbol + ' ' + t.orderType + ' ' + px + (t.bracket ? ' [OSO]' : '');
  }
  function syncTypeFields() {
    var type = els.type.value;
    els.priceWrap.style.display = (type === 'Limit' || type === 'StopLimit') ? 'flex' : 'none';
    els.stopWrap.style.display = (type === 'Stop' || type === 'StopLimit') ? 'flex' : 'none';
  }
  function syncBracket() { var on = els.bracket.checked; els.sl.disabled = !on; els.tp.disabled = !on; }

  /* ── activation-condition builder ───────────────────────────────────────── */
  var COND_LABELS = { clockAfter: 'clock ≥', clockBefore: 'clock ≤', sessionAbove: 'session ≥', sessionBelow: 'session ≤', priceAbove: 'price ≥', priceBelow: 'price ≤', priceInside: 'price ∈', detectorIs: 'detector ∋' };
  function condLabel(c) { return (COND_LABELS[c.type] || c.type) + ' ' + (Array.isArray(c.value) ? c.value.join('–') : c.value); }
  function syncCondInputs() { els.condVal2.style.display = els.condType.value === 'priceInside' ? '' : 'none'; }
  function addCond() {
    var type = els.condType.value, v1 = (els.condVal.value || '').trim(), v2 = (els.condVal2.value || '').trim(), value;
    if (!v1) { setFormMsg('condition value required', 'err'); return; }
    if (type === 'priceInside') { if (!v2) { setFormMsg('band needs a high value', 'err'); return; } value = [Number(v1), Number(v2)]; }
    else if (type === 'clockAfter' || type === 'clockBefore') { if (!/^\d{1,2}:\d{2}$/.test(v1)) { setFormMsg('clock needs HH:MM (ET)', 'err'); return; } value = v1; }
    else if (type === 'detectorIs') { value = v1; }
    else { value = Number(v1); if (!isFinite(value)) { setFormMsg('numeric value required', 'err'); return; } }
    conds.push({ type: type, value: value });
    els.condVal.value = ''; els.condVal2.value = ''; setFormMsg('');
    renderConds();
  }
  function renderConds() {
    els.condList.innerHTML = conds.length ? conds.map(function (c, i) {
      return '<div class="exCondItem"><span class="exCondText">' + esc(condLabel(c)) + '</span><button class="exMini" data-ci="' + i + '" type="button">✕</button></div>';
    }).join('') : '';
  }
  function onCondListClick(e) { var b = e.target.closest('[data-ci]'); if (!b) return; conds.splice(Number(b.getAttribute('data-ci')), 1); renderConds(); }

  /* ── stage / arm (server-side launch queue) ─────────────────────────────── */
  // Wrap a runtime write with the live-book acknowledgement handshake.
  function writeWithLiveGate(action, params, onOk, onErr) {
    var send = function (live) {
      api(action, params, { confirm: true, live: live }).then(function (res) {
        if (res.status === 409 && res.data && /LIVE/.test(res.data.error || '')) {
          if (window.confirm('⚠ The runtime is on the LIVE book — this can route REAL money.\n\nProceed?')) send(true);
          else onErr('cancelled (live)');
          return;
        }
        if (!res.ok) { onErr((res.data && res.data.error) || ('error ' + res.status)); return; }
        onOk(res.data.result || {});
      }).catch(function (e) { onErr(e.message); });
    };
    send(false);
  }

  function stageOrder(armed) {
    var t = readTicket(), err = validateTicket(t);
    if (err) { setFormMsg(err, 'err'); return; }
    if (t.accountId == null) { setFormMsg('connect + select an account first', 'err'); return; }
    var params = { ticket: t, conditions: conds.slice(), quoteSymbol: (els.quoteSym.value || '').trim() || null, armed: !!armed };
    setFormMsg(armed ? 'Arming…' : 'Staging…');
    writeWithLiveGate('stage', params,
      function () { setFormMsg(armed ? '✓ armed — server routes it when conditions qualify' : '✓ staged (dormant)', 'ok'); conds = []; renderConds(); refreshPending(); },
      function (m) { setFormMsg('✗ ' + m, 'err'); });
  }

  // Route a ticket to the broker immediately (bypasses the launch queue).
  function routeNow() {
    var t = readTicket(), err = validateTicket(t);
    if (err) { setFormMsg(err, 'err'); return; }
    if (t.accountId == null) { setFormMsg('connect + select an account first', 'err'); return; }
    var action = t.bracket && (t.stopLoss != null || t.takeProfit != null) ? 'bracket' : 'placeorder';
    setFormMsg('Routing…'); els.routeBtn.disabled = true;
    writeWithLiveGate(action, t,
      function (r) { els.routeBtn.disabled = false; setFormMsg('✓ routed · order ' + (r.orderId || '?'), 'ok'); refreshBook(); },
      function (m) { els.routeBtn.disabled = false; setFormMsg('✗ ' + m, 'err'); });
  }

  /* ── launch queue (server pending) ──────────────────────────────────────── */
  function refreshPending() {
    if (!conn) return;
    api('listPending').then(function (res) { if (res.ok && res.data.result) renderPending(res.data.result); }).catch(function () {});
  }
  function renderPending(state) {
    var pend = (state && state.pending) || [];
    if (!pend.length) { els.queue.innerHTML = '<div class="exEmpty">No orders in the launch queue.</div>'; return; }
    els.queue.innerHTML = pend.slice().reverse().map(function (o) {
      var t = o.ticket || {}, sideCls = String(t.action).toLowerCase() === 'buy' ? 'buy' : 'sell';
      var condTxt = (o.conditions && o.conditions.length) ? o.conditions.map(condLabel).join(' · ') : (o.armed ? 'no conditions — fires on next tick' : '—');
      var terminal = /^(filled|rejected|cancelled)$/.test(o.status);
      var btns = '';
      if (!terminal) {
        btns += o.armed
          ? '<button class="exMini" data-act="disarm" data-id="' + o.id + '" type="button">Disarm</button>'
          : '<button class="exMini" data-act="arm" data-id="' + o.id + '" type="button">Arm ◎</button>';
        btns += '<button class="exMini" data-act="cancel" data-id="' + o.id + '" type="button">✕</button>';
      }
      return '<div class="exOrder">' +
        '<span class="exOrderSide ' + sideCls + '">' + esc(String(t.action).toUpperCase()) + '</span>' +
        '<span class="exOrderMeta">' + esc(ticketLabel(t)) + '</span>' +
        '<span class="exOrderState ' + esc(o.status) + '">' + esc(o.status) + (o.armed && !terminal ? ' ◎' : '') + '</span>' +
        btns +
        '<div class="exOrderConds">' + esc(condTxt) + (o.note ? ' — ' + esc(o.note) : '') + '</div>' +
        '</div>';
    }).join('');
  }
  function onQueueClick(e) {
    var btn = e.target.closest('[data-act]'); if (!btn) return;
    var id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act');
    if (act === 'cancel') { api('cancelPending', { id: id }).then(refreshPending).catch(function () {}); return; }
    if (act === 'disarm') { api('disarm', { id: id }).then(refreshPending).catch(function () {}); return; }
    if (act === 'arm') { writeWithLiveGate('arm', { id: id }, function () { refreshPending(); }, function (m) { setFormMsg('✗ ' + m, 'err'); }); }
  }

  /* ── push the terminal's analysis snapshot for headless condition eval ──── */
  function collectSnapshot() {
    var inst = (($('instA') || {}).value) || '';
    var date = (window.__sessionDateNow && window.__sessionDateNow()) || (($('dayDate') || {}).value) || '';
    var sessionT = null; try { if (window.__sessionT) sessionT = Number(window.__sessionT()); } catch (_) {}
    var detector = null;
    try { var d = window.__reportData ? window.__reportData(inst, date) : null; var raw = d && d.__raw; if (raw) detector = { direction: raw.direction, bias: raw.bias, action: raw.action, tier: raw.tier }; } catch (_) {}
    var price = num(($('gAnchor') || {}).value);
    return { sessionT: sessionT, date: date, detector: detector, price: price };
  }
  function pushState() { if (!conn) return; api('pushState', collectSnapshot()).catch(function () {}); }

  /* ── live book + risk field ─────────────────────────────────────────────── */
  function refreshBook() {
    if (!conn) { setStatus('Connect first.', 'err'); return; }
    api('book').then(function (res) { if (!res.ok) { els.monSub.textContent = 'book error'; return; } renderBook(res.data.result || {}); }).catch(function () {});
  }
  function renderBook(b) {
    var orders = b.orders || [], positions = b.positions || [], fills = b.fills || [];
    els.monSub.textContent = new Date().toLocaleTimeString();
    var working = orders.filter(function (o) { return /working|pending|new|accepted/i.test(o.ordStatus || o.status || ''); });
    els.orders.innerHTML = orders.length
      ? orders.slice(-12).reverse().map(function (o) {
          var st = String(o.ordStatus || o.status || '?');
          var stCls = /fill/i.test(st) ? 'filled' : (/reject|cancel/i.test(st) ? 'rejected' : 'working');
          return '<div class="exRow"><span class="exOrderMeta">' + esc(String(o.symbol || o.contractId || '')) + ' · #' + esc(String(o.id || o.orderId || '')) + '</span><span class="exOrderState ' + stCls + '">' + esc(st) + '</span></div>';
        }).join('')
      : '<div class="exEmpty">— none —</div>';
    var netQty = 0, openPl = 0, plKnown = false;
    els.positions.innerHTML = positions.length
      ? positions.map(function (p) {
          var q = num(p.netPos != null ? p.netPos : p.netpos) || 0; netQty += q;
          if (p.openPl != null || p.unrealizedPl != null) { plKnown = true; openPl += num(p.openPl != null ? p.openPl : p.unrealizedPl) || 0; }
          var sideCls = q > 0 ? 'buy' : (q < 0 ? 'sell' : '');
          return '<div class="exRow"><span class="exOrderSide ' + sideCls + '">' + (q > 0 ? 'LONG' : q < 0 ? 'SHORT' : 'FLAT') + '</span><span class="exOrderMeta">' + esc(String(p.symbol || p.contractId || '')) + ' × ' + Math.abs(q) + '</span></div>';
        }).join('')
      : '<div class="exEmpty">— flat —</div>';
    els.fills.innerHTML = fills.length
      ? fills.slice(-10).reverse().map(function (f) {
          var sideCls = /buy/i.test(f.action || '') ? 'buy' : 'sell';
          return '<div class="exRow"><span class="exOrderSide ' + sideCls + '">' + esc(String(f.action || '')) + '</span><span class="exOrderMeta">' + esc(String(f.symbol || f.contractId || '')) + ' × ' + esc(String(f.qty != null ? f.qty : '')) + ' @ ' + esc(String(f.price != null ? f.price : '')) + '</span></div>';
        }).join('')
      : '<div class="exEmpty">— none —</div>';
    els.rkPos.textContent = String(positions.length);
    els.rkOrd.textContent = String(working.length || orders.length);
    els.rkNet.textContent = (netQty > 0 ? '+' : '') + netQty;
    if (plKnown) { els.rkOpl.textContent = money(openPl); els.rkOpl.className = 'exRiskV ' + (openPl > 0 ? 'pos' : openPl < 0 ? 'neg' : ''); }
    else { els.rkOpl.textContent = '—'; els.rkOpl.className = 'exRiskV'; }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(function () {
      if (!conn) return;
      if (els.sec && els.sec.classList.contains('on')) { refreshBook(); refreshPending(); }
      pushState(); // keep the DO's snapshot fresh even when the tab isn't focused
    }, 6000);
  }
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
      condType: $('exCondType'), condVal: $('exCondVal'), condVal2: $('exCondVal2'), condAdd: $('exCondAdd'),
      condList: $('exCondList'), quoteSym: $('exQuoteSym'),
      stageBtn: $('exStageBtn'), armBtn: $('exArmBtn'), routeBtn: $('exRouteBtn'), formMsg: $('exFormMsg'), queue: $('exQueue'),
      monSub: $('exMonSub'), orders: $('exOrders'), positions: $('exPositions'), fills: $('exFills'),
      rkPos: $('exRkPos'), rkOrd: $('exRkOrd'), rkOpl: $('exRkOpl'), rkNet: $('exRkNet'),
    };
    if (!els.connectBtn) return;
    els.connectBtn.addEventListener('click', onConnectClick);
    els.loginGo.addEventListener('click', doLogin);
    els.loginCancel.addEventListener('click', closeLogin);
    els.loginPass.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    document.addEventListener('click', function (e) { if (els.loginPanel.classList.contains('on') && els.connWrap && !els.connWrap.contains(e.target)) closeLogin(); });
    els.refreshBtn.addEventListener('click', function () { refreshBook(); refreshPending(); });
    els.acct.addEventListener('change', updateBalance);
    els.type.addEventListener('change', syncTypeFields);
    els.bracket.addEventListener('change', syncBracket);
    els.condType.addEventListener('change', syncCondInputs);
    els.condAdd.addEventListener('click', addCond);
    els.condList.addEventListener('click', onCondListClick);
    els.stageBtn.addEventListener('click', function () { stageOrder(false); });
    els.armBtn.addEventListener('click', function () { stageOrder(true); });
    els.routeBtn.addEventListener('click', routeNow);
    els.queue.addEventListener('click', onQueueClick);
    var inst = ($('instA') || {}).value; if (inst && !els.sym.value) els.sym.value = inst;
    syncTypeFields(); syncBracket(); syncCondInputs(); renderConds();
    probeSession();
  };
})();
