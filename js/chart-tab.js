(function(){
  // ---- price chart tab: lightweight-charts candles + structural-level overlay, fed by the same yahoo proxy ----
  var PROXY_BASE='https://quanyahoo.jqnboggan.workers.dev';
  var chart=null, series=null, priceLines=[], container=null, curSym=null, curRange='5d', curInterval='5m', booted=false;
  var titleEl, statusEl;

  function ensureChart(){
    if(chart) return true;
    if(typeof LightweightCharts==='undefined') return false;
    container=document.getElementById('chartMount'); if(!container) return false;
    chart=LightweightCharts.createChart(container,{
      width:container.clientWidth||600, height:container.clientHeight||400,
      layout:{background:{color:'transparent'},textColor:'#cccccc'},
      grid:{vertLines:{color:'#202020'},horzLines:{color:'#202020'}},
      rightPriceScale:{borderColor:'#2a2a2a'},
      timeScale:{borderColor:'#2a2a2a',timeVisible:true,secondsVisible:false}
    });
    series=chart.addSeries(LightweightCharts.CandlestickSeries,{
      upColor:'#26a69a', downColor:'#ef5350', borderUpColor:'#26a69a', borderDownColor:'#ef5350', wickUpColor:'#26a69a', wickDownColor:'#ef5350'
    });
    new ResizeObserver(function(){ if(chart&&container) chart.applyOptions({width:container.clientWidth,height:container.clientHeight}); }).observe(container);
    return true;
  }

  function clearLevels(){ priceLines.forEach(function(pl){ try{ series.removePriceLine(pl); }catch(_){} }); priceLines=[]; }

  function drawLevels(raw){
    clearLevels(); if(!series||!raw) return;
    var LS=LightweightCharts.LineStyle;
    var specs=[];
    if(raw.dfloor!=null) specs.push([raw.dfloor,'dfloor',LS.Solid]);
    if(raw.dceil!=null) specs.push([raw.dceil,'dceil',LS.Solid]);
    if(raw.sfloor!=null) specs.push([raw.sfloor,'sfloor',LS.Dashed]);
    if(raw.sceil!=null) specs.push([raw.sceil,'sceil',LS.Dashed]);
    if(raw.target!=null) specs.push([raw.target,'target',LS.Dotted]);
    (raw.gwalls||[]).slice(0,5).forEach(function(g,i){ specs.push([g,'gwall'+(i+1),LS.Dotted]); });
    specs.forEach(function(s){
      if(typeof s[0]!=='number') return;
      priceLines.push(series.createPriceLine({price:s[0],color:'#9b9b9b',lineWidth:1,lineStyle:s[2],axisLabelVisible:true,title:s[1]}));
    });
  }

  function refreshLevels(){
    if(!series) return;
    var inst=(document.getElementById('instA')||{}).value||'', date=(document.getElementById('dayDate')||{}).value||'';
    var data=null; try{ data=window.__reportData?window.__reportData(inst,date):null; }catch(_){}
    drawLevels(data&&data.__raw);
  }

  function loadHistory(){
    if(!statusEl) return;
    var inst=(document.getElementById('instA')||{}).value||'', sym=(window.__YF_SYMS||{})[inst];
    if(!ensureChart()){ statusEl.textContent='loading chart library…'; setTimeout(loadHistory,300); return; }
    if(!sym){ statusEl.textContent='no Yahoo symbol mapped for '+inst; return; }
    curSym=sym;
    if(titleEl) titleEl.textContent=sym+' · '+curRange+'/'+curInterval;
    statusEl.textContent='loading '+sym+'…';
    fetch(PROXY_BASE+'/history?symbol='+encodeURIComponent(sym)+'&range='+curRange+'&interval='+curInterval)
      .then(function(r){ return r.json(); }).then(function(d){
        if(!d||!d.bars||!d.bars.length){ statusEl.textContent=(d&&d.error)?('error: '+d.error):'no bars returned'; return; }
        series.setData(d.bars.map(function(b){ return {time:b.time,open:b.open,high:b.high,low:b.low,close:b.close}; }));
        chart.timeScale().fitContent();
        statusEl.textContent=sym+' · '+d.bars.length+' bars · '+new Date().toLocaleTimeString();
        refreshLevels();
      }).catch(function(){ statusEl.textContent='proxy unreachable — check your connection'; });
  }

  window.__chartOnLiveTick=function(sym,price){
    if(!series||sym!==curSym) return;
    try{ series.update({time:Math.floor(Date.now()/1000),open:price,high:price,low:price,close:price}); }catch(_){}
  };

  window.__chartBoot=function(){
    if(booted) return; booted=true;
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