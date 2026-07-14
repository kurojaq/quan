/* ==========================================================================
   QU'AN TIMESTATE TERMINAL — ZN (Promissory Notes) dedicated graphical engine.
   Standalone (timestate.html). Own storage namespace; nothing shared with the
   CME terminal or the CBOE app.

   A Barchart chain upload is parsed into the Golden Reference closure
   (QT.realizationWaves) and the breach tension closure (QT.computeTension).
   The chart plots the Book-sheet derivative stack — PG, PC(=∂PG), ∂²PG, ∂³PG —
   and the CL/CM dual-phase tension pair against the Chronometer Watch, with
   breach crossings, coherence breaks and zero-crossings as timestate events.

   Inherits the terminal's RIPN tuning tool: the handshake table (anchor-row
   selection re-runs the closure) and the global tuning controller
   (responsiveness / sensitivity / smoothing / weighting) shaping every curve.

   Graphical engine = breach-detector derivative: same axis geometry, zoom/pan,
   crosshair clock + mirror guide, fit ladder — plus a vector annotation suite
   (line/arrow/rect/ellipse/level/timeline/measure/free/text/erase) anchored in
   DATA coordinates so annotations survive zoom, pan and reload.
   ========================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const INST = 'ZN';
  const STORE_KEY = 'quan_ts_zn_store_v1', SEL_KEY = 'quan_ts_zn_sel_v1',
        ANNOT_KEY = 'quan_ts_zn_annot_v1', TUNE_KEY = 'quan_ts_zn_tune_v1';

  /* ---------------- persistence (standalone: localStorage only) ---------- */
  function lsGet(k, fb) { try { const s = localStorage.getItem(k); return s != null ? JSON.parse(s) : fb; } catch (_) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  let store = lsGet(STORE_KEY, {});      // {date: {chain:text, fn:name}}
  let annots = lsGet(ANNOT_KEY, {});     // {date: [annotation...]}
  let ripnSel = lsGet(SEL_KEY + '_ripn', {});  // {date: anchorRowIdx}
  let date = (lsGet(SEL_KEY, {}) || {}).date || todayISO();

  const tune = QT.Tuning.create(lsGet(TUNE_KEY, null) || { responsiveness: 1, sensitivity: 0, smoothing: 0, weighting: 1 });

  function todayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  const saveSel = () => lsSet(SEL_KEY, { date });
  const saveStore = () => lsSet(STORE_KEY, store);
  const saveAnnots = () => lsSet(ANNOT_KEY, annots);
  const saveRipn = () => lsSet(SEL_KEY + '_ripn', ripnSel);
  const saveTune = () => lsSet(TUNE_KEY, tune.global());

  /* ---------------- session clock (ET, 18:00 open, 23h) ------------------ */
  const _etClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function sessionT() { const P = {}; for (const p of _etClock.formatToParts(new Date())) P[p.type] = p.value;
    let h = +P.hour; if (h >= 24) h -= 24; const sod = h * 3600 + (+P.minute) * 60 + (+P.second);
    let el = (h >= 18) ? (sod - 64800) : (sod + 21600); let pt = el / 82800; return pt < 0 ? 0 : (pt > 1 ? 1 : pt); }

  /* ---------------- DOM ----------------------------------------------- */
  const canvas = $('tsChart'), ctx = canvas.getContext('2d');
  const overlay = $('tsOverlay'), octx = overlay.getContext('2d');
  const chartwrap = canvas.parentElement;
  const dotTip = $('tsTip'), legend = $('tsLegend'), infoLine = $('tsInfo'),
        eventStrip = $('tsEvents'), fnLabel = $('tsFn'), sessTEl = $('sessT'),
        dayDate = $('tsDate');

  /* ---------------- series model ----------------------------------------
     key, label, source, group ('deriv' = own scale, 'tension' = shared scale
     so CL×CM crossings stay geometric under normalize) */
  const SERIES_DEF = [
    { key: 'PG',  label: 'PG · pressure gradient',   color: '#e8b53a', group: 'deriv' },
    { key: 'PC',  label: 'PC · ∂PG',            color: '#6fd3ff', group: 'deriv' },
    { key: 'D2',  label: '∂²PG',           color: '#c9a0ff', group: 'deriv' },
    { key: 'D3',  label: '∂³PG',           color: '#5fcf8f', group: 'deriv' },
    { key: 'CL',  label: 'PG/PC dual-phase tension', color: '#d36b9b', group: 'tension' },
    { key: 'CM',  label: 'PC/PG dual-phase tension', color: '#5aa0d8', group: 'tension' }
  ];
  const vis = { PG: true, PC: true, D2: false, D3: false, CL: true, CM: true };

  let rw = null, tens = null;            // raw closures for the loaded chain
  let P = null;                          // plotted model {cw, series:{key:{ys,scale}}, breaches, events}
  let highlight = null, rafId = null, t0 = 0, screenPts = [];
  let viewLo = -1, viewHi = 1, yScale = 1, yPan = 0, GEO = null, cursor = null;
  let flashCW = null, flashT0 = 0;       // event-chip click flash marker

  /* ---------------- compute pipeline ------------------------------------- */
  function recompute() {
    rw = null; tens = null;
    const cell = store[date];
    if (cell && cell.chain) {
      try { const rows = QT.ingestChain(cell.chain); if (rows) rw = QT.realizationWaves(rows, (date in ripnSel) ? ripnSel[date] : null); } catch (_) { rw = null; }
      try { const trows = QT.parseTensionChain(cell.chain); if (trows && trows.length >= 17) tens = QT.computeTension(trows); } catch (_) { tens = null; }
    }
    buildPlot();
    renderInfo(); renderRipn(); buildLegend(); renderEvents(); renderTexts(); draw();
  }

  function buildPlot() {
    P = { cw: null, series: {}, breaches: [], events: [] };
    const cfg = tune.forInstrument(INST);
    const doNorm = $('normToggle').checked;
    function maxAbs(a) { let m = 0; for (const v of a) { const x = Math.abs(v); if (isFinite(x) && x > m) m = x; } return m; }
    function put(key, ys) { P.series[key] = { raw: ys, tuned: QT.Tuning.apply(ys, cfg), scale: 1 }; }
    if (rw) {
      P.cw = rw.cw;
      const d2 = QT.bookDeriv(rw.cd, rw.cw), d3 = QT.bookDeriv(d2, rw.cw);
      put('PG', rw.cc); put('PC', rw.cd); put('D2', d2); put('D3', d3);
    }
    if (tens) {
      P.cw = P.cw || tens.CI;
      put('CL', tens.CL); put('CM', tens.CM);
    }
    // scaling: derivative series each to unit max-abs; CL/CM share one factor
    if (doNorm) {
      for (const def of SERIES_DEF) { const s = P.series[def.key]; if (!s || def.group !== 'deriv') continue;
        const m = maxAbs(s.tuned); s.scale = m > 0 ? 1 / m : 1; }
      const cl = P.series.CL, cm = P.series.CM;
      if (cl || cm) { const m = Math.max(cl ? maxAbs(cl.tuned) : 0, cm ? maxAbs(cm.tuned) : 0);
        const f = m > 0 ? 1 / m : 1; if (cl) cl.scale = f; if (cm) cm.scale = f; }
    }
    for (const k in P.series) { const s = P.series[k]; s.ys = s.tuned.map(v => v * s.scale); }
    // timestate events from the plotted (tuned) geometry
    if (P.series.CL && P.series.CM && P.cw)
      P.breaches = QT.findBreaches(P.cw, P.series.CL.ys, P.series.CM.ys);
    const ev = [];
    for (const b of P.breaches) ev.push({ cw: b.cw, kind: 'breach', label: 'breach' });
    if (rw) for (const c of rw.cross) ev.push({ cw: c, kind: 'coherence', label: 'coherence break' });
    if (P.series.PG && P.cw) for (const z of QT.zeroCrossings(P.cw, P.series.PG.ys)) ev.push({ cw: z.cw, kind: 'pg0', label: 'PG zero' });
    if (P.series.PC && P.cw) for (const z of QT.zeroCrossings(P.cw, P.series.PC.ys)) ev.push({ cw: z.cw, kind: 'pc0', label: 'PC zero' });
    ev.sort((a, b) => a.cw - b.cw);
    P.events = ev;
  }

  /* ---------------- header info / legend / events ------------------------ */
  function renderInfo() {
    if (!rw && !tens) { infoLine.textContent = 'No session loaded — upload a Barchart options chain CSV for ' + date + '.'; return; }
    const bits = [];
    if (rw) { bits.push('golden · anchor ' + rw.anchor_strike + (rw.manual_anchor ? ' (handshake)' : ' (auto)'));
      bits.push(rw.n_strikes + ' strikes'); if (!rw.covered) bits.push('⚠ window not fully covered'); }
    else bits.push('golden closure unavailable (named Strike/Premium/Open Int columns not found)');
    if (!tens) bits.push('tension closure unavailable (side-by-side layout not detected)');
    if (P.breaches.length) bits.push(P.breaches.length + ' breach' + (P.breaches.length > 1 ? 'es' : ''));
    if (rw && rw.cross.length) bits.push('coherence breaks CW ' + rw.cross.join(', '));
    infoLine.textContent = bits.join(' · ');
  }

  function buildLegend() {
    legend.innerHTML = SERIES_DEF.map(def => {
      const s = P && P.series[def.key]; if (!s) return '';
      const scaleNote = (s.scale !== 1) ? ' <span class="scl">×' + fmtScale(s.scale) + '</span>' : '';
      return '<span class="ltog' + (vis[def.key] ? '' : ' off') + '" data-k="' + def.key + '" title="click: show/hide">' +
        '<span class="sw" style="border-top-color:' + def.color + '"></span>' + def.label + scaleNote + '</span>';
    }).join('') +
    '<span><span class="dot" style="background:#e85c5c"></span>breach</span>' +
    '<span><span class="dot" style="background:#e8b53a"></span>coherence</span>';
  }
  function fmtScale(s) { const v = s; if (v >= 1000) return (v / 1000).toFixed(1) + 'k'; if (v >= 10) return v.toFixed(0); return v.toPrecision(3); }
  legend.addEventListener('click', e => { const lt = e.target.closest('.ltog'); if (!lt) return;
    const k = lt.dataset.k; vis[k] = !vis[k]; buildLegend(); draw(); });

  const EV_COLORS = { breach: '#e85c5c', coherence: '#e8b53a', pg0: '#8f8c82', pc0: '#8f8c82' };
  function renderEvents() {
    if (!P || !P.events.length) { eventStrip.innerHTML = '<span class="empty">— timestate events appear once a chain is loaded</span>'; return; }
    eventStrip.innerHTML = P.events.map((ev, i) =>
      '<span class="chip evchip" data-i="' + i + '" style="color:' + EV_COLORS[ev.kind] + '">' +
      QT.cwClock(ev.cw) + ' ET · ' + ev.label + ' · CW ' + ev.cw.toFixed(3) + '</span>').join('');
  }
  eventStrip.addEventListener('click', e => { const c = e.target.closest('.evchip'); if (!c || !P) return;
    const ev = P.events[+c.dataset.i]; if (!ev) return; flashCW = ev.cw; flashT0 = performance.now(); startLoop(); });

  /* ---------------- chart geometry --------------------------------------- */
  let W = 0, H = 0; const PAD_L = 52, PAD_R = 24, PAD_T = 26, PAD_B = 36;
  function sizeCanvas() { const dpr = window.devicePixelRatio || 1; const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr); octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h; draw(); }
  new ResizeObserver(sizeCanvas).observe(canvas);

  function extent() { let lo = Infinity, hi = -Infinity;
    if (P) for (const def of SERIES_DEF) { const s = P.series[def.key]; if (!s || !vis[def.key]) continue;
      for (const v of s.ys) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (!isFinite(lo)) return [-1, 1];
    if (lo === hi) { lo -= 1; hi += 1; } const p = (hi - lo) * 0.08; return [lo - p, hi + p]; }
  function fmt(v) { const a = Math.abs(v); if (a >= 1000) return (v / 1000).toFixed(1) + 'k'; if (a >= 10) return v.toFixed(0); return v.toFixed(2); }
  function smooth(c, pts) { if (pts.length < 2) return; c.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      c.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y); } }

  function startLoop() { t0 = t0 || performance.now(); if (!rafId) rafId = requestAnimationFrame(loop); }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } draw(); }
  function loop(now) { draw(now);
    const needs = highlight || (flashCW != null && now - flashT0 < 1600);
    if (flashCW != null && now - flashT0 >= 1600) flashCW = null;
    if (needs) rafId = requestAnimationFrame(loop); else { rafId = null; draw(); } }

  /* ---------------- main draw -------------------------------------------- */
  function draw(now) {
    if (!W || !H) return; now = (typeof now === 'number') ? now : 0;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#050506'; ctx.fillRect(0, 0, W, H);
    const pW = W - PAD_L - PAD_R, pH = H - PAD_T - PAD_B;
    const ex = extent();
    const c0 = (ex[0] + ex[1]) / 2 - yPan * (ex[1] - ex[0]); const hh = (ex[1] - ex[0]) / 2 / yScale;
    const zA = [c0 - hh, c0 + hh];
    const mapX = cw => PAD_L + ((cw - viewLo) / (viewHi - viewLo)) * pW;
    const invX = px => viewLo + ((px - PAD_L) / pW) * (viewHi - viewLo);
    const mapY = v => PAD_T + (1 - (v - zA[0]) / (zA[1] - zA[0])) * pH;
    const invY = py => zA[0] + (1 - (py - PAD_T) / pH) * (zA[1] - zA[0]);
    GEO = { pW, pH, mapX, invX, mapY, invY };
    const clampY = y => Math.max(PAD_T, Math.min(PAD_T + pH, y));
    const cx = mapX(0), baseY = clampY(mapY(0));

    // BD-style flat field: no inner panel, dotted zero line, near-invisible grid
    const ti0 = Math.ceil(viewLo * 10 - 1e-9), ti1 = Math.floor(viewHi * 10 + 1e-9);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
    for (let i = ti0; i <= ti1; i++) { const x = mapX(i / 10); ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + pH); ctx.stroke(); }

    ctx.strokeStyle = 'rgba(232,227,214,0.30)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(PAD_L, baseY); ctx.lineTo(PAD_L + pW, baseY); ctx.stroke(); ctx.setLineDash([]);
    if (cx >= PAD_L && cx <= PAD_L + pW) { ctx.strokeStyle = 'rgba(232,227,214,0.14)';
      ctx.beginPath(); ctx.moveTo(cx, PAD_T); ctx.lineTo(cx, PAD_T + pH); ctx.stroke(); }

    // watch ticks on the zero line; CW labels only at the 0.5 majors (BD axis)
    ctx.font = '10px SF Mono,Menlo,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = ti0; i <= ti1; i++) { const v = i / 10, x = mapX(v), maj = (i % 5 === 0);
      ctx.strokeStyle = 'rgba(232,227,214,' + (maj ? 0.35 : 0.15) + ')'; ctx.lineWidth = maj ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(x, baseY - (maj ? 4 : 2)); ctx.lineTo(x, baseY + (maj ? 4 : 2)); ctx.stroke();
      if (maj) { ctx.fillStyle = '#5a574f'; ctx.fillText(v.toFixed(1).replace('-0.0', '0.0'), x, PAD_T + pH + 6); } }

    // y labels
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#5a574f'; ctx.font = '9px SF Mono,Menlo,monospace';
    for (let i = 0; i <= 4; i++) { const val = zA[0] + (i / 4) * (zA[1] - zA[0]), y = PAD_T + (1 - i / 4) * pH;
      ctx.strokeStyle = 'rgba(232,227,214,0.18)'; ctx.lineWidth = 0.5; ctx.textAlign = 'right';
      ctx.beginPath(); ctx.moveTo(PAD_L - 4, y); ctx.lineTo(PAD_L, y); ctx.stroke(); ctx.fillText(fmt(val), PAD_L - 7, y); }

    ctx.save(); ctx.beginPath(); ctx.rect(PAD_L, PAD_T, pW, pH); ctx.clip();

    // live chronometer position (current session)
    const st = sessionT();
    if (st > 0 && st < 1) { const sx = mapX(st);
      if (sx >= PAD_L && sx <= PAD_L + pW) { ctx.strokeStyle = 'rgba(232,227,214,0.22)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
        ctx.beginPath(); ctx.moveTo(sx, PAD_T); ctx.lineTo(sx, PAD_T + pH); ctx.stroke(); ctx.setLineDash([]); } }

    // series
    if (P) for (const def of SERIES_DEF) { const s = P.series[def.key]; if (!s || !vis[def.key]) continue;
      const pts = P.cw.map((cw, i) => ({ x: mapX(cw), y: mapY(s.ys[i]) }));
      ctx.save(); ctx.strokeStyle = def.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      if (fitOn()) ctx.globalAlpha = 0.26;
      ctx.beginPath(); smooth(ctx, pts); ctx.stroke(); ctx.restore(); }

    // fit ladder on the selected target series
    if (fitOn() && P) { const tk = $('fitTarget').value, s = P.series[tk];
      if (s && P.cw && P.cw.length >= 8) { const maxO = fitMaxO(), N = 160, x0 = P.cw[0], x1 = P.cw[P.cw.length - 1];
        for (let deg = 1; deg <= maxO; deg++) { if (P.cw.length < deg + 1) break;
          const c = QT.Poly.fit(P.cw, s.ys, deg);
          ctx.save(); ctx.strokeStyle = FITC[deg] || '#fff'; ctx.lineWidth = Math.max(0.8, 1.8 - (deg - 1) * 0.1);
          ctx.lineJoin = 'round'; ctx.beginPath();
          for (let i = 0; i <= N; i++) { const xv = x0 + (x1 - x0) * i / N, X = mapX(xv), Y = mapY(QT.Poly.evalAt(c, xv)); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
          ctx.stroke(); ctx.restore(); } } }

    // PG/PC zero crossings: open circles pinned to the zero line (BD style)
    if (P) for (const ev of P.events) { if (ev.kind !== 'pg0' && ev.kind !== 'pc0') continue;
      const x = mapX(ev.cw); if (x < PAD_L || x > PAD_L + pW) continue;
      ctx.strokeStyle = 'rgba(232,227,214,0.8)'; ctx.lineWidth = 1.2; ctx.fillStyle = '#050506';
      ctx.beginPath(); ctx.arc(x, baseY, 3.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }

    // breach markers: open triangles on the CL curve (BD style)
    screenPts = [];
    if (P && vis.CL && vis.CM) P.breaches.forEach(bp => { const x = mapX(bp.cw), y = mapY(bp.val);
      drawDot(x, y, highlight && highlight.cw === bp.cw, now); screenPts.push({ x, y, cw: bp.cw }); });

    // coherence break markers (golden fold sign flips)
    if (rw) for (const c of rw.cross) { const x = mapX(c); if (x < PAD_L || x > PAD_L + pW) continue;
      ctx.strokeStyle = 'rgba(232,181,58,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + pH); ctx.stroke(); ctx.setLineDash([]); }

    // event-chip flash
    if (flashCW != null) { const ph = Math.min(1, (now - flashT0) / 1600); const x = mapX(flashCW);
      ctx.fillStyle = 'rgba(232,227,214,' + (0.18 * (1 - ph)).toFixed(3) + ')';
      ctx.fillRect(x - 14 * (1 - ph) - 1, PAD_T, 28 * (1 - ph) + 2, pH); }

    // crosshair + mirror guide + clock label
    if (cursor && !tool && !dragPan) { const mx = cursor.x, my = cursor.y;
      if (mx >= PAD_L && mx <= PAD_L + pW && my >= PAD_T && my <= PAD_T + pH) { const cw = invX(mx);
        const guide = (cwv, a) => { const gx = mapX(cwv); if (gx < PAD_L - 1 || gx > PAD_L + pW + 1) return;
          ctx.strokeStyle = 'rgba(232,227,214,' + a + ')'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(gx, PAD_T); ctx.lineTo(gx, PAD_T + pH); ctx.stroke(); ctx.setLineDash([]);
          if (P) for (const def of SERIES_DEF) { const s = P.series[def.key]; if (!s || !vis[def.key]) continue;
            const v = interpAt(P.cw, s.ys, cwv); if (v == null) continue;
            ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(gx, mapY(v), 3.4, 0, Math.PI * 2); ctx.fill(); }
          const lab = 'τ ' + cwv.toFixed(3) + ' · ' + QT.cwClock12(cwv) + ' ET'; ctx.font = '10px SF Mono,Menlo,monospace'; const tw = ctx.measureText(lab).width + 14;
          const lx = Math.max(PAD_L, Math.min(PAD_L + pW - tw, gx - tw / 2));
          ctx.fillStyle = 'rgba(10,10,11,0.94)'; ctx.fillRect(lx, PAD_T + 2, tw, 18); ctx.strokeStyle = '#3a3a42'; ctx.lineWidth = 0.5; ctx.strokeRect(lx, PAD_T + 2, tw, 18);
          ctx.fillStyle = '#e8e3d6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lab, lx + tw / 2, PAD_T + 11); };
        guide(cw, 0.5);
        if (Math.abs(cw) > 0.012) guide(-cw, 0.3);
      } }
    ctx.restore();

    // BD corner furniture
    ctx.font = '10px SF Mono,Menlo,monospace'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(232,227,214,0.30)'; ctx.textAlign = 'left';
    ctx.fillText('ZN Timestate', 8, H - 8);
    ctx.fillStyle = 'rgba(232,227,214,0.20)'; ctx.textAlign = 'right';
    ctx.fillText('scroll: zoom · shift+scroll: y · dbl-click: reset', W - 8, H - 8);
    if (P && P.breaches.length) { ctx.fillStyle = 'rgba(232,227,214,0.5)';
      ctx.fillText('Breach · ' + P.breaches.length, W - 8, 16); }

    drawAnnots(now);
    positionTexts();
  }

  function interpAt(cw, ys, x) { if (!cw || !cw.length || x < cw[0] || x > cw[cw.length - 1]) return null;
    for (let i = 0; i < cw.length - 1; i++) { if (x >= cw[i] && x <= cw[i + 1]) { const t = (cw[i + 1] === cw[i]) ? 0 : (x - cw[i]) / (cw[i + 1] - cw[i]);
      return ys[i] + t * (ys[i + 1] - ys[i]); } } return ys[ys.length - 1]; }
  // BD marker: open triangle, no glow; hover = thin expanding ring
  function drawDot(x, y, hl, now) { if (hl) { const ph = ((now - t0) % 900) / 900; ctx.strokeStyle = 'rgba(232,227,214,' + (0.7 * (1 - ph)).toFixed(3) + ')'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 6 + ph * 14, 0, Math.PI * 2); ctx.stroke(); }
    const r = hl ? 5.5 : 4.5;
    ctx.save(); ctx.strokeStyle = '#e8e3d6'; ctx.lineWidth = 1.4; ctx.fillStyle = '#050506';
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.87, y + r * 0.5); ctx.lineTo(x - r * 0.87, y + r * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }

  const FITC = { 1: '#e8b53a', 2: '#6fd3ff', 3: '#c9a0ff', 4: '#f06a6a', 5: '#5fcf8f', 6: '#ff9a4d', 7: '#9fb0ff', 8: '#ff7fd0', 9: '#d4c47a' };
  function fitOn() { return $('fitToggle').checked; }
  function fitMaxO() { const e = $('fitOrder'); return e ? Math.max(1, Math.min(9, (+e.value) || 4)) : 4; }

  /* ---------------- annotation suite (vector, data-anchored) -------------
     Model: {type, color, w, ...coords in data space}
       free    {pts:[{cw,v}]}       line/arrow/rect/ellipse/measure {a:{cw,v}, b:{cw,v}}
       hline   {v}                  vline {cw}
       text    {cw,v,text}  — rendered as draggable DOM notes
     All redrawn from the model every frame -> they survive zoom/pan/reload. */
  let tool = null, drawing = false, temp = null, dragPan = null;
  let penColor = '#ffe14d', penW = 2.4;
  const undoStack = [];
  function A() { return annots[date] || (annots[date] = []); }
  function pushUndo() { undoStack.push(JSON.stringify(A())); if (undoStack.length > 60) undoStack.shift(); }
  function undo() { if (!undoStack.length) return; annots[date] = JSON.parse(undoStack.pop()); saveAnnots(); renderTexts(); draw(); }
  function clearAll() { if (!A().length) return; pushUndo(); annots[date] = []; saveAnnots(); renderTexts(); draw(); }

  function drawAnnots(now) {
    octx.save(); octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, overlay.width, overlay.height); octx.restore();
    if (!GEO) return;
    octx.save(); octx.beginPath(); octx.rect(PAD_L, PAD_T, GEO.pW, GEO.pH); octx.clip();
    for (const a of A()) renderAnnot(a);
    if (temp) renderAnnot(temp, true);
    octx.restore();
  }
  function renderAnnot(a, isTemp) {
    const mX = GEO.mapX, mY = GEO.mapY;
    octx.strokeStyle = a.color; octx.fillStyle = a.color; octx.lineWidth = a.w; octx.lineCap = 'round'; octx.lineJoin = 'round';
    octx.setLineDash(isTemp ? [5, 4] : []);
    switch (a.type) {
      case 'free': { if (a.pts.length < 2) break; octx.beginPath(); octx.moveTo(mX(a.pts[0].cw), mY(a.pts[0].v));
        for (let i = 1; i < a.pts.length; i++) octx.lineTo(mX(a.pts[i].cw), mY(a.pts[i].v)); octx.stroke(); break; }
      case 'line': case 'arrow': { const x1 = mX(a.a.cw), y1 = mY(a.a.v), x2 = mX(a.b.cw), y2 = mY(a.b.v);
        octx.beginPath(); octx.moveTo(x1, y1); octx.lineTo(x2, y2); octx.stroke();
        if (a.type === 'arrow') { const an = Math.atan2(y2 - y1, x2 - x1), len = 12, sp = Math.PI / 7;
          octx.beginPath(); octx.moveTo(x2, y2); octx.lineTo(x2 - len * Math.cos(an - sp), y2 - len * Math.sin(an - sp));
          octx.moveTo(x2, y2); octx.lineTo(x2 - len * Math.cos(an + sp), y2 - len * Math.sin(an + sp)); octx.stroke(); } break; }
      case 'rect': { const x = Math.min(mX(a.a.cw), mX(a.b.cw)), y = Math.min(mY(a.a.v), mY(a.b.v));
        const w = Math.abs(mX(a.b.cw) - mX(a.a.cw)), h = Math.abs(mY(a.b.v) - mY(a.a.v));
        octx.strokeRect(x, y, w, h); octx.save(); octx.globalAlpha = 0.08; octx.fillRect(x, y, w, h); octx.restore(); break; }
      case 'ellipse': { const cx = (mX(a.a.cw) + mX(a.b.cw)) / 2, cy = (mY(a.a.v) + mY(a.b.v)) / 2;
        const rx = Math.abs(mX(a.b.cw) - mX(a.a.cw)) / 2, ry = Math.abs(mY(a.b.v) - mY(a.a.v)) / 2;
        octx.beginPath(); octx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2); octx.stroke(); break; }
      case 'hline': { const y = mY(a.v); octx.beginPath(); octx.moveTo(PAD_L, y); octx.lineTo(PAD_L + GEO.pW, y); octx.stroke();
        tag(fmt(a.v), PAD_L + 4, y - 9, a.color); break; }
      case 'vline': { const x = mX(a.cw); octx.beginPath(); octx.moveTo(x, PAD_T); octx.lineTo(x, PAD_T + GEO.pH); octx.stroke();
        tag(QT.cwClock(a.cw) + ' ET', x + 4, PAD_T + GEO.pH - 20, a.color); break; }
      case 'measure': { const x1 = mX(a.a.cw), y1 = mY(a.a.v), x2 = mX(a.b.cw), y2 = mY(a.b.v);
        octx.setLineDash([4, 4]); octx.beginPath(); octx.moveTo(x1, y1); octx.lineTo(x2, y1); octx.lineTo(x2, y2); octx.stroke(); octx.setLineDash(isTemp ? [5, 4] : []);
        octx.beginPath(); octx.moveTo(x1, y1); octx.lineTo(x2, y2); octx.stroke();
        octx.beginPath(); octx.arc(x1, y1, 2.6, 0, Math.PI * 2); octx.fill(); octx.beginPath(); octx.arc(x2, y2, 2.6, 0, Math.PI * 2); octx.fill();
        const dcw = a.b.cw - a.a.cw, dmin = Math.round(Math.abs(QT.cwToSec(a.b.cw) - QT.cwToSec(a.a.cw)) / 60), dv = a.b.v - a.a.v;
        tag('ΔCW ' + dcw.toFixed(3) + ' · Δt ' + dmin + 'm · Δv ' + dv.toFixed(3), (x1 + x2) / 2 - 60, (y1 + y2) / 2 - 20, a.color); break; }
    }
    octx.setLineDash([]);
  }
  function tag(text, x, y, color) { octx.save(); octx.font = '10px SF Mono,Menlo,monospace';
    const tw = octx.measureText(text).width + 10;
    octx.fillStyle = 'rgba(18,18,22,0.92)'; octx.fillRect(x, y, tw, 16);
    octx.strokeStyle = '#4c4c54'; octx.lineWidth = 0.5; octx.strokeRect(x, y, tw, 16);
    octx.fillStyle = color; octx.textAlign = 'left'; octx.textBaseline = 'middle'; octx.fillText(text, x + 5, y + 8); octx.restore(); }

  /* text notes: DOM, data-anchored, draggable, persisted */
  function renderTexts() {
    chartwrap.querySelectorAll('.tsnote').forEach(n => n.remove());
    A().forEach((a, i) => { if (a.type !== 'text') return; makeNote(a); });
    positionTexts();
  }
  function makeNote(a) {
    const b = document.createElement('div'); b.className = 'tsnote'; b.__a = a;
    const head = document.createElement('div'); head.className = 'tsn-head';
    const x = document.createElement('span'); x.className = 'tsn-x'; x.innerHTML = '&#10006;'; x.title = 'Delete note';
    x.addEventListener('click', () => { pushUndo(); const arr = A(); const ix = arr.indexOf(a); if (ix >= 0) arr.splice(ix, 1); saveAnnots(); b.remove(); });
    head.appendChild(x);
    const ta = document.createElement('textarea'); ta.placeholder = 'note…'; ta.value = a.text || '';
    let tmr = null; ta.addEventListener('input', () => { a.text = ta.value; clearTimeout(tmr); tmr = setTimeout(saveAnnots, 400); });
    b.appendChild(head); b.appendChild(ta); chartwrap.appendChild(b);
    head.addEventListener('pointerdown', e => { if (e.target === x) return; e.preventDefault();
      const wr = chartwrap.getBoundingClientRect(); const bx = b.getBoundingClientRect(); const ox = e.clientX - bx.left, oy = e.clientY - bx.top;
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      const mv = ev => { let nx = ev.clientX - wr.left - ox, ny = ev.clientY - wr.top - oy;
        nx = Math.max(0, Math.min(wr.width - b.offsetWidth, nx)); ny = Math.max(0, Math.min(wr.height - b.offsetHeight, ny));
        b.style.left = nx + 'px'; b.style.top = ny + 'px';
        if (GEO) { a.cw = GEO.invX(nx); a.v = GEO.invY(ny); } };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); saveAnnots(); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); });
    return b;
  }
  function positionTexts() { if (!GEO) return;
    chartwrap.querySelectorAll('.tsnote').forEach(b => { const a = b.__a; if (!a) return;
      b.style.left = Math.max(0, GEO.mapX(a.cw)) + 'px'; b.style.top = Math.max(0, GEO.mapY(a.v)) + 'px'; }); }

  /* tool selection */
  const TOOLS = ['free', 'line', 'arrow', 'rect', 'ellipse', 'hline', 'vline', 'measure', 'erase'];
  function setTool(t) { tool = (tool === t) ? null : t;
    for (const k of TOOLS) { const b = $('tool_' + k); if (b) b.classList.toggle('on', tool === k); }
    overlay.style.pointerEvents = tool ? 'auto' : 'none';
    overlay.style.cursor = tool === 'erase' ? 'not-allowed' : 'crosshair';
    drawing = false; temp = null;
    if (tool) { cursor = null; dotTip.style.display = 'none'; }
    draw(); }
  TOOLS.forEach(k => { const b = $('tool_' + k); if (b) b.addEventListener('click', () => setTool(k)); });
  $('tool_text').addEventListener('click', () => { // drop a note at plot center
    pushUndo(); const a = { type: 'text', cw: GEO ? GEO.invX(PAD_L + GEO.pW / 2 + ((A().length % 6) * 22)) : 0,
      v: GEO ? GEO.invY(PAD_T + 40 + ((A().length % 6) * 22)) : 0, text: '' };
    A().push(a); saveAnnots(); const b = makeNote(a); positionTexts(); const ta = b.querySelector('textarea'); setTimeout(() => ta.focus(), 0); });
  $('undoBtn').addEventListener('click', undo);
  $('clearDraw').addEventListener('click', clearAll);
  document.querySelectorAll('.tspal .swb').forEach(s => s.addEventListener('click', () => {
    penColor = s.dataset.c; document.querySelectorAll('.tspal .swb').forEach(o => o.classList.toggle('on', o === s)); }));
  $('penW').addEventListener('input', () => { penW = +$('penW').value; });

  function evPt(e) { const r = overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function toData(p) { return { cw: GEO.invX(p.x), v: GEO.invY(p.y) }; }
  overlay.addEventListener('pointerdown', e => { if (!tool || !GEO) return;
    const p = evPt(e), d = toData(p);
    if (tool === 'erase') { eraseAt(p); return; }
    drawing = true;
    if (tool === 'free') temp = { type: 'free', pts: [d], color: penColor, w: penW };
    else if (tool === 'hline') temp = { type: 'hline', v: d.v, color: penColor, w: penW };
    else if (tool === 'vline') temp = { type: 'vline', cw: d.cw, color: penColor, w: penW };
    else temp = { type: tool, a: d, b: d, color: penColor, w: penW };
    try { overlay.setPointerCapture(e.pointerId); } catch (_) {}
    draw(); });
  overlay.addEventListener('pointermove', e => { if (!tool || !drawing || !temp || !GEO) return;
    const d = toData(evPt(e));
    if (temp.type === 'free') temp.pts.push(d);
    else if (temp.type === 'hline') temp.v = d.v;
    else if (temp.type === 'vline') temp.cw = d.cw;
    else temp.b = d;
    draw(); });
  function commitTemp() { if (!temp) return;
    if (temp.type === 'free' && temp.pts.length < 2) { temp = null; draw(); return; }
    pushUndo(); A().push(temp); temp = null; saveAnnots(); draw(); }
  overlay.addEventListener('pointerup', () => { if (drawing) { drawing = false; commitTemp(); } });
  overlay.addEventListener('pointerleave', () => { if (drawing) { drawing = false; commitTemp(); } });
  overlay.addEventListener('wheel', e => { e.preventDefault(); }, { passive: false });

  function eraseAt(p) { const arr = A(); let best = 10, bi = -1;
    for (let i = 0; i < arr.length; i++) { const d = annotDist(arr[i], p); if (d < best) { best = d; bi = i; } }
    if (bi >= 0) { pushUndo(); arr.splice(bi, 1); saveAnnots(); renderTexts(); draw(); } }
  function segDist(p, x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; const L2 = dx * dx + dy * dy;
    let t = L2 ? ((p.x - x1) * dx + (p.y - y1) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy)); }
  function annotDist(a, p) { const mX = GEO.mapX, mY = GEO.mapY;
    switch (a.type) {
      case 'free': { let m = Infinity; for (let i = 0; i < a.pts.length - 1; i++)
        m = Math.min(m, segDist(p, mX(a.pts[i].cw), mY(a.pts[i].v), mX(a.pts[i + 1].cw), mY(a.pts[i + 1].v))); return m; }
      case 'line': case 'arrow': case 'measure': return segDist(p, mX(a.a.cw), mY(a.a.v), mX(a.b.cw), mY(a.b.v));
      case 'rect': case 'ellipse': { const x1 = mX(a.a.cw), y1 = mY(a.a.v), x2 = mX(a.b.cw), y2 = mY(a.b.v);
        return Math.min(segDist(p, x1, y1, x2, y1), segDist(p, x2, y1, x2, y2), segDist(p, x2, y2, x1, y2), segDist(p, x1, y2, x1, y1)); }
      case 'hline': return Math.abs(p.y - mY(a.v));
      case 'vline': return Math.abs(p.x - mX(a.cw));
      case 'text': return Math.hypot(p.x - mX(a.cw), p.y - mY(a.v));
    } return Infinity; }

  /* ---------------- pointer: hover / zoom / pan on the base canvas ------- */
  canvas.addEventListener('mousemove', e => { const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (dragPan && GEO) { const dcw = GEO.invX(dragPan.x) - GEO.invX(mx); let lo = viewLo + dcw, hi = viewHi + dcw;
      const w = hi - lo; if (lo < -1) { lo = -1; hi = lo + w; } if (hi > 1) { hi = 1; lo = hi - w; } viewLo = lo; viewHi = hi;
      yPan -= (my - dragPan.y) / GEO.pH; dragPan = { x: mx, y: my }; draw(); return; }
    cursor = { x: mx, y: my };
    let hit = null, bestD = 12; for (const p of screenPts) { const d = Math.hypot(mx - p.x, my - p.y); if (d < bestD) { bestD = d; hit = p; } }
    if (hit) { canvas.style.cursor = 'pointer'; if (!highlight || highlight.cw !== hit.cw) { highlight = { cw: hit.cw }; t0 = performance.now(); startLoop(); }
      dotTip.innerHTML = '<b>τ ' + hit.cw.toFixed(3) + '</b> &middot; ' + QT.cwClock12(hit.cw) + ' ET &middot; ZN breach';
      dotTip.style.left = hit.x + 'px'; dotTip.style.top = hit.y + 'px'; dotTip.style.display = 'block'; }
    else { canvas.style.cursor = 'crosshair'; dotTip.style.display = 'none'; if (highlight) { highlight = null; stopLoop(); } else draw(); } });
  canvas.addEventListener('mousedown', e => { if (tool) return; const r = canvas.getBoundingClientRect();
    dragPan = { x: e.clientX - r.left, y: e.clientY - r.top }; canvas.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { dragPan = null; });
  canvas.addEventListener('mouseleave', () => { dotTip.style.display = 'none'; canvas.style.cursor = 'default'; cursor = null; if (highlight) { highlight = null; stopLoop(); } else draw(); });
  function resetView() { viewLo = -1; viewHi = 1; yScale = 1; yPan = 0; draw(); }
  canvas.addEventListener('dblclick', resetView);
  $('resetView').addEventListener('click', resetView);
  canvas.addEventListener('wheel', e => { if (!GEO) return; e.preventDefault(); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left;
    if (e.shiftKey) { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; yScale = Math.max(0.5, Math.min(10, yScale * f)); }
    else { const cw = GEO.invX(mx); const cur = viewHi - viewLo; let w = cur * (e.deltaY < 0 ? 0.85 : 1 / 0.85); w = Math.max(0.04, Math.min(2, w));
      let lo = cw - (cw - viewLo) * (w / cur), hi = lo + w; if (w >= 2 - 1e-9) { lo = -1; hi = 1; } if (lo < -1) { lo = -1; hi = lo + w; } if (hi > 1) { hi = 1; lo = hi - w; } viewLo = lo; viewHi = hi; }
    draw(); }, { passive: false });

  /* ---------------- RIPN handshake + tuning panel ------------------------ */
  $('ripnToggle').addEventListener('click', () => { const p = $('ripnPanel');
    const on = p.style.display !== 'flex'; p.style.display = on ? 'flex' : 'none'; $('ripnToggle').classList.toggle('on', on); });
  $('ripnClose').addEventListener('click', () => { $('ripnPanel').style.display = 'none'; $('ripnToggle').classList.remove('on'); });
  $('ripnAutoBtn').addEventListener('click', () => { delete ripnSel[date]; saveRipn(); recompute(); });
  function ripnGo() { const v = parseInt($('ripnIdxInput').value, 10); if (isFinite(v)) { ripnSel[date] = v; saveRipn(); recompute(); } }
  $('ripnGo').addEventListener('click', ripnGo);
  $('ripnIdxInput').addEventListener('keydown', e => { if (e.key === 'Enter') ripnGo(); });

  function renderRipn() {
    const head = $('ripnHead'), tbl = $('ripnTbl');
    if (!rw) { head.textContent = 'No chain loaded — the RIPN column appears once the golden closure has resolved.'; tbl.innerHTML = ''; return; }
    const auto = rw.auto_idx, used = rw.used_idx;
    head.innerHTML = 'anchor <b style="color:var(--cream)">row ' + used + ' · strike ' + rw.anchor_strike + '</b>' +
      (rw.manual_anchor ? ' (handshake)' : ' (auto)') + ' · ' + rw.n_strikes + ' strikes · click a row to re-anchor';
    const fz = (v, d) => (v == null ? '—' : v.toFixed(d));
    let h = '<thead><tr>' + ['#', 'strike', 'RIPN', 'AP', 'tuning'].map(x => '<th>' + x + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of rw.ripn_rows) { const idx = r[0], anchorRipn = (r[2] === 0 || r[2] === 1);
      h += '<tr data-idx="' + idx + '" class="ripnRow' + (idx === used ? ' used' : '') + '">' +
        '<td>' + idx + (idx === auto ? ' ◆' : '') + '</td><td>' + r[1] + '</td>' +
        '<td style="color:' + (anchorRipn ? '#e8b53a' : 'inherit') + '">' + fz(r[2], 3) + '</td>' +
        '<td>' + fz(r[3], 4) + '</td><td>' + fz(r[4], 4) + '</td></tr>'; }
    tbl.innerHTML = h + '</tbody>';
    tbl.querySelectorAll('.ripnRow').forEach(tr => tr.addEventListener('click', () => {
      const i = parseInt(tr.getAttribute('data-idx'), 10); if (isFinite(i)) { ripnSel[date] = i; saveRipn(); recompute(); } }));
  }
  ['responsiveness', 'sensitivity', 'smoothing', 'weighting'].forEach(k => {
    const sl = $('tsTune_' + k); if (!sl) return;
    sl.value = tune.get(k);
    const vv = $('tsTune_' + k + '_v'); if (vv) vv.textContent = (+sl.value).toFixed(2);
    sl.addEventListener('input', () => { const val = parseFloat(sl.value); tune.set(k, val);
      if (vv) vv.textContent = val.toFixed(2); saveTune();
      buildPlot(); buildLegend(); renderEvents(); draw(); }); });

  /* ---------------- upload / date ---------------------------------------- */
  $('tsFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => { store[date] = { chain: ev.target.result, fn: f.name }; saveStore(); recompute(); };
    r.readAsText(f); fnLabel.textContent = f.name; e.target.value = ''; });
  dayDate.addEventListener('change', () => { date = dayDate.value || todayISO(); saveSel();
    fnLabel.textContent = (store[date] && store[date].fn) || 'none'; renderTexts(); recompute(); });
  $('normToggle').addEventListener('change', () => { buildPlot(); buildLegend(); renderEvents(); draw(); });
  $('fitToggle').addEventListener('change', draw);
  $('fitTarget').addEventListener('change', draw);
  $('fitOrder').addEventListener('input', () => { $('fitOrderV').textContent = $('fitOrder').value; draw(); });

  function tickT() { sessTEl.textContent = sessionT().toFixed(4); }

  /* ---------------- init -------------------------------------------------- */
  (function init() {
    dayDate.value = date;
    fnLabel.textContent = (store[date] && store[date].fn) || 'none';
    $('fitTarget').innerHTML = SERIES_DEF.map(d => '<option value="' + d.key + '">' + d.key + '</option>').join('');
    tickT(); setInterval(tickT, 250);
    setInterval(() => { if (!rafId) draw(); }, 15000);   // keep the live chronometer marker moving
    recompute(); sizeCanvas();
    // ResizeObserver is frame-aligned and never fires in a hidden pane — retry
    // until the backing store matches layout so the chart is ready on reveal
    (function ensureSized() { if ((!W || !H) && canvas.clientWidth) sizeCanvas(); if (!W || !H) setTimeout(ensureSized, 300); })();
  })();
})();
