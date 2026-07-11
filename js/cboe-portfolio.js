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
  var C = { exp:0, callLast:2, callVol:6, callOI:10, strike:11, putLast:13, putVol:17, putOI:21 };

  // ---- ingest (port of ingest_cboe) -----------------------------------------
  function ingest(text, expiration) {
    var lines = String(text).replace(/\r\n/g, "\n").split("\n");
    // meta from lines 2-3 (index 1-2)
    var meta = { symbol: "", spot: NaN, asof: "" };
    if (lines[1]) {
      meta.symbol = parseLine(lines[1])[0].trim();
      var mL = /Last:\s*([-\d.]+)/.exec(lines[1]); if (mL) meta.spot = +mL[1];
    }
    if (lines[2]) { var mD = /Date:\s*(.+?)"?\s*,/.exec(lines[2]); if (mD) meta.asof = mD[1].replace(/"/g, "").trim(); }

    var rows = [], expsSet = {};
    for (var r = 4; r < lines.length; r++) {
      if (!lines[r]) continue;
      var f = parseLine(lines[r]);
      var strike = num(f[C.strike]); if (!isFinite(strike)) continue;
      var exp = (f[C.exp] || "").trim(); if (exp) expsSet[exp] = 1;
      rows.push({ exp: exp, strike: strike,
        callOI: num(f[C.callOI]), putOI: num(f[C.putOI]),
        callVol: num(f[C.callVol]), putVol: num(f[C.putVol]),
        callLast: num(f[C.callLast]), putLast: num(f[C.putLast]) });
    }
    var exps = Object.keys(expsSet).sort(function (a, b) { return expKey(a) - expKey(b); });
    var pick = expiration || (exps[0] || null);
    var sel = rows;
    if (pick && pick !== "ALL") sel = rows.filter(function (x) { return x.exp === pick; });
    sel.sort(function (a, b) { return a.strike - b.strike; });
    return { meta: meta, expirations: exps, expiration: pick, rows: sel };
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
      support: support, resist: resist, pin: pin,
      supDist: (support!=null && isFinite(spot)) ? Math.round(support-spot) : null,
      resDist: (resist!=null && isFinite(spot)) ? Math.round(resist-spot) : null,
      signals: pdsl*10 + dsc, dsc: dsc, pdsl: pdsl,
      ts: Date.now(), drill: drill
    };
  }

  // ---- persistence -----------------------------------------------------------
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(PORT)); } catch (_) {} }
  function load() { try { var s = localStorage.getItem(LS_KEY); if (s) PORT = JSON.parse(s) || {}; } catch (_) { PORT = {}; } }

  // ---- rendering -------------------------------------------------------------
  var COLS = [
    { k:"symbol", t:"Ticker", num:false },
    { k:"spot", t:"Spot", num:true, fmt:function(v){return v==null?"—":v.toLocaleString();} },
    { k:"pcrOI", t:"PCR-OI", num:true },
    { k:"pcrVol", t:"PCR-Vol", num:true },
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
    h += '  <div class="cbTitle"><span class="inf">∞</span> CBOE Portfolio <span class="cbSub">P-C risk board · '
       + (closed ? '<b style="color:#e85c5c">RTH CLOSED</b>' : '<b style="color:#5fd08a">RTH OPEN</b>') + '</span></div>';
    h += '  <div class="cbTools">';
    h += '    <label class="cbUp">＋ New ticker<input type="file" id="cbFile" accept=".csv" multiple></label>';
    h += '    <span class="cbCount">' + arr.length + ' ticker' + (arr.length===1?'':'s') + '</span>';
    h += arr.length ? '    <button class="cbClear" id="cbClear" type="button">Clear all</button>' : '';
    h += '  </div>';
    h += '</div>';

    if (!arr.length) {
      h += '<div class="cbEmpty">Upload a CBOE <b>Download CSV</b> (NDX, SPX, RUT, or any listed ticker) to index it.<br>'
         + 'Each upload adds a row scored by the premium-free <b>P-C logic</b> — PCR, Net-OI walls, γ-pin, and DSC/PDSL signals.</div>';
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
    var h = '<div class="cbDrillHead">'+esc(sym)+' · '+esc(row.expiration||"")+' · spot '+(row.spot!=null?row.spot.toLocaleString():"—")
          + ' · '+esc(row.asof)+'</div>';
    h += '<div class="cbDrillGrid">';
    h += '<div><span class="cbLbl">Resistance ladder (ceilings)</span><div class="cbRungs">'+(ladder(d.cl,"c")||'<i>none in band</i>')+'</div></div>';
    h += '<div><span class="cbLbl">Support ladder (floors)</span><div class="cbRungs">'+(ladder(d.fl,"f")||'<i>none in band</i>')+'</div></div>';
    h += '<div><span class="cbLbl">Watermarks |LR|&gt;20</span><div class="cbRungs">'+((d.wm||[]).map(function(x){return '<span class="cbRung '+(x[1]==="F"?"f":"c")+'">'+x[0].toLocaleString()+' '+x[1]+'</span>';}).join("")||'<i>none</i>')+'</div></div>';
    h += '<div><span class="cbLbl">Top P-C signals (DSC/PDSL)</span><div class="cbRungs">'+(top||'<i>none ≥3 criteria</i>')+'</div></div>';
    h += '</div>';
    h += '<div class="cbDrillNote">Premium-free read — no intent bias (CBOE has no premium). Walls, PCR &amp; γ-pin are OI/Volume-derived.</div>';
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
          if (parsed.rows.length) { var s = summarize(parsed); PORT[s.symbol] = s; added.push(s.symbol); }
        } catch (e) { console.warn("CBOE ingest failed for", file.name, e); }
        if (++done === list.length) { save(); render(); if (added.length===1) drill(added[0]); }
      };
      rd.readAsText(file);
    });
  }

  function wire() {
    var fi = document.getElementById("cbFile");
    if (fi) fi.addEventListener("change", function(){ handleFiles(this.files); this.value=""; });
    var cl = document.getElementById("cbClear");
    if (cl) cl.addEventListener("click", function(){ PORT = {}; save(); render(); });
    host.querySelectorAll(".cbTable th").forEach(function(th){
      th.addEventListener("click", function(){ var k=th.dataset.k;
        if (k===sortKey) sortDir=-sortDir; else { sortKey=k; sortDir = th.classList.contains("l")?1:-1; }
        render(); });
    });
    host.querySelectorAll(".cbTable tbody tr").forEach(function(tr){
      tr.addEventListener("click", function(){ drill(tr.dataset.sym); });
    });
  }

  // ---- boot ------------------------------------------------------------------
  root.__cboeBoot = function () {
    host = document.getElementById("cboeMount");
    if (!host) return;
    if (!mounted) { load(); mounted = true; }
    render();
  };
  // re-render clock badge when exchange flips to CBOE
  root.addEventListener("quan:exchange", function(e){ if (e.detail && e.detail.exchange==="CBOE" && mounted) render(); });
})(typeof window !== "undefined" ? window : this);
