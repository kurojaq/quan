/* ============================================================================
   Qu'an → Tradovate payload generator
   ----------------------------------------------------------------------------
   The Tradovate twin of the TradingView / Pine payload path. Reads the same
   heat snapshots the Chart-tab Bookmap renders (window.__getHeatSnapshots),
   serializes them into a compact PAYLOAD, and injects it into the Tradovate
   renderer template (tradovate/indicators/quan-bookmap.js) — producing a
   ready-to-paste custom indicator that draws the identical bookmap in Tradovate.

   Public:
     window.__quanExportTradovate()  -> Promise<string>  (also copies to clipboard)
     window.QuanTradovatePayload = { buildPayload, injectPayload, ... }  (testable)

   Nothing here recomputes analytics — it only mirrors what the terminal already
   produced, exactly like the Pine payload. See [[tradovate-bookmap-engine]].
   ============================================================================ */
(function (root) {
  'use strict';

  var TEMPLATE_URL = 'tradovate/indicators/quan-bookmap.js';

  // ---- metric getters: mirror chart-heat.js METRICS (row {k, coi, poi, ...}) ----
  function metricGetter(key) {
    switch (key) {
      case 'oi':      return function (r) { return (+r.coi || 0) + (+r.poi || 0); };
      case 'vol':     return function (r) { return (+r.cvol || 0) + (+r.pvol || 0); };
      default:        return function (r) { var v = +r[key]; return isFinite(v) ? Math.abs(v) : 0; };
    }
  }

  // ---- the metric list, taken straight from the Bookmap dropdown so the
  //      Tradovate indicator's metric selector matches the terminal exactly.
  //      Falls back to a sensible default set if the DOM control isn't present.
  function metricOptions() {
    var sel = root.document && document.getElementById('chartHeatMetric');
    if (sel && sel.options && sel.options.length) {
      var out = [];
      for (var i = 0; i < sel.options.length; i++) {
        var o = sel.options[i];
        out.push({ key: o.value, label: o.textContent || o.value });
      }
      return out;
    }
    return [
      { key: 'oi', label: 'OI (C+P)' }, { key: 'vol', label: 'Volume (C+P)' },
      { key: 'netprem', label: 'Net Premium' }, { key: 'gex', label: 'GEX' },
      { key: 'invdist', label: 'Inv Dist' }, { key: 'mass', label: 'Mass' }
    ];
  }

  // ---- ET session start (port of chart-heat.js): session D = [D-1 18:00, D 17:00] ET ----
  function etHourUnix(dateStr, hour) {
    var guess = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10), hour + 4, 0, 0) / 1000;
    try {
      var etH = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit' })
        .formatToParts(new Date(guess * 1000)).find(function (p) { return p.type === 'hour'; }).value;
      var diff = hour - etH; if (diff > 12) diff -= 24; if (diff < -12) diff += 24;
      guess += diff * 3600;
    } catch (_) {}
    return guess;
  }
  function sessionStart(dateStr) { return etHourUnix(dateStr, 17) - 23 * 3600; }

  // ---- decimals to display: count the decimal places of the tightest strike step ----
  function decimalsOf(x) {
    if (!isFinite(x)) return 0;
    // round to 8 sig-decimals to shed float noise (e.g. 0.7500000001), then count
    var s = (Math.round(x * 1e8) / 1e8).toString();
    var i = s.indexOf('.');
    return i < 0 ? 0 : Math.min(6, s.length - i - 1);
  }
  function inferPdec(segments) {
    var step = Infinity, s, r;
    for (s = 0; s < segments.length; s++) {
      var rows = segments[s].rows;
      for (r = 1; r < rows.length; r++) {
        var d = Math.abs(rows[r][0] - rows[r - 1][0]);
        if (d > 1e-9 && d < step) step = d;
      }
    }
    if (!isFinite(step)) return (segments[0] && segments[0].rows[0]) ? decimalsOf(segments[0].rows[0][0]) : 2;
    return decimalsOf(step);
  }

  // ---- snapshot acquisition: [{date, heatmap:{meta, rows}}] ----
  //  Prefer THIS terminal's live grids (__getChartHeatSnapshots, sourced from
  //  chart-heat's DAYGRIDS); fall back to the client terminal's published
  //  __getHeatSnapshots / single-date __getHeatSnapshot.
  function getSnapshots() {
    try {
      if (typeof root.__getChartHeatSnapshots === 'function') {
        var live = root.__getChartHeatSnapshots() || [];
        if (live.length) return live.filter(function (s) { return s && s.date && s.heatmap && s.heatmap.rows && s.heatmap.rows.length; });
      }
    } catch (_) {}
    try {
      if (typeof root.__getHeatSnapshots === 'function') {
        var arr = root.__getHeatSnapshots() || [];
        return arr.filter(function (s) { return s && s.date && s.heatmap && s.heatmap.rows && s.heatmap.rows.length; });
      }
    } catch (_) {}
    try {
      if (typeof root.__getHeatSnapshot === 'function') {
        var one = root.__getHeatSnapshot();
        if (one && one.rows && one.rows.length) {
          var d = (root.document && document.getElementById('dayDate') && document.getElementById('dayDate').value) || todayISO();
          return [{ date: d, heatmap: one }];
        }
      }
    } catch (_) {}
    return [];
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  // ---- selected metric (key + label) from the Bookmap control ----
  function selectedMetric() {
    var sel = root.document && document.getElementById('chartHeatMetric');
    if (sel && sel.value) {
      var opt = sel.options[sel.selectedIndex];
      return { key: sel.value, label: (opt && opt.textContent) || sel.value };
    }
    return { key: 'oi', label: 'OI (C+P)' };
  }

  // ---- build the compact ALL-METRICS payload from snapshots (v2) ----
  //  `metrics` = [{key,label}] to bake (defaults to the whole Bookmap list).
  //  Rows carry every metric column so the Tradovate indicator can switch
  //  metrics on its own — a complete duplicate of the Bookmap view.
  function buildPayload(snapshots, metrics, defaultMetric, instrument) {
    metrics = (metrics && metrics.length) ? metrics : metricOptions();
    var getters = metrics.map(function (m) { return metricGetter(m.key); });
    var cols = ['k'].concat(metrics.map(function (m) { return m.key; }));
    var segments = [], pdecRows = [];
    for (var i = 0; i < snapshots.length; i++) {
      var snap = snapshots[i], hm = snap.heatmap || {}, meta = hm.meta || {};
      var rows = (hm.rows || [])
        .filter(function (r) { return r && isFinite(+r.k); })
        .sort(function (a, b) { return a.k - b.k; })
        .map(function (r) {
          var row = [+r.k];
          for (var g = 0; g < getters.length; g++) row.push(+getters[g](r) || 0);
          return row;
        });
      if (!rows.length) continue;
      var pdsl = (meta.pdsl || [])
        .filter(function (p) { return p && isFinite(+p.k); })
        .map(function (p) { return [+p.k, (p.side === 'support' || p.side === 'S') ? 'S' : 'R']; });
      segments.push({
        date: snap.date,
        t0: Math.round(sessionStart(snap.date)),
        anchor: isFinite(+meta.anchor) ? +meta.anchor : null,
        atm: isFinite(+meta.atm) ? +meta.atm : null,
        rows: rows,
        pdsl: pdsl
      });
      pdecRows.push({ rows: rows });   // inferPdec reads [k, ...] rows
    }
    segments.sort(function (a, b) { return a.t0 - b.t0; });
    return {
      v: 2,
      inst: instrument || 'QUAN',
      defaultMetric: defaultMetric || (metrics[0] && metrics[0].key) || 'oi',
      metrics: metrics.map(function (m) { return [m.key, m.label]; }),
      cols: cols,
      pdec: inferPdec(segments),
      segments: segments
    };
  }

  // ---- inject a payload object into the renderer template ----
  function injectPayload(template, payload) {
    var lines = template.split('\n');
    var bi = -1, ei = -1;
    for (var i = 0; i < lines.length; i++) {
      if (bi < 0 && lines[i].indexOf('QUAN_PAYLOAD_BEGIN') > -1) bi = i;
      else if (lines[i].indexOf('QUAN_PAYLOAD_END') > -1) { ei = i; break; }
    }
    if (bi < 0 || ei < 0 || ei <= bi) throw new Error('payload sentinels not found in template');
    var head = lines.slice(0, bi + 1);          // up to & incl. //QUAN_PAYLOAD_BEGIN
    var tail = lines.slice(ei);                  // from //QUAN_PAYLOAD_END
    var mid = ['const PAYLOAD = ' + JSON.stringify(payload) + ';'];
    return head.concat(mid, tail).join('\n');
  }

  // ---- swap the baked RENDER_MODE constant between the two sentinels ----
  function injectMode(template, mode) {
    mode = (mode === 'cells') ? 'cells' : 'bands';
    var lines = template.split('\n'), bi = -1, ei = -1;
    for (var i = 0; i < lines.length; i++) {
      if (bi < 0 && lines[i].indexOf('QUAN_MODE_BEGIN') > -1) bi = i;
      else if (lines[i].indexOf('QUAN_MODE_END') > -1) { ei = i; break; }
    }
    if (bi < 0 || ei < 0 || ei <= bi) return template;   // older template: leave as-is
    return lines.slice(0, bi + 1).concat(['var RENDER_MODE = "' + mode + '";'], lines.slice(ei)).join('\n');
  }

  // ---- build the full pasteable indicator source (all metrics baked) ----
  //  Returns a Promise<{ source, payload }>. Default metric = whatever the
  //  terminal Bookmap currently shows, so the indicator opens on that view.
  function buildIndicator(mode) {
    var snaps = getSnapshots();
    if (!snaps.length) return Promise.reject(new Error('No bookmap data loaded — open the Chart tab and let the heat snapshots populate first.'));
    var inst = (root.document && document.getElementById('instA') && document.getElementById('instA').value) || 'QUAN';
    var payload = buildPayload(snaps, metricOptions(), selectedMetric().key, inst);
    return fetch(TEMPLATE_URL, { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('template fetch ' + res.status); return res.text(); })
      .then(function (tpl) { return { source: injectMode(injectPayload(tpl, payload), mode), payload: payload, mode: (mode === 'cells' ? 'cells' : 'bands') }; });
  }

  // ---- convenience: build + copy to clipboard, resolve with the source ----
  function exportIndicator() {
    return buildIndicator().then(function (r) {
      try { if (navigator.clipboard) navigator.clipboard.writeText(r.source); } catch (_) {}
      return r.source;
    });
  }

  root.QuanTradovatePayload = {
    metricGetter: metricGetter, metricOptions: metricOptions, sessionStart: sessionStart, inferPdec: inferPdec,
    buildPayload: buildPayload, injectPayload: injectPayload, injectMode: injectMode, buildIndicator: buildIndicator,
    getSnapshots: getSnapshots, selectedMetric: selectedMetric, exportIndicator: exportIndicator
  };
  root.__quanExportTradovate = exportIndicator;

  if (typeof module !== 'undefined' && module.exports) module.exports = root.QuanTradovatePayload;
})(typeof window !== 'undefined' ? window : globalThis);
