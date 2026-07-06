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
  function VertLinePaneRenderer(x,color){ this._x=x; this._color=color; }
  VertLinePaneRenderer.prototype.draw=function(target){
    var self=this;
    target.useBitmapCoordinateSpace(function(scope){
      if(self._x===null) return;
      var ctx=scope.context;
      var x=Math.round(self._x*scope.horizontalPixelRatio);
      ctx.save();
      ctx.lineWidth=Math.max(1,Math.floor(scope.horizontalPixelRatio));
      ctx.strokeStyle=self._color;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,scope.bitmapSize.height); ctx.stroke();
      ctx.restore();
    });
  };
  function VertLinePaneView(source){ this._source=source; this._x=null; }
  VertLinePaneView.prototype.update=function(){ this._x=this._source._chart.timeScale().timeToCoordinate(this._source._time); };
  VertLinePaneView.prototype.renderer=function(){ return new VertLinePaneRenderer(this._x,this._source._color); };
  function VertLine(chart,time,color){ this._chart=chart; this._time=time; this._color=color; this._paneViews=[new VertLinePaneView(this)]; }
  VertLine.prototype.updateAllViews=function(){ this._paneViews.forEach(function(v){ v.update(); }); };
  VertLine.prototype.paneViews=function(){ return this._paneViews; };

  function ensureChart(){
    if(chart) return true;
    if(typeof LightweightCharts==='undefined') return false;
    container=document.getElementById('chartMount'); if(!container) return false;
    chart=LightweightCharts.createChart(container,{
      width:container.clientWidth||600, height:container.clientHeight||400,
      layout:{background:{color:'transparent'},textColor:'#cccccc'},
      grid:{vertLines:{visible:false},horzLines:{visible:false}},
      rightPriceScale:{borderColor:'#2a2a2a'},
      timeScale:{borderColor:'#2a2a2a',timeVisible:true,secondsVisible:false}
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

  function refreshLevels(){
    if(!series) return;
    var inst=(document.getElementById('instA')||{}).value||'', date=(document.getElementById('dayDate')||{}).value||'';
    var data=null; try{ data=window.__reportData?window.__reportData(inst,date):null; }catch(_){}
    drawLevels(data&&data.__raw);
    drawP9Markers(data&&data.__raw, date);
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
    window.addEventListener('quan:instr',loadHistory);
    window.addEventListener('quan:date',loadHistory);
    window.addEventListener('quan:cell',refreshLevels);
    loadHistory();
  };
  window.__chartResize=function(){ if(chart&&container) chart.applyOptions({width:container.clientWidth,height:container.clientHeight}); };
})();
