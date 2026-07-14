/* ==========================================================================
   QU'AN TIMESTATE CORE — pure math, no UI, no shared globals.
   Standalone port of the validated closures for the ZN (Promissory Notes)
   Timestate terminal. Everything lives under window.QT so nothing here can
   collide with the CME terminal (app.html) or the CBOE app.

   Contents:
     · RIPN tuning controller        (port of QuanRipnTuning, strike-compass.js)
     · Poly fit core                 (port of QuanPoly9, strike-compass.js)
     · Golden-Reference closure      (port of ingestChain/realizationWaves,
                                      sop-polar.js — RIPN_METHOD='golden' only)
     · Breach tension closure        (port of QuanTension, detector.js —
                                      validated vs LibreOffice, max err ~1e-12)
     · Book derivative chain         (forward diff on the CW grid, Book _step
                                      edge rule: cell k=20 divides by -1)
     · Chronometer Watch clock math  (cw -> ET wall clock)
   ========================================================================== */
(function (root) {
  "use strict";
  var QT = {};

  /* ---------------- RIPN tuning (Section 2 core, one controller) --------- */
  var TUNE_DEFAULTS = { responsiveness: 1.0, sensitivity: 0.0, smoothing: 0.0, weighting: 1.0 };
  var TUNE_RANGES = { responsiveness: [0, 2], sensitivity: [0, 1], smoothing: [0, 1], weighting: [0, 1] };
  function tclamp(v, r) { return v < r[0] ? r[0] : v > r[1] ? r[1] : v; }
  function tuneResolve(base, over) {
    var out = {}; for (var k in TUNE_DEFAULTS) out[k] = tclamp((over && k in over) ? over[k] : base[k], TUNE_RANGES[k]); return out;
  }
  function TuneController(initial) { this._g = tuneResolve(TUNE_DEFAULTS, initial || {}); this._instances = {}; }
  TuneController.prototype.get = function (k) { return this._g[k]; };
  TuneController.prototype.set = function (k, v) { if (k in TUNE_DEFAULTS) this._g[k] = tclamp(+v, TUNE_RANGES[k]); return this; };
  TuneController.prototype.global = function () { return tuneResolve(this._g, {}); };
  TuneController.prototype.forInstrument = function (inst, over) {
    var key = String(inst || "").toLowerCase();
    if (over) this._instances[key] = over;
    return tuneResolve(this._g, this._instances[key] || {});
  };
  function tuneApply(signal, cfg) {
    cfg = cfg || TUNE_DEFAULTS; var out = [], prev = 0, started = false;
    for (var i = 0; i < signal.length; i++) {
      var x = +signal[i] * cfg.responsiveness;
      if (cfg.sensitivity > 0 && Math.abs(x) < cfg.sensitivity) x = 0;
      var blended = started ? (cfg.weighting * x + (1 - cfg.weighting) * prev) : x;
      var smoothed = started ? (cfg.smoothing * prev + (1 - cfg.smoothing) * blended) : blended;
      out.push(smoothed); prev = smoothed; started = true;
    }
    return out;
  }
  QT.Tuning = { DEFAULTS: TUNE_DEFAULTS, RANGES: TUNE_RANGES,
    create: function (init) { return new TuneController(init); }, apply: tuneApply, resolve: tuneResolve };

  /* ---------------- Poly fit core (fit ladder / curvature) --------------- */
  function polySolve(A, b) {
    var n = b.length, i, j, k;
    for (i = 0; i < n; i++) {
      var p = i; for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var tmp = A[i]; A[i] = A[p]; A[p] = tmp; var tb = b[i]; b[i] = b[p]; b[p] = tb;
      if (Math.abs(A[i][i]) < 1e-12) continue;
      for (j = i + 1; j < n; j++) { var f = A[j][i] / A[i][i];
        for (k = i; k < n; k++) A[j][k] -= f * A[i][k]; b[j] -= f * b[i]; }
    }
    var x = new Array(n).fill(0);
    for (i = n - 1; i >= 0; i--) { var s = b[i];
      for (j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : s / A[i][i]; }
    return x;
  }
  function polyFit(xs, ys, deg) {
    deg = deg == null ? 9 : deg;
    var m = Math.min(deg, xs.length - 1), n = m + 1, i, j, k;
    var A = [], b = [];
    for (i = 0; i < n; i++) { A.push(new Array(n).fill(0)); b.push(0); }
    for (k = 0; k < xs.length; k++) {
      var pw = [1]; for (i = 1; i < 2 * n; i++) pw.push(pw[i - 1] * xs[k]);
      for (i = 0; i < n; i++) { for (j = 0; j < n; j++) A[i][j] += pw[i + j]; b[i] += pw[i] * ys[k]; }
    }
    return polySolve(A, b); // ascending powers
  }
  function polyEval(c, x) { var y = 0; for (var i = c.length - 1; i >= 0; i--) y = y * x + c[i]; return y; }
  QT.Poly = { fit: polyFit, evalAt: polyEval };

  /* ---------------- shared CSV helpers ----------------------------------- */
  function cleanNum(s) { if (s == null) return NaN; s = String(s).replace(/,/g, '').replace(/s$/, '').trim();
    if (s === '' || s === 'N/A' || s === 'nan' || s === 'None') return NaN; var v = parseFloat(s); return isFinite(v) ? v : NaN; }
  function parseCsvLine(line) { var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) { var c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } }
    out.push(cur); return out; }

  /* ---------------- Golden-Reference closure (sop-polar port) ------------ */
  // Barchart side-by-side chain, header-name driven (nth occurrence of the
  // duplicated call/put columns). Returns sorted strike rows or null.
  function ingestChain(text) {
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.length; });
    if (!lines.length) return null;
    var head = parseCsvLine(lines[0]).map(function (h) { return h.replace(/^﻿/, '').replace(/^"|"$/g, '').trim(); });
    function nth(name, k) { var c = 0; for (var i = 0; i < head.length; i++) { if (head[i] === name) { if (c === k) return i; c++; } } return -1; }
    var ix = { strike: nth('Strike', 0), callPrem: nth('Premium', 0), putPrem: nth('Premium', 1),
      callOI: nth('Open Int', 0), putOI: nth('Open Int', 1) };
    if (ix.strike < 0 || ix.callPrem < 0 || ix.putPrem < 0 || ix.callOI < 0 || ix.putOI < 0) return null;
    var rows = [];
    for (var i = 1; i < lines.length; i++) { var f = parseCsvLine(lines[i]); var strike = cleanNum(f[ix.strike]); if (!isFinite(strike)) continue;
      rows.push({ strike: strike, callPrem: cleanNum(f[ix.callPrem]), putPrem: cleanNum(f[ix.putPrem]),
        callOI: cleanNum(f[ix.callOI]), putOI: cleanNum(f[ix.putOI]) }); }
    rows.sort(function (a, b) { return a.strike - b.strike; }); return rows;
  }

  var CW_STEPS = 21, PAIR_ROWS = 11;
  // Golden-Reference realization: RAW RIPN min-max, anchor = first RIPN 0/1 row
  // (or operator handshake), FORWARD window ai..ai+20, Book _step edge rule.
  function realizationWaves(rows, anchorIdx) {
    var n = rows.length; if (n < 17) return null;
    function fz(v) { return (v == null || !isFinite(v)) ? 0 : v; }
    var strikes = rows.map(function (r) { return r.strike; }); var ap = new Array(n);
    for (var i = 0; i < n; i++) { var netOI = fz(rows[i].putOI) - fz(rows[i].callOI), netPrem = fz(rows[i].putPrem) - fz(rows[i].callPrem);
      ap[i] = (netOI !== 0 && netPrem !== 0) ? netPrem / netOI : NaN; }
    var bh = ap.map(function (v) { return Math.abs(v); });
    var valid = bh.filter(function (v) { return isFinite(v); }); if (valid.length < 5) return null;
    var lo = Math.min.apply(null, valid), hi = Math.max.apply(null, valid);   // golden = raw min-max (no winsorize)
    var rng = hi - lo; var bi = bh.map(function (v) { return isFinite(v) ? (rng > 0 ? (v - lo) / rng : 0) : NaN; });
    var br = new Array(n - 1).fill(NaN); for (i = 0; i < n - 1; i++) if (isFinite(bi[i]) && isFinite(bi[i + 1])) br[i] = bi[i + 1] - bi[i];
    var cw = []; for (var k = 0; k < CW_STEPS; k++) cw.push(Math.round((k * 0.1 - 1.0) * 1e10) / 1e10);
    function cwStep(kk) { var nxt = (kk + 1) < CW_STEPS ? cw[kk + 1] : 0.0; return nxt - cw[kk]; }   // 0.1; Book edge cell k=20 = -1.0
    // AUTO anchor: first RIPN 0/1 row (Book handshake)
    var auto_ai = -1;
    for (i = 0; i < n; i++) { if (bi[i] === 0.0 || bi[i] === 1.0) { auto_ai = i; break; } }
    // OPERATOR HANDSHAKE: anchorIdx overrides the auto pick when valid
    var ai = auto_ai, manual = false;
    if (anchorIdx != null) { var ix2 = Math.trunc(anchorIdx); if (ix2 >= 0 && ix2 < n && isFinite(bi[ix2])) { ai = ix2; manual = true; } }
    if (ai < 0) return null;
    var cc = new Array(CW_STEPS).fill(0), cd = new Array(CW_STEPS).fill(0);
    // GOLDEN — forward derivative chain from the anchor row, Book _step edge rule
    for (k = 0; k < CW_STEPS; k++) { var a = ai + k, b = ai + k + 1, d = cwStep(k);
      if (a >= 0 && a < br.length && b >= 0 && b < br.length && isFinite(br[a]) && isFinite(br[b]) && d !== 0) cc[k] = (br[b] - br[a]) / d; }
    for (k = 0; k < CW_STEPS; k++) { var d2 = cwStep(k); var cc_next = (k + 1) < CW_STEPS ? cc[k + 1] : 0.0; cd[k] = d2 !== 0 ? (cc_next - cc[k]) / d2 : 0.0; }
    var covered = (ai + CW_STEPS) <= br.length;
    // pairs: fold the 21-cell axis from opposite ends toward center (TSC(Curvature) schema)
    function pairs(B) { var sop = [], pm = [], pd = [], dip = []; for (var nn = 0; nn < PAIR_ROWS; nn++) { var hival = B[nn], loval = B[20 - nn];
      sop.push(hival + loval); pm.push(hival * loval); pd.push(loval !== 0 ? hival / loval : 0); dip.push(hival - loval); } return { sop: sop, pm: pm, pd: pd, dip: dip }; }
    var pG = pairs(cc), pC = pairs(cd);
    var sopG = pG.sop, sopC = pC.sop; var fold = sopG.map(function (g, i2) { return g * sopC[i2]; });
    var cross = []; for (i = 1; i < PAIR_ROWS; i++) { if (fold[i] === 0) continue; var sc = Math.sign(fold[i]), sp = Math.sign(fold[i - 1]); if (sc !== 0 && sp !== 0 && sc !== sp) cross.push(Math.round(cw[i] * 100) / 100); }
    // RIPN inspection rows for the handshake panel: [idx, strike, RIPN[0,1], AP, tuning(BR)]
    var ripn_rows = []; for (var r = 0; r < n; r++) ripn_rows.push([r, strikes[r], (isFinite(bi[r]) ? bi[r] : null), (isFinite(ap[r]) ? ap[r] : null), (r < br.length && isFinite(br[r]) ? br[r] : null)]);
    return { cw: cw, cc: cc, cd: cd, sopG: sopG, sopC: sopC, fold: fold, cross: cross,
      anchor_strike: strikes[ai], n_strikes: n, covered: covered,
      ripn_rows: ripn_rows, auto_idx: auto_ai, used_idx: ai, manual_anchor: manual, method: 'golden' };
  }
  QT.ingestChain = ingestChain;
  QT.realizationWaves = realizationWaves;

  /* ---------------- Breach tension closure (detector.js port) ------------ */
  function num(s) { if (s == null) return null; s = String(s).trim().replace(/^"|"$/g, '').replace(/,/g, '');
    if (s === '' || s === 'N/A' || s === 'n/a' || s === '--') return null; var v = parseFloat(s); return isFinite(v) ? v : null; }
  // Barchart side-by-side: Type,Last,Volume,"Open Int","Daily Premium",Strike,Type,Last,Volume,"Open Int","Daily Premium"
  function parseTensionChain(text) {
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    var rows = [];
    for (var i = 1; i < lines.length; i++) { var v = parseCsvLine(lines[i]); if (v.length < 11) continue;
      var k = num(v[5]); if (k == null) continue;
      rows.push({ k: k, cprem: num(v[4]), pprem: num(v[10]), coi: num(v[3]), poi: num(v[9]), cvol: num(v[2]), pvol: num(v[8]) }); }
    rows.sort(function (a, b) { return a.k - b.k; });
    return rows;
  }
  function _stats(xs) { var a = xs.filter(function (x) { return x != null; }); var n = a.length;
    var m = 0; for (var i = 0; i < n; i++) m += a[i]; m /= n;
    var ss = 0; for (i = 0; i < n; i++) { var d = a[i] - m; ss += d * d; } var s = Math.sqrt(ss / (n - 1));
    return { a: a, n: n, m: m, s: s }; }
  function excelSkew(xs) { var t = _stats(xs); if (t.n < 3 || t.s === 0) return null;
    var c = t.n / ((t.n - 1) * (t.n - 2)), sum = 0; for (var i = 0; i < t.n; i++) { var z = (t.a[i] - t.m) / t.s; sum += z * z * z; } return c * sum; }
  function excelKurt(xs) { var t = _stats(xs); if (t.n < 4 || t.s === 0) return null; var n = t.n;
    var A = n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)), B = 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3)), sum = 0;
    for (var i = 0; i < n; i++) { var z = (t.a[i] - t.m) / t.s; sum += z * z * z * z; } return A * sum - B; }
  function div(a, b) { return (a != null && b != null && b !== 0) ? a / b : null; }
  function dphase(a1, a2, b1, b2) { // ((a2-a1)/(a1+a2))/((b2-b1)/(b1+b2)), IFERROR->0
    var s1 = a1 + a2, s2 = b1 + b2; if (s1 === 0 || s2 === 0) return 0;
    var top = (a2 - a1) / s1, bot = (b2 - b1) / s2; if (bot === 0) return 0; return top / bot; }
  // returns {CI:[21], CL:[21], CM:[21]} — CI = Chronometer Watch axis,
  // CL = PG/PC Dual Phase Tension, CM = PC/PG Dual Phase Tension
  function computeTension(rows) {
    var n = rows.length, i, w;
    var O = [], AO = [], L = [], AS = [], AV = [], AX = [];
    for (i = 0; i < n; i++) { var r = rows[i];
      var o = (r.poi || 0) - (r.coi || 0), ao = (r.pprem || 0) - (r.cprem || 0), l = (r.pvol || 0) - (r.cvol || 0);
      O.push(o); AO.push(ao); L.push(l);
      AS.push(o !== 0 ? ao / o : null);
      AV.push(l !== 0 ? ao / l : null); }
    for (i = 0; i < n; i++) { AX.push((AS[i] != null && AV[i] != null && AV[i] !== 0) ? AS[i] / AV[i] : null); }
    var DE2 = excelKurt(AS), DE3 = excelKurt(AV), DE7 = excelKurt(AX);
    var DE14 = excelSkew(AS), DE15 = excelSkew(AV), DE17 = excelSkew(AX);
    var DE37 = div(DE2, DE14), DE38 = div(DE3, DE15), DE39 = div(DE7, DE17);
    var DI29 = div(DE7, div(DE2, DE3)), DI30 = div(DE17, div(DE14, DE15));
    var DI31 = div(DI29, DI30), DI37 = div(DE37, DE38), DI38 = div(DI37, DE39);
    var gain = (DI37 != null && DI38 != null && DI31 != null) ? ((DI37 - DI38) * DI31) : null;
    var BO = AS.map(function (a) { return (gain != null && a != null) ? gain * Math.abs(a) : null; });
    var nums = BO.filter(function (x) { return x != null; });
    if (!nums.length) return null;
    var bmin = Math.min.apply(null, nums), bmax = Math.max.apply(null, nums), rng = bmax - bmin;
    var BP = BO.map(function (x) { return x != null ? (rng ? (x - bmin) / rng : null) : null; });
    var BY = []; for (i = 0; i < n; i++) BY.push((i + 1 < n && BP[i] != null && BP[i + 1] != null) ? (BP[i + 1] - BP[i]) : null);
    function byi(idx) { return (idx >= 0 && idx < n) ? BY[idx] : null; }
    var step = []; for (w = 0; w < 20; w++) step.push(0.1); step.push(-1.0);
    var CJ = []; for (w = 0; w < 21; w++) { var a = byi(14 + w), b = byi(13 + w); CJ.push((a != null && b != null) ? (a - b) / step[w] : 0); }
    var CK = []; for (w = 0; w < 21; w++) { var cjn = (w + 1 < 21) ? CJ[w + 1] : 0; CK.push((cjn - CJ[w]) / step[w]); }
    var CU = [], CV = [];
    for (w = 0; w < 21; w++) { if (w < 20) { CU.push(dphase(CJ[w], CJ[w + 1], CK[w], CK[w + 1])); CV.push(dphase(CK[w], CK[w + 1], CJ[w], CJ[w + 1])); }
      else { CU.push(0); CV.push(0); } }
    var CL = [], CM = []; for (w = 0; w < 21; w++) { CL.push((w + 1 < 21) ? CU[w] + CU[w + 1] : 0); CM.push((w + 1 < 21) ? CV[w] + CV[w + 1] : 0); }
    [1, 2, 3, 4, 19, 20].forEach(function (z) { CL[z] = 0; });            // Book literal-zero rows on CL
    var CI = []; for (w = 0; w < 21; w++) CI.push(Math.round((-1 + 0.1 * w) * 1e10) / 1e10);
    return { CI: CI, CL: CL, CM: CM };
  }
  // Breach detector primitive: cross CL vs CM along the watch axis
  function findBreaches(CI, CL, CM) { var out = [];
    for (var i = 0; i < CI.length - 1; i++) { var d1 = CM[i] - CL[i], d2 = CM[i + 1] - CL[i + 1];
      if ((d1 <= 0 && d2 > 0) || (d1 > 0 && d2 <= 0)) { var t = -d1 / (d2 - d1); out.push({ cw: CI[i] + t * (CI[i + 1] - CI[i]), val: CL[i] + t * (CL[i + 1] - CL[i]) }); } }
    return out.sort(function (a, b) { return a.cw - b.cw; }); }
  QT.parseTensionChain = parseTensionChain;
  QT.computeTension = computeTension;
  QT.findBreaches = findBreaches;

  /* ---------------- Book derivative chain --------------------------------
     Forward difference of any 21-cell series against the Chronometer Watch,
     Book _step edge rule (cell k=20 steps to 0.0, i.e. divides by -1) — the
     same rule the golden closure uses for cc -> cd. Chain it for ∂², ∂³. */
  function bookDeriv(vals, cw) {
    var n = vals.length, out = new Array(n).fill(0);
    function step(k) { var nxt = (k + 1) < n ? cw[k + 1] : 0.0; return nxt - cw[k]; }
    for (var k = 0; k < n; k++) { var d = step(k); var vn = (k + 1) < n ? vals[k + 1] : 0.0; out[k] = d !== 0 ? (vn - vals[k]) / d : 0.0; }
    return out;
  }
  // zero crossings of a series along the watch axis -> [{cw, val:0}]
  function zeroCrossings(cw, vals) { var out = [];
    for (var i = 0; i < cw.length - 1; i++) { var a = vals[i], b = vals[i + 1];
      if (a === 0) { out.push({ cw: cw[i] }); continue; }
      if ((a < 0 && b > 0) || (a > 0 && b < 0)) { var t = -a / (b - a); out.push({ cw: cw[i] + t * (cw[i + 1] - cw[i]) }); } }
    return out; }
  QT.bookDeriv = bookDeriv;
  QT.zeroCrossings = zeroCrossings;

  /* ---------------- Chronometer Watch clock math -------------------------
     Session opens 18:00 ET, runs 23h. |cw| in [0,1] maps open -> close. */
  function cwToSec(cw) { var t = Math.round(64800 + Math.abs(cw) * 82800); return ((t % 86400) + 86400) % 86400; }
  function cwClock(cw) { var t = cwToSec(cw);
    return String(Math.floor(t / 3600)).padStart(2, '0') + ':' + String(Math.floor((t % 3600) / 60)).padStart(2, '0'); }
  function cwClock12(cw) { var t = cwToSec(cw); var totalMin = Math.round(t / 60) % 1440;
    var H = Math.floor(totalMin / 60), Mn = totalMin % 60; var ap = H < 12 ? 'AM' : 'PM'; var h = H % 12; if (h === 0) h = 12;
    return h + ':' + String(Mn).padStart(2, '0') + ' ' + ap; }
  QT.cwToSec = cwToSec;
  QT.cwClock = cwClock;
  QT.cwClock12 = cwClock12;

  root.QT = QT;
})(typeof window !== 'undefined' ? window : globalThis);
