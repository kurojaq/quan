(function(){
  // ---- Bookmap-and-beyond heat blend for the Chart tab ----
  // A lightweight-charts series primitive (zOrder 'bottom' — everything paints UNDER
  // the candles, inside the chart's own coordinate/redraw lifecycle). Layers:
  //   1. time-segmented heat field  — each session date's grid spans that day's bars;
  //      today's grid is re-captured while the view is open, so the field EVOLVES
  //      intraday. The SELECTED day renders in color; other days in grayscale.
  //   2. 3D volume bubbles          — per-bar traded volume as shaded spheres
  //   3. right-anchored profile     — the selected day's grid, two-tone call/put
  //      split where the metric has sides
  //   4. PDSL dealer levels         — support/resistance ticks + top-wall labels
  // Controls (Chart tab header): Price | Line | Bookmap view toggle, metric select
  // (every heatmap column, discovered from the grid's meta), granularity dial
  // (strike aggregation ×1/2/4/8), candles show/hide, grayscale (Mono) toggle.
  //
  // Data sources, in order of preference:
  //   window.__getHeatSnapshots()  — client terminal: ALL published dates at once
  //   window.__getHeatSnapshot()   — client terminal fallback: current date only
  //   #heatFrame quanGetHeatmap    — main terminal: the live heat-engine iframe

  var on=false, viewMode='price', metric='oi', prim=null, attachedSeries=null, pendingReq=false;
  // render strategy for the heat field (Price-tab Obj 3-5 / Bookmap item 6): 'cells' = classic
  // discrete bands; the rest delegate to the ScalarField framework. Rendering-only — the
  // underlying day grids / bands are computed identically for every mode.
  var renderMode='cells', heatPalette='thermal', modeSelEl=null, palSelEl=null;
  var DAYGRIDS={};        // 'YYYY-MM-DD' -> {rows,meta}
  var INTRADAY=[];        // [{t,grid}] — today's recaptures, session-lifetime only
  var LATEST=null;
  var lastHash='';
  var captureTimer=null, tipEl=null, legendEl=null, crosshairWired=false, lineSeries=null;
  var curInstKey='';
  var GRANS=[1,2,4,8], granIdx=0, mono=false, candlesOn=true;

  var PROFILE_FRAC=0.13, BAND_ALPHA=0.55, PROF_ALPHA=0.9, BUBBLE_MAX_R=13, GAMMA=1.75;
  var CAPTURE_MS=180000, MAX_DAYS_STORED=10, MAX_INTRADAY=240;
  var CALL_RGB='67,176,168', PUT_RGB='207,154,58', UP_RGB='38,166,154', DN_RGB='239,83,80';
  var CANDLE_UP='#26a69a', CANDLE_DN='#ef5350';

  // ---- metrics: composites with C/P splits + every column the heat engine reports ----
  function absGet(key){ return function(r){ var v=+r[key]; return isFinite(v)?Math.abs(v):0; }; }
  var METRICS={
    oi:      {label:'OI (C+P)',       get:function(r){ return (r.coi||0)+(r.poi||0); },   split:function(r){ return [r.coi||0,r.poi||0]; }},
    vol:     {label:'Volume (C+P)',   get:function(r){ return (r.cvol||0)+(r.pvol||0); }, split:function(r){ return [r.cvol||0,r.pvol||0]; }},
    netprem: {label:'Net Premium',    get:absGet('netprem'),                              split:function(r){ return [Math.abs(r.cprem||0),Math.abs(r.pprem||0)]; }},
    gex:     {label:'GEX',            get:absGet('gex'),     split:null},
    invdist: {label:'Inv Dist',       get:absGet('invdist'), split:null},
    mass:    {label:'Mass',           get:absGet('mass'),    split:null}
  };
  function rebuildMetricSelect(){
    var sel=document.getElementById('chartHeatMetric'); if(!sel) return;
    sel.innerHTML=Object.keys(METRICS).map(function(k){ return '<option value="'+k+'">'+METRICS[k].label+'</option>'; }).join('');
    if(METRICS[metric]) sel.value=metric; else { metric='oi'; sel.value='oi'; }
  }
  // pull the full column list from the grid's meta so the Bookmap can color by ANY heatmap column
  function absorbMeta(meta){
    if(!meta||!meta.metrics||!meta.metrics.length) return;
    var changed=false;
    meta.metrics.forEach(function(m){
      var k=m&&m[0], lbl=(m&&m[1])||k;
      if(!k||METRICS[k]) return;
      METRICS[k]={label:String(lbl),get:absGet(k),split:null};
      changed=true;
    });
    if(changed) rebuildMetricSelect();
  }

  // ---- colormaps: Bookmap-ish color ramp + grayscale twin (mono mode / out-of-day segments) ----
  var STOPS=[
    [0.00,   6, 12, 24,   0],
    [0.20,  10, 36, 70,  90],
    [0.45,  14, 90,160, 150],
    [0.68,  30,150,210, 185],
    [0.84,  90,210,235, 210],
    [0.93, 255,205, 70, 240],
    [1.00, 255,120, 30, 255]
  ];
  var GRAY_STOPS=[
    [0.00,  16, 17, 20,   0],
    [0.30,  52, 54, 60, 100],
    [0.60, 110,113,122, 160],
    [0.84, 178,180,188, 210],
    [1.00, 245,245,247, 255]
  ];
  function rampFrom(stops,t){
    if(!(t>0)) t=0; if(t>1) t=1;
    var i=1; while(i<stops.length-1 && stops[i][0]<t) i++;
    var a=stops[i-1], b=stops[i], f=(t-a[0])/((b[0]-a[0])||1);
    return [a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f, a[3]+(b[3]-a[3])*f, (a[4]+(b[4]-a[4])*f)/255];
  }
  function ramp(t){ return rampFrom(STOPS,t); }
  function grayRamp(t){ return rampFrom(GRAY_STOPS,t); }
  function rgba(c,mul){ return 'rgba('+Math.round(c[0])+','+Math.round(c[1])+','+Math.round(c[2])+','+(c[3]*mul).toFixed(3)+')'; }
  function cssRamp(stops){ return 'linear-gradient(90deg,'+stops.map(function(s){ return 'rgba('+s[1]+','+s[2]+','+s[3]+',1) '+(s[0]*100)+'%'; }).join(',')+')'; }
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

  // ---- persistence: per-instrument day grids (all numeric fields survive, so every metric works after reload) ----
  function compactGrid(g){
    if(!g||!g.rows) return null;
    return { meta:{anchor:g.meta&&g.meta.anchor,atm:g.meta&&g.meta.atm,pdsl:(g.meta&&g.meta.pdsl)||[],metrics:(g.meta&&g.meta.metrics)||[]},
      rows:g.rows.map(function(r){ var o={}; for(var f in r){ var v=r[f]; if(v!=null&&isFinite(+v)&&typeof v!=='boolean') o[f]=+v; } return o; }) };
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
  function savePrefs(){ try{ localStorage.setItem('quanChartHeat:prefs',JSON.stringify({metric:metric,granIdx:granIdx,mono:mono,candlesOn:candlesOn,renderMode:renderMode,heatPalette:heatPalette})); }catch(_){} }
  function loadPrefs(){
    try{
      var p=JSON.parse(localStorage.getItem('quanChartHeat:prefs')||'{}');
      if(p.metric) metric=p.metric;
      if(p.granIdx!=null) granIdx=Math.max(0,Math.min(GRANS.length-1,+p.granIdx||0));
      mono=!!p.mono;
      candlesOn=(p.candlesOn!==false);
      if(p.renderMode) renderMode=p.renderMode;
      if(p.heatPalette) heatPalette=p.heatPalette;
    }catch(_){}
  }

  function curInst(){ return (document.getElementById('instA')||{}).value||''; }
  function curDate(){ return (document.getElementById('dayDate')||{}).value||''; }
  function selDate(){ return curDate()||Object.keys(DAYGRIDS).sort().pop()||todaySessionDate(); }
  function getApi(){ try{ return window.__chartApi?window.__chartApi():null; }catch(_){ return null; } }
  // rAF-coalesced repaint request: event storms (bars + date + cell all firing together)
  // collapse into a single series invalidation per frame instead of one each
  var _nudgeRaf=0;
  function nudge(){
    if(_nudgeRaf) return;
    _nudgeRaf=requestAnimationFrame(function(){ _nudgeRaf=0;
      var api=getApi(); if(api&&api.series){ try{ api.series.applyOptions({}); }catch(_){} } });
  }
  var _aggMemo={key:'',sorted:null,agg:null};   // per-frame aggregation memo (see HeatPaneView.update)

  // ---- segment model: sorted boundaries [{t,grid,date}] ----
  function buildSegments(){
    var segs=[];
    Object.keys(DAYGRIDS).sort().forEach(function(d){
      if(DAYGRIDS[d]&&DAYGRIDS[d].rows&&DAYGRIDS[d].rows.length) segs.push({t:sessionStart(d),grid:DAYGRIDS[d],date:d});
    });
    var today=todaySessionDate();
    INTRADAY.forEach(function(e){ segs.push({t:e.t,grid:e.grid,date:today}); });
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
    absorbMeta(grid.meta);
    if(h&&h!==lastHash){
      if(lastHash&&d===todaySessionDate()){
        INTRADAY.push({t:Math.floor(Date.now()/1000),grid:grid});
        if(INTRADAY.length>MAX_INTRADAY) INTRADAY.shift();
      }
      lastHash=h;
    }
    saveDays(curInst());
    nudge(); updateLegend();
    return true;
  }
  function requestData(cb){
    if(window.__getHeatSnapshots||window.__getHeatSnapshot){
      var got=false;
      try{
        if(window.__getHeatSnapshots){
          (window.__getHeatSnapshots()||[]).forEach(function(s){
            if(s&&s.heatmap&&s.heatmap.rows&&s.heatmap.rows.length){ DAYGRIDS[s.date]=s.heatmap; absorbMeta(s.heatmap.meta); got=true; }
          });
          var newest=Object.keys(DAYGRIDS).sort().pop(); if(newest) LATEST=DAYGRIDS[newest];
        }else{
          var one=window.__getHeatSnapshot(); got=ingest(one);
        }
      }catch(_){}
      nudge(); updateLegend();
      if(cb) cb(got);
      return;
    }
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

  // ---- continuous field rendering (scalar / spectral / contour / gradient / density) ----
  // One 1-column ScalarField PER DAY-SEGMENT, so interpolation can never cross a session
  // boundary (strict session isolation). The column is rasterized on an offscreen canvas by
  // the shared ScalarField framework, then stretched across the segment's width with
  // drawImage — proper alpha compositing over the pane (putImageData would stomp it), and
  // the canvas' own smoothing supplies the vertical continuity. Rendering-only: bands are
  // the same objects the classic cell path draws.
  var _fieldOff=null;
  function drawSegField(ctx,seg,hr,vr,H){
    var SF=window.ScalarField; if(!SF) return false;
    var x0=Math.round(seg.x0*hr), x1=Math.round(seg.x1*hr);
    if(x1<=x0||!seg.bands.length) return true;
    var cssH=H/vr, R=Math.max(8,Math.min(420,Math.round(cssH/2)));   // ~2 css px per sample row
    var f=SF.makeField(R,1,0);
    for(var i=0;i<seg.bands.length;i++){
      var b=seg.bands[i];
      var r0=Math.max(0,Math.floor(b.yTop/cssH*R)), r1=Math.min(R,Math.max(r0+1,Math.ceil(b.yBot/cssH*R)));
      for(var r2=r0;r2<r1;r2++){ if(b.norm>f.at(r2,0)) f.set(r2,0,b.norm); }
    }
    if(!_fieldOff) _fieldOff=document.createElement('canvas');
    if(_fieldOff.width!==1||_fieldOff.height!==R){ _fieldOff.width=1; _fieldOff.height=R; }
    var octx=_fieldOff.getContext('2d');
    octx.clearRect(0,0,1,R);
    try{ SF.render(octx,f,{ mode:renderMode, colormap:seg.gray?'mono':heatPalette, rect:{x:0,y:0,w:1,h:R}, sigma:3 }); }
    catch(_){ return false; }
    ctx.save();
    ctx.globalAlpha=BAND_ALPHA;
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(_fieldOff,0,0,1,R, x0,0,x1-x0,H);
    ctx.restore();
    return true;
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
      // 1. time-segmented heat field (selected day in color, the rest grayscale)
      var useField=(renderMode!=='cells')&&!!window.ScalarField;
      for(var s=0;s<v._segs.length;s++){
        var seg=v._segs[s];
        if(useField&&drawSegField(ctx,seg,hr,vr,H)) continue;   // continuous strategy; falls through to cells on failure
        var x0=Math.round(seg.x0*hr), x1=Math.round(seg.x1*hr);
        if(x1<=x0) continue;
        var rf=seg.gray?grayRamp:ramp;
        for(var i=0;i<seg.bands.length;i++){
          var b=seg.bands[i];
          var yT=Math.round(b.yTop*vr), yB=Math.round(b.yBot*vr);
          if(yB<0||yT>H) continue;
          ctx.fillStyle=rgba(rf(b.norm),BAND_ALPHA);
          ctx.fillRect(x0,yT,x1-x0,Math.max(1,yB-yT));
        }
      }
      // 2. 3D volume bubbles — shaded spheres with a specular highlight
      for(var j=0;j<v._bubbles.length;j++){
        var bu=v._bubbles[j];
        var bx=bu.x*hr, by=bu.y*vr, r=bu.r*hr;
        if(bx<-r||bx>W+r||by<-r||by>H+r) continue;
        var base=bu.up?UP_RGB:DN_RGB, rim=bu.up?'8,72,63':'96,22,20';
        var g=ctx.createRadialGradient(bx-r*0.38,by-r*0.42,Math.max(0.5,r*0.12),bx,by,r);
        g.addColorStop(0,'rgba(255,255,255,0.9)');
        g.addColorStop(0.28,'rgba('+base+',0.95)');
        g.addColorStop(1,'rgba('+rim+',0.92)');
        ctx.beginPath(); ctx.arc(bx,by,r,0,6.2832);
        ctx.fillStyle=g; ctx.fill();
        ctx.lineWidth=Math.max(1,hr*0.6);
        ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.stroke();
      }
      // 3. right-anchored profile (selected day's grid)
      for(var p=0;p<v._prof.length;p++){
        var pb=v._prof[p];
        var yT2=Math.round(pb.yTop*vr), yB2=Math.round(pb.yBot*vr), h2=Math.max(1,yB2-yT2);
        var w=Math.round(pb.prof*profW);
        if(w<1) continue;
        if(mono){
          ctx.fillStyle=rgba(grayRamp(0.3+0.7*pb.prof),PROF_ALPHA);
          ctx.fillRect(W-w,yT2,w,h2);
        }else if(pb.fc==null){
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
        ctx.fillStyle=mono?'rgba(245,245,247,1)':rgba(ramp(0.9+0.1*lb.norm),1);
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
    var gran=GRANS[granIdx]||1;
    var ts=chart.timeScale();
    var vis=null; try{ vis=ts.getVisibleRange(); }catch(_){}

    // arbitrary time -> x: interpolate between the surrounding bars' own coordinates
    // (timeToCoordinate only resolves exact bar timestamps; logicalToCoordinate is unreliable)
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
        var xa=ts.timeToCoordinate(allBars[lo].time), xb=ts.timeToCoordinate(allBars[hi].time);
        if(xa!=null&&xb!=null){
          var frac=(t-allBars[lo].time)/((allBars[hi].time-allBars[lo].time)||1);
          return xa+(xb-xa)*frac;
        }
        if(xa!=null) return xa;
        if(xb!=null) return xb;
      }
      return null;
    }

    var bounds=buildSegments();
    if(!bounds.length&&LATEST) bounds=[{t:0,grid:LATEST,date:selDate()}];
    var xs=[];
    for(var i=0;i<bounds.length;i++) xs.push(timeToX(bounds[i].t));

    // ---- granularity: aggregate sorted strikes into buckets of `gran` adjacent levels ----
    function aggregate(rows){
      var n=rows.length;
      if(!n) return [];
      // strike band edges = midpoints between adjacent strikes
      var edges=new Array(n+1);
      for(var e=1;e<n;e++) edges[e]=(rows[e-1].k+rows[e].k)/2;
      edges[0]=rows[0].k-((rows[1]?rows[1].k-rows[0].k:1)/2);
      edges[n]=rows[n-1].k+((rows[n-1].k-(rows[n-2]?rows[n-2].k:rows[n-1].k-1))/2);
      var out=[];
      for(var i0=0;i0<n;i0+=gran){
        var i1=Math.min(n,i0+gran);
        var val=0,c=0,p=0,hasSplit=!!getM.split,kSum=0;
        for(var r2=i0;r2<i1;r2++){
          val+=getM.get(rows[r2]); kSum+=rows[r2].k;
          if(hasSplit){ var sp=getM.split(rows[r2]); c+=sp[0]; p+=sp[1]; }
        }
        out.push({kLo:edges[i0],kHi:edges[i1],k:Math.round(kSum/(i1-i0)),val:val,fc:(hasSplit&&(c+p)>0)?(c/(c+p)):null});
      }
      return out;
    }

    // update() runs on every chart repaint (pan/zoom/crosshair). Sorting + aggregating
    // every day's grid each frame is pure churn — the inputs only change on data ingest
    // (lastHash), granularity, or metric. Pixel mapping below stays per-frame.
    var memoKey=curInstKey+'|'+lastHash+'|'+granIdx+'|'+metric+'|'+bounds.length;
    var sortedCache, aggCache;
    if(_aggMemo.key===memoKey&&_aggMemo.sorted){ sortedCache=_aggMemo.sorted; aggCache=_aggMemo.agg; }
    else{
      sortedCache=[]; aggCache=[];
      for(var s=0;s<bounds.length;s++){
        var rows=(bounds[s].grid.rows||[]).filter(function(r){ return r&&isFinite(r.k); }).sort(function(a,b){ return a.k-b.k; });
        sortedCache.push(rows);
        aggCache.push(aggregate(rows));
      }
      _aggMemo={key:memoKey,sorted:sortedCache,agg:aggCache};
    }
    // global normalization across visible aggregated buckets of every segment
    var vmax=0;
    for(var s1=0;s1<aggCache.length;s1++){
      for(var a1=0;a1<aggCache[s1].length;a1++){
        var y0=series.priceToCoordinate(aggCache[s1][a1].k);
        if(y0==null||y0<-paneH*0.25||y0>paneH*1.25) continue;
        if(aggCache[s1][a1].val>vmax) vmax=aggCache[s1][a1].val;
      }
    }
    if(!(vmax>0)){
      for(var s2=0;s2<aggCache.length;s2++) for(var a2=0;a2<aggCache[s2].length;a2++){ if(aggCache[s2][a2].val>vmax) vmax=aggCache[s2][a2].val; }
      if(!(vmax>0)) return;
    }
    var lmax=Math.log1p(vmax);

    function bandsFor(arows){
      var out=[];
      for(var i4=0;i4<arows.length;i4++){
        var a=arows[i4];
        if(!(a.val>0)) continue;
        var yTop=series.priceToCoordinate(a.kHi), yBot=series.priceToCoordinate(a.kLo);
        if(yTop==null||yBot==null) continue;
        var norm=Math.pow(Math.log1p(a.val)/lmax,GAMMA);
        var prof=a.val/vmax;
        if(norm<=0.02&&prof<=0.02) continue;
        out.push({yTop:Math.min(yTop,yBot),yBot:Math.max(yTop,yBot),norm:norm,prof:prof,fc:a.fc,k:a.k});
      }
      return out;
    }

    // ---- heat segments (day isolation: only the selected day keeps color) ----
    var sd=selDate();
    for(var s3=0;s3<bounds.length;s3++){
      var x0=xs[s3], x1=(s3<bounds.length-1)?xs[s3+1]:paneW;
      if(s3===0) x0=0;
      if(x0==null||x1==null||x1<=x0) continue;
      var gray=mono||(bounds[s3].date&&bounds[s3].date!==sd);
      this._segs.push({x0:x0,x1:x1,gray:gray,bands:bandsFor(aggCache[s3])});
    }
    // ---- profile / PDSL / labels from the SELECTED day's grid (falls back to latest) ----
    var profGrid=DAYGRIDS[sd]||((bounds.length&&bounds[bounds.length-1].grid)||LATEST);
    var profRows=(profGrid&&profGrid.rows?profGrid.rows.slice():[]).filter(function(r){ return r&&isFinite(r.k); }).sort(function(a,b){ return a.k-b.k; });
    var profBands=bandsFor(aggregate(profRows));
    this._prof=profBands;
    var meta=(profGrid&&profGrid.meta)||{};
    var pd=meta.pdsl||[];
    for(var j=0;j<pd.length;j++){
      var y=series.priceToCoordinate(pd[j].k);
      if(y==null) continue;
      this._pdsl.push({y:y,w:Math.max(0.15,Math.min(1,pd[j].w||0.5)),side:pd[j].side});
    }
    var ranked=profBands.slice().sort(function(a,b){ return b.prof-a.prof; });
    for(var t2=0;t2<ranked.length&&this._labels.length<3;t2++){
      var yl=(ranked[t2].yTop+ranked[t2].yBot)/2, clash=false;
      for(var t3=0;t3<this._labels.length;t3++){ if(Math.abs(this._labels[t3].y-yl)<18){ clash=true; break; } }
      if(!clash) this._labels.push({y:yl,txt:String(ranked[t2].k),norm:ranked[t2].prof});
    }
    // ---- volume bubbles ----
    var bars=allBars;
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

  function ensurePrim(){
    var api=getApi();
    if(!api||!api.chart||!api.series) return false;
    if(prim&&attachedSeries===api.series) return true;
    prim=new HeatPrimitive(api.chart,api.series);
    try{ api.series.attachPrimitive(prim); attachedSeries=api.series; wireCrosshair(api); ensureLegend(api); return true; }
    catch(_){ prim=null; attachedSeries=null; return false; }
  }

  // ---- candles show/hide: transparent colors, NOT visible:false — a hidden series
  //      would stop rendering the heat primitive attached to it ----
  function applyCandleVisibility(show){
    var api=getApi(); if(!api||!api.series) return;
    var t='rgba(0,0,0,0)';
    try{
      api.series.applyOptions(show
        ?{upColor:CANDLE_UP,downColor:CANDLE_DN,borderUpColor:CANDLE_UP,borderDownColor:CANDLE_DN,wickUpColor:CANDLE_UP,wickDownColor:CANDLE_DN}
        :{upColor:t,downColor:t,borderUpColor:t,borderDownColor:t,wickUpColor:t,wickDownColor:t});
    }catch(_){}
  }

  // ---- line chart view ----
  function ensureLine(){
    var api=getApi(); if(!api||!api.chart) return null;
    if(lineSeries) return lineSeries;
    try{
      lineSeries=api.chart.addSeries(LightweightCharts.LineSeries,{color:'#f5f5f7',lineWidth:2,priceLineVisible:false,lastValueVisible:true,visible:false});
      setLineData();
    }catch(_){ lineSeries=null; }
    return lineSeries;
  }
  function setLineData(){
    if(!lineSeries) return;
    var bars=window.__chartBars||[];
    try{ lineSeries.setData(bars.map(function(b){ return {time:b.time,value:b.close}; })); }catch(_){}
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
    var n=Object.keys(DAYGRIDS).length, iv=INTRADAY.length, gran=GRANS[granIdx]||1;
    legendEl.innerHTML='<span style="display:inline-block;width:64px;height:7px;border-radius:3px;background:'+cssRamp(mono?GRAY_STOPS:STOPS)+'"></span>'
      +'<span>'+m.label.toUpperCase()+'</span>'
      +(m.split&&!mono?'<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:rgb('+CALL_RGB+');vertical-align:-1px"></i> C · <i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:rgb('+PUT_RGB+');vertical-align:-1px"></i> P</span>':'')
      +(gran>1?'<span style="opacity:.7">×'+gran+'</span>':'')
      +(mono?'<span style="opacity:.7">MONO</span>':'')
      +'<span style="opacity:.6">'+n+'d'+(iv?(' · '+iv+' slices'):'')+' · '+selDate()+'</span>';
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
      if(inst&&inst!==curInstKey){ curInstKey=inst; DAYGRIDS=loadDays(inst); INTRADAY=[]; LATEST=null; lastHash=''; Object.keys(DAYGRIDS).forEach(function(d){ absorbMeta(DAYGRIDS[d]&&DAYGRIDS[d].meta); }); }
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
    loadPrefs();
    var viewBtns=[].slice.call(document.querySelectorAll('.chart-view')),
        sel=document.getElementById('chartHeatMetric'),
        granWrap=document.getElementById('chartGranWrap'), granIn=document.getElementById('chartGran'), granV=document.getElementById('chartGranV'),
        candBtn=document.getElementById('chartCandlesBtn'), monoBtn=document.getElementById('chartMonoBtn'),
        tvBtn=document.getElementById('chartTradovateBtn');
    if(!viewBtns.length) return;

    function syncControls(){
      var bm=(viewMode==='bookmap');
      if(sel) sel.style.display=bm?'':'none';
      if(modeSelEl) modeSelEl.style.display=bm?'':'none';
      if(palSelEl) palSelEl.style.display=(bm&&renderMode!=='cells')?'':'none';
      if(granWrap) granWrap.style.display=bm?'inline-flex':'none';
      if(candBtn){ candBtn.style.display=bm?'':'none'; candBtn.classList.toggle('on',candlesOn); }
      if(monoBtn){ monoBtn.style.display=bm?'':'none'; monoBtn.classList.toggle('on',mono); }
      if(tvBtn) tvBtn.style.display=bm?'':'none';
      if(granIn) granIn.value=String(granIdx);
      if(granV) granV.textContent='×'+(GRANS[granIdx]||1);
    }
    function applyView(name){
      viewMode=name;
      viewBtns.forEach(function(b){ b.classList.toggle('on',b.dataset.chartview===name); });
      if(name==='price'){
        applyCandleVisibility(true);
        if(lineSeries){ try{ lineSeries.applyOptions({visible:false}); }catch(_){} }
        setOn(false);
      }else if(name==='line'){
        applyCandleVisibility(false);
        if(ensureLine()){ try{ lineSeries.applyOptions({visible:true}); }catch(_){} }
        setOn(false);
      }else{ // bookmap
        applyCandleVisibility(candlesOn);
        if(lineSeries){ try{ lineSeries.applyOptions({visible:false}); }catch(_){} }
        setOn(true);
      }
      syncControls();
    }
    viewBtns.forEach(function(b){ b.addEventListener('click',function(){ applyView(b.dataset.chartview); }); });

    rebuildMetricSelect();
    if(sel){
      sel.style.display='none';
      sel.addEventListener('change',function(){ metric=sel.value; savePrefs(); updateLegend(); nudge(); });
    }
    // render-strategy + palette selectors (Price-tab Obj 5: switching visualization modes
    // only changes rendering — the day grids and bands are never recomputed)
    if(sel&&sel.parentNode&&!modeSelEl){
      modeSelEl=document.createElement('select');
      modeSelEl.id='chartHeatRender'; modeSelEl.className=sel.className; modeSelEl.title='Render strategy';
      ['cells','scalar','spectral','contour','gradient','density'].forEach(function(m){
        var o=document.createElement('option'); o.value=m; o.textContent=m; modeSelEl.appendChild(o);
      });
      modeSelEl.value=renderMode; if(modeSelEl.value!==renderMode){ renderMode='cells'; modeSelEl.value='cells'; }
      modeSelEl.addEventListener('change',function(){ renderMode=modeSelEl.value; savePrefs(); syncControls(); nudge(); });
      sel.parentNode.insertBefore(modeSelEl,sel.nextSibling);
      palSelEl=document.createElement('select');
      palSelEl.id='chartHeatPalette'; palSelEl.className=sel.className; palSelEl.title='Field palette';
      (window.ScalarField?window.ScalarField.COLORMAP_NAMES:['thermal','spectral','viridis','ice']).forEach(function(nm){
        if(nm==='mono') return;                       // mono is reserved for non-selected sessions
        var o=document.createElement('option'); o.value=nm; o.textContent=nm; palSelEl.appendChild(o);
      });
      palSelEl.value=heatPalette; if(palSelEl.value!==heatPalette){ heatPalette='thermal'; palSelEl.value='thermal'; }
      palSelEl.addEventListener('change',function(){ heatPalette=palSelEl.value; savePrefs(); nudge(); });
      modeSelEl.parentNode.insertBefore(palSelEl,modeSelEl.nextSibling);
    }
    if(granIn) granIn.addEventListener('input',function(){
      granIdx=Math.max(0,Math.min(GRANS.length-1,+granIn.value||0));
      if(granV) granV.textContent='×'+GRANS[granIdx];
      savePrefs(); updateLegend(); nudge();
    });
    if(candBtn) candBtn.addEventListener('click',function(){
      candlesOn=!candlesOn; candBtn.classList.toggle('on',candlesOn);
      if(viewMode==='bookmap') applyCandleVisibility(candlesOn);
      savePrefs();
    });
    if(monoBtn) monoBtn.addEventListener('click',function(){
      mono=!mono; monoBtn.classList.toggle('on',mono);
      savePrefs(); updateLegend(); nudge();
    });
    // Tradovate export — opens the dedicated Tradovate Bookmap sidebar (twin of
    // the Payload engine). The panel (js/tradovate-panel.js) builds the paste-
    // ready custom indicator from these live heat snapshots.
    if(tvBtn) tvBtn.addEventListener('click',function(){
      if(typeof window.__quanOpenTradovatePanel==='function'){ window.__quanOpenTradovatePanel(); }
      else{ var t=document.getElementById('tvTab'); if(t) t.click(); }
    });
    syncControls();

    window.addEventListener('quan:instr',function(){
      var inst=curInst();
      if(inst===curInstKey) return;
      curInstKey=inst; DAYGRIDS=loadDays(inst); INTRADAY=[]; LATEST=null; lastHash='';
      Object.keys(DAYGRIDS).forEach(function(d){ absorbMeta(DAYGRIDS[d]&&DAYGRIDS[d].meta); });
      var newest=Object.keys(DAYGRIDS).sort().pop(); if(newest) LATEST=DAYGRIDS[newest];
      if(on) setTimeout(function(){ requestData(); },600); else nudge();
    });
    window.addEventListener('quan:date',function(){ updateLegend(); if(on) setTimeout(function(){ requestData(); },600); else nudge(); });
    // quan:cell fires when the selected cell's chain/anchor is actually applied — synchronously
    // for an already-loaded date, and again when the async ingest auto-load lands. Without this
    // the Bookmap only redrew on the fixed 600ms quan:date timer, which usually fired BEFORE the
    // data arrived, so a new date rendered stale until another event ("clicking around") forced it.
    // Debounced so the burst of cell events (anchor + chain + greeks) coalesces into one pull, and
    // so warehouse.feedHeatmap posts the new chain to the heat frame before we poll it.
    var _cellReqT=0;
    window.addEventListener('quan:cell',function(){ updateLegend();
      if(!on){ nudge(); return; }
      clearTimeout(_cellReqT);
      _cellReqT=setTimeout(function(){ requestData(function(){ nudge(); }); },180);
    });
    window.addEventListener('quan:bars',function(){ setLineData(); if(on) nudge(); });
  });
})();
