(function(){
  const tabs=document.querySelectorAll('.tabbtn'), secs={report:document.getElementById('tabReport'),detector:document.getElementById('tabDetector'),polar:document.getElementById('tabPolar'),strike:document.getElementById('tabStrike'),heat:document.getElementById('tabHeat'),chart:document.getElementById('tabChart'),compass:document.getElementById('tabCompass'),sim:document.getElementById('tabSim')};
  tabs.forEach(b=>b.addEventListener('click',()=>{ const t=b.dataset.tab;
    if(t==='split'){ tabs.forEach(x=>x.classList.toggle('on',x===b)); if(window.__enterSplit)window.__enterSplit(); return; }
    if(window.__exitSplit)window.__exitSplit();
    tabs.forEach(x=>x.classList.toggle('on',x===b)); for(const k in secs) secs[k].classList.toggle('on',k===t);
    if(t==='polar'){ if(window.__polarBoot)window.__polarBoot(); setTimeout(()=>{window.__polarResize&&window.__polarResize(); window.__sopResize&&window.__sopResize();},40); }
    else if(t==='detector'){ setTimeout(()=>{window.__detResize&&window.__detResize();},40); }
    else if(t==='strike'){ setTimeout(()=>{window.__skResize&&window.__skResize();},40); }
    else if(t==='heat'){ window.__heatBoot&&window.__heatBoot(); setTimeout(function(){ if(window.__feedHeatmap)window.__feedHeatmap(); },350); }
    else if(t==='report'){ window.__reportRender&&window.__reportRender(); }
    else if(t==='chart'){ window.__chartBoot&&window.__chartBoot(); setTimeout(function(){window.__chartResize&&window.__chartResize();},40); }
    else if(t==='compass'){ window.__compassBoot&&window.__compassBoot(); setTimeout(function(){window.__compassResize&&window.__compassResize();},40); }
    else if(t==='sim'){ window.__simBoot&&window.__simBoot(); window.__simRender&&window.__simRender(); } }));
})();