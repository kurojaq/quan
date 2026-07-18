/* ============================================================================
   Chart Drawing Tools  (Price-tab spec — Integrated Drawing Toolkit)
   ----------------------------------------------------------------------------
   Trend lines, rays, horizontal levels, vertical markers and rectangles drawn
   directly on the price chart. Every drawing is stored in DATA coordinates
   (bar-snapped time + price) and reprojected to pixels on each render, so it
   stays locked to the chart as the user pans and zooms — never floats in
   screen space. Persisted per (instrument, date) in localStorage.

   Uses window.__chartApi() -> {chart, series, container}. Self-initializing.
   ============================================================================ */
(function(){
  'use strict';
  var api=null, prim=null, overlay=null, tool=null, toolbar=null, drag=null;
  var DRAWINGS=[];   // [{type, t1,p1,t2,p2 | time | price, color}]
  var COL='rgba(232,192,122,0.95)';   // default drawing color (matches terminal accent)

  function getApi(){ try{ return window.__chartApi?window.__chartApi():null; }catch(_){ return null; } }
  function key(){ var i=(document.getElementById('instA')||{}).value||'', d=(document.getElementById('dayDate')||{}).value||''; return 'qdraw:'+i+':'+d; }
  function save(){ try{ localStorage.setItem(key(), JSON.stringify(DRAWINGS)); }catch(_){} }
  function load(){ try{ var v=localStorage.getItem(key()); DRAWINGS=v?JSON.parse(v):[]; }catch(_){ DRAWINGS=[]; } }

  // snap a unix time to the nearest real bar time — lightweight-charts' timeToCoordinate
  // only resolves times that lie exactly on the scale (see chart-tab chrono fix).
  function snapTime(t){ var bars=window.__chartBars; if(!bars||!bars.length||t==null) return t;
    if(t<=bars[0].time) return bars[0].time; if(t>=bars[bars.length-1].time) return bars[bars.length-1].time;
    var lo=0,hi=bars.length-1; while(hi-lo>1){ var m=(lo+hi)>>1; if(bars[m].time<t) lo=m; else hi=m; }
    return (Math.abs(bars[lo].time-t)<=Math.abs(bars[hi].time-t))?bars[lo].time:bars[hi].time; }

  // ---- the single series primitive that renders every drawing ----
  function Renderer(items){ this._items=items; }
  Renderer.prototype.draw=function(target){ var items=this._items;
    target.useBitmapCoordinateSpace(function(sc){
      var ctx=sc.context, R=sc.horizontalPixelRatio, RV=sc.verticalPixelRatio, W=sc.bitmapSize.width, H=sc.bitmapSize.height;
      items.forEach(function(it){
        ctx.save(); ctx.strokeStyle=it.color||COL; ctx.fillStyle=it.color||COL; ctx.lineWidth=Math.max(1,Math.floor(R*1.4));
        if(it.type==='hline'){ var y=it.y*RV; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
        else if(it.type==='vline'){ var x=it.x*R; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
        else if(it.type==='trend'||it.type==='ray'){ var x1=it.x1*R,y1=it.y1*RV,x2=it.x2*R,y2=it.y2*RV;
          if(it.type==='ray'){ var dx=x2-x1,dy=y2-y1,k=(dx===0&&dy===0)?0:Math.max(W,H)*4/Math.hypot(dx,dy); x2=x1+dx*k; y2=y1+dy*k; }
          ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
        else if(it.type==='rect'){ var rx=Math.min(it.x1,it.x2)*R, ry=Math.min(it.y1,it.y2)*RV, rw=Math.abs(it.x2-it.x1)*R, rh=Math.abs(it.y2-it.y1)*RV;
          ctx.globalAlpha=0.12; ctx.fillRect(rx,ry,rw,rh); ctx.globalAlpha=1; ctx.strokeRect(rx,ry,rw,rh); }
        ctx.restore();
      });
    }); };
  function PaneView(src){ this._src=src; this._items=[]; }
  PaneView.prototype.update=function(){
    var ts=this._src._chart.timeScale(), s=this._src._series, items=[];
    function X(t){ return ts.timeToCoordinate(t); } function Y(p){ return s.priceToCoordinate(p); }
    // include committed drawings plus any in-progress preview
    var listAll=DRAWINGS.concat(drag&&drag.preview?[drag.preview]:[]);
    listAll.forEach(function(d){
      var it={type:d.type, color:d.color};
      if(d.type==='hline'){ var y=Y(d.price); if(y==null) return; it.y=y; }
      else if(d.type==='vline'){ var x=X(d.time); if(x==null) return; it.x=x; }
      else { var x1=X(d.t1),y1=Y(d.p1),x2=X(d.t2),y2=Y(d.p2); if(x1==null||x2==null||y1==null||y2==null) return; it.x1=x1;it.y1=y1;it.x2=x2;it.y2=y2; }
      items.push(it);
    });
    this._items=items;
  };
  PaneView.prototype.renderer=function(){ return new Renderer(this._items); };
  PaneView.prototype.zOrder=function(){ return 'top'; };
  function Primitive(chart,series){ this._chart=chart; this._series=series; this._paneViews=[new PaneView(this)]; }
  Primitive.prototype.updateAllViews=function(){ this._paneViews.forEach(function(v){ v.update(); }); };
  Primitive.prototype.paneViews=function(){ return this._paneViews; };

  function repaint(){ try{ if(api&&api.series) api.series.applyOptions({}); }catch(_){} }
  function ensurePrim(){ api=getApi(); if(!api||!api.chart||!api.series) return false;
    if(prim) return true; prim=new Primitive(api.chart,api.series);
    try{ api.series.attachPrimitive(prim); }catch(_){ prim=null; return false; } return true; }

  // ---- mouse → data coordinates (via the overlay, which shares the chart rect) ----
  function toData(ev){ var c=api.container.getBoundingClientRect(); var x=ev.clientX-c.left, y=ev.clientY-c.top;
    var t=api.chart.timeScale().coordinateToTime(x), p=api.series.coordinateToPrice(y);
    return { time:(t!=null?snapTime(t):null), price:p, x:x, y:y }; }

  function setTool(t){ tool=t; syncToolbar();
    if(t){ showOverlay(); } else { hideOverlay(); } }
  function showOverlay(){ if(!api||!api.container) return; if(!overlay){ overlay=document.createElement('div');
      overlay.style.cssText='position:absolute;inset:0;z-index:7;cursor:crosshair;'; api.container.style.position=api.container.style.position||'relative';
      overlay.addEventListener('mousedown',onDown); overlay.addEventListener('mousemove',onMove);
      window.addEventListener('mouseup',onUp); api.container.appendChild(overlay); }
    overlay.style.display='block'; }
  function hideOverlay(){ if(overlay) overlay.style.display='none'; drag=null; }

  function onDown(ev){ if(!tool) return; ev.preventDefault(); var d=toData(ev);
    if(tool==='hline'){ DRAWINGS.push({type:'hline',price:d.price,color:COL}); commit(); return; }
    if(tool==='vline'){ if(d.time==null) return; DRAWINGS.push({type:'vline',time:d.time,color:COL}); commit(); return; }
    drag={ t1:d.time, p1:d.price, preview:null }; }
  function onMove(ev){ if(!tool||!drag) return; var d=toData(ev);
    drag.preview={ type:tool, t1:drag.t1,p1:drag.p1, t2:d.time,p2:d.price, color:'rgba(232,192,122,0.55)' }; repaint(); }
  function onUp(ev){ if(!tool||!drag) return; var d=toData(ev);
    if(drag.t1!=null && d.time!=null){ DRAWINGS.push({ type:tool, t1:drag.t1,p1:drag.p1, t2:d.time,p2:d.price, color:COL }); }
    drag=null; commit(); }
  function commit(){ save(); repaint(); setTool(null); }   // one drawing per tool selection, then back to pan mode

  // ---- toolbar ----
  function btn(label,title,on,cls){ var b=document.createElement('button'); b.type='button'; b.textContent=label; b.title=title;
    b.className='cdraw-btn'+(cls?(' '+cls):'');
    b.addEventListener('click',function(e){ e.preventDefault(); on(b); }); return b; }
  function buildToolbar(){ if(toolbar||!api||!api.container) return;
    var wrap=document.getElementById('chartWrap')||api.container;
    toolbar=document.createElement('div'); toolbar.className='cdraw-bar';
    toolbar._tools={};
    [['Trend','trend','Trend line (drag)'],['Ray','ray','Ray (drag)'],['H','hline','Horizontal level (click)'],['V','vline','Vertical marker (click)'],['Rect','rect','Rectangle (drag)']]
      .forEach(function(t){ var b=btn(t[0],t[2],function(){ setTool(tool===t[1]?null:t[1]); }); toolbar._tools[t[1]]=b; toolbar.appendChild(b); });
    toolbar.appendChild(Object.assign(document.createElement('span'),{className:'cdraw-sep'}));
    toolbar.appendChild(btn('Clear','Remove all drawings on this session',function(){ DRAWINGS=[]; save(); repaint(); },'cdraw-clear'));
    wrap.style.position=wrap.style.position||'relative'; wrap.appendChild(toolbar); }
  function syncToolbar(){ if(!toolbar) return;
    toolbar.classList.toggle('active',!!tool);   // keep the bar fully opaque while a tool is armed
    Object.keys(toolbar._tools).forEach(function(k){ toolbar._tools[k].classList.toggle('on',tool===k); }); }

  // reload drawings when the session/instrument changes
  function reload(){ if(!ensurePrim()) return; load(); repaint(); }
  window.addEventListener('quan:instr',reload); window.addEventListener('quan:date',reload);
  window.addEventListener('quan:bars',reload);

  function boot(){ if(!ensurePrim()){ setTimeout(boot,400); return; } buildToolbar(); load(); repaint(); }
  if(document.readyState!=='loading') setTimeout(boot,600); else document.addEventListener('DOMContentLoaded',function(){ setTimeout(boot,600); });
  window.__chartDrawReload=reload;
})();
