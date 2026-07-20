/* ============================================================================
   Tradovate Bookmap payload panel  —  slide-out sidebar (twin of the Payload
   engine panel). Drives js/tradovate-payload.js: Generate serializes the live
   Chart-tab Bookmap snapshots into a paste-ready Tradovate custom indicator
   (all metrics baked → metric dropdown inside Tradovate).
   ============================================================================ */
(function () {
  var tab = document.getElementById('tvTab'), panel = document.getElementById('tvPanel'),
      x = document.getElementById('tvClose'), chev = document.getElementById('tvChev'),
      sync = document.getElementById('tvSync'), statusEl = document.getElementById('tvStatus'),
      errEl = document.getElementById('tvErr'), outEl = document.getElementById('tvOut'),
      genB = document.getElementById('tvGen'), modeSel = document.getElementById('tvMode'), copyB = document.getElementById('tvCopy'),
      dlB = document.getElementById('tvDl'), summaryEl = document.getElementById('tvSummary'),
      metricsEl = document.getElementById('tvMetrics');
  if (!tab || !panel) return;
  var open = false, lastSrc = '', lastInst = 'quan', lastMode = 'cells';
  var MAX_METRICS = 3, selectedKeys = [];

  function setStatus(t) { if (statusEl) statusEl.textContent = t || ''; }
  function setErr(t) { if (errEl) errEl.textContent = t || ''; }
  function setSync(t) { if (sync) sync.textContent = t || ''; }

  function setOpen(o) {
    open = o;
    panel.classList.toggle('open', o); tab.classList.toggle('open', o);
    panel.setAttribute('aria-hidden', o ? 'false' : 'true');
    if (chev) chev.innerHTML = o ? '&#9654;' : '&#9664;';
    if (o) {
      // don't stack on top of the Payload engine panel
      var pd = document.getElementById('pdPanel'), pdTab = document.getElementById('pdTab');
      if (pd && pd.classList.contains('open')) { pd.classList.remove('open'); if (pdTab) pdTab.classList.remove('open'); pd.setAttribute('aria-hidden', 'true'); }
      // ensure the heat grids are loaded (may be on another tab), then auto-build
      setStatus('loading bookmap data…');
      var ensure = window.__quanEnsureHeatData;
      if (typeof ensure === 'function') ensure(function () { previewMetrics(); autoGenerate(); });
      else { previewMetrics(); autoGenerate(); }
    }
  }

  // pick the metrics to bake (default: the terminal's live metric)
  function defaultSelection() {
    var api = window.QuanTradovatePayload;
    var live = api && api.selectedMetric && api.selectedMetric().key;
    if (live) return [live];
    var opts = (api && api.metricOptions()) || [];
    return opts.length ? [opts[0].key] : [];
  }

  // show the metric toggles (max 3 baked) + data status, before generating
  function previewMetrics() {
    var api = window.QuanTradovatePayload;
    if (!api) { setStatus('payload engine not loaded'); return; }
    if (!selectedKeys.length) selectedKeys = defaultSelection();
    renderMetricToggles(api.metricOptions());
    var snaps = api.getSnapshots();
    if (!snaps.length) { setStatus('no bookmap data yet — open the Chart tab in Bookmap view'); if (summaryEl) summaryEl.textContent = ''; }
    else { setStatus('ready — ' + snaps.length + ' session' + (snaps.length > 1 ? 's' : '') + ' loaded · pick up to ' + MAX_METRICS + ' metrics'); if (summaryEl) summaryEl.textContent = selectedKeys.length + '/' + MAX_METRICS + ' metrics · ' + snaps.length + ' sessions'; }
  }

  // clickable metric chips — select up to MAX_METRICS to keep the payload light
  function renderMetricToggles(opts) {
    if (!metricsEl) return;
    metricsEl.innerHTML = '';
    opts.forEach(function (m) {
      var on = selectedKeys.indexOf(m.key) > -1;
      var s = document.createElement('button');
      s.type = 'button'; s.textContent = m.label || m.key;
      s.style.cssText = 'font:10px ui-monospace,Menlo,monospace;border-radius:5px;padding:3px 7px;cursor:pointer;'
        + (on ? 'color:#dcf5e9;background:#1f5a44;border:1px solid #46b389;'
              : 'color:#8fb8a8;background:#101a16;border:1px solid #24382f;');
      s.addEventListener('click', function () {
        var i = selectedKeys.indexOf(m.key);
        if (i > -1) selectedKeys.splice(i, 1);
        else { if (selectedKeys.length >= MAX_METRICS) selectedKeys.shift(); selectedKeys.push(m.key); }
        renderMetricToggles(opts);
        if (summaryEl) summaryEl.textContent = selectedKeys.length + '/' + MAX_METRICS + ' metrics selected — Generate to apply';
      });
      metricsEl.appendChild(s);
    });
  }

  // auto-build on open if data is present (seamless); silent if none yet
  function autoGenerate() {
    var api = window.QuanTradovatePayload;
    if (api && api.getSnapshots().length) generate();
  }

  function generate() {
    var api = window.QuanTradovatePayload;
    if (!api) { setErr('payload engine (js/tradovate-payload.js) not loaded'); return; }
    var mode = (modeSel && modeSel.value === 'cells') ? 'cells' : 'bands';
    if (!selectedKeys.length) selectedKeys = defaultSelection();
    setErr(''); setStatus('building…'); genB.disabled = true;
    api.buildIndicator(mode, selectedKeys.slice()).then(function (r) {
      lastSrc = r.source; lastInst = (r.payload && r.payload.inst) || 'quan';
      outEl.value = r.source;
      copyB.disabled = false; dlB.disabled = false;
      try { if (navigator.clipboard) navigator.clipboard.writeText(r.source); } catch (_) {}
      lastMode = r.mode || 'cells';
      var p = r.payload, strikes = (p.segments[0] && p.segments[0].rows.length) || 0;
      renderMetricToggles(api.metricOptions());
      var kb = Math.round(r.source.length / 1024);
      if (summaryEl) summaryEl.textContent = p.inst + ' · ' + (lastMode === 'bands' ? 'bands' : 'cells') + ' · ' + p.segments.length + ' session' + (p.segments.length > 1 ? 's' : '') + ' · ' + (p.metrics || []).length + ' metric' + ((p.metrics || []).length > 1 ? 's' : '') + ' · ~' + strikes + ' strikes · ' + kb + 'KB';
      setStatus('done — copied to clipboard'); setSync('#v' + p.v);
    }).catch(function (e) {
      setErr(String(e && e.message || e)); setStatus('error');
    }).then(function () { genB.disabled = false; });
  }

  function download() {
    if (!lastSrc) return;
    var u = URL.createObjectURL(new Blob([lastSrc], { type: 'text/javascript' }));
    var a = document.createElement('a'); a.href = u; a.download = 'quan-bookmap-' + lastMode + '.' + String(lastInst).toLowerCase() + '.tradovate.js';
    a.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
  }

  tab.addEventListener('click', function () { setOpen(!open); });
  if (x) x.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) setOpen(false); });
  if (genB) genB.addEventListener('click', generate);
  if (copyB) copyB.addEventListener('click', function () {
    if (!lastSrc) return;
    try { navigator.clipboard.writeText(lastSrc); copyB.textContent = 'Copied ✓'; setTimeout(function () { copyB.textContent = 'Copy script'; }, 1200); }
    catch (_) { outEl.select(); try { document.execCommand('copy'); } catch (__) {} }
  });
  if (dlB) dlB.addEventListener('click', download);

  // let other UI (e.g. the Bookmap "Tradovate" button) open this panel
  window.__quanOpenTradovatePanel = function () { setOpen(true); };
})();
