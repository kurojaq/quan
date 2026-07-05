(function(){
  const tabs=document.querySelectorAll('.tabbtn'), secs={report:document.getElementById('tabReport'),detector:document.getElementById('tabDetector'),polar:document.getElementById('tabPolar'),strike:document.getElementById('tabStrike'),heat:document.getElementById('tabHeat'),chart:document.getElementById('tabChart'),compass:document.getElementById('tabCompass'),sim:document.getElementById('tabSim')};
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
    else if(t==='sim'){ window.__simBoot&&window.__simBoot(); window.__simRender&&window.__simRender(); } }));
  // Report is reachable only as a dropdown view inside Detector now (see detViewSel below); the standalone top-level Report tab button was removed.
  const dvs=document.getElementById('detViewSel'), tabDet=secs.detector, tabRpt=secs.report;
  if(dvs&&tabDet&&tabRpt) dvs.addEventListener('change',()=>{
    if(dvs.value==='report'){ tabDet.classList.remove('on'); tabRpt.classList.add('on'); window.__reportRender&&window.__reportRender(); }
    else { tabRpt.classList.remove('on'); tabDet.classList.add('on'); setTimeout(()=>{window.__detResize&&window.__detResize();},40); }
  });
})();