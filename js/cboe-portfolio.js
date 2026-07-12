/* ==========================================================================
   cboe-portfolio.js — CBOE portfolio / risk board.

   The Python engines (engine quan_cboe.py) run OFFLINE, so this is a faithful
   in-browser port of the premium-free P-C branch of the golden reference:
   ingest_cboe → apex_basis → per_strike_block(observable) → compute_levels. One
   row per uploaded CBOE ticker (NDX, SPX, RUT, equities…), sortable, with a
   drill-down into the full P-C surface. Built for indexing/risk-ranking 1000s of
   tickers, on the CBOE RTH clock (js/exchange.js).

   No premium: CBOE quotedata has none, so Net-OI walls, PCR, LR watermarks and
   the observable scorecard (all OI+Volume) are the read. Bias/intent cascade is
   intentionally absent (see quan_cboe.py header).
   ========================================================================== */
(function (root) {
  "use strict";

  var LS_KEY = "quan:cboe:portfolio";
  var PORT = {};          // symbol -> summary row (+ compact drill payload)
  var CHAINS = {};        // symbol -> { meta, expiration, rows[] } — full Golden-Reference chain
  var ACTIVE = null;      // active CBOE ticker symbol (feeds the instrument selector + tabs)
  var LS_CHAINS = "quan:cboe:chains", LS_ACTIVE = "quan:cboe:active";
  var sortKey = "pcrOI", sortDir = -1;
  var mounted = false, host = null;

  // ---- CSV + numeric helpers -------------------------------------------------
  function parseLine(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) { var c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ""; } else cur += c; }
    out.push(cur); return out;
  }
  function num(s) {
    if (s == null) return NaN;
    var t = String(s).replace(/,/g, "").trim();
    if (t === "" || /^n\/?a$/i.test(t)) return NaN;
    var v = parseFloat(t); return isFinite(v) ? v : NaN;
  }
  function div(a, b) { return (b !== 0 && isFinite(a) && isFinite(b)) ? a / b : NaN; }

  var MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  function expKey(e) {
    var m = /[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/.exec(String(e).trim());
    if (!m) return 99999999;
    return (+m[3]) * 10000 + (MONTHS[m[1]] || 99) * 100 + (+m[2]);
  }

  // Positional columns in the CBOE quotedata table (see quan_cboe.py _COL).
  var C = { exp:0, callLast:2, callVol:6, callIV:7, callDelta:8, callGamma:9, callOI:10,
            strike:11, putLast:13, putVol:17, putIV:18, putDelta:19, putGamma:20, putOI:21 };

  // ---- latent premium reconstruction: E = (K/S)^2 * IV * sqrt(tau) ----------
  // Premium is not missing on CBOE, it is latent. Reconstruct it from strike,
  // spot, per-side IV and time so the FULL cascade (DID/DIT/DR3/CDS) runs — the
  // same read CME gets from observed premium. (Port of quan_cboe.energy.)
  var YEAR_S = 365.25 * 86400, TAU_FLOOR = 3600;
  function tauYears(exp, asofMs) {
    var m = /[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/.exec(String(exp).trim());
    if (!m) return TAU_FLOOR / YEAR_S;
    var expMs = Date.UTC(+m[3], (MONTHS[m[1]]||1)-1, +m[2], 20, 0, 0); // ~16:00 ET settle
    var ref = isFinite(asofMs) ? asofMs : Date.now();
    return Math.max((expMs - ref) / 1000, TAU_FLOOR) / YEAR_S;
  }
  function energy(K, S, iv, tau) {
    if (!(S > 0) || !isFinite(iv) || !isFinite(tau)) return NaN;
    var m = K / S; return m * m * iv * Math.sqrt(tau);
  }

  // ---- ingest (port of ingest_cboe, premium="energy") -----------------------
  function ingest(text, expiration) {
    var lines = String(text).replace(/\r\n/g, "\n").split("\n");
    // meta from lines 2-3 (index 1-2)
    var meta = { symbol: "", spot: NaN, asof: "" };
    if (lines[1]) {
      meta.symbol = parseLine(lines[1])[0].trim();
      var mL = /Last:\s*([-\d.]+)/.exec(lines[1]); if (mL) meta.spot = +mL[1];
    }
    var asofMs = NaN;
    if (lines[2]) { var mD = /Date:\s*(.+?)"/.exec(lines[2]);   // capture full quoted "July 11, 2026 at 12:46 AM EDT"
      if (mD) { meta.asof = mD[1].replace(/"/g, "").trim(); var t = Date.parse(meta.asof.replace(/\s+at\s+/, " ").replace(/\s+[A-Z]{2,4}$/, "")); if (isFinite(t)) asofMs = t; } }

    var rows = [], expsSet = {};
    for (var r = 4; r < lines.length; r++) {
      if (!lines[r]) continue;
      var f = parseLine(lines[r]);
      var strike = num(f[C.strike]); if (!isFinite(strike)) continue;
      var exp = (f[C.exp] || "").trim(); if (exp) expsSet[exp] = 1;
      var tau = tauYears(exp, asofMs), cIV = num(f[C.callIV]), pIV = num(f[C.putIV]);
      rows.push({ exp: exp, strike: strike,
        callOI: num(f[C.callOI]), putOI: num(f[C.putOI]),
        callVol: num(f[C.callVol]), putVol: num(f[C.putVol]),
        callLast: num(f[C.callLast]), putLast: num(f[C.putLast]),
        callIV: cIV, putIV: pIV, tau: tau,
        callDelta: num(f[C.callDelta]), putDelta: num(f[C.putDelta]),
        callGamma: num(f[C.callGamma]), putGamma: num(f[C.putGamma]),
        callPrem: energy(strike, meta.spot, cIV, tau),   // reconstructed latent premium
        putPrem:  energy(strike, meta.spot, pIV, tau) });
    }
    var exps = Object.keys(expsSet).sort(function (a, b) { return expKey(a) - expKey(b); });
    var pick = expiration || (exps[0] || null);
    var sel = rows;
    if (pick && pick !== "ALL") sel = rows.filter(function (x) { return x.exp === pick; });
    sel.sort(function (a, b) { return a.strike - b.strike; });
    return { meta: meta, expirations: exps, expiration: pick, rows: sel };
  }

  // ---- cascade (port of quan_engine.compute_cascade) on reconstructed premium -
  function cascade(rows) {
    var AP = [], AR = [], AT = [];
    rows.forEach(function (x) {
      var AN = (x.putPrem || 0) - (x.callPrem || 0);
      var O = (x.putOI || 0) - (x.callOI || 0), L = (x.putVol || 0) - (x.callVol || 0);
      var ap = O !== 0 ? AN / O : NaN, ar = L !== 0 ? AN / L : NaN;
      AP.push(ap); AR.push(ar); AT.push((ar && isFinite(ar)) ? ap / ar : NaN);
    });
    var DIDS = skew(AP), DITS = skew(AR), DR3S = skew(AT);
    var DIDK = kurt(AP), DITK = kurt(AR), DR3K = kurt(AT);
    var cds = ((DIDS < 0 ? 1 : -1) + (DITS < 0 ? 1 : -1) + (DR3S > 0 ? 1 : -1)) / 3;
    var bias = cds >= 0.67 ? "STRONG_BULL" : cds > 0 ? "BULL" : cds === 0 ? "NEUTRAL"
             : cds >= -0.67 ? "BEAR" : "STRONG_BEAR";
    return { CDS: +cds.toFixed(3), BIAS: bias,
             DIDS: DIDS, DITS: DITS, DR3S: DR3S, DIDK: DIDK, DITK: DITK, DR3K: DR3K };
  }

  // ---- Excel sample skew/kurt (blank-excluding) ------------------------------
  function clean(v) { return v.filter(function (x) { return typeof x === "number" && isFinite(x); }); }
  function skew(vals) { var x = clean(vals), n = x.length; if (n < 3) return NaN;
    var m = x.reduce(function(a,b){return a+b;},0)/n;
    var s = Math.sqrt(x.reduce(function(a,b){return a+(b-m)*(b-m);},0)/(n-1)); if (s === 0) return NaN;
    return n/((n-1)*(n-2))*x.reduce(function(a,b){return a+Math.pow((b-m)/s,3);},0); }
  function kurt(vals) { var x = clean(vals), n = x.length; if (n < 4) return NaN;
    var m = x.reduce(function(a,b){return a+b;},0)/n;
    var s = Math.sqrt(x.reduce(function(a,b){return a+(b-m)*(b-m);},0)/(n-1)); if (s === 0) return NaN;
    var a1 = n*(n+1)/((n-1)*(n-2)*(n-3)), b1 = 3*(n-1)*(n-1)/((n-2)*(n-3));
    return a1*x.reduce(function(a,b){return a+Math.pow((b-m)/s,4);},0) - b1; }

  // ---- per-strike block + observable scan (port of quan_scorecard) -----------
  var OBS = { mass: 2.0, kurt: 4.5, lr: 8.0, absA: 20.0 };
  function perStrike(rows) {
    return rows.map(function (x) {
      var cOI = x.callOI||0, pOI = x.putOI||0, cV = x.callVol||0, pV = x.putVol||0;
      var K = (x.putLast||0)-(x.callLast||0), L = pV-cV, M = div(pOI,cOI), N = div(pV,cV),
          O = pOI-cOI, P = div(O,M), Q = div(L,N), R = div(O,L), S = div(L,O), T = div(P,Q);
      var vec = [L,M,N,O,P,Q,R,S,T], W = kurt(vec), X = skew(vec);
      var Mass = div(W,X);
      var crit = (Math.abs(Mass)>OBS.mass?1:0)+(W>OBS.kurt?1:0)+(Math.abs(T)>OBS.lr?1:0)+(Math.abs(P)>OBS.absA?1:0);
      return { strike:x.strike, netOI:O, M:M, N:N, L:L, LR:div(div(O,M),div(L,N)),
               Mass:Mass, Kurt:W, T:T, P:P, crit:crit, isPDSL:crit===4, isDSC:crit===3 };
    });
  }

  // ---- apex levels (port of compute_levels floors/ceilings/pin/watermarks) ----
  function levels(ps, spot) {
    var band = isFinite(spot) ? spot * 0.06 : Infinity;
    var ab = ps.filter(function (r) { return !isFinite(band) || Math.abs(r.strike - spot) <= band; });
    var floors = ab.filter(function (r){ return r.netOI > 0; });
    var ceils  = ab.filter(function (r){ return r.netOI < 0; });
    function argMax(arr, f){ var best=null,bv=-Infinity; arr.forEach(function(r){var v=f(r); if(v>bv){bv=v;best=r;}}); return best; }
    var SFLOOR = floors.length ? argMax(floors, function(r){return r.netOI;}) : null;
    var SCEIL  = ceils.length  ? argMax(ceils,  function(r){return -r.netOI;}) : null;
    var pin    = ab.length ? argMax(ab, function(r){return Math.abs(r.netOI);}) : null;
    var isWM = function(r){ return isFinite(r.LR) && Math.abs(r.LR) > 20; };
    // nearest defended resistance above / strongest wall below (dealer ceiling/floor)
    var below = ab.filter(function(r){ return r.strike < spot; });
    var aboveWM = ab.filter(function(r){ return r.strike>spot && isWM(r) && r.netOI<0; }).sort(function(a,b){return a.strike-b.strike;});
    var aboveAll = ab.filter(function(r){ return r.strike>spot && r.netOI<0; });
    var DFLOOR = below.length ? argMax(below, function(r){return Math.abs(r.netOI);}) : null;
    var DCEIL  = aboveWM.length ? aboveWM[0] : (aboveAll.length ? argMax(aboveAll, function(r){return -r.netOI;}) : null);
    var cl = ab.filter(function(r){ return r.strike>spot && ((isWM(r)&&r.netOI<0)||r.netOI<=-100); }).sort(function(a,b){return a.strike-b.strike;}).slice(0,6);
    var fl = ab.filter(function(r){ return r.strike<spot && ((isWM(r)&&r.netOI>0)||r.netOI>=100); }).sort(function(a,b){return b.strike-a.strike;}).slice(0,6);
    var wm = ab.filter(isWM).sort(function(a,b){return Math.abs(b.LR)-Math.abs(a.LR);}).slice(0,4);
    return { SFLOOR:SFLOOR, SCEIL:SCEIL, pin:pin, DFLOOR:DFLOOR, DCEIL:DCEIL, cl:cl, fl:fl, wm:wm };
  }

  // ---- summarize a parsed chain into one portfolio row -----------------------
  function summarize(parsed) {
    var rows = parsed.rows, spot = parsed.meta.spot;
    var sumCOI=0,sumPOI=0,sumCV=0,sumPV=0;
    rows.forEach(function(x){ sumCOI+=x.callOI||0; sumPOI+=x.putOI||0; sumCV+=x.callVol||0; sumPV+=x.putVol||0; });
    var ps = perStrike(rows);
    var lv = levels(ps, spot);
    var cx = cascade(rows);          // Dealer Intent cascade on reconstructed premium
    var dsc = ps.filter(function(r){return r.isDSC;}).length, pdsl = ps.filter(function(r){return r.isPDSL;}).length;
    var netTot = sumPOI - sumCOI;
    var support = lv.DFLOOR ? lv.DFLOOR.strike : (lv.SFLOOR?lv.SFLOOR.strike:null);
    var resist  = lv.DCEIL  ? lv.DCEIL.strike  : (lv.SCEIL?lv.SCEIL.strike:null);
    var pin     = lv.pin ? lv.pin.strike : null;
    var drill = {
      cl: lv.cl.map(function(r){return [r.strike,r.netOI,r.LR];}),
      fl: lv.fl.map(function(r){return [r.strike,r.netOI,r.LR];}),
      wm: lv.wm.map(function(r){return [r.strike, r.netOI>0?"F":"C", r.LR];}),
      top: ps.filter(function(r){return r.crit>=3;}).sort(function(a,b){return b.crit-a.crit;}).slice(0,8)
             .map(function(r){return [r.strike, r.crit, +(r.Mass||0).toFixed(2)];})
    };
    return {
      symbol: parsed.meta.symbol || "—",
      spot: isFinite(spot) ? spot : null,
      asof: parsed.meta.asof, expiration: parsed.expiration,
      strikes: rows.length,
      pcrOI: +(div(sumPOI, Math.max(sumCOI,1e-9))).toFixed(3),
      pcrVol: +(div(sumPV, Math.max(sumCV,1e-9))).toFixed(3),
      bias: netTot > 0 ? "PUT-HEAVY" : "CALL-HEAVY",
      cds: cx.CDS, dealerBias: cx.BIAS, dr3s: isFinite(cx.DR3S) ? +cx.DR3S.toFixed(2) : null,
      support: support, resist: resist, pin: pin,
      supDist: (support!=null && isFinite(spot)) ? Math.round(support-spot) : null,
      resDist: (resist!=null && isFinite(spot)) ? Math.round(resist-spot) : null,
      signals: pdsl*10 + dsc, dsc: dsc, pdsl: pdsl,
      ts: Date.now(), drill: drill, cascade: cx
    };
  }

  // ---- persistence -----------------------------------------------------------
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(PORT)); } catch (_) {}
    try { localStorage.setItem(LS_CHAINS, JSON.stringify(CHAINS)); } catch (_) {}   // may exceed quota for 1000s — best-effort
    try { localStorage.setItem(LS_ACTIVE, ACTIVE || ""); } catch (_) {}
  }
  function load() {
    try { PORT = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { PORT = {}; }
    try { CHAINS = JSON.parse(localStorage.getItem(LS_CHAINS)) || {}; } catch (_) { CHAINS = {}; }
    try { ACTIVE = localStorage.getItem(LS_ACTIVE) || null; } catch (_) { ACTIVE = null; }
    if (ACTIVE && !PORT[ACTIVE]) ACTIVE = null;
    if (!ACTIVE) { var k = Object.keys(PORT); ACTIVE = k.length ? k[0] : null; }
  }

  // ---- public adapter API: the active CBOE ticker's Golden Reference chain ----
  function notifyChanged() {
    try { root.dispatchEvent(new CustomEvent("quan:cboe:changed", { detail: { active: ACTIVE, tickers: Object.keys(PORT) } })); } catch (_) {}
  }
  // Emit a CME-vendor-format chain CSV from a CBOE chain, so any consumer written
  // for the CME Golden Reference inherits it unchanged. TWO parsers must both be
  // satisfied: the heatmap's JS display reads POSITIONALLY (cVol=2, cOI=3, cPrem=4,
  // Strike=5, pVol=8, pOI=9, pPrem=10), while the Pyodide engine (quan_engine.
  // ingest_chain) reads BY HEADER NAME (Strike, Premium/.1, Open Int/.1, Volume/.1,
  // Latest/.1). This column order + header names satisfies both; pandas dedupes the
  // repeated call/put names into Name / Name.1.
  function vendorCsv(chain) {
    if (!chain || !chain.rows) return "";
    var out = ["Latest,x,Volume,Open Int,Premium,Strike,x,Latest,Volume,Open Int,Premium"];
    var v = function (n) { return (n == null || !isFinite(n)) ? "" : n; };
    chain.rows.forEach(function (r) {
      out.push([v(r.callLast), "", v(r.callVol), v(r.callOI), v(r.callPrem), r.strike,
                "", v(r.putLast), v(r.putVol), v(r.putOI), v(r.putPrem)].join(","));
    });
    return out.join("\n");
  }
  // greeks CSV: parseGreeks positions cIV=1, cGamma=3, Strike=9, pIV=11, pDelta=12, pGamma=13 (len>=19).
  function greeksCsv(chain) {
    if (!chain || !chain.rows) return "";
    var head = new Array(19).fill("h");
    var out = [head.join(",")];
    var v = function (n) { return (n == null || !isFinite(n)) ? "" : n; };
    chain.rows.forEach(function (r) {
      var c = new Array(19).fill("");
      c[1] = v(r.callIV); c[3] = v(r.callGamma);
      c[9] = r.strike;
      c[11] = v(r.putIV); c[12] = v(r.putDelta); c[13] = v(r.putGamma);
      out.push(c.join(","));
    });
    return out.join("\n");
  }

  root.QuanCboe = {
    list: function () { return Object.keys(PORT); },
    active: function () { return ACTIVE; },
    setActive: function (sym) { if (PORT[sym]) { ACTIVE = sym; save(); syncInstr(); notifyChanged(); feedHeatmapCboe(); } return ACTIVE; },
    summary: function (sym) { return PORT[sym || ACTIVE] || null; },
    chain: function (sym) { return CHAINS[sym || ACTIVE] || null; },   // { meta, expiration, rows[] } for the engine adapter
    vendorCsv: function (sym) { return vendorCsv(CHAINS[sym || ACTIVE]); },
    greeksCsv: function (sym) { return greeksCsv(CHAINS[sym || ACTIVE]); }
  };

  // Feed the active CBOE Golden Reference into the standalone Heat Map iframe —
  // the same postMessage contract the CME path uses (compass.feedHeat), so the
  // Deep Strike surface inherits CBOE with zero engine changes.
  function feedHeatmapCboe(fid) {
    fid = fid || "heatFrame";
    var ch = CHAINS[ACTIVE]; if (!ch) return;
    var fr = document.getElementById(fid); if (!fr || !fr.contentWindow) return;
    var anchor = (ch.meta && isFinite(ch.meta.spot)) ? ch.meta.spot : null;
    var W = fr.contentWindow, sym = ACTIVE;
    // the iframe keys by [inst][date]; its #dayDate is <input type=date> so the
    // date MUST be YYYY-MM-DD, and #instSel needs an <option> for the ticker or
    // instSel.value won't take (loadDate would keep showing the baked CME inst).
    var iso = "";
    var t = Date.parse(((ch.meta && ch.meta.asof) || "").replace(/\s+at\s+/, " ").replace(/\s+[A-Z]{2,4}$/, ""));
    iso = new Date(isFinite(t) ? t : Date.now()).toISOString().slice(0, 10);
    try {
      var doc = fr.contentDocument, sel = doc && doc.getElementById("instSel");
      if (sel && !Array.prototype.some.call(sel.options, function (o) { return o.value === sym; })) {
        var op = doc.createElement("option"); op.value = sym; op.textContent = sym; sel.appendChild(op);
      }
    } catch (_) {}
    try {
      W.postMessage({ type: "quanFeed", kind: "chain", text: vendorCsv(ch), name: sym + ".csv", inst: sym, date: iso, anchor: anchor }, "*");
      W.postMessage({ type: "quanFeed", kind: "greeks", text: greeksCsv(ch), name: sym + "_greeks.csv", inst: sym, date: iso, anchor: anchor }, "*");
      W.postMessage({ type: "quanFeed", kind: "setView", inst: sym, date: iso }, "*");
    } catch (_) {}
    // The iframe renders the grid + engine surface off the uploaded chain, but its
    // header labels (inst/anchor/ATM/expiry) refresh only on its own upload path,
    // so sync them directly to the CBOE ticker (retry to beat the async eng-merge).
    var atm = null, bd = Infinity;
    (ch.rows || []).forEach(function (r) { var d = Math.abs(r.strike - (anchor || 0)); if (d < bd) { bd = d; atm = r.strike; } });
    var applyLabels = function () {
      try {
        var doc = fr.contentDocument; if (!doc) return;
        var set = function (id, val) { var el = doc.getElementById(id); if (el && val != null && val !== "") el.textContent = val; };
        set("m_inst", sym); set("m_anchor", anchor); set("m_atm", atm); set("m_exp", (ch.expiration || "").replace(/^[A-Za-z]{3}\s/, ""));
      } catch (_) {}
    };
    applyLabels(); setTimeout(applyLabels, 500); setTimeout(applyLabels, 1400);
  }
  root.__feedHeatmapCboe = feedHeatmapCboe;
  // the iframe announces readiness with 'quanReady' — (re)feed CBOE when active
  root.addEventListener("message", function (ev) {
    var d = ev && ev.data || {};
    if (d.type === "quanReady" && root.QuanExchange && root.QuanExchange.get() === "CBOE") setTimeout(feedHeatmapCboe, 40);
  });

  // ---- rendering -------------------------------------------------------------
  var COLS = [
    { k:"symbol", t:"Ticker", num:false },
    { k:"spot", t:"Spot", num:true, fmt:function(v){return v==null?"—":v.toLocaleString();} },
    { k:"pcrOI", t:"PCR-OI", num:true },
    { k:"pcrVol", t:"PCR-Vol", num:true },
    { k:"cds", t:"Dealer (CDS)", num:true, fmt:function(v,row){return (v>0?"+":"")+v+" "+(row.dealerBias||"").replace("_"," ");} },
    { k:"bias", t:"Net-OI", num:false },
    { k:"support", t:"Support", num:true, sub:"supDist" },
    { k:"resist", t:"Resist", num:true, sub:"resDist" },
    { k:"pin", t:"Pin (γ)", num:true },
    { k:"signals", t:"Signals", num:true, fmt:function(v,row){return (row.pdsl?row.pdsl+"P ":"")+row.dsc+"D";} },
    { k:"strikes", t:"Strikes", num:true },
    { k:"expiration", t:"Expiry", num:false, fmt:function(v){return (v||"").replace(/^[A-Za-z]{3}\s/,"");} }
  ];

  function rowsSorted() {
    var arr = Object.keys(PORT).map(function(k){return PORT[k];});
    arr.sort(function(a,b){ var x=a[sortKey], y=b[sortKey];
      if (x==null) return 1; if (y==null) return -1;
      if (typeof x==="string") return sortDir*x.localeCompare(y);
      return sortDir*(x-y); });
    return arr;
  }

  function esc(s){ return String(s==null?"":s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];}); }

  function render() {
    if (!host) return;
    var closed = root.QuanExchange ? root.QuanExchange.marketClosed("CBOE") : false;
    var arr = rowsSorted();
    var h = '';
    h += '<div class="cbHead">';
    h += '  <div class="cbTitle"><span class="inf">∞</span> CBOE Portfolio <span class="cbSub">Golden Reference · reconstructed premium · '
       + (closed ? '<b style="color:#e85c5c">RTH CLOSED</b>' : '<b style="color:#5fd08a">RTH OPEN</b>') + '</span></div>';
    h += '  <div class="cbTools">';
    h += '    <label class="cbUp">＋ New ticker<input type="file" id="cbFile" accept=".csv" multiple></label>';
    h += '    <span class="cbCount">' + arr.length + ' ticker' + (arr.length===1?'':'s') + '</span>';
    h += arr.length ? '    <button class="cbClear" id="cbClear" type="button">Clear all</button>' : '';
    h += '  </div>';
    h += '</div>';

    if (!arr.length) {
      h += '<div class="cbEmpty">Upload a CBOE <b>Download CSV</b> (NDX, SPX, RUT, or any listed ticker) to index it.<br>'
         + 'Premium is reconstructed as a latent energy field <b>E=(K/S)²·IV·√τ</b>, so each row carries the full '
         + '<b>Dealer Intent cascade</b> (CDS bias, DR3) plus PCR, Net-OI walls, γ-pin and DSC/PDSL signals — the same Golden Reference as CME.</div>';
    } else {
      h += '<div class="cbTableWrap"><table class="cbTable"><thead><tr>';
      COLS.forEach(function(c){
        var on = c.k===sortKey ? ' cbOn' : '';
        var ar = c.k===sortKey ? (sortDir<0?' ▾':' ▴') : '';
        h += '<th class="'+(c.num?'r':'l')+on+'" data-k="'+c.k+'">'+esc(c.t)+ar+'</th>';
      });
      h += '</tr></thead><tbody>';
      arr.forEach(function(row){
        h += '<tr data-sym="'+esc(row.symbol)+'">';
        COLS.forEach(function(c){
          var v = row[c.k], disp = c.fmt ? c.fmt(v,row) : (v==null?"—":v);
          var cls = c.num ? 'r' : 'l';
          if (c.k==="bias") cls += row.bias==="PUT-HEAVY" ? ' cbPut' : ' cbCall';
          if (c.k==="cds") cls += row.cds>0 ? ' cbPut' : row.cds<0 ? ' cbCall' : '';
          var sub = c.sub && row[c.sub]!=null ? '<span class="cbDist">'+(row[c.sub]>0?"+":"")+row[c.sub]+'</span>' : '';
          h += '<td class="'+cls+'">'+esc(disp)+sub+'</td>';
        });
        h += '</tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="cbDrill" id="cbDrill"></div>';
    }
    host.innerHTML = h;
    wire();
  }

  function drill(sym) {
    var row = PORT[sym]; var box = document.getElementById("cbDrill"); if (!row || !box) return;
    var d = row.drill || {};
    function ladder(list, kind){ return (list||[]).map(function(x){
      var wm = isFinite(x[2]) && Math.abs(x[2])>20 ? ' ★' : '';
      return '<span class="cbRung '+kind+'">'+x[0].toLocaleString()+'<i>'+(x[1]>0?"+":"")+Math.round(x[1])+'</i>'+wm+'</span>';
    }).join(""); }
    var top = (d.top||[]).map(function(x){ return '<span class="cbSig">'+x[0].toLocaleString()+' <i>'+x[1]+'× m'+x[2]+'</i></span>'; }).join("");
    var cx = row.cascade || {};
    var cf = function(v){ return (isFinite(v) ? (v>0?"+":"")+(+v).toFixed(2) : "—"); };
    var intent = '<span class="cbSig">CDS <i>'+cf(cx.CDS)+' '+esc((row.dealerBias||"").replace("_"," "))+'</i></span>'
               + '<span class="cbSig">DR3 skew <i>'+cf(cx.DR3S)+'</i></span>'
               + '<span class="cbSig">DID skew <i>'+cf(cx.DIDS)+'</i></span>'
               + '<span class="cbSig">DIT skew <i>'+cf(cx.DITS)+'</i></span>';
    var h = '<div class="cbDrillHead">'+esc(sym)+' · '+esc(row.expiration||"")+' · spot '+(row.spot!=null?row.spot.toLocaleString():"—")
          + ' · '+esc(row.asof)+'</div>';
    h += '<div class="cbDrillGrid">';
    h += '<div><span class="cbLbl">Dealer Intent (reconstructed premium)</span><div class="cbRungs">'+intent+'</div></div>';
    h += '<div><span class="cbLbl">Resistance ladder (ceilings)</span><div class="cbRungs">'+(ladder(d.cl,"c")||'<i>none in band</i>')+'</div></div>';
    h += '<div><span class="cbLbl">Support ladder (floors)</span><div class="cbRungs">'+(ladder(d.fl,"f")||'<i>none in band</i>')+'</div></div>';
    h += '<div><span class="cbLbl">Watermarks |LR|&gt;20</span><div class="cbRungs">'+((d.wm||[]).map(function(x){return '<span class="cbRung '+(x[1]==="F"?"f":"c")+'">'+x[0].toLocaleString()+' '+x[1]+'</span>';}).join("")||'<i>none</i>')+'</div></div>';
    h += '<div><span class="cbLbl">Top signals (DSC/PDSL)</span><div class="cbRungs">'+(top||'<i>none ≥3 criteria</i>')+'</div></div>';
    h += '</div>';
    h += '<div class="cbDrillNote">Premium is reconstructed as latent energy E=(K/S)²·IV·√τ; Dealer Intent (CDS/DR3) is computed on it exactly as CME computes on observed premium. Walls, PCR &amp; γ-pin are OI/Volume-derived.</div>';
    box.innerHTML = h;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function handleFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    var done = 0, added = [];
    list.forEach(function(file){
      var rd = new FileReader();
      rd.onload = function(){
        try {
          var parsed = ingest(rd.result);
          if (parsed.rows.length) {
            var s = summarize(parsed); PORT[s.symbol] = s;
            CHAINS[s.symbol] = { meta: parsed.meta, expiration: parsed.expiration, rows: parsed.rows };
            ACTIVE = s.symbol; added.push(s.symbol);
          }
        } catch (e) { console.warn("CBOE ingest failed for", file.name, e); }
        if (++done === list.length) { save(); render(); syncInstr(); notifyChanged(); if (added.length===1) drill(added[0]); }
      };
      rd.readAsText(file);
    });
  }

  function wire() {
    var fi = document.getElementById("cbFile");
    if (fi) fi.addEventListener("change", function(){ handleFiles(this.files); this.value=""; });
    var cl = document.getElementById("cbClear");
    if (cl) cl.addEventListener("click", function(){ PORT = {}; CHAINS = {}; ACTIVE = null; save(); render(); syncInstr(); notifyChanged(); });
    host.querySelectorAll(".cbTable th").forEach(function(th){
      th.addEventListener("click", function(){ var k=th.dataset.k;
        if (k===sortKey) sortDir=-sortDir; else { sortKey=k; sortDir = th.classList.contains("l")?1:-1; }
        render(); });
    });
    host.querySelectorAll(".cbTable tbody tr").forEach(function(tr){
      tr.addEventListener("click", function(){ drill(tr.dataset.sym); });
    });
  }

  // ---- instrument selector: contract dropdown ⇄ ticker dropdown --------------
  // Directive: switching to CBOE turns the futures-contract selector into a
  // ticker selector, populated from uploaded datasets, persisted for the session.
  // #instA (CME) is left untouched; a sibling #instCboe is shown in its place.
  function ensureInstCboe() {
    var sel = document.getElementById("instCboe");
    if (sel) return sel;
    var bar = document.querySelector(".tabbar .instrbar"); if (!bar) return null;
    sel = document.createElement("select");
    sel.className = "field"; sel.id = "instCboe"; sel.style.display = "none";
    sel.title = "CBOE ticker — populated from uploaded datasets";
    sel.addEventListener("change", function () {
      if (this.value && root.QuanCboe) root.QuanCboe.setActive(this.value);
    });
    bar.appendChild(sel);
    return sel;
  }
  function syncInstr() {
    var instA = document.getElementById("instA");
    var sel = ensureInstCboe(); if (!sel) return;
    var isCboe = root.QuanExchange && root.QuanExchange.get() === "CBOE";
    if (instA) instA.style.display = isCboe ? "none" : "";
    sel.style.display = isCboe ? "" : "none";
    if (!isCboe) return;
    var syms = Object.keys(PORT);
    if (!syms.length) {
      sel.innerHTML = '<option value="">upload a ticker…</option>';
    } else {
      sel.innerHTML = syms.map(function (s) {
        return '<option value="' + esc(s) + '"' + (s === ACTIVE ? " selected" : "") + ">" + esc(s) + "</option>";
      }).join("");
      if (ACTIVE) sel.value = ACTIVE;
    }
  }

  // ---- boot ------------------------------------------------------------------
  root.__cboeBoot = function () {
    host = document.getElementById("cboeMount");
    if (!host) return;
    if (!mounted) { load(); mounted = true; }
    render(); syncInstr();
  };
  // exchange flip → re-render board + swap the instrument selector
  root.addEventListener("quan:exchange", function (e) {
    if (!mounted) { load(); mounted = true; }
    if (e.detail && e.detail.exchange === "CBOE" && host) render();
    syncInstr();
  });
  // keep the selector correct even before the tab is first opened
  if (document.readyState !== "loading") { load(); mounted = true; syncInstr(); }
  else root.addEventListener("DOMContentLoaded", function () { load(); mounted = true; syncInstr(); });
})(typeof window !== "undefined" ? window : this);
