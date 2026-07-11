(function(){
  const tabs=document.querySelectorAll('.tabbtn'), secs={report:document.getElementById('tabReport'),detector:document.getElementById('tabDetector'),polar:document.getElementById('tabPolar'),strike:document.getElementById('tabStrike'),heat:document.getElementById('tabHeat'),chart:document.getElementById('tabChart'),compass:document.getElementById('tabCompass'),sim:document.getElementById('tabSim'),exec:document.getElementById('tabExec'),cboe:document.getElementById('tabCboe')};
  tabs.forEach(b=>b.addEventListener('click',()=>{ const t=b.dataset.tab;
    if(t==='split'){ tabs.forEach(x=>x.classList.toggle('on',x===b)); if(window.__enterSplit)window.__enterSplit(); return; }
    if(window.__exitSplit)window.__exitSplit();
    tabs.forEach(x=>x.classList.toggle('on',x===b)); for(const k in secs) secs[k].classList.toggle('on',k===t);
    if(t==='polar'){ if(window.__polarBoot)window.__polarBoot(); setTimeout(()=>{window.__polarResize&&window.__polarResize(); window.__sopResize&&window.__sopResize();},40); }
    else if(t==='detector'){ const dv=document.getElementById('detViewSel');
      if(dv&&dv.value==='report'){ secs.detector.classList.remove('on'); secs.report.classList.add('on'); window.__reportRender&&window.__reportRender(); }
      else { setTimeout(()=>{window.__detResize&&window.__detResize();},40); } }
    else if(t==='strike'){ setTimeout(()=>{window.__skResize&&window.__skResize();},40); }
    else if(t==='heat'){ window.__heatBoot&&window.__heatBoot(); setTimeout(function(){ if(window.__feedHeatmap)window.__feedHeatmap(); },350); }
    else if(t==='chart'){ window.__chartBoot&&window.__chartBoot(); setTimeout(function(){window.__chartResize&&window.__chartResize();},40); }
    else if(t==='compass'){ window.__compassBoot&&window.__compassBoot(); setTimeout(function(){window.__compassResize&&window.__compassResize();},40); }
    else if(t==='sim'){ window.__simBoot&&window.__simBoot(); window.__simRender&&window.__simRender(); }
    else if(t==='exec'){ window.__execBoot&&window.__execBoot(); }
    else if(t==='cboe'){ window.__cboeBoot&&window.__cboeBoot(); } }));

  // ---- exchange toggle (CME ⇄ CBOE): global re-scope of the visible tab set + clock ----
  const xbtns=document.querySelectorAll('.xchgbtn');
  function applyExchange(ex, activate){
    xbtns.forEach(b=>b.classList.toggle('on', b.dataset.xchg===ex));
    // show only tabs scoped to this exchange (or unscoped tabs, which apply to both)
    tabs.forEach(b=>{ const scope=b.dataset.xchgScope; if(scope) b.style.display = (scope===ex)?'':'none'; });
    if(activate){
      // if the currently-active tab is now hidden, jump to this exchange's default tab
      const cur=document.querySelector('.tabbtn.on');
      if(!cur || cur.style.display==='none' || (cur.dataset.xchgScope && cur.dataset.xchgScope!==ex)){
        const def = ex==='CBOE' ? document.querySelector('[data-tab="cboe"]') : document.querySelector('[data-tab="detector"]');
        if(def) def.click();
      }
    }
  }
  xbtns.forEach(b=>b.addEventListener('click',()=>{ const ex=b.dataset.xchg;
    if(window.QuanExchange) window.QuanExchange.set(ex); applyExchange(ex,true); }));
  // apply persisted exchange on load (QuanExchange read localStorage already)
  const ex0 = (window.QuanExchange && window.QuanExchange.get()) || 'CME';
  applyExchange(ex0, ex0!=='CME');
  // Report is reachable only as a dropdown view inside Detector now (see detViewSel below); the standalone top-level Report tab button was removed.
  // Both the Detector header and the Report header carry a View dropdown (detViewSel / rptViewSel);
  // whichever is used, applyView() flips the two sections and keeps both selects in sync so the
  // View control is always present in the visible section (fixes the "dropdown disappears" bug).
  const dvs=document.getElementById('detViewSel'), rvs=document.getElementById('rptViewSel'), tabDet=secs.detector, tabRpt=secs.report;
  function applyView(v){
    if(dvs) dvs.value=v; if(rvs) rvs.value=v;
    if(v==='report'){ tabDet.classList.remove('on'); tabRpt.classList.add('on'); window.__reportRender&&window.__reportRender(); }
    else { tabRpt.classList.remove('on'); tabDet.classList.add('on'); setTimeout(()=>{window.__detResize&&window.__detResize();},40); }
  }
  if(dvs&&tabDet&&tabRpt) dvs.addEventListener('change',()=>applyView(dvs.value));
  if(rvs&&tabDet&&tabRpt) rvs.addEventListener('change',()=>applyView(rvs.value));
})();