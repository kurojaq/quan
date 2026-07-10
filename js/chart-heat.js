(function(){
  // ---- Bookmap-and-beyond heat blend for the Chart tab ----
  // A lightweight-charts series primitive (zOrder 'bottom' — everything paints UNDER
  // the candles, inside the chart's own coordinate/redraw lifecycle). Layers:
  //   1. time-segmented heat field  — each session date's grid spans that day's bars;
  //      today's grid is re-captured while the view is open, so the field EVOLVES
  //      intraday as dealers reposition (this is the beyond-Bookmap part: Bookmap
  //      shows resting orders, this shows the positioning book through time)
  //   2. volume bubbles             — per-bar traded volume on the price path
  //   3. right-anchored profile     — latest grid, two-tone call/put split where the
  //      metric has sides (OI, Volume, Net Premium), heat ramp otherwise
  //   4. PDSL dealer levels         — support/resistance ticks + top-wall labels
  // Plus a DOM crosshair readout (strike / value / C-P split / PDSL) and a legend chip.
  //
  // Data sources, in order of preference:
  //   window.__getHeatSnapshots()  — client terminal: ALL published dates at once
  //   window.__getHeatSnapshot()   — client terminal fallback: current date only
  //   #heatFrame quanGetHeatmap    — main terminal: the live heat-engine iframe
  // Grid shape: { meta:{anchor,atm,pdsl:[{k,w,side}],...}, rows:[{k,coi,poi,cvol,pvol,
  //               netprem,cprem,pprem,gex,invdist,mass,...}] }

  var on=false, metric='oi', prim=null, attachedSeries=null, pendingReq=false;
  var DAYGRIDS={};        // 'YYYY-MM-DD' -> {rows,meta}
  var INTRADAY=[];        // [{t,grid}] — today's recaptures, session-lifetime only
  var LATEST=null;        // newest grid (drives profile / PDSL / readout)
  var lastHash='';
  var captureTimer=null, tipEl=null, legendEl=null, crosshairWired=false;
  var curInstKey='';

  var PROFILE_FRAC=0.13, BAND_ALPHA=0.55, PROF_ALPHA=0.9, BUBBLE_MAX_R=13, GAMMA=1.75;
  var CAPTURE_MS=180000, MAX_DAYS_STORED=10, MAX_INTRADAY=240;
  var CALL_RGB='67,176,168', PUT_RGB='207,154,58', UP_RGB='38,166,154', DN_RGB='239,83,80';

  var METRICS={
    oi:      {label:'Open Interest', get:function(r){ return (r.coi||0)+(r.poi||0); },        split:function(r){ return [r.coi||0,r.poi||0]; }},
    netprem: {label:'Net Premium',   get:function(r){ return Math.abs(r.netprem||0); },       split:function(r){ return [Math.abs(r.cprem||0),Math.abs(r.pprem||0)]; }},
    gex:     {label:'GEX',           get:function(r){ return Math.abs(r.gex||0); },           split:null},
    vol:     {label:'Volume',        get:function(r){ return (r.cvol||0)+(r.pvol||0); },      split:function(r){ return [r.cvol||0,r.pvol||0]; }},
    invdist: {label:'Inv Dist',      get:function(r){ return Math.abs(r.invdist||0); },       split:null},
    mass:    {label:'Mass',          get:function(r){ return Math.abs(r.mass||0); },          split:null}
  };

  // ---- Bookmap-ish colormap: navy field, hot only at the true walls ----
  var STOPS=[
    [0.00,   6, 12, 24,   0],
    [0.20,  10, 36, 70,  90],
    [0.45,  14, 90,160, 150],
    [0.68,  30,150,210, 185],
    [0.84,  90,210,235, 210],
    [0.93, 255,205, 70, 240],
    [1.00, 255,120, 30, 255]
  ];
  function ramp(t){
    if(!(t>0)) t=0; if(t>1) t=1;
    var i=1; while(i<STOPS.length-1 && STOPS[i][0]<t) i++;
    var a=STOPS[i-1], b=STOPS[i], f=(t-a[0])/((b[0]-a[0])||1);
    return [a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f, a[3]+(b[3]-a[3])*f, (a[4]+(b[4]-a[4])*f)/255];
  }
  function rgba(c,mul){ return 'rgba('+Math.round(c[0])+','+Math.round(c[1])+','+Math.round(c[2])+','+(c[3]*mul).toFixed(3)+')'; }
  function cssRamp(){ return 'linear-gradient(90deg,'+STOPS.map(function(s){ return 'rgba('+s[1]+','+s[2]+','+s[3]+',1) '+(s[0]*100)+'%'; }).join(',')+')'; }
  function fmtV(v){
    var a=Math.abs(v);
    if(a>=1e9) return (v/1e9).toFixed(2)+'B'; if(a>=1e6) return (v/1e6).toFixed(2)+'M';
    if(a>=1e3) return (v/1e3).toFixed(1)+'k'; return String(Math.round(v*100)/100);
  }

  // ---- ET session math: session for date D = [D-1 18:00 ET, D 17:00 ET] ----
  function etHourUnix(dateStr,hour){
    var guess=Date.UTC(+dateStr.slice(0,4),+dateStr.slice(5,7)-1,+dateStr.slice(8,10),hour+4,0,0)/1000;
    try{
      var etH=+new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit'})
        .formatToParts(new Date(guess*1000)).find(function(p){return p.type==='hour';}).value;
      var diff=hour-etH; if(diff>12)diff-=24; if(diff<-12)diff+=24;
      guess+=diff*3600;
    }catch(_){}
    return guess;
  }
  function sessionStart(dateStr){ return etHourUnix(dateStr,17)-23*3600; }
  function todaySessionDate(){
    var P={}; new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit'})
      .formatToParts(new Date()).forEach(function(x){P[x.type]=x.value;});
    var h=+P.hour; if(h>=24)h-=24;
    var d=new Date(Date.UTC(+P.year,+P.month-1,+P.day)); if(h>=18)d.setUTCDate(d.getUTCDate()+1);
    return d.toISOString().slice(0,10);
  }

  // ---- persistence: per-instrument day grids (compacted; localStorage — cloud-storage.js write-through picks it up) ----
  var KEEP_FIELDS=['k','coi','poi','cvol','pvol','netprem','cprem','pprem','gex','invdist','mass'];
  function compactGrid(g){
    if(!g||!g.rows) return null;
    return { meta:{anchor:g.meta&&g.meta.anchor,atm:g.meta&&g.meta.atm,pdsl:(g.meta&&g.meta.pdsl)||[]},
      rows:g.rows.map(function(r){ var o={}; KEEP_FIELDS.forEach(function(f){ if(r[f]!=null)o[f]=r[f]; }); return o; }) };
  }
  function saveDays(inst){
    try{
      var dates=Object.keys(DAYGRIDS).sort().slice(-MAX_DAYS_STORED), out={};
      dates.forEach(function(d){ out[d]=compactGrid(DAYGRIDS[d]); });
      localStorage.setItem('quanChartHeat:'+inst,JSON.stringify(out));
    }catch(_){}
  }
  function loadDays(inst){
    try{
      var raw=localStorage.getItem('quanChartHeat:'+inst);
      if(raw){ var d=JSON.parse(raw); if(d&&typeof d==='object') return d; }
    }catch(_){}
    return {};
  }

  function curInst(){ return (document.getElementById('instA')||{}).value||''; }
  function curDate(){ return (document.getElementById('dayDate')||{}).value||''; }
  function getApi(){ try{ return window.__chartApi?window.__chartApi():null; }catch(_){ return null; } }
  function nudge(){ var api=getApi(); if(api&&api.series){ try{ api.series.applyOptions({}); }catch(_){} } }

  // ---- segment model: sorted boundaries [{t,grid}]; each runs to the next boundary,
  //      first extends to the pane's left edge, last to the right edge ----
  function buildSegments(){
    var segs=[];
    Object.keys(DAYGRIDS).sort().forEach(function(d){
      if(DAYGRIDS[d]&&DAYGRIDS[d].rows&&DAYGRIDS[d].rows.length) segs.push({t:sessionStart(d),grid:DAYGRIDS[d]});
    });
    INTRADAY.forEach(function(e){ segs.push({t:e.t,grid:e.grid}); });
    segs.sort(function(a,b){ return a.t-b.t; });
    return segs;
  }
  function gridAt(t){
    var segs=buildSegments(); if(!segs.length) return LATEST;
    var g=segs[0].grid;
    for(var i=0;i<segs.length;i++){ if(segs[i].t<=t) g=segs[i].grid; else break; }
    return g;
  }

  // ---- data acquisition ----
  function ingest(grid,dateStr){
    if(!grid||!grid.rows||!grid.rows.length) return false;
    var d=dateStr||curDate()||todaySessionDate();
    var h=''; try{ h=String(grid.rows.length)+':'+JSON.stringify(grid.rows[Math.floor(grid.rows.length/2)])+':'+d; }catch(_){}
    DAYGRIDS[d]=grid;
    var newest=Object.keys(DAYGRIDS).sort().pop();
    LATEST=DAYGRIDS[newest];
    if(h&&h!==lastHash){
      // intraday evolution: only today's session accumulates time slices
      if(lastHash&&d===todaySessionDate()){
        INTRADAY.push({t:Math.floor(Date.now()/1000),grid:grid});
        if(INTRADAY.length>MAX_INTRADAY) INTRADAY.shift();
      }
      lastHash=h;
    }
    if(prim) prim.setData();
    saveDays(curInst());
    nudge(); updateLegend();
    return true;
  }
  function requestData(cb){
    // client terminal: published snapshots (multi-date when available)
    if(window.__getHeatSnapshots||window.__getHeatSnapshot){
      var got=false;
      try{
        if(window.__getHeatSnapshots){
          (window.__getHeatSnapshots()||[]).forEach(function(s){
            if(s&&s.heatmap&&s.heatmap.rows&&s.heatmap.rows.length){ DAYGRIDS[s.date]=s.heatmap; got=true; }
          });
          var newest=Object.keys(DAYGRIDS).sort().pop(); if(newest) LATEST=DAYGRIDS[newest];
        }else{
          var one=window.__getHeatSnapshot(); got=ingest(one);
        }
      }catch(_){}
      if(prim) prim.setData();
      nudge(); updateLegend();
      if(cb) cb(got);
      return;
    }
    // main terminal: heat-engine iframe bridge
    if(pendingReq) return;
    var frame=document.getElementById('heatFrame');
    if(!frame&&window.__heatBoot){ try{ window.__heatBoot(); }catch(_){} frame=document.getElementById('heatFrame'); }
    if(!frame){ if(cb) cb(false); return; }
    pendingReq=true;
    var reqId='ch'+Math.random().toString(36).slice(2), done=false, attempts=0;
    function onMsg(ev){
      if(ev.data&&ev.data.type==='quanHeatmapData'&&ev.data.reqId===reqId){
        done=true; pendingReq=false; window.removeEventListener('message',onMsg);
        var ok=ingest(ev.data.data);
        if(cb) cb(ok);
      }
    }
    window.addEventListener('message',onMsg);
    var iv=setInterval(function(){
      attempts++;
      try{ frame.contentWindow.postMessage({type:'quanGetHeatmap',reqId:reqId},'*'); }catch(_){}
      if(done||attempts>=12){ clearInterval(iv); if(!done){ pendingReq=false; window.removeEventListener('message',onMsg); if(cb) cb(false); } }
    },400);
  }

  // ---- pane renderer ----
  function HeatRenderer(view){ this._v=view; }
  HeatRenderer.prototype.draw=function(target){
    var v=this._v;
    target.useBitmapCoordinateSpace(function(scope){
      var ctx=scope.context, hr=scope.horizontalPixelRatio, vr=scope.verticalPixelRatio;
      var W=scope.bitmapSize.width, H=scope.bitmapSize.height;
      var profW=Math.round(W*PROFILE_FRAC);
      ctx.save();
      // 1. time-segmented heat field
      for(var s=0;s<v._segs.length;s++){
        var seg=v._segs[s];
        var x0=Math.round(seg.x0*hr), x1=Math.round(seg.x1*hr);
        if(x1<=x0) continue;
        for(var i=0;i<seg.bands.length;i++){
          var b=seg.bands[i];
          var yT=Math.round(b.yTop*vr), yB=Math.round(b.yBot*vr);
          if(yB<0||yT>H) continue;
          ctx.fillStyle=rgba(ramp(b.norm),BAND_ALPHA);
          ctx.fillRect(x0,yT,x1-x0,Math.max(1,yB-yT));
        }
      }
      // 2. volume bubbles on the price path
      for(var j=0;j<v._bubbles.length;j++){
        var bu=v._bubbles[j];
        var bx=bu.x*hr, by=bu.y*vr, r=bu.r*hr;
        if(bx<-r||bx>W+r||by<-r||by>H+r) continue;
        ctx.beginPath(); ctx.arc(bx,by,r,0,6.2832);
        ctx.fillStyle='rgba('+(bu.up?UP_RGB:DN_RGB)+',0.30)'; ctx.fill();
        ctx.lineWidth=Math.max(1,hr*0.8);
        ctx.strokeStyle='rgba('+(bu.up?UP_RGB:DN_RGB)+',0.75)'; ctx.stroke();
      }
      // 3. right-anchored profile (latest grid) — two-tone call/put when the metric has sides
      for(var p=0;p<v._prof.length;p++){
        var pb=v._prof[p];
        var yT2=Math.round(pb.yTop*vr), yB2=Math.round(pb.yBot*vr), h2=Math.max(1,yB2-yT2);
        var w=Math.round(pb.prof*profW);
        if(w<1) continue;
        if(pb.fc==null){
          ctx.fillStyle=rgba(ramp(0.3+0.7*pb.prof),PROF_ALPHA);
          ctx.fillRect(W-w,yT2,w,h2);
        }else{
          var wc=Math.round(w*pb.fc);
          ctx.fillStyle='rgba('+CALL_RGB+','+(PROF_ALPHA*0.92)+')';
          ctx.fillRect(W-wc,yT2,wc,h2);
          ctx.fillStyle='rgba('+PUT_RGB+','+(PROF_ALPHA*0.92)+')';
          ctx.fillRect(W-w,yT2,w-wc,h2);
        }
      }
      // 4. PDSL levels + top-wall labels
      for(var q=0;q<v._pdsl.length;q++){
        var pd=v._pdsl[q], y3=Math.round(pd.y*vr);
        if(y3<0||y3>H) continue;
        ctx.fillStyle=(pd.side==='support')?'rgba(26,161,121,0.9)':'rgba(214,90,30,0.9)';
        ctx.fillRect(W-profW,Math.max(0,y3-1),Math.max(2,Math.round(profW*pd.w)),2);
      }
      ctx.font=(Math.round(10*hr))+'px ui-monospace,Menlo,Consolas,monospace';
      ctx.textAlign='right'; ctx.textBaseline='middle';
      for(var L=0;L<v._labels.length;L++){
        var lb=v._labels[L], ly=Math.round(lb.y*vr);
        if(ly<8||ly>H-8) continue;
        ctx.fillStyle='rgba(5,5,6,0.75)';
        var tw=ctx.measureText(lb.txt).width;
        ctx.fillRect(W-profW-tw-14*hr,ly-7*vr,tw+8*hr,14*vr);
        ctx.fillStyle=rgba(ramp(0.9+0.1*lb.norm),1);
        ctx.fillText(lb.txt,W-profW-10*hr,ly);
      }
      ctx.restore();
    });
  };

  function HeatPaneView(source){ this._source=source; this._segs=[]; this._prof=[]; this._pdsl=[]; this._labels=[]; this._bubbles=[]; }
  HeatPaneView.prototype.zOrder=function(){ return 'bottom'; };
  HeatPaneView.prototype.renderer=function(){ return on?new HeatRenderer(this):null; };
  HeatPaneView.prototype.update=function(){
    var src=this._source, series=src._series, chart=src._chart;
    this._segs=[]; this._prof=[]; this._pdsl=[]; this._labels=[]; this._bubbles=[];
    if(!series||!chart) return;
    var paneW=0,paneH=0; try{ var ps=chart.paneSize(); paneW=ps.width; paneH=ps.height; }catch(_){}
    if(!paneW||!paneH) return;
    var getM=(METRICS[metric]||METRICS.oi);
    var ts=chart.timeScale();
    var vis=null; try{ vis=ts.getVisibleRange(); }catch(_){}

    // --- segment x-extents (clamped to the pane) ---
    // timeToCoordinate() only resolves exact bar timestamps, and session boundaries
    // (18:00 ET) never are one — so interpolate a logical index between the
    // surrounding bars and use logicalToCoordinate instead.
    var allBars=window.__chartBars||[];
    function timeToX(t){
      if(vis){
        if(t<=vis.from) return 0;
        if(t>=vis.to) return paneW;
      }
      var c=ts.timeToCoordinate(t);
      if(c!=null) return c;
      if(allBars.length>1){
        if(t<=allBars[0].time) return 0;
        if(t>=allBars[allBars.length-1].time) return paneW;
        var lo=0,hi=allBars.length-1;
        while(hi-lo>1){ var mid=(lo+hi)>>1; if(allBars[mid].time<=t) lo=mid; else hi=mid; }
        var frac=(t-allBars[lo].time)/((allBars[hi].time-allBars[lo].time)||1);
        var xc=ts.logicalToCoordinate(lo+frac);
        return xc==null?null:xc;
      }
      return null;
    }
    var bounds=buildSegments();
    if(!bounds.length&&LATEST) bounds=[{t:0,grid:LATEST}];
    var xs=[];
    for(var i=0;i<bounds.length;i++) xs.push(timeToX(bounds[i].t));
    // --- global normalization across visible rows of every segment (stable color over time) ---
    var vmax=0, sortedCache=[];
    for(var s=0;s<bounds.length;s++){
      var rows=(bounds[s].grid.rows||[]).filter(function(r){ return r&&isFinite(r.k); }).sort(function(a,b){ return a.k-b.k; });
      sortedCache.push(rows);
      for(var r2=0;r2<rows.length;r2++){
        var y0=series.priceToCoordinate(rows[r2].k);
        if(y0==null||y0<-paneH*0.25||y0>paneH*1.25) continue;
        var vv=getM.get(rows[r2]); if(vv>vmax) vmax=vv;
      }
    }
    if(!(vmax>0)){
      for(var s2=0;s2<sortedCache.length;s2++) for(var r3=0;r3<sortedCache[s2].length;r3++){ var v3=getM.get(sortedCache[s2][r3]); if(v3>vmax) vmax=v3; }
      if(!(vmax>0)) return;
    }
    var lmax=Math.log1p(vmax);

    function bandsFor(rows){
      var out=[], n=rows.length;
      for(var i4=0;i4<n;i4++){
        var kPrev=(i4>0)?rows[i4-1].k:(rows[i4].k-(rows[i4+1]?rows[i4+1].k-rows[i4].k:1));
        var kNext=(i4<n-1)?rows[i4+1].k:(rows[i4].k+(rows[i4].k-kPrev));
        var yTop=series.priceToCoordinate((rows[i4].k+kNext)/2);
        var yBot=series.priceToCoordinate((rows[i4].k+kPrev)/2);
        if(yTop==null||yBot==null) continue;
        var val=getM.get(rows[i4]);
        if(!(val>0)) continue;
        var norm=Math.pow(Math.log1p(val)/lmax,GAMMA);
        var prof=val/vmax;
        if(norm<=0.02&&prof<=0.02) continue;
        var fc=null;
        if(getM.split){ var sp=getM.split(rows[i4]); var tot=sp[0]+sp[1]; if(tot>0) fc=sp[0]/tot; }
        out.push({yTop:Math.min(yTop,yBot),yBot:Math.max(yTop,yBot),norm:norm,prof:prof,fc:fc,k:rows[i4].k});
      }
      return out;
    }

    // --- heat segments ---
    for(var s3=0;s3<bounds.length;s3++){
      var x0=xs[s3], x1=(s3<bounds.length-1)?xs[s3+1]:paneW;
      if(s3===0) x0=0;
      if(x0==null||x1==null||x1<=x0) continue;
      this._segs.push({x0:x0,x1:x1,bands:bandsFor(sortedCache[s3])});
    }
    // --- profile / PDSL / labels from the latest grid ---
    var latestRows=sortedCache.length?sortedCache[sortedCache.length-1]:[];
    var profBands=bandsFor(latestRows);
    this._prof=profBands;
    var meta=(bounds.length?bounds[bounds.length-1].grid.meta:LATEST&&LATEST.meta)||{};
    var pd=meta.pdsl||[];
    for(var j=0;j<pd.length;j++){
      var y=series.priceToCoordinate(pd[j].k);
      if(y==null) continue;
      this._pdsl.push({y:y,w:Math.max(0.15,Math.min(1,pd[j].w||0.5)),side:pd[j].side});
    }
    // top walls, deduped: adjacent strikes of the same wall collapse to its peak
    var ranked=profBands.slice().sort(function(a,b){ return b.prof-a.prof; });
    for(var t2=0;t2<ranked.length&&this._labels.length<3;t2++){
      var yl=(ranked[t2].yTop+ranked[t2].yBot)/2, clash=false;
      for(var t3=0;t3<this._labels.length;t3++){ if(Math.abs(this._labels[t3].y-yl)<18){ clash=true; break; } }
      if(!clash) this._labels.push({y:yl,txt:String(ranked[t2].k),norm:ranked[t2].prof});
    }
    // --- volume bubbles ---
    var bars=window.__chartBars||[];
    if(bars.length&&vis){
      var volMax=0, inView=[];
      for(var b2=0;b2<bars.length;b2++){
        var bar=bars[b2];
        if(bar.time<vis.from||bar.time>vis.to||bar.volume==null||!(bar.volume>0)) continue;
        inView.push(bar); if(bar.volume>volMax) volMax=bar.volume;
      }
      if(volMax>0){
        for(var b3=0;b3<inView.length;b3++){
          var bb=inView[b3];
          var bx=ts.timeToCoordinate(bb.time), by=series.priceToCoordinate(bb.close);
          if(bx==null||by==null) continue;
          var r=Math.sqrt(bb.volume/volMax)*BUBBLE_MAX_R;
          if(r<1.4) continue;
          this._bubbles.push({x:bx,y:by,r:r,up:bb.close>=bb.open});
        }
      }
    }
  };

  function HeatPrimitive(chart,series){ this._chart=chart; this._series=series; this._paneViews=[new HeatPaneView(this)]; }
  HeatPrimitive.prototype.updateAllViews=function(){ this._paneViews.forEach(function(v){ v.update(); }); };
  HeatPrimitive.prototype.paneViews=function(){ return this._paneViews; };
  HeatPrimitive.prototype.setData=function(){};

  function ensurePrim(){
    var api=getApi();
    if(!api||!api.chart||!api.series) return false;
    if(prim&&attachedSeries===api.series) return true;
    prim=new HeatPrimitive(api.chart,api.series);
    try{ api.series.attachPrimitive(prim); attachedSeries=api.series; wireCrosshair(api); ensureLegend(api); return true; }
    catch(_){ prim=null; attachedSeries=null; return false; }
  }

  // ---- crosshair readout ----
  function wireCrosshair(api){
    if(crosshairWired||!api.chart||!api.container) return;
    crosshairWired=true;
    if(!api.container.style.position) api.container.style.position='relative';
    tipEl=document.createElement('div');
    tipEl.id='chartHeatTip';
    tipEl.style.cssText='position:absolute;z-index:8;display:none;pointer-events:none;max-width:230px;'
      +'background:rgba(16,16,18,0.88);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);'
      +'border:0.5px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 10px;'
      +'font:10.5px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#f5f5f7;white-space:nowrap;box-shadow:0 8px 28px rgba(0,0,0,0.5);';
    api.container.appendChild(tipEl);
    api.chart.subscribeCrosshairMove(function(param){
      if(!on||!tipEl||!param||!param.point){ if(tipEl) tipEl.style.display='none'; return; }
      var series=api.series;
      var price=series.coordinateToPrice(param.point.y);
      if(price==null){ tipEl.style.display='none'; return; }
      var t=(typeof param.time==='number')?param.time:Math.floor(Date.now()/1000);
      var grid=gridAt(t)||LATEST;
      if(!grid||!grid.rows||!grid.rows.length){ tipEl.style.display='none'; return; }
      // nearest strike
      var best=null,bd=Infinity;
      for(var i=0;i<grid.rows.length;i++){
        var d=Math.abs(grid.rows[i].k-price);
        if(d<bd){ bd=d; best=grid.rows[i]; }
      }
      if(!best){ tipEl.style.display='none'; return; }
      var m=(METRICS[metric]||METRICS.oi);
      var html='<b style="font-size:12px">'+best.k+'</b> <span style="opacity:.55">strike</span>'
        +'<br>'+m.label+' <b>'+fmtV(m.get(best))+'</b>';
      if(m.split){ var sp=m.split(best);
        html+='<br><span style="color:rgb('+CALL_RGB+')">C '+fmtV(sp[0])+'</span> · <span style="color:rgb('+PUT_RGB+')">P '+fmtV(sp[1])+'</span>'; }
      var meta=grid.meta||{}, pd=(meta.pdsl||[]).find(function(p){ return p.k===best.k; });
      if(pd) html+='<br><span style="color:'+(pd.side==='support'?'rgb(26,161,121)':'rgb(214,90,30)')+'">PDSL '+pd.side+' · w '+(pd.w!=null?pd.w.toFixed(2):'—')+'</span>';
      if(meta.anchor!=null) html+='<br><span style="opacity:.55">Δ anchor '+fmtV(best.k-meta.anchor)+'</span>';
      tipEl.innerHTML=html;
      tipEl.style.display='block';
      var cw=api.container.clientWidth, tw=tipEl.offsetWidth;
      var x=param.point.x+16; if(x+tw>cw-8) x=param.point.x-tw-16;
      tipEl.style.left=Math.max(4,x)+'px';
      tipEl.style.top=Math.max(4,param.point.y-14)+'px';
    });
  }

  // ---- legend chip (bottom-left of the chart) ----
  function ensureLegend(api){
    if(legendEl||!api.container) return;
    legendEl=document.createElement('div');
    legendEl.id='chartHeatLegend';
    legendEl.style.cssText='position:absolute;left:12px;bottom:34px;z-index:7;display:none;align-items:center;gap:8px;'
      +'background:rgba(16,16,18,0.8);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);'
      +'border:0.5px solid rgba(255,255,255,0.08);border-radius:9px;padding:5px 9px;pointer-events:none;'
      +'font:9.5px ui-monospace,Menlo,Consolas,monospace;color:rgba(235,235,245,0.62);letter-spacing:.04em;';
    api.container.appendChild(legendEl);
    updateLegend();
  }
  function updateLegend(){
    if(!legendEl) return;
    var m=(METRICS[metric]||METRICS.oi);
    var n=Object.keys(DAYGRIDS).length, iv=INTRADAY.length;
    legendEl.innerHTML='<span style="display:inline-block;width:64px;height:7px;border-radius:3px;background:'+cssRamp()+'"></span>'
      +'<span>'+m.label.toUpperCase()+'</span>'
      +(m.split?'<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:rgb('+CALL_RGB+');vertical-align:-1px"></i> C · <i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:rgb('+PUT_RGB+');vertical-align:-1px"></i> P</span>':'')
      +'<span style="opacity:.6">'+n+'d'+(iv?(' · '+iv+' slices'):'')+'</span>';
    legendEl.style.display=on?'flex':'none';
  }

  // ---- intraday recapture loop (main terminal only) ----
  function setCapture(active){
    if(captureTimer){ clearInterval(captureTimer); captureTimer=null; }
    if(active&&!window.__getHeatSnapshots&&!window.__getHeatSnapshot){
      captureTimer=setInterval(function(){ if(on&&!document.hidden) requestData(); },CAPTURE_MS);
    }
  }

  function setOn(v){
    on=!!v;
    if(on){
      var inst=curInst();
      if(inst&&inst!==curInstKey){ curInstKey=inst; DAYGRIDS=loadDays(inst); INTRADAY=[]; LATEST=null; lastHash=''; }
      if(!ensurePrim()){
        var tries=0, iv=setInterval(function(){ tries++; if(ensurePrim()||tries>20){ clearInterval(iv); nudge(); } },250);
      }
      requestData();
    }
    setCapture(on);
    if(tipEl&&!on) tipEl.style.display='none';
    updateLegend();
    nudge();
  }

  window.__chartHeat={ refresh:function(){ if(on) requestData(); }, isOn:function(){ return on; } };

  document.addEventListener('DOMContentLoaded',function(){
    // segmented view toggle inside the Chart tab: Price (plain candles) | Bookmap (heat blend)
    var viewBtns=[].slice.call(document.querySelectorAll('.chart-view')), sel=document.getElementById('chartHeatMetric');
    if(!viewBtns.length) return;
    function applyView(name){
      viewBtns.forEach(function(b){ b.classList.toggle('on',b.dataset.chartview===name); });
      if(sel) sel.style.display=(name==='bookmap')?'':'none';
      setOn(name==='bookmap');
    }
    viewBtns.forEach(function(b){ b.addEventListener('click',function(){ applyView(b.dataset.chartview); }); });
    if(sel){
      sel.innerHTML=Object.keys(METRICS).map(function(k){ return '<option value="'+k+'">'+METRICS[k].label+'</option>'; }).join('');
      sel.value=metric;
      sel.style.display='none';
      sel.addEventListener('change',function(){ metric=sel.value; updateLegend(); nudge(); });
    }
    // instrument change: swap grid history; date change: refetch the engine's new grid
    window.addEventListener('quan:instr',function(){
      var inst=curInst();
      if(inst===curInstKey) return;
      curInstKey=inst; DAYGRIDS=loadDays(inst); INTRADAY=[]; LATEST=null; lastHash='';
      var newest=Object.keys(DAYGRIDS).sort().pop(); if(newest) LATEST=DAYGRIDS[newest];
      if(on) setTimeout(function(){ requestData(); },600); else nudge();
    });
    window.addEventListener('quan:date',function(){ if(on) setTimeout(function(){ requestData(); },600); });
    window.addEventListener('quan:bars',function(){ if(on) nudge(); });
  });
})();
