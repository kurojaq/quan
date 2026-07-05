/* ===== compass shared cores (Sections 2,3,5B,7): one copy, all views ===== */
/* compass shared core */
/* quan_poly9.js — shared 9th-order polynomial skew core (Sections 5B/7).
 * Pure math, no UI. One implementation to be inherited by every compass view
 * (TSC, Latent Paths, CXG, Breach) rather than re-implemented per tab.
 *   fit(xs,ys,deg=9) -> coeffs (least squares, ascending powers)
 *   evalAt(coeffs,x) -> y (Horner)
 *   crossings(coeffs,x0,x1,n) -> zero-crossing x's (signal shaping / intersections)
 *   curvature(coeffs,x) -> 2nd derivative (curvature modeling)
 */
(function (root) {
  "use strict";
  function solve(A, b) { // Gaussian elimination with partial pivoting
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
  function fit(xs, ys, deg) {
    deg = deg == null ? 9 : deg;
    var m = Math.min(deg, xs.length - 1), n = m + 1, i, j, k;
    var A = [], b = [];
    for (i = 0; i < n; i++) { A.push(new Array(n).fill(0)); b.push(0); }
    for (k = 0; k < xs.length; k++) {
      var pw = [1]; for (i = 1; i < 2 * n; i++) pw.push(pw[i - 1] * xs[k]);
      for (i = 0; i < n; i++) { for (j = 0; j < n; j++) A[i][j] += pw[i + j]; b[i] += pw[i] * ys[k]; }
    }
    return solve(A, b); // ascending powers
  }
  function evalAt(c, x) { var y = 0; for (var i = c.length - 1; i >= 0; i--) y = y * x + c[i]; return y; }
  function deriv(c) { var d = []; for (var i = 1; i < c.length; i++) d.push(i * c[i]); return d.length ? d : [0]; }
  function curvature(c, x) { return evalAt(deriv(deriv(c)), x); }
  function crossings(c, x0, x1, n) {
    n = n || 200; var out = [], prev = evalAt(c, x0), px = x0;
    for (var i = 1; i <= n; i++) { var x = x0 + (x1 - x0) * i / n, y = evalAt(c, x);
      if (prev === 0) out.push(px);
      else if ((prev < 0) !== (y < 0)) out.push(px + (x - px) * (0 - prev) / (y - prev));
      prev = y; px = x; }
    return out;
  }
  var api = { fit: fit, evalAt: evalAt, deriv: deriv, curvature: curvature, crossings: crossings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.QuanPoly9 = api;
})(typeof window !== "undefined" ? window : this);

/* compass shared core */
/* quan_toroidal_time.js — canonical session-time geometry (Section 3, shared).
 * Breach-detector reference model: session progresses 0 -> 1; the axis is toroidal
 * with 0->-1 == 0->1 (the negative half mirrors the positive). One implementation
 * for every compass view (TSC, Latent, CXG, Breach) so axes agree.
 *
 *   progress(t,t0,t1) : timestamp -> [0,1] session progression (clamped)
 *   phase(x)          : compass x in [-1,1] -> canonical session phase [0,1]  (= |x|, the 0<->1 fold)
 *   toAxis(s,side)    : session phase [0,1] -> compass x in [-1,1] (side = +1 right / -1 mirror)
 *   wrap(x)           : fold any real into the toroidal [-1,1] domain
 *   equivalent(a,b)   : toroidal-equivalence test (|a| ~= |b|)
 *   label(s)          : human session-time label for an event at phase s (e.g. "0.62")
 *
 * NOTE: the fold metric (|x|) implements the directive's stated wrap symmetry. The
 * EOM forward-horizon variant (time-distance asymmetry) remains the parked extension;
 * when defined it slots in as an alternate phase() metric without changing callers.
 */
(function (root) {
  "use strict";
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function progress(t, t0, t1) {
    t = +t; t0 = +t0; t1 = +t1;
    if (!(t1 > t0)) return 0;
    return clamp((t - t0) / (t1 - t0), 0, 1);
  }
  function phase(x) { return Math.abs(+x) % 1 === 0 && Math.abs(+x) >= 1 ? 1 : Math.abs(+x) % 1 || (Math.abs(+x) >= 1 ? 1 : 0); }
  // simpler, exact fold to [0,1] with 1 mapping to 1 (not 0):
  function phaseFold(x) { var a = Math.abs(+x); return a >= 1 ? 1 : a; }
  function toAxis(s, side) { s = clamp(+s, 0, 1); return (side < 0 ? -1 : 1) * s; }
  function wrap(x) { // fold any real into [-1,1] toroidal domain (triangle wave)
    x = +x; var m = ((x + 1) % 2 + 2) % 2 - 1; return m;
  }
  function equivalent(a, b, eps) { eps = eps || 1e-9; return Math.abs(phaseFold(a) - phaseFold(b)) <= eps; }
  function label(s) { return clamp(+s, 0, 1).toFixed(2); }
  var api = { progress: progress, phase: phaseFold, toAxis: toAxis, wrap: wrap, equivalent: equivalent, label: label };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.QuanToroidalTime = api;
})(typeof window !== "undefined" ? window : this);

/* compass shared core */
/* quan_ripn_tuning.js — global RIPN tuning controller (Section 2, shared).
 * ONE controller shared by all compass views (not duplicated per tab). Runtime-
 * adjustable. Local overrides layer over the global. ZN gets a dedicated instance
 * (separate reference-file pipeline) that stays synced to global rules unless an
 * override is set explicitly.
 *
 * Params (all runtime-adjustable; defaults are a sane starting calibration,
 * NOT final — exact response curves are Spence's to tune):
 *   responsiveness [0..2] : output gain on the RIPN signal        (1 = neutral)
 *   sensitivity    [0..1] : zero-band; |x|<sensitivity -> 0        (0 = none)
 *   smoothing      [0..1] : EMA factor; 0 = raw, ->1 = heavy smooth
 *   weighting      [0..1] : blend of current vs prior signal       (1 = all current)
 */
(function (root) {
  "use strict";
  var DEFAULTS = { responsiveness: 1.0, sensitivity: 0.0, smoothing: 0.0, weighting: 1.0 };
  var RANGES = { responsiveness: [0, 2], sensitivity: [0, 1], smoothing: [0, 1], weighting: [0, 1] };
  function clamp(v, r) { return v < r[0] ? r[0] : v > r[1] ? r[1] : v; }
  function resolve(base, over) {
    var out = {}; for (var k in DEFAULTS) out[k] = clamp((over && k in over) ? over[k] : base[k], RANGES[k]); return out;
  }
  function Controller(initial) {
    this._g = resolve(DEFAULTS, initial || {});
    this._instances = {}; // per-instrument override sets
  }
  Controller.prototype.get = function (k) { return this._g[k]; };
  Controller.prototype.set = function (k, v) { if (k in DEFAULTS) this._g[k] = clamp(+v, RANGES[k]); return this; };
  Controller.prototype.global = function () { return resolve(this._g, {}); };
  Controller.prototype.withLocal = function (over) { return resolve(this._g, over || {}); };   // local beats global
  Controller.prototype.forInstrument = function (inst, over) {                                 // dedicated instance, synced to global
    var key = String(inst || "").toLowerCase();
    if (over) this._instances[key] = over;
    return resolve(this._g, this._instances[key] || {});
  };
  // apply a resolved config to a signal array (documented transforms; tune curves freely)
  function apply(signal, cfg) {
    cfg = cfg || DEFAULTS; var out = [], prev = 0, started = false;
    for (var i = 0; i < signal.length; i++) {
      var x = +signal[i] * cfg.responsiveness;
      if (cfg.sensitivity > 0 && Math.abs(x) < cfg.sensitivity) x = 0;
      var blended = started ? (cfg.weighting * x + (1 - cfg.weighting) * prev) : x;
      var smoothed = started ? (cfg.smoothing * prev + (1 - cfg.smoothing) * blended) : blended;
      out.push(smoothed); prev = smoothed; started = true;
    }
    return out;
  }
  var api = { DEFAULTS: DEFAULTS, RANGES: RANGES, Controller: Controller,
              create: function (init) { return new Controller(init); }, apply: apply, resolve: resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.QuanRipnTuning = api;
})(typeof window !== "undefined" ? window : this);


/* compass renderer (data-driven, reads __ripnCfg) */
/* quan_compass_view.js — data-driven compass renderer (no engine/Pyodide).
 * renderCompass(svg, series, opts) draws curves on a toroidal session-time axis,
 * with optional RIPN tuning + 9th-order smoothing + event time-labels.
 * Reusable by every view (TSC/Latent/CXG/Breach) and by the live terminal: feed it
 * the engine's realization payload, it draws. Decoupled = validatable headlessly.
 * Depends only on the shared cores: QuanToroidalTime, QuanRipnTuning, QuanPoly9.
 */
(function (root) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  // colorblind-safe: hue + dash + label (never color alone)
  var STYLE = {
    gradient:  { color: "#1aa179", dash: "",      label: "CC · gradient" },
    curvature: { color: "#d65a1e", dash: "6 4",   label: "CD · curvature" },
    sopG:      { color: "#3b82c4", dash: "",       label: "SOPG" },
    sopC:      { color: "#b07fd6", dash: "5 4",    label: "SOPC" },
    fold:      { color: "#e8e8e8", dash: "",       label: "fold = SOPG·SOPC" },
    dpG:       { color: "#1aa179", dash: "2 3",    label: "dual-phase U" },
    dpC:       { color: "#d65a1e", dash: "2 3",    label: "dual-phase V" }
  };
  function autoscale(arrs) {
    var lo = Infinity, hi = -Infinity;
    arrs.forEach(function (a) { a.forEach(function (v) { if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); });
    if (!isFinite(lo)) { lo = -1; hi = 1; } if (lo === hi) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.08; return [lo - pad, hi + pad];
  }
  // x: session-time [0,1] toroidal; fit a smooth 9th-order path through points
  function pathFor(xs, ys, X, Y, W, H, smooth) {
    var pts = [];
    if (smooth && root.QuanPoly9 && xs.length > 3) {
      var c = root.QuanPoly9.fit(xs, ys, Math.min(9, xs.length - 1));
      var n = 120; for (var i = 0; i <= n; i++) { var t = xs[0] + (xs[xs.length - 1] - xs[0]) * i / n; pts.push([X(t), Y(root.QuanPoly9.evalAt(c, t))]); }
    } else { for (var j = 0; j < xs.length; j++) pts.push([X(xs[j]), Y(ys[j])]); }
    return "M" + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join("L");
  }
  function tune(ys, ripn) {
    if (!ripn || !root.QuanRipnTuning) return ys;
    return root.QuanRipnTuning.apply(ys, ripn);
  }
  // series: [{key, xs(sessiontime[0,1]), ys}], events:[{t,label}]
  function renderCompass(svg, spec, opts) {
    opts = opts || {};
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var W = +svg.getAttribute("width") || 640, H = +svg.getAttribute("height") || 360;
    var m = { l: 38, r: 12, t: 16, b: 26 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    var allY = spec.series.map(function (s) { return tune(s.ys, opts.ripn); });
    var yr = autoscale(allY); var smooth = opts.smooth !== false;
    function X(t) { return m.l + t * pw; }                 // t in [0,1]
    function Y(v) { return m.t + (yr[1] - v) / (yr[1] - yr[0]) * ph; }
    // panel bg + toroidal axis
    svg.appendChild(el("rect", { x: m.l, y: m.t, width: pw, height: ph, fill: "#0d0f0e", stroke: "#222" }));
    // gridlines at session-time 0,.25,.5,.75,1 (toroidal: 0 and 1 identified)
    [0, .25, .5, .75, 1].forEach(function (t) {
      svg.appendChild(el("line", { x1: X(t), y1: m.t, x2: X(t), y2: m.t + ph, stroke: "#1c2220", "stroke-width": t === 0 || t === 1 ? 1.4 : 0.6 }));
      var tx = el("text", { x: X(t), y: H - 8, fill: "#6b7a74", "font-size": 9, "text-anchor": "middle" }); tx.textContent = t.toFixed(2); svg.appendChild(tx);
    });
    // zero line
    if (yr[0] < 0 && yr[1] > 0) svg.appendChild(el("line", { x1: m.l, y1: Y(0), x2: m.l + pw, y2: Y(0), stroke: "#3a443f", "stroke-dasharray": "3 3" }));
    // curves
    spec.series.forEach(function (s) {
      var st = STYLE[s.key] || { color: "#888", dash: "", label: s.key };
      var ys = tune(s.ys, opts.ripn);
      svg.appendChild(el("path", { d: pathFor(s.xs, ys, X, Y, W, H, smooth), fill: "none", stroke: st.color, "stroke-width": 1.8, "stroke-dasharray": st.dash, opacity: 0.95 }));
      // sample dots
      for (var i = 0; i < s.xs.length; i++) svg.appendChild(el("circle", { cx: X(s.xs[i]), cy: Y(ys[i]), r: 1.6, fill: st.color, opacity: 0.5 }));
    });
    // event time-labels (breach/cross at session-time)
    (spec.events || []).forEach(function (ev) {
      svg.appendChild(el("line", { x1: X(ev.t), y1: m.t, x2: X(ev.t), y2: m.t + ph, stroke: "#e8e8e8", "stroke-width": 1, "stroke-dasharray": "2 2", opacity: 0.7 }));
      svg.appendChild(el("circle", { cx: X(ev.t), cy: m.t + 6, r: 3, fill: "#e8e8e8" }));
      var lt = el("text", { x: X(ev.t), y: m.t - 3, fill: "#e8e8e8", "font-size": 8.5, "text-anchor": "middle" });
      lt.textContent = (ev.label != null ? ev.label : (root.QuanToroidalTime ? root.QuanToroidalTime.label(ev.t) : ev.t.toFixed(2)));
      svg.appendChild(lt);
    });
    return svg;
  }
  // map an engine realization payload -> view specs (main / fold / dual)
  function specsFromPayload(p) {
    var cw = p.cwAxis || [], tcw = cw.map(function (c) { return (c + 1) / 2; });   // session-time (engine convention)
    var pr = (p.fold || []).map(function (_, i) { return i / Math.max(1, (p.fold.length - 1)); });
    var ev = (p.crossings_t || []).map(function (t) { return { t: t, label: t.toFixed(2) }; });
    return {
      main: { series: [{ key: "gradient", xs: tcw, ys: p.pressureGradient || [] }, { key: "curvature", xs: tcw, ys: p.pressureCurvature || [] }], events: ev },
      fold: { series: [{ key: "sopG", xs: pr, ys: p.sopG || [] }, { key: "sopC", xs: pr, ys: p.sopC || [] }, { key: "fold", xs: pr, ys: p.fold || [] }], events: [] },
      dual: { series: [{ key: "dpG", xs: tcw, ys: p.dpGradient || p.tensionCL || [] }, { key: "dpC", xs: tcw, ys: p.dpCurvature || p.tensionCM || [] }], events: ev }
    };
  }
  var api = { renderCompass: renderCompass, specsFromPayload: specsFromPayload, STYLE: STYLE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.QuanCompassView = api;
})(typeof window !== "undefined" ? window : this);

/* CXG container renderer (faithful BD drawAxisGraph port) */
/* quan_cxg.js — CXG container renderer. Faithful canvas port of BD's drawAxisGraph
 * (same colors, Catmull-Rom smoothing, -1..+1 chronometer-watch axis) so the CXG
 * container is identical in design to the existing SOP Field panels. Applies the
 * global RIPN tuning (__ripnCfg) to curve data before drawing. Drives every CXG
 * sub-panel (Pressure / Dual-Phase / SOP-Fold / Family / DS / SWF).
 */
(function (root) {
  "use strict";
  // EXACT BD palette
  var C = { BG:'#07090d', PLOT:'#0b0f14', FG:'#c7cdd7', GRID:'rgba(255,255,255,0.06)',
            FRAME:'rgba(255,255,255,0.08)', ZERO:'rgba(232,227,214,0.7)', CYAN:'#6fd3ff',
            WHITE:'#ffffff', RED:'#d9463b', GOLD:'#e8b53a', TEAL:'#3f9d6b' };
  // EXACT BD Catmull-Rom
  function cr(p0,p1,p2,p3,t){ var t2=t*t,t3=t2*t; return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3); }
  function crEval(a,t){ var n=a.length; if(n<2) return a[0]||0; var pos=t*(n-1); var i=Math.floor(pos); if(i>n-2)i=n-2; if(i<0)i=0; var lt=pos-i;
    return cr(a[Math.max(i-1,0)],a[i],a[Math.min(i+1,n-1)],a[Math.min(i+2,n-1)],lt); }
  // EXACT BD clock: session starts 6:00 PM ET, runs 23h across t in [0,1]
  function clockT(t){ var sec=window.__cwToSec?window.__cwToSec(t):Math.round(64800+Math.abs(t)*82800)%86400; var totalMin=Math.round(sec/60)%1440; var H=Math.floor(totalMin/60),Mn=totalMin%60; var ap=H<12?'AM':'PM'; var h=H%12; if(h===0)h=12; return h+':'+String(Mn).padStart(2,'0')+' '+ap+' ET'; }
  function fmt(v){ return (v>=0?'+':'')+(Math.abs(v)>=1000?v.toFixed(0):v.toFixed(3)); }
  function tune(y, ripn){ return (ripn && root.QuanRipnTuning) ? root.QuanRipnTuning.apply(y, ripn) : y; }

  // EXACT port of BD drawAxisGraph onto a 2d context (lines:[{x,y,c,lw,lab}], x in [-1,1])
  function drawAxisGraph(ctx, w, h, opt) {
    opt = opt || {}; var lines = opt.lines, title = opt.title||'', xlabel = opt.xlabel||'', foot = opt.foot||'', hov = opt.hov||{t:null}, ripn = opt.ripn;
    ctx.fillStyle = C.BG; ctx.fillRect(0,0,w,h);
    if(!lines || !lines.length){ ctx.fillStyle='#8f8c82'; ctx.font='12px monospace'; ctx.textAlign='left'; ctx.fillText('load a session chain + anchor',16,26); return; }
    lines = lines.map(function(ln){ return {x:ln.x, y:tune(ln.y,ripn), c:ln.c, lw:ln.lw, lab:ln.lab}; });
    var padL=42,padR=14,padT=28,padB=30, x0=padL,x1=w-padR,y0=padT,y1=h-padB;
    var ylo=Infinity,yhi=-Infinity; lines.forEach(function(ln){ ln.y.forEach(function(v){ if(isFinite(v)){ if(v<ylo)ylo=v; if(v>yhi)yhi=v; } }); });
    if(!isFinite(ylo)){ylo=-1;yhi=1;} if(ylo===yhi){ylo-=1;yhi+=1;} var pdd=(yhi-ylo)*0.12; ylo-=pdd; yhi+=pdd;
    var xAt=function(t){ return x0+(t+1)/2*(x1-x0); }, yAt=function(v){ return y1-(v-ylo)/(yhi-ylo)*(y1-y0); };
    ctx.fillStyle=C.PLOT; ctx.fillRect(x0,y0,x1-x0,y1-y0);
    ctx.lineWidth=0.5; ctx.font='9px monospace'; ctx.fillStyle='#a6a299'; ctx.strokeStyle=C.GRID; ctx.textAlign='center';
    for(var t=-10;t<=10;t++){ var X=xAt(t/10); ctx.beginPath(); ctx.moveTo(X,y0); ctx.lineTo(X,y1); ctx.stroke(); if(t%2===0) ctx.fillText((t/10).toFixed(1),X,y1+13); }
    ctx.textAlign='right'; for(var k=0;k<=4;k++){ var v=ylo+(yhi-ylo)*k/4, Y=yAt(v); ctx.beginPath(); ctx.moveTo(x0,Y); ctx.lineTo(x1,Y); ctx.stroke(); ctx.fillText(v.toFixed(Math.abs(v)>=100?0:1),x0-4,Y+3); }
    if(ylo<0&&yhi>0){ ctx.strokeStyle=C.ZERO; ctx.lineWidth=0.8; var YZ=yAt(0); ctx.beginPath(); ctx.moveTo(x0,YZ); ctx.lineTo(x1,YZ); ctx.stroke(); }
    ctx.strokeStyle=C.FRAME; ctx.lineWidth=1; ctx.strokeRect(x0,y0,x1-x0,y1-y0);
    lines.forEach(function(ln){ var yy=ln.y, xx=ln.x, m=yy.length; ctx.strokeStyle=ln.c; ctx.lineWidth=ln.lw||1.5; ctx.beginPath();
      for(var i=0;i<m-1;i++){ var a=yy[Math.max(i-1,0)],b=yy[i],cc2=yy[i+1],dd=yy[Math.min(i+2,m-1)];
        var xa=xx[Math.max(i-1,0)],xb=xx[i],xc=xx[i+1],xd=xx[Math.min(i+2,m-1)];
        for(var sN=0;sN<=18;sN++){ var tt=sN/18; var XX=xAt(cr(xa,xb,xc,xd,tt)), YY=yAt(cr(a,b,cc2,dd,tt)); (i===0&&sN===0)?ctx.moveTo(XX,YY):ctx.lineTo(XX,YY); } }
      ctx.stroke(); });
    ctx.fillStyle=C.FG; ctx.font='12px monospace'; ctx.textAlign='left'; ctx.fillText(title,x0,18);
    ctx.font='9px monospace'; ctx.fillStyle='#8f8c82'; ctx.textAlign='center'; ctx.fillText(xlabel,(x0+x1)/2,h-6);
    if(foot){ ctx.textAlign='right'; ctx.fillStyle='#8f8c82'; ctx.font='9px monospace'; ctx.fillText(foot,x1,18); }
    ctx.textAlign='left'; ctx.font='9px monospace'; var ly=y1-4-lines.length*11;
    lines.forEach(function(ln){ ctx.strokeStyle=ln.c; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x0+6,ly); ctx.lineTo(x0+22,ly); ctx.stroke(); ctx.fillStyle=C.FG; ctx.fillText(ln.lab,x0+27,ly+3); ly+=11; });
    // events (breach crossings) labeled with session-time on the chronometer axis
    (opt.events||[]).forEach(function(ev){ var XE=xAt(ev.cw!=null?ev.cw:(ev.t*2-1)); ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=1; ctx.setLineDash([2,2]); ctx.beginPath(); ctx.moveTo(XE,y0); ctx.lineTo(XE,y1); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle=C.WHITE; ctx.beginPath(); ctx.arc(XE,y0+5,2.5,0,7); ctx.fill(); ctx.font='8px monospace'; ctx.textAlign='center'; ctx.fillText((ev.t!=null?ev.t.toFixed(2):''),XE,y0-2); });
  }

  // EXACT port of BD miniPanel grid (11-pt pair series on 0..1) for SOP-Fold sub-panel
  function drawMiniGrid(ctx, w, h, panels, ripn) {
    ctx.fillStyle=C.BG; ctx.fillRect(0,0,w,h);
    ctx.fillStyle=C.FG; ctx.font='10px monospace'; ctx.textAlign='left'; ctx.fillText('SOP Folding \u2014 full panel set  (shared chronometer x-axis)',12,14);
    var cols=3,rows=2, top=20, pw=(w-24)/cols, ph=(h-top-8)/rows;
    panels.forEach(function(p,i){ var cx=i%cols, cy=(i/cols)|0; mini(ctx, 12+cx*pw, top+cy*ph, pw-8, ph-6, p.lines.map(function(l){return {d:tune(l.d,ripn),c:l.c,lab:l.lab};}), p.title); });
  }
  function rangeOf(lns){ var lo=Infinity,hi=-Infinity; lns.forEach(function(ln){ ln.d.forEach(function(v){ if(isFinite(v)){ if(v<lo)lo=v; if(v>hi)hi=v; } }); }); if(!isFinite(lo)){lo=-1;hi=1;} if(lo===hi){lo-=1;hi+=1;} var pad=(hi-lo)*0.12; return [lo-pad,hi+pad]; }
  function mini(ctx,x0,y0,w,h,lns,title){
    var ix0=x0+30,iy0=y0+16,ix1=x0+w-8,iy1=y0+h-16; var r=rangeOf(lns), ylo=r[0],yhi=r[1];
    var xAt=function(t){return ix0+t*(ix1-ix0);}, yAt=function(v){return iy1-(v-ylo)/(yhi-ylo)*(iy1-iy0);};
    ctx.fillStyle=C.PLOT; ctx.fillRect(ix0,iy0,ix1-ix0,iy1-iy0);
    ctx.fillStyle='#a6a299'; ctx.font='8px monospace'; ctx.strokeStyle=C.FRAME; ctx.lineWidth=1; ctx.strokeRect(ix0,iy0,ix1-ix0,iy1-iy0);
    ctx.textAlign='right'; for(var kk=0;kk<=2;kk++){ var v=ylo+(yhi-ylo)*kk/2, Y=yAt(v); ctx.fillText(v.toFixed(Math.abs(v)>=100?0:1),ix0-3,Y+3); }
    if(ylo<0&&yhi>0){ ctx.strokeStyle=C.ZERO; ctx.lineWidth=0.6; var YZ=yAt(0); ctx.beginPath(); ctx.moveTo(ix0,YZ); ctx.lineTo(ix1,YZ); ctx.stroke(); }
    ctx.textAlign='center'; for(var tt=0;tt<=10;tt+=5){ ctx.fillStyle='#a6a299'; ctx.fillText((tt/10).toFixed(1),xAt(tt/10),iy1+11); }
    lns.forEach(function(ln){ ctx.strokeStyle=ln.c; ctx.lineWidth=1.3; ctx.beginPath(); ln.d.forEach(function(v,i){ var X=xAt(i/10),Y=yAt(v); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); }); ctx.stroke();
      ctx.fillStyle=ln.c; ln.d.forEach(function(v,i){ ctx.beginPath(); ctx.arc(xAt(i/10),yAt(v),1.8,0,7); ctx.fill(); }); });
    ctx.fillStyle=C.FG; ctx.font='8.5px monospace'; ctx.textAlign='left'; ctx.fillText(title,ix0,y0+10);
  }

  // map a realization payload -> CXG sub-panel line sets (chronometer axis = cwAxis)
  function panelsFromPayload(p) {
    var cw = p.cwAxis||[], pg=p.pressureGradient||[], pc=p.pressureCurvature||[];
    var prod = pg.map(function(v,i){ return v*(pc[i]||0); });
    var ev = (p.crossings_t||[]).map(function(t,i){ return {t:t, cw:(p.crossings_cw?p.crossings_cw[i]:(t*2-1))}; });
    var pr = (p.fold||[]).map(function(_,i){ return i; });
    return {
      pressure: { title:'PG\u00d7C \u2014 pressure gradient \u00d7 curvature (smoothed)', xlabel:'chronometer watch  (\u22121 below ATM \u00b7 0 ATM \u00b7 +1 above)',
        lines:[{x:cw,y:pg,c:C.GOLD,lw:1.6,lab:'pressure gradient (CC)'},{x:cw,y:pc,c:C.RED,lw:1.6,lab:'pressure curvature (CD)'},{x:cw,y:prod,c:C.WHITE,lw:2.0,lab:'PG\u00d7C (product)'}], events:ev },
      dual: { title:'Dual-Phase \u2014 U / V tensions (breach metric)', xlabel:'chronometer watch  (\u22121 below ATM \u00b7 0 ATM \u00b7 +1 above)',
        lines:[{x:cw,y:(p.tensionCL||p.dpGradient||[]),c:C.TEAL,lw:1.6,lab:'U \u00b7 R/S'},{x:cw,y:(p.tensionCM||p.dpCurvature||[]),c:C.RED,lw:1.6,lab:'V \u00b7 S/R'}], events:ev },
      family: { title:'Family \u2014 Curvature / Gradient', xlabel:'chronometer watch  (\u22121 below ATM \u00b7 0 ATM \u00b7 +1 above)',
        lines:[{x:cw,y:pc,c:C.RED,lw:1.6,lab:'Curvature (CD)'},{x:cw,y:pg,c:C.GOLD,lw:1.6,lab:'Gradient (CC)'}], events:ev },
      fold: { grid:true, panels:[
        {title:'product (fold/coherence)', lines:[{d:p.fold||[],c:C.WHITE}]},
        {title:'Product Tension (J+next)', lines:[{d:(p.fold||[]).map(function(v,i,a){return v+(a[i+1]||0);}),c:C.TEAL}]},
        {title:'Product Curvature', lines:[{d:(p.fold||[]).map(function(v,i,a){return (a[i+1]||0)-v;}),c:C.RED}]},
        {title:'SOPG / SOPC (ratio)', lines:[{d:(p.sopG||[]).map(function(v,i){return (p.sopC&&p.sopC[i])?v/p.sopC[i]:0;}),c:C.CYAN}]},
        {title:'SOPC / SOPG (inverse)', lines:[{d:(p.sopC||[]).map(function(v,i){return (p.sopG&&p.sopG[i])?v/p.sopG[i]:0;}),c:C.CYAN}]},
        {title:'SOPG & SOPC (raw factors)', lines:[{d:p.sopG||[],c:C.GOLD,lab:'SOPG'},{d:p.sopC||[],c:C.RED,lab:'SOPC'}]} ] }
    };
  }
  var api = { COLORS:C, cr:cr, crEval:crEval, clockT:clockT, fmt:fmt, drawAxisGraph:drawAxisGraph, drawMiniGrid:drawMiniGrid, panelsFromPayload:panelsFromPayload };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.QuanCXG = api;
})(typeof window !== "undefined" ? window : this);