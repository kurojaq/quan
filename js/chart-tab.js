(function(){
  // ---- price chart tab: lightweight-charts candles + structural-level overlay, fed by the same yahoo proxy ----
  var PROXY_BASE='https://quanyahoo.jqnboggan.workers.dev';
  var chart=null, series=null, priceLines=[], sessionLines=[], levelVals=[], container=null, curSym=null, curRange='5d', curInterval='5m', booted=false;
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

  function refreshLevels(){
    if(!series) return;
    var inst=(document.getElementById('instA')||{}).value||'', date=(document.getElementById('dayDate')||{}).value||'';
    var data=null; try{ data=window.__reportData?window.__reportData(inst,date):null; }catch(_){}
    drawLevels(data&&data.__raw);
  }
  window.__chartRefreshLevels=refreshLevels;

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
