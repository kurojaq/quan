(function(){
  // ---- price chart tab: lightweight-charts candles + structural-level overlay, fed by the gated /api/history function ----
  // Same-origin Pages Function (edge-cached, auth-gated, rate-limited). The old
  // open Worker (quanyahoo.jqnboggan.workers.dev) is superseded.
  var PROXY_BASE='/api';
  var chart=null, series=null, priceLines=[], sessionLines=[], dayRangeLines=[], levelVals=[], container=null, curSym=null, curRange='5d', curInterval='5m', booted=false;
  var titleEl, statusEl;

  // FX (and other fine-tick) instruments need more than 2 decimals on the price axis.
  var FX_PREC={'6E':5,'6B':5,'6A':5,'6C':5,'6S':5,'6N':5,'6J':7};
  function precFor(inst,price){
    if(FX_PREC[inst]!=null) return FX_PREC[inst];
    var p=Math.abs(price)||1;
    if(p<0.1) return 6; if(p<1) return 5; if(p<10) return 4; if(p<100) return 3; return 2;
  }

  // ---- vertical-line primitive (lightweight-charts has no built-in vertical line) ----
  function VertLinePaneRenderer(x,color,w,dash){ this._x=x; this._color=color; this._w=w||1; this._dash=dash; }
  VertLinePaneRenderer.prototype.draw=function(target){
    var self=this;
    target.useBitmapCoordinateSpace(function(scope){
      if(self._x===null) return;
      var ctx=scope.context, R=scope.horizontalPixelRatio;
      var x=Math.round(self._x*R);
      ctx.save();
      ctx.lineWidth=Math.max(1,Math.floor(R*self._w));
      ctx.strokeStyle=self._color;
      if(self._dash&&self._dash.length){ ctx.setLineDash(self._dash.map(function(d){ return d*R; })); }
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,scope.bitmapSize.height); ctx.stroke();
      ctx.restore();
    });
  };
  function VertLinePaneView(source){ this._source=source; this._x=null; }
  VertLinePaneView.prototype.update=function(){ this._x=this._source._chart.timeScale().timeToCoordinate(this._source._time); };
  VertLinePaneView.prototype.renderer=function(){ var s=this._source; return new VertLinePaneRenderer(this._x,(s._hot?s._hotColor:s._color)||s._color,(s._hot?(s._w*1.8):s._w),s._dash); };
  function VertLine(chart,time,color,w,dash,hotColor){ this._chart=chart; this._time=time; this._color=color; this._w=w||1; this._dash=dash; this._hotColor=hotColor; this._hot=false; this._paneViews=[new VertLinePaneView(this)]; }
  VertLine.prototype.updateAllViews=function(){ this._paneViews.forEach(function(v){ v.update(); }); };
  VertLine.prototype.paneViews=function(){ return this._paneViews; };

  // ---- vertical-band primitive: a Gaussian-weighted highlight along the time axis ----
  // Renders a soft session-time highlight for a chronometric event: opacity follows a
  // Gaussian centered on the event, so the visual literally is "±sigma in normalized session time".
  function VertBandPaneRenderer(xLo,xC,xHi,rgb,peak){ this._xLo=xLo; this._xC=xC; this._xHi=xHi; this._rgb=rgb; this._peak=peak; }
  VertBandPaneRenderer.prototype.draw=function(target){
    var s=this;
    target.useBitmapCoordinateSpace(function(scope){
      if(s._xC===null) return;
      var ctx=scope.context, R=scope.horizontalPixelRatio, H=scope.bitmapSize.height;
      var xC=s._xC*R;
      var xLo=(s._xLo!=null?s._xLo:s._xC)*R, xHi=(s._xHi!=null?s._xHi:s._xC)*R;
      if(xHi-xLo<2){ xLo=xC-1; xHi=xC+1; }                          // degenerate span: draw a hairline
      var g=ctx.createLinearGradient(xLo,0,xHi,0), col=s._rgb, pk=s._peak;
      // Gaussian-ish alpha profile across ±2.5σ (band edges), peak at the event centre.
      var stops=[[0,0],[0.12,0.06],[0.27,0.28],[0.4,0.72],[0.5,1],[0.6,0.72],[0.73,0.28],[0.88,0.06],[1,0]];
      stops.forEach(function(st){ g.addColorStop(st[0],'rgba('+col+','+(pk*st[1]).toFixed(3)+')'); });
      ctx.save();
      ctx.fillStyle=g; ctx.fillRect(xLo,0,xHi-xLo,H);
      ctx.strokeStyle='rgba('+col+','+Math.min(0.9,pk*1.7).toFixed(3)+')';
      ctx.lineWidth=Math.max(1,Math.floor(R));
      ctx.beginPath(); ctx.moveTo(Math.round(xC),0); ctx.lineTo(Math.round(xC),H); ctx.stroke();
      ctx.restore();
    });
  };
  function VertBandPaneView(source){ this._source=source; this._xLo=null; this._xC=null; this._xHi=null; }
  VertBandPaneView.prototype.update=function(){ var ts=this._source._chart.timeScale(), s=this._source;
    this._xLo=(s._tLo!=null)?ts.timeToCoordinate(s._tLo):null;
    this._xC =(s._tC !=null)?ts.timeToCoordinate(s._tC ):null;
    this._xHi=(s._tHi!=null)?ts.timeToCoordinate(s._tHi):null; };
  VertBandPaneView.prototype.renderer=function(){ return new VertBandPaneRenderer(this._xLo,this._xC,this._xHi,this._source._rgb,this._source._peak); };
  VertBandPaneView.prototype.zOrder=function(){ return 'normal'; };   // translucent highlight over the candles (matches VertLine, which renders; 'bottom' is hidden by the pane background in this build)
  function VertBand(chart,tLo,tC,tHi,rgb,peak){ this._chart=chart; this._tLo=tLo; this._tC=tC; this._tHi=tHi; this._rgb=rgb; this._peak=peak||0.28; this._paneViews=[new VertBandPaneView(this)]; }
  VertBand.prototype.updateAllViews=function(){ this._paneViews.forEach(function(v){ v.update(); }); };
  VertBand.prototype.paneViews=function(){ return this._paneViews; };

  function ensureChart(){
    if(chart) return true;
    if(typeof LightweightCharts==='undefined') return false;
    container=document.getElementById('chartMount'); if(!container) return false;
    chart=LightweightCharts.createChart(container,{
      width:container.clientWidth||600, height:container.clientHeight||400,
      layout:{background:{color:'transparent'},textColor:'#cccccc'},
      grid:{vertLines:{visible:false},horzLines:{visible:false}},
      rightPriceScale:{borderColor:'#2a2a2a'},
      timeScale:{borderColor:'#2a2a2a',timeVisible:true,secondsVisible:false},
      // free cursor for accurate annotation placement — no snap-to-price magnet (CrosshairMode.Normal=0)
      crosshair:{mode:(LightweightCharts.CrosshairMode&&LightweightCharts.CrosshairMode.Normal!=null)?LightweightCharts.CrosshairMode.Normal:0}
    });
    series=chart.addSeries(LightweightCharts.CandlestickSeries,{
      upColor:'#26a69a', downColor:'#ef5350', borderUpColor:'#26a69a', borderDownColor:'#ef5350', wickUpColor:'#26a69a', wickDownColor:'#ef5350',
      // keep every overlaid structural level inside the visible price range
      autoscaleInfoProvider:function(original){
        var res=original();
        if(res&&res.priceRange&&levelVals.length){
          var lo=Math.min.apply(null,levelVals), hi=Math.max.apply(null,levelVals);
          res.priceRange.minValue=Math.min(res.priceRange.minValue,lo);
          res.priceRange.maxValue=Math.max(res.priceRange.maxValue,hi);
        }
        return res;
      }
    });
    new ResizeObserver(function(){ if(chart&&container) chart.applyOptions({width:container.clientWidth,height:container.clientHeight}); }).observe(container);
    try{ chart.subscribeCrosshairMove(onChronoCrosshair); }catch(_){}
    return true;
  }

  function clearLevels(){ priceLines.forEach(function(pl){ try{ series.removePriceLine(pl); }catch(_){} }); priceLines=[]; levelVals=[]; }

  function drawLevels(raw){
    clearLevels(); if(!series||!raw){ if(series) series.applyOptions({}); return; }
    var LS=LightweightCharts.LineStyle;
    var specs=[];
    if(raw.dfloor!=null) specs.push([raw.dfloor,'dfloor',LS.Solid]);
    if(raw.dceil!=null) specs.push([raw.dceil,'dceil',LS.Solid]);
    if(raw.sfloor!=null) specs.push([raw.sfloor,'sfloor',LS.Dashed]);
    if(raw.sceil!=null) specs.push([raw.sceil,'sceil',LS.Dashed]);
    if(raw.target!=null) specs.push([raw.target,'target',LS.Dotted]);
    (raw.gwalls||[]).slice(0,5).forEach(function(g,i){ specs.push([g,'gwall'+(i+1),LS.Dotted]); });
    specs.forEach(function(s){
      if(typeof s[0]!=='number'||!isFinite(s[0])) return;
      levelVals.push(s[0]);
      priceLines.push(series.createPriceLine({price:s[0],color:'#9b9b9b',lineWidth:1,lineStyle:s[2],axisLabelVisible:true,title:s[1]}));
    });
    // nudge the series so the autoscale provider re-runs with the new level values
    if(series&&priceLines.length) series.applyOptions({});
  }

  // ---- current day's high/low, drawn like the other structural levels but sourced straight from the already-fetched bars ----
  var dayRangeVals=[];
  function clearDayRangeLines(){
    dayRangeLines.forEach(function(pl){ try{ series.removePriceLine(pl); }catch(_){} }); dayRangeLines=[];
    dayRangeVals.forEach(function(v){ var i=levelVals.indexOf(v); if(i>=0) levelVals.splice(i,1); }); dayRangeVals=[];
  }
  function drawDayRange(bars,dateStr){
    clearDayRangeLines(); if(!series||!bars||!bars.length||!dateStr) return;
    var fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
    function etDate(t){ var p={}; fmt.formatToParts(new Date(t*1000)).forEach(function(x){p[x.type]=x.value;}); return p.year+'-'+p.month+'-'+p.day; }
    var day=bars.filter(function(b){ return etDate(b.time)===dateStr; });
    if(!day.length) return;
    var hi=Math.max.apply(null,day.map(function(b){return b.high;})), lo=Math.min.apply(null,day.map(function(b){return b.low;}));
    if(!isFinite(hi)||!isFinite(lo)) return;
    var LS=LightweightCharts.LineStyle;
    levelVals.push(hi,lo); dayRangeVals.push(hi,lo);
    dayRangeLines.push(series.createPriceLine({price:hi,color:'#3fae63',lineWidth:1,lineStyle:LS.Dashed,axisLabelVisible:true,title:'Day High'}));
    dayRangeLines.push(series.createPriceLine({price:lo,color:'#c14e4e',lineWidth:1,lineStyle:LS.Dashed,axisLabelVisible:true,title:'Day Low'}));
    if(series) series.applyOptions({});
  }

  var _chronoEngHooked=false;
  function refreshLevels(){
    if(!series) return;
    // the Pyodide brief engine loads async; if it isn't ready yet, __reportData returns no __raw
    // (so no chrono events to draw) — kick it off and self-heal once it resolves (matches report.js).
    if(!window.__engBrief){ try{ if(window.__qEnsureEngine) window.__qEnsureEngine(); }catch(_){}
      if(!_chronoEngHooked && window.__engReady){ _chronoEngHooked=true; window.__engReady.then(function(){ try{ refreshLevels(); }catch(_){} }); } }
    var inst=(document.getElementById('instA')||{}).value||'', date=(document.getElementById('dayDate')||{}).value||'';
    var data=null; try{ data=window.__reportData?window.__reportData(inst,date):null; }catch(_){}
    drawLevels(data&&data.__raw);
    if(chronoOn){ clearP9Lines(); drawChronoBands(data&&data.__raw, date); }   // bands carry a centre hairline — supersede the plain p9 lines
    else{ clearChronoBands(); drawP9Markers(data&&data.__raw, date); }
  }
  window.__chartRefreshLevels=refreshLevels;

  // ---- 9th-order intersection markers (payload engine's degree-9 fit of the CL tension) — green=crossing up, red=crossing down ----
  var p9Lines=[];
  function clearP9Lines(){ p9Lines.forEach(function(p){ try{ series.detachPrimitive(p); }catch(_){} }); p9Lines=[]; }
  // seconds-since-ET-midnight (>=64800 rolls back to the prior calendar day, matching the session's 18:00 ET open) -> real Unix timestamp
  function etSecToUnix(dateStr,secOfDay){
    var d=new Date(dateStr+'T12:00:00Z'); if(secOfDay>=64800) d.setUTCDate(d.getUTCDate()-1);
    var y=d.getUTCFullYear(), mo=d.getUTCMonth(), da=d.getUTCDate();
    var h=Math.floor(secOfDay/3600), mi=Math.floor((secOfDay%3600)/60), se=secOfDay%60;
    var guess=Date.UTC(y,mo,da,h+4,mi,se)/1000;
    try{
      var etH=+new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit'}).formatToParts(new Date(guess*1000)).find(function(p){return p.type==='hour';}).value;
      var diff=h-etH; if(diff>12)diff-=24; if(diff<-12)diff+=24;
      guess+=diff*3600;
    }catch(_){}
    return guess;
  }
  function drawP9Markers(raw,date){
    clearP9Lines();
    if(!series||!chart||!raw||!raw.p9||!date) return;
    raw.p9.forEach(function(root){
      if(root==null||root.cw==null) return;
      var sod=window.__cwToSec?window.__cwToSec(root.cw,date):null; if(sod==null) return;
      var t=etSecToUnix(date,sod);
      var col=root.dir==='up'?'rgba(70,200,120,0.55)':'rgba(220,90,90,0.55)';
      try{ var vl=new VertLine(chart,t,col); series.attachPrimitive(vl); p9Lines.push(vl); }catch(_){}
    });
  }

  // ---- chronometric session highlights: event bands along the normalized-session-time axis ----
  // Each chronometric event (keyed on chronometer-watch cw) is painted as a Gaussian highlight of
  // width sigma in normalized session time. cw -> seconds-of-day (__cwToSec) -> unix (etSecToUnix) -> chart x.
  var chronoBands=[], chronoEvents=[], chronoOn=true, CHRONO_SIGMA=0.025;   // sigma in normalized session-time units
  var CHRONO_CONV_WIN=0.02;   // cross-type convergence window (normalized session time) for magnitude reinforcement
  var CHRONO_COL={ p9:'168,124,223', zc:'111,211,255', tx:'230,150,70', ext:'120,200,150', def:'200,200,210' };
  var CHRONO_NAME={ p9:'9th-order intersection', zc:'coherence-break (ZC)', tx:'tension intersection', ext:'extremum', def:'chronometric event' };
  function cwToUnix(cw,date){ if(cw==null||!date) return null; var sod=window.__cwToSec?window.__cwToSec(cw,date):null; if(sod==null) return null; return etSecToUnix(date,sod); }
  window.__cwToUnix=cwToUnix;
  function clearChronoBands(){ chronoBands.forEach(function(p){ try{ series.detachPrimitive(p); }catch(_){} }); chronoBands=[]; }
  function collectChronoEvents(raw,date){
    var ev=[];
    function pushArr(arr,type,namer){ if(!arr||!arr.length) return; arr.forEach(function(r){ if(r&&r.cw!=null) ev.push({cw:+r.cw,type:type,label:(namer?namer(r):CHRONO_NAME[type]),mag:1}); }); }
    if(raw){
      pushArr(raw.p9,'p9',function(r){ return CHRONO_NAME.p9+(r.dir?' ('+r.dir+')':''); });   // 9th-order intersections
      pushArr(raw.zc,'zc');                                                                     // coherence-break zero-crossings
      pushArr(raw.tx,'tx');                                                                     // CL×CM tension intersections
    }
    // extensible hook — further producers (extrema, cross-sheet convergence) register here without touching this file
    try{ var hook=window.__chronoEvents&&window.__chronoEvents(date); if(hook&&hook.length) hook.forEach(function(e){ if(e&&e.cw!=null) ev.push({cw:+e.cw,type:e.type||'def',label:e.label||CHRONO_NAME[e.type]||CHRONO_NAME.def,mag:(e.mag!=null?e.mag:1)}); }); }catch(_){}
    // magnitude by cross-type convergence (Obj 4/5): events of *different* sheets near the same session
    // time reinforce one another — intersection events glow brighter than isolated crossings.
    ev.forEach(function(e){
      var conv=0; ev.forEach(function(o){ if(o!==e && o.type!==e.type && Math.abs(o.cw-e.cw)<=CHRONO_CONV_WIN) conv++; });
      e.conv=conv; e.mag=Math.max(1,Math.min(2.2,1+0.45*conv));
      // per-event standard deviation: base sigma, widened by convergence so intersection events span a broader temporal zone
      e.sigma=Math.min(0.06,CHRONO_SIGMA*(1+0.25*conv));
    });
    return ev;
  }
  function drawChronoBands(raw,date){
    clearChronoBands();
    if(!series||!chart||!chronoOn||curInterval==='1d'||!date) return;   // session-time overlay: intraday only
    chronoEvents=collectChronoEvents(raw,date);
    chronoEvents.forEach(function(e){
      var tC=cwToUnix(e.cw,date); if(tC==null) return;
      var rgb=CHRONO_COL[e.type]||CHRONO_COL.def;
      // one dashed vertical line per event, colored by sheet; brightens to solid when the cursor is over it
      var col='rgba('+rgb+',0.62)', hot='rgba('+rgb+',0.98)';
      try{ var b=new VertLine(chart,tC,col,1,[5,4],hot); b._ev=e; b._tC=tC; series.attachPrimitive(b); chronoBands.push(b); }catch(_){}
    });
  }
  window.__chronoRefresh=function(){
    var inst=(document.getElementById('instA')||{}).value||'', date=(document.getElementById('dayDate')||{}).value||'';
    var data=null; try{ data=window.__reportData?window.__reportData(inst,date):null; }catch(_){}
    drawChronoBands(data&&data.__raw,date);
  };
  window.__chronoSetOn=function(v){ chronoOn=!!v; if(chronoOn){ window.__chronoRefresh(); } else { clearChronoBands(); } };
  window.__chronoIsOn=function(){ return chronoOn; };
  window.__chronoSetSigma=function(s){ CHRONO_SIGMA=Math.max(0.005,Math.min(0.2,+s||0.025)); if(chronoOn) window.__chronoRefresh(); };

  // ---- chronometric inspection: hover a highlight to read the event's mathematical state ----
  var chronoTip=null;
  function ensureChronoTip(){
    if(chronoTip) return chronoTip;
    var wrap=document.getElementById('chartWrap'); if(!wrap) return null;
    chronoTip=document.createElement('div'); chronoTip.id='chronoTip';
    chronoTip.style.cssText='position:absolute;z-index:40;pointer-events:none;display:none;max-width:230px;'+
      'padding:7px 9px;border-radius:7px;font:11px "SF Mono",Menlo,monospace;line-height:1.5;'+
      'background:rgba(18,18,22,0.94);border:.5px solid rgba(255,255,255,0.14);color:#e8e3d6;'+
      'box-shadow:0 6px 20px rgba(0,0,0,0.45);';
    wrap.appendChild(chronoTip); return chronoTip;
  }
  var chronoHot=null;
  function setChronoHot(b){ if(chronoHot===b) return; if(chronoHot) chronoHot._hot=false; if(b) b._hot=true; chronoHot=b; try{ series.applyOptions({}); }catch(_){} }  // force a repaint so the hovered line brightens
  function onChronoCrosshair(param){
    var tip=ensureChronoTip(); if(!tip) return;
    if(!chronoOn||!param||!param.point||!chronoBands.length){ tip.style.display='none'; setChronoHot(null); return; }
    // pixel-precise: highlight the line the cursor is actually over (~9px), independent of magnet/snap
    var ts=chart.timeScale(), px=param.point.x, best=null, bestD=Infinity;
    chronoBands.forEach(function(b){ if(b._tC==null) return; var x=ts.timeToCoordinate(b._tC); if(x==null) return; var d=Math.abs(px-x); if(d<bestD){ bestD=d; best=b; } });
    if(!best||bestD>9){ tip.style.display='none'; setChronoHot(null); return; }
    setChronoHot(best);
    var e=best._ev, rgb=CHRONO_COL[e.type]||CHRONO_COL.def;
    var clock=window.__cwClock?window.__cwClock(e.cw):null;
    var convLine=(e.conv>0)?('<div style="color:rgb('+rgb+');opacity:.9;">⊕&nbsp;'+e.conv+'-way convergence</div>'):'';
    tip.innerHTML='<div style="color:rgb('+rgb+');letter-spacing:.04em;margin-bottom:2px;">'+e.label+'</div>'+
      '<div style="opacity:.85;">session&nbsp;t&nbsp;<b>'+(+e.cw).toFixed(3)+'</b>'+(clock?('&nbsp;·&nbsp;'+clock):'')+'</div>'+
      convLine+
      '<div style="opacity:.6;">σ&nbsp;'+(e.sigma||CHRONO_SIGMA).toFixed(3)+'&nbsp;·&nbsp;mag&nbsp;'+(+e.mag).toFixed(2)+'</div>';
    tip.style.display='block';
    var wrap=document.getElementById('chartWrap'), ww=(wrap&&wrap.clientWidth)||600, wh=(wrap&&wrap.clientHeight)||400;
    var x=Math.min(param.point.x+14, ww-tip.offsetWidth-8), y=Math.min(param.point.y+12, wh-tip.offsetHeight-8);
    tip.style.left=Math.max(6,x)+'px'; tip.style.top=Math.max(6,y)+'px';
  }

  // ---- CME daily session vertical markers: open 17:00 CT, close 16:00 CT (America/Chicago, DST-aware) ----
  function chicagoHM(t){
    try{
      var s=new Date(t*1000).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:false,hour:'2-digit',minute:'2-digit'});
      var p=s.split(':'); return {h:parseInt(p[0],10)%24, m:parseInt(p[1],10)};
    }catch(_){ return {h:-1,m:0}; }
  }
  function clearSessionLines(){ sessionLines.forEach(function(p){ try{ series.detachPrimitive(p); }catch(_){} }); sessionLines=[]; }
  function drawSessionMarkers(bars){
    clearSessionLines();
    if(!series||!chart||curInterval==='1d') return;               // daily bars: session markers don't apply
    var stepMin=parseInt(curInterval,10)||5;                        // 1m/5m/15m/60m
    bars.forEach(function(b){
      var hm=chicagoHM(b.time);
      if(hm.m<stepMin && (hm.h===17||hm.h===16)){                   // top-of-hour bar only
        var col=(hm.h===17)?'rgba(120,190,150,0.30)':'rgba(190,120,120,0.30)'; // open / close
        try{ var vl=new VertLine(chart,b.time,col); series.attachPrimitive(vl); sessionLines.push(vl); }catch(_){}
      }
    });
  }

  function loadHistory(){
    if(!statusEl) return;
    var inst=(document.getElementById('instA')||{}).value||'', sym=(window.__YF_SYMS||{})[inst];
    if(!ensureChart()){ statusEl.textContent='loading chart library…'; setTimeout(loadHistory,300); return; }
    if(!sym){ statusEl.textContent='no Yahoo symbol mapped for '+inst; return; }
    curSym=sym;
    if(titleEl) titleEl.textContent=sym+' · '+curRange+'/'+curInterval;
    statusEl.textContent='loading '+sym+'…';
    var _h={}; var _t=window.__authToken&&window.__authToken(); if(_t) _h['Authorization']='Bearer '+_t;
    if(window.__viewToken) _h['X-Quan-Token']=window.__viewToken;   // client view (view.html) has no login, carries a publish token
    fetch(PROXY_BASE+'/history?symbol='+encodeURIComponent(sym)+'&range='+curRange+'&interval='+curInterval,{headers:_h})
      .then(function(r){ return r.json(); }).then(function(d){
        if(!d||!d.bars||!d.bars.length){ statusEl.textContent=(d&&d.error)?('error: '+d.error):'no bars returned'; return; }
        series.setData(d.bars.map(function(b){ return {time:b.time,open:b.open,high:b.high,low:b.low,close:b.close}; }));
        window.__chartBars=d.bars; // chart-heat.js reads these for the volume-bubble layer
        try{ window.dispatchEvent(new CustomEvent('quan:bars')); }catch(_){}
        var last=d.bars[d.bars.length-1].close;
        var p=precFor(inst,last);
        series.applyOptions({priceFormat:{type:'price',precision:p,minMove:Math.pow(10,-p)}});
        chart.timeScale().fitContent();
        drawSessionMarkers(d.bars);
        statusEl.textContent=sym+' · '+d.bars.length+' bars · '+new Date().toLocaleTimeString();
        refreshLevels();
        drawDayRange(d.bars,(document.getElementById('dayDate')||{}).value||'');
      }).catch(function(){ statusEl.textContent='proxy unreachable — check your connection'; });
  }

  // js/chart-heat.js (Bookmap-style heat blend) needs the live chart + series to attach its pane primitive
  window.__chartApi=function(){ return {chart:chart,series:series,container:container}; };

  window.__chartOnLiveTick=function(sym,price){
    if(!series||sym!==curSym) return;
    try{ series.update({time:Math.floor(Date.now()/1000),open:price,high:price,low:price,close:price}); }catch(_){}
  };

  window.__chartBoot=function(){
    if(booted){ refreshLevels(); return; }
    booted=true;
    titleEl=document.getElementById('chartPriceTitle'); statusEl=document.getElementById('chartStatus');
    document.querySelectorAll('.chart-tf').forEach(function(btn){
      btn.addEventListener('click',function(){
        document.querySelectorAll('.chart-tf').forEach(function(b){ b.classList.remove('on'); });
        btn.classList.add('on');
        curRange=btn.dataset.range; curInterval=btn.dataset.interval;
        loadHistory();
      });
    });
    var refreshBtn=document.getElementById('chartRefreshBtn'); if(refreshBtn) refreshBtn.addEventListener('click',loadHistory);
    var chronoBtn=document.getElementById('chartChronoBtn');
    if(chronoBtn) chronoBtn.addEventListener('click',function(){ chronoBtn.classList.toggle('on'); window.__chronoSetOn(chronoBtn.classList.contains('on')); });
    window.addEventListener('quan:instr',loadHistory);
    window.addEventListener('quan:date',loadHistory);
    window.addEventListener('quan:cell',refreshLevels);
    loadHistory();
  };
  window.__chartResize=function(){ if(chart&&container) chart.applyOptions({width:container.clientWidth,height:container.clientHeight}); };
})();
