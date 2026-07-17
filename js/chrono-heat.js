/* ============================================================================
   Chronometric Heatmap Layer  —  temporal fields along the Bookmap time axis
   ----------------------------------------------------------------------------
   Implements the Chronometric Heatmap Engine spec (Obj 1, 2, 6): a selector
   analogous to the strike-space heatmap metric dropdown, but for SESSION-TIME
   metrics. The brief engine publishes a self-describing registry of curves
   (raw.chrono = [{id, name, sheet, cw:[...], v:[...]}]); this layer renders
   the selected curve — or the whole registry stacked — as a scalar/spectral
   field strip along the bottom of the chart, sharing the ScalarField
   framework and the cw -> unix -> x mapping used by the chrono event lines.

   Nothing here assumes a fixed set of metrics: whatever entries the engine
   emits appear in the dropdown automatically (per the spec's extensibility
   requirement). Values are signed; rendering normalizes symmetrically so the
   'diverging' palette pins zero at mid-scale.

   Exposes window.__chronoHeatRefresh. Strip is display-only (pointer-events
   none) — event inspection stays with the chrono event lines.
   ============================================================================ */
(function(){
  'use strict';
  var STRIP_H=64, BOTTOM=30, GAP_PX=4;
  var state={ field:'off', mode:'spectral' };
  var canvas=null, cctx=null, fieldSel=null, modeSel=null, built=false, engHooked=false, rangeHooked=false, raf=0;
  var lastRegSig='';

  function api(){ try{ return window.__chartApi?window.__chartApi():null; }catch(_){ return null; } }
  function curInst(){ return (document.getElementById('instA')||{}).value||''; }
  function curDate(){ return (document.getElementById('dayDate')||{}).value||''; }
  function briefRaw(){
    try{ var d=window.__reportData?window.__reportData(curInst(),curDate()):null; return d&&d.__raw; }catch(_){ return null; }
  }
  function savePrefs(){ try{ localStorage.setItem('quanChronoHeat:prefs',JSON.stringify(state)); }catch(_){} }
  function loadPrefs(){ try{ var p=JSON.parse(localStorage.getItem('quanChronoHeat:prefs')||'{}');
    if(p.field) state.field=p.field; if(p.mode) state.mode=p.mode; }catch(_){} }

  // ---- header controls: field selector (registry-driven) + render strategy ----
  function ensureUI(){
    if(built) return; var btn=document.getElementById('chartChronoBtn');
    if(!btn||!btn.parentNode) return;
    built=true; loadPrefs();
    fieldSel=document.createElement('select');
    fieldSel.id='chartChronoField'; fieldSel.className='field';
    fieldSel.title='Chronometric heatmap — temporal field rendered along the session timeline';
    fieldSel.style.maxWidth='150px';
    rebuildOptions(null);
    fieldSel.addEventListener('change',function(){ state.field=fieldSel.value; savePrefs(); syncMode(); schedule(); });
    btn.parentNode.insertBefore(fieldSel,btn.nextSibling);
    modeSel=document.createElement('select');
    modeSel.id='chartChronoMode'; modeSel.className='field'; modeSel.title='Chronometric field render strategy';
    ['scalar','spectral','contour','gradient','density'].forEach(function(m){
      var o=document.createElement('option'); o.value=m; o.textContent=m; modeSel.appendChild(o); });
    modeSel.value=state.mode; if(modeSel.value!==state.mode){ state.mode='spectral'; modeSel.value='spectral'; }
    modeSel.addEventListener('change',function(){ state.mode=modeSel.value; savePrefs(); schedule(); });
    fieldSel.parentNode.insertBefore(modeSel,fieldSel.nextSibling);
    syncMode();
  }
  function syncMode(){ if(modeSel) modeSel.style.display=(state.field==='off')?'none':''; }
  function rebuildOptions(reg){
    if(!fieldSel) return;
    var sig=(reg||[]).map(function(m){ return m&&m.id; }).join(',');
    if(sig===lastRegSig&&fieldSel.options.length) return;
    lastRegSig=sig;
    fieldSel.innerHTML='';
    function opt(v,txt){ var o=document.createElement('option'); o.value=v; o.textContent=txt; fieldSel.appendChild(o); }
    opt('off','Chrono field: off');
    (reg||[]).forEach(function(m){ if(m&&m.id) opt(m.id,(m.sheet?m.sheet+' · ':'')+(m.name||m.id)); });
    if(reg&&reg.length>1) opt('stack','Stack (all sheets)');
    fieldSel.value=state.field;
    if(fieldSel.value!==state.field){ state.field='off'; fieldSel.value='off'; }
  }

  // ---- overlay canvas over the chart pane's bottom edge ----
  function ensureCanvas(){
    if(canvas) return canvas;
    var wrap=document.getElementById('chartWrap'); if(!wrap) return null;
    canvas=document.createElement('canvas'); canvas.id='chronoHeatStrip';
    canvas.style.cssText='position:absolute;left:0;right:0;bottom:'+BOTTOM+'px;height:'+STRIP_H+'px;width:100%;pointer-events:none;z-index:4;display:none;';
    wrap.appendChild(canvas); cctx=canvas.getContext('2d');
    if(typeof ResizeObserver!=='undefined'){ new ResizeObserver(schedule).observe(wrap); }
    return canvas;
  }

  // arbitrary time -> x: exact scale coordinate first, then interpolate between bars
  function timeToX(ts,t,bars,paneW){
    var c=ts.timeToCoordinate(t);
    if(c!=null) return c;
    if(bars.length>1){
      if(t<=bars[0].time) return 0;
      if(t>=bars[bars.length-1].time) return paneW;
      var lo=0,hi=bars.length-1;
      while(hi-lo>1){ var mid=(lo+hi)>>1; if(bars[mid].time<=t) lo=mid; else hi=mid; }
      var xa=ts.timeToCoordinate(bars[lo].time), xb=ts.timeToCoordinate(bars[hi].time);
      if(xa!=null&&xb!=null) return xa+(xb-xa)*((t-bars[lo].time)/((bars[hi].time-bars[lo].time)||1));
      if(xa!=null) return xa; if(xb!=null) return xb;
    }
    return null;
  }

  function schedule(){ if(raf) return; raf=requestAnimationFrame(function(){ raf=0; draw(); }); }

  function draw(){
    ensureUI();
    var cv=ensureCanvas(); if(!cv) return;
    var raw=briefRaw(), reg=raw&&raw.chrono;
    // engine boots async — self-heal once briefs become computable (report.js pattern)
    if(!raw&&!window.__engBrief){ try{ if(window.__qEnsureEngine) window.__qEnsureEngine(); }catch(_){}
      if(!engHooked&&window.__engReady){ engHooked=true; window.__engReady.then(function(){ schedule(); }); } }
    rebuildOptions(reg);
    if(state.field==='off'||!reg||!reg.length){ cv.style.display='none'; return; }
    var a=api(); if(!a||!a.chart||!a.container){ cv.style.display='none'; return; }
    if(!rangeHooked){ rangeHooked=true;
      try{ a.chart.timeScale().subscribeVisibleTimeRangeChange(schedule); }catch(_){ rangeHooked=false; } }
    var bars=window.__chartBars||[]; if(!bars.length){ cv.style.display='none'; return; }
    var SF=window.ScalarField, date=curDate();
    if(!SF||!window.__cwToUnix||!date){ cv.style.display='none'; return; }

    var metrics=(state.field==='stack')?reg.filter(function(m){ return m&&m.cw&&m.v; })
                                       :reg.filter(function(m){ return m&&m.id===state.field&&m.cw&&m.v; });
    if(!metrics.length){ cv.style.display='none'; return; }

    var wrap=document.getElementById('chartWrap');
    var W=Math.max(2,Math.round(wrap.clientWidth)), H=STRIP_H, dpr=window.devicePixelRatio||1;
    if(cv.width!==W*dpr||cv.height!==H*dpr){ cv.width=W*dpr; cv.height=H*dpr; }
    cctx.setTransform(dpr,0,0,dpr,0,0); cctx.clearRect(0,0,W,H);

    var ts=a.chart.timeScale();
    // bucket each metric's samples into pixel columns (max-|v| wins per bucket);
    // the cw axis may be non-monotonic in clock time, so samples map independently.
    var rows=metrics.length, buckets=[];
    var maxAbs=1e-12, r, k;
    for(r=0;r<rows;r++){
      var m=metrics[r], col=new Array(W).fill(null);
      for(k=0;k<m.cw.length;k++){
        var v=m.v[k]; if(v==null||!isFinite(v)) continue;
        var t=window.__cwToUnix(m.cw[k],date); if(t==null) continue;
        var x=timeToX(ts,t,bars,W); if(x==null) continue;
        var j=Math.max(0,Math.min(W-1,Math.round(x)));
        if(col[j]==null||Math.abs(v)>Math.abs(col[j])) col[j]=v;
        if(Math.abs(v)>maxAbs) maxAbs=Math.abs(v);
      }
      // gap-fill: nearest filled bucket within GAP_PX so sparse samples read as a band
      var filled=col.slice();
      for(var j2=0;j2<W;j2++){ if(filled[j2]!=null) continue;
        for(var d2=1;d2<=GAP_PX;d2++){
          if(j2-d2>=0&&col[j2-d2]!=null){ filled[j2]=col[j2-d2]; break; }
          if(j2+d2<W&&col[j2+d2]!=null){ filled[j2]=col[j2+d2]; break; }
        } }
      buckets.push(filled);
    }
    // symmetric normalization: signed value -> [0,1] with zero pinned at 0.5
    var field=SF.makeField(rows,W,function(i,j){
      var v=buckets[i][j]; return v==null?0.5:((v/maxAbs)+1)/2;
    });
    cv.style.display='';
    try{ SF.render(cctx,field,{ mode:state.mode, colormap:'diverging', rect:{x:0,y:0,w:W,h:H} }); }
    catch(_){ cv.style.display='none'; return; }
    // frame + row labels
    cctx.save(); cctx.globalAlpha=0.9;
    cctx.strokeStyle='rgba(255,255,255,0.14)'; cctx.lineWidth=1;
    cctx.strokeRect(0.5,0.5,W-1,H-1);
    cctx.font='9px ui-monospace,Menlo,Consolas,monospace'; cctx.textBaseline='middle'; cctx.textAlign='left';
    for(r=0;r<rows;r++){
      var cy=(r+0.5)*H/rows, nm=metrics[r].name||metrics[r].id;
      cctx.fillStyle='rgba(5,5,6,0.7)';
      cctx.fillRect(2,cy-6,cctx.measureText(nm).width+6,12);
      cctx.fillStyle='rgba(232,227,214,0.92)';
      cctx.fillText(nm,5,cy);
      if(r>0){ cctx.strokeStyle='rgba(255,255,255,0.10)';
        cctx.beginPath(); cctx.moveTo(0,Math.round(r*H/rows)+0.5); cctx.lineTo(W,Math.round(r*H/rows)+0.5); cctx.stroke(); }
    }
    cctx.restore();
  }

  window.__chronoHeatRefresh=schedule;
  ['quan:bars','quan:date','quan:instr','quan:cell'].forEach(function(ev){ window.addEventListener(ev,schedule); });
  window.addEventListener('resize',schedule);
  document.addEventListener('DOMContentLoaded',function(){ ensureUI(); schedule(); });
  if(document.readyState!=='loading'){ ensureUI(); schedule(); }
})();
