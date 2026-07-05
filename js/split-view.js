(function(){
  const host=document.getElementById('secHost'), bar=document.getElementById('splitBar'), div=document.getElementById('splitDiv'),
        selA=document.getElementById('spPaneA'), selB=document.getElementById('spPaneB'),
        layH=document.getElementById('spLayH'), layV=document.getElementById('spLayV'), xBtn=document.getElementById('splitExit'),
        spInstA=document.getElementById('spInstA'), spInstB=document.getElementById('spInstB'),
        splitSessT=document.getElementById('splitSessT'), wrap=document.querySelector('.wrap');
  if(!host||!bar) return;
  const SEC={report:'tabReport',detector:'tabDetector',polar:'tabPolar',strike:'tabStrike',heat:'tabHeat',chart:'tabChart',sim:'tabSim'};
  let vert=false, ratio=50;
  function sec(k){ return document.getElementById(SEC[k]); }
  function firstOther(v){ return Object.keys(SEC).find(k=>k!==v); }
  function nudge(k){
    if(k==='polar'){ window.__polarBoot&&window.__polarBoot(); window.__polarResize&&window.__polarResize(); window.__sopResize&&window.__sopResize(); }
    else if(k==='detector'){ window.__detResize&&window.__detResize(); }
    else if(k==='strike'){ window.__skResize&&window.__skResize(); }
    else if(k==='heat'){ window.__heatBoot&&window.__heatBoot(); window.__feedHeatmap&&window.__feedHeatmap(); }
    else if(k==='chart'){ window.__chartBoot&&window.__chartBoot(); window.__chartResize&&window.__chartResize(); }
    else if(k==='sim'){ window.__simBoot&&window.__simBoot(); window.__simRender&&window.__simRender(); }
    else if(k==='report'){ window.__reportRender&&window.__reportRender(); }
  }
  var ALLSEC=['tabReport','tabDetector','tabPolar','tabStrike','tabHeat','tabHeatB','tabChart','tabSim'];
  function paneSecId(pane,page){ if(page==='heat') return (pane==='B')?'tabHeatB':'tabHeat'; return SEC[page]; }
  function paneSec(pane,page){ return document.getElementById(paneSecId(pane,page)); }
  function nudgePane(pane,page,inst){
    if(page==='heat'){ var boot=(pane==='B')?window.__heatBootB:window.__heatBoot; var fid=(pane==='B')?'heatFrameB':'heatFrame'; if(boot)boot(); setTimeout(function(){ if(window.__feedHeatmapTo)window.__feedHeatmapTo(fid, inst, true); },120); }
    else { nudge(page); }
  }
  function applyPanes(){
    const a=selA.value, b=selB.value;
    ALLSEC.forEach(function(id){ var s=document.getElementById(id); if(s){ s.classList.remove('on'); s.style.order=''; s.style.flexGrow=''; s.style.flexBasis=''; } });
    const sa=paneSec('A',a), sb=paneSec('B',b); if(!sa||!sb) return;
    sa.classList.add('on'); sb.classList.add('on');
    sa.style.order='1'; sb.style.order='3';
    sa.style.flexGrow=String(ratio); sb.style.flexGrow=String(100-ratio); sa.style.flexBasis='0'; sb.style.flexBasis='0';
    setTimeout(function(){ window.dispatchEvent(new Event('resize')); nudgePane('A',a,spInstA?spInstA.value:null); nudgePane('B',b,spInstB?spInstB.value:null); },60);
  }
  function applyLayout(){
    host.classList.toggle('vert',vert);
    layH.classList.toggle('on',!vert); layV.classList.toggle('on',vert);
    div.style.cursor=vert?'row-resize':'col-resize';
    setTimeout(function(){ window.dispatchEvent(new Event('resize')); },60);
  }
  function enter(){
    host.classList.add('split'); bar.classList.add('on');
    if(wrap)wrap.classList.add('splitFull');
    var iA=document.getElementById('instA');
    if(iA&&spInstA&&spInstB){ spInstA.innerHTML=iA.innerHTML; spInstB.innerHTML=iA.innerHTML; spInstA.value=iA.value; spInstB.value=iA.value; }
    if(selA.value===selB.value && selA.value!=='heat'){ selB.value=firstOther(selA.value); }
    applyLayout(); applyPanes();
  }
  function exitLayout(){
    host.classList.remove('split'); bar.classList.remove('on');
    if(wrap)wrap.classList.remove('splitFull');
    ALLSEC.forEach(function(id){ var s=document.getElementById(id); if(s){ s.style.order=''; s.style.flexGrow=''; s.style.flexBasis=''; } });
    var hbB=document.getElementById('tabHeatB'); if(hbB)hbB.classList.remove('on');
    setTimeout(function(){ if(window.__feedHeatmap)window.__feedHeatmap(true); },60);
  }
  window.__enterSplit=enter; window.__exitSplit=exitLayout;
  selA.addEventListener('change',function(){ if(selB.value===selA.value && selA.value!=='heat') selB.value=firstOther(selA.value); applyPanes(); });
  selB.addEventListener('change',function(){ if(selA.value===selB.value && selB.value!=='heat') selA.value=firstOther(selB.value); applyPanes(); });
  layH.addEventListener('click',function(){ vert=false; applyLayout(); applyPanes(); });
  layV.addEventListener('click',function(){ vert=true; applyLayout(); applyPanes(); });
  function setSharedInst(v){ var iA=document.getElementById('instA'); if(iA){ if(iA.value!==v){ iA.value=v; iA.dispatchEvent(new Event('change')); } } }
  function paneInstChange(pane){ var sel=(pane==='A')?selA:selB, isel=(pane==='A')?spInstA:spInstB; if(!isel)return; var page=sel.value, v=isel.value; if(page==='heat'){ var fid=(pane==='B')?'heatFrameB':'heatFrame'; if(window.__feedHeatmapTo)window.__feedHeatmapTo(fid, v, true); } else { setSharedInst(v); } }
  if(spInstA)spInstA.addEventListener('change',function(){ paneInstChange('A'); });
  if(spInstB)spInstB.addEventListener('change',function(){ paneInstChange('B'); });
  window.addEventListener('quan:instr',function(){ var iA=document.getElementById('instA'); if(iA&&host.classList.contains('split')){ if(selA.value!=='heat'&&spInstA)spInstA.value=iA.value; if(selB.value!=='heat'&&spInstB)spInstB.value=iA.value; } });
  (function(){ var sT=document.getElementById('sessT'); if(sT&&splitSessT){ var sync=function(){ splitSessT.textContent=sT.textContent; }; try{ new MutationObserver(sync).observe(sT,{childList:true,characterData:true,subtree:true}); }catch(_){} sync(); } })();
  xBtn.addEventListener('click',function(){ exitLayout(); const a=selA.value; const btn=document.querySelector('.tabbtn[data-tab="'+a+'"]')||document.querySelector('.tabbtn[data-tab="detector"]'); btn&&btn.click(); });
  let dragging=false;
  div.addEventListener('pointerdown',function(e){ dragging=true; try{div.setPointerCapture(e.pointerId);}catch(_){} e.preventDefault(); });
  div.addEventListener('pointermove',function(e){ if(!dragging) return; const r=host.getBoundingClientRect(); let p=vert?(e.clientY-r.top)/r.height:(e.clientX-r.left)/r.width; p=Math.max(0.15,Math.min(0.85,p)); ratio=Math.round(p*100); const sa=paneSec('A',selA.value), sb=paneSec('B',selB.value); if(sa)sa.style.flexGrow=String(ratio); if(sb)sb.style.flexGrow=String(100-ratio); });
  div.addEventListener('pointerup',function(e){ if(!dragging) return; dragging=false; try{div.releasePointerCapture(e.pointerId);}catch(_){} window.dispatchEvent(new Event('resize')); if(selA.value!=='heat')nudge(selA.value); if(selB.value!=='heat')nudge(selB.value); });
})();