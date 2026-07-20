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
      genB = document.getElementById('tvGen'), copyB = document.getElementById('tvCopy'),
      dlB = document.getElementById('tvDl'), summaryEl = document.getElementById('tvSummary'),
      metricsEl = document.getElementById('tvMetrics');
  if (!tab || !panel) return;
  var open = false, lastSrc = '', lastInst = 'quan';

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
      previewMetrics();
    }
  }

  // show the metric list that WOULD be baked, before generating
  function previewMetrics() {
    var api = window.QuanTradovatePayload;
    if (!api) { setStatus('payload engine not loaded'); return; }
    var opts = api.metricOptions();
    renderMetricChips(opts.map(function (m) { return m.label || m.key; }));
    var snaps = api.getSnapshots();
    if (!snaps.length) { setStatus('no bookmap data yet — open the Chart tab in Bookmap view'); if (summaryEl) summaryEl.textContent = ''; }
    else { setStatus('ready — ' + snaps.length + ' session' + (snaps.length > 1 ? 's' : '') + ' loaded'); if (summaryEl) summaryEl.textContent = opts.length + ' metrics · ' + snaps.length + ' sessions'; }
  }

  function renderMetricChips(labels) {
    if (!metricsEl) return;
    metricsEl.innerHTML = '';
    labels.forEach(function (l) {
      var s = document.createElement('span');
      s.textContent = l;
      s.style.cssText = 'font:10px ui-monospace,Menlo,monospace;color:#bfe6d6;background:#12261f;border:1px solid #2c5344;border-radius:5px;padding:2px 6px';
      metricsEl.appendChild(s);
    });
  }

  function generate() {
    var api = window.QuanTradovatePayload;
    if (!api) { setErr('payload engine (js/tradovate-payload.js) not loaded'); return; }
    setErr(''); setStatus('building…'); genB.disabled = true;
    api.buildIndicator().then(function (r) {
      lastSrc = r.source; lastInst = (r.payload && r.payload.inst) || 'quan';
      outEl.value = r.source;
      copyB.disabled = false; dlB.disabled = false;
      try { if (navigator.clipboard) navigator.clipboard.writeText(r.source); } catch (_) {}
      var p = r.payload, strikes = (p.segments[0] && p.segments[0].rows.length) || 0;
      renderMetricChips((p.metrics || []).map(function (m) { return m[1]; }));
      if (summaryEl) summaryEl.textContent = p.inst + ' · ' + p.segments.length + ' session' + (p.segments.length > 1 ? 's' : '') + ' · ' + (p.metrics || []).length + ' metrics · ~' + strikes + ' strikes';
      setStatus('done — copied to clipboard'); setSync('#v' + p.v);
    }).catch(function (e) {
      setErr(String(e && e.message || e)); setStatus('error');
    }).then(function () { genB.disabled = false; });
  }

  function download() {
    if (!lastSrc) return;
    var u = URL.createObjectURL(new Blob([lastSrc], { type: 'text/javascript' }));
    var a = document.createElement('a'); a.href = u; a.download = 'quan-bookmap.' + String(lastInst).toLowerCase() + '.tradovate.js';
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
