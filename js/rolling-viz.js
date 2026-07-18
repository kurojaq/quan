/* ============================================================================
   Rolling Expiration-Curve Visualization  (Rolling Analysis Engine — Obj 6)
   ----------------------------------------------------------------------------
   Renders forward dealer positioning across the expiration curve as a
   strike x expiration scalar field, using the interchangeable scalar/spectral
   rendering strategies from ScalarField. Consumes window.RollingEngine; changing
   the render mode changes only the rendering, never the aggregation.

   Layout:  strike axis (y)  x  expiration axis (x, ordered by time-to-expiry),
   cell intensity = weighted forward dealer interest; a cumulative forward-
   interest profile runs down the right edge, with a colorbar and hover
   inspection (Obj 9).

   Exposes window.__rollingBoot / window.__rollingResize (wired in tabs.js).
   ============================================================================ */
(function(){
  'use strict';
  var mount, canvas, ctx, tip, bar, built=false;
  var state={ mode:'spectral', colormap:'spectral', weighting:'ttx' };
  var last=null;   // {field, strikes, exps, plot, agg}

  var LABEL='#b7b1a2', LABEL_DIM='#6f6a5e', LINE='rgba(255,255,255,0.08)';

  function el(tag, css, html){ var e=document.createElement(tag); if(css) e.style.cssText=css; if(html!=null) e.innerHTML=html; return e; }
  function activeInst(){ var s=document.getElementById('instA'); return (s&&s.value)|| (window.__qCurInst&&window.__qCurInst()) || 'NQ'; }
  function activeDate(){ var d=document.getElementById('dayDate'); return (d&&d.value)||''; }

  function build(){
    if(built) return; mount=document.getElementById('rollingMount'); if(!mount) return;
    mount.style.cssText='display:flex;flex-direction:column;flex:1 1 auto;min-height:0;width:100%;';

    bar=el('div','display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;font:12px system-ui,sans-serif;color:'+LABEL+';border-bottom:1px solid '+LINE+';');
    function sel(label, opts, val, on){
      var wrap=el('label','display:flex;align-items:center;gap:5px;');
      wrap.appendChild(el('span','color:'+LABEL_DIM+';letter-spacing:.03em;', label));
      var s=el('select','background:#161616;color:'+LABEL+';border:1px solid '+LINE+';border-radius:6px;padding:3px 6px;font:12px system-ui;');
      opts.forEach(function(o){ var op=el('option',null,o); op.value=o; if(o===val)op.selected=true; s.appendChild(op); });
      s.addEventListener('change',function(){ on(s.value); });
      wrap.appendChild(s); return wrap;
    }
    bar.appendChild(el('span','font-weight:600;letter-spacing:.06em;color:'+LABEL+';','ROLLING · Forward Dealer Interest'));
    bar.appendChild(sel('Render', window.ScalarField?window.ScalarField.MODES:['spectral'], state.mode, function(v){ state.mode=v; draw(); }));
    bar.appendChild(sel('Palette', window.ScalarField?window.ScalarField.COLORMAP_NAMES:['spectral'], state.colormap, function(v){ state.colormap=v; draw(); }));
    bar.appendChild(sel('Weight', ['ttx','equal','oi'], state.weighting, function(v){ state.weighting=v; refresh(); }));
    var rb=el('button','margin-left:auto;background:#161616;color:'+LABEL+';border:1px solid '+LINE+';border-radius:6px;padding:3px 10px;cursor:pointer;','↻ Refresh');
    rb.addEventListener('click', refresh); bar.appendChild(rb);
    state._summary=el('span','color:'+LABEL_DIM+';font-size:11px;'); bar.appendChild(state._summary);
    mount.appendChild(bar);

    var wrap=el('div','position:relative;flex:1 1 auto;min-height:0;');
    canvas=el('canvas','position:absolute;inset:0;width:100%;height:100%;display:block;');
    wrap.appendChild(canvas);
    tip=el('div','position:absolute;z-index:5;pointer-events:none;display:none;max-width:230px;padding:7px 9px;border-radius:7px;font:11px "SF Mono",Menlo,monospace;line-height:1.5;background:rgba(18,18,22,0.95);border:.5px solid rgba(255,255,255,0.14);color:#e8e3d6;box-shadow:0 6px 20px rgba(0,0,0,0.5);');
    wrap.appendChild(tip);
    mount.appendChild(wrap);
    ctx=canvas.getContext('2d');
    canvas.addEventListener('mousemove', onHover);
    canvas.addEventListener('mouseleave', function(){ tip.style.display='none'; });
    built=true;
  }

  // ---- build the strike x expiration scalar field from the aggregate ----------
  function buildField(agg){
    if(!agg||agg.empty||!agg.strikes.length||!agg.expirations.length) return null;
    var exps=agg.expirations;                                  // already ordered by ttx
    var strikes=agg.strikes.slice().sort(function(a,b){ return b.strike-a.strike; });  // high strike on top
    var expIndex={}; exps.forEach(function(e,j){ expIndex[e.key]=j; });
    var SF=window.ScalarField, f=SF.makeField(strikes.length, exps.length, 0);
    strikes.forEach(function(s,i){
      (s.byExp||[]).forEach(function(be){
        var j=expIndex[be.exp]; if(j==null) return;
        f.set(i,j,(be.oi||0)*(be.weight||1));                  // weighted forward dealer interest
      });
    });
    return { field:f, strikes:strikes, exps:exps };
  }

  function refresh(){
    build(); if(!built) return;
    var inst=activeInst(), date=activeDate();
    var agg=null;
    try{ agg=window.RollingEngine?window.RollingEngine.aggregate(inst,{asOf:date||undefined, weighting:{mode:state.weighting, tau:21}}):null; }catch(e){ agg=null; }
    if(!agg){ last=null; draw(); return; }
    var built2=buildField(agg);
    last=built2?{ field:built2.field, strikes:built2.strikes, exps:built2.exps, agg:agg, plot:null }:null;
    if(state._summary){
      state._summary.textContent=agg.empty?('no rolling data for '+inst+(date?(' @ '+date):'')):
        (inst+' · '+agg.expirationCount+' expirations · '+agg.strikeCount+' strikes · asOf '+(agg.asOf||'latest'));
    }
    draw();
  }

  function sizeCanvas(){
    if(!canvas) return {w:0,h:0};
    var r=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    var w=Math.max(1,Math.round(r.width)), h=Math.max(1,Math.round(r.height));
    if(canvas.width!==w*dpr||canvas.height!==h*dpr){ canvas.width=w*dpr; canvas.height=h*dpr; }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return {w:w,h:h};
  }

  // Map an underlying price to a y-coordinate on the (index-spaced, descending) strike ladder,
  // interpolating between adjacent strikes so anchor/OHLC land precisely between rows.
  function priceToY(p, strikes, plot){
    var n=strikes.length; if(!n||p==null||!isFinite(p)) return null;
    var rowH=plot.h/n;
    if(p>=strikes[0].strike) return plot.y+0.5*rowH;
    if(p<=strikes[n-1].strike) return plot.y+(n-0.5)*rowH;
    for(var i=1;i<n;i++){ if(strikes[i].strike<=p){
      var hi=strikes[i-1].strike, lo=strikes[i].strike, frac=(hi-lo)>0?(hi-p)/(hi-lo):0;
      var yHi=plot.y+(i-1+0.5)*rowH, yLo=plot.y+(i+0.5)*rowH;
      return yHi+frac*(yLo-yHi);
    }}
    return plot.y+(n-0.5)*rowH;
  }
  // ET calendar date of a bar; matches the chart-tab session date used as an expiration's observation day.
  function barDate(t){ try{ return new Date(t*1000).toLocaleDateString('en-CA',{timeZone:'America/New_York'}); }catch(_){ return null; } }
  // Per-day OHLC of the underlying, folded from window.__chartBars (works for daily or intraday bars).
  function dayOHLC(){
    var bars=window.__chartBars; if(!bars||!bars.length) return null;
    var map={};
    for(var i=0;i<bars.length;i++){ var b=bars[i], d=barDate(b.time); if(!d) continue;
      var m=map[d]; if(!m) map[d]={o:b.open,h:b.high,l:b.low,c:b.close};
      else { if(b.high>m.h)m.h=b.high; if(b.low<m.l)m.l=b.low; m.c=b.close; } }
    return map;
  }

  function draw(){
    if(!built||!ctx) return;
    var dim=sizeCanvas(); ctx.clearRect(0,0,dim.w,dim.h);
    if(!last||!last.field){ ctx.fillStyle=LABEL_DIM; ctx.font='13px system-ui'; ctx.textAlign='center';
      ctx.fillText('No rolling dealer data — upload option chains across expirations to build the term structure.', dim.w/2, dim.h/2); return; }

    var f=last.field, strikes=last.strikes, exps=last.exps;
    var padL=60, padR=104, padT=10, padB=34;
    var plot={ x:padL, y:padT, w:Math.max(10,dim.w-padL-padR), h:Math.max(10,dim.h-padT-padB) };
    last.plot=plot;

    // scalar/spectral field
    try{ window.ScalarField.render(ctx, f, { mode:state.mode, colormap:state.colormap, rect:plot }); }catch(e){}

    // frame
    ctx.strokeStyle=LINE; ctx.lineWidth=1; ctx.strokeRect(plot.x+0.5, plot.y+0.5, plot.w, plot.h);

    // per-expiration OHLC of the underlying (whisker = high-low, ticks = open left / close right),
    // positioned on the strike ladder so dealer interest reads against where price actually traded.
    var ohlc=dayOHLC();
    if(ohlc){
      var colW=plot.w/exps.length, tick=Math.min(colW*0.3,7);
      for(var jo=0;jo<exps.length;jo++){
        var d=exps[jo].sessionDate, b=d&&ohlc[d]; if(!b) continue;
        var cx=plot.x+(jo+0.5)*colW;
        var yH=priceToY(b.h,strikes,plot), yL=priceToY(b.l,strikes,plot), yO=priceToY(b.o,strikes,plot), yC=priceToY(b.c,strikes,plot);
        if(yH==null||yL==null) continue;
        var col=(b.c>=b.o)?'rgba(120,220,170,0.85)':'rgba(240,120,120,0.85)';
        ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(cx,yH); ctx.lineTo(cx,yL); ctx.stroke();
        if(yO!=null){ ctx.beginPath(); ctx.moveTo(cx-tick,yO); ctx.lineTo(cx,yO); ctx.stroke(); }
        if(yC!=null){ ctx.beginPath(); ctx.moveTo(cx,yC); ctx.lineTo(cx+tick,yC); ctx.stroke(); }
        ctx.restore();
      }
    }

    // current anchor (spot) price delineation across the whole field
    var anchor=last.agg&&last.agg.anchor;
    if(anchor!=null&&isFinite(anchor)){
      var ay=priceToY(anchor,strikes,plot);
      if(ay!=null){
        ctx.save(); ctx.strokeStyle='rgba(240,200,90,0.9)'; ctx.lineWidth=1; ctx.setLineDash([5,4]);
        ctx.beginPath(); ctx.moveTo(plot.x,ay); ctx.lineTo(plot.x+plot.w,ay); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle='rgba(240,200,90,0.95)';
        ctx.font='9px "SF Mono",Menlo,monospace'; ctx.textAlign='left'; ctx.textBaseline='bottom';
        ctx.fillText('anchor '+Math.round(anchor), plot.x+3, ay-1);
        ctx.restore();
      }
    }

    // strike (y) labels — thin out to ~12 ticks
    ctx.fillStyle=LABEL; ctx.font='10px "SF Mono",Menlo,monospace'; ctx.textAlign='right'; ctx.textBaseline='middle';
    var rowStep=Math.max(1,Math.round(strikes.length/12));
    for(var i=0;i<strikes.length;i+=rowStep){
      var cy=plot.y+(i+0.5)*plot.h/strikes.length;
      ctx.fillText(String(strikes[i].strike), plot.x-6, cy);
    }
    // expiration (x) labels
    ctx.textAlign='center'; ctx.textBaseline='top';
    var colStep=Math.max(1,Math.round(exps.length/10));
    for(var j=0;j<exps.length;j+=colStep){
      var cx=plot.x+(j+0.5)*plot.w/exps.length;
      var lbl=(exps[j].ttxDays!=null?(exps[j].ttxDays+'d'):(exps[j].bucket||exps[j].key));
      ctx.fillStyle=LABEL; ctx.fillText(lbl, cx, plot.y+plot.h+5);
      if(exps[j].expiryDate){ ctx.fillStyle=LABEL_DIM; ctx.fillText(exps[j].expiryDate.slice(5), cx, plot.y+plot.h+17); }
    }
    ctx.fillStyle=LABEL_DIM; ctx.textAlign='center'; ctx.fillText('time to expiry →', plot.x+plot.w/2, plot.y+plot.h+27);

    // cumulative forward-interest profile (per strike) down the right edge
    var profX=plot.x+plot.w+8, profW=40, maxW=0;
    strikes.forEach(function(s){ if(s.wOI>maxW) maxW=s.wOI; });
    if(maxW>0){ for(var k=0;k<strikes.length;k++){
      var ry=plot.y+k*plot.h/strikes.length, rh=Math.max(1,plot.h/strikes.length-0.5);
      var w=profW*(strikes[k].wOI/maxW);
      var alpha=0.35+0.55*(strikes[k].persistence||0);
      ctx.fillStyle='rgba(120,190,230,'+alpha.toFixed(2)+')';
      ctx.fillRect(profX, ry, w, rh);
    }}
    ctx.fillStyle=LABEL_DIM; ctx.font='9px system-ui'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('cum. wOI', profX, plot.y-0);

    // colorbar
    var cbX=profX+profW+16, cbW=12, cm=window.ScalarField.colormap(state.colormap);
    for(var y=0;y<plot.h;y++){ var t=1-y/plot.h, rgb=cm(t);
      ctx.fillStyle='rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')'; ctx.fillRect(cbX, plot.y+y, cbW, 1); }
    ctx.strokeStyle=LINE; ctx.strokeRect(cbX+0.5, plot.y+0.5, cbW, plot.h);
    var ext=window.ScalarField.extent(f);
    ctx.fillStyle=LABEL; ctx.font='9px "SF Mono",Menlo,monospace'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(Math.round(ext.max).toLocaleString(), cbX+cbW+4, plot.y+5);
    ctx.fillText(Math.round(ext.min).toLocaleString(), cbX+cbW+4, plot.y+plot.h-5);
  }

  function onHover(ev){
    if(!last||!last.field||!last.plot){ tip.style.display='none'; return; }
    var r=canvas.getBoundingClientRect(), mx=ev.clientX-r.left, my=ev.clientY-r.top, p=last.plot;
    if(mx<p.x||mx>p.x+p.w||my<p.y||my>p.y+p.h){ tip.style.display='none'; return; }
    var f=last.field, strikes=last.strikes, exps=last.exps;
    var i=Math.min(strikes.length-1,Math.max(0,Math.floor((my-p.y)/p.h*strikes.length)));
    var j=Math.min(exps.length-1,Math.max(0,Math.floor((mx-p.x)/p.w*exps.length)));
    var s=strikes[i], e=exps[j], val=f.at(i,j);
    tip.innerHTML='<div style="color:#e8c07a;letter-spacing:.04em;margin-bottom:2px;">strike '+s.strike+'</div>'+
      '<div style="opacity:.85;">exp <b>'+(e.expiryDate||e.key)+'</b>'+(e.ttxDays!=null?(' · '+e.ttxDays+'d'):'')+'</div>'+
      '<div style="opacity:.85;">weighted OI <b>'+Math.round(val).toLocaleString()+'</b> · w '+(e.weight||1).toFixed(2)+'</div>'+
      '<div style="opacity:.6;">persistence '+((s.persistence||0)*100).toFixed(0)+'% · share '+((s.share||0)*100).toFixed(1)+'% · skew '+((s.putCallSkew||0)>=0?'+':'')+(s.putCallSkew||0).toFixed(2)+'</div>';
    tip.style.display='block';
    var tw=tip.offsetWidth||200, th=tip.offsetHeight||60;
    tip.style.left=Math.min(mx+14, r.width-tw-6)+'px';
    tip.style.top=Math.min(my+12, r.height-th-6)+'px';
  }

  window.__rollingBoot=function(){ build(); refresh(); };
  window.__rollingResize=function(){ if(built) draw(); };
  // follow the global control bar like every other tab: re-aggregate on instrument / date /
  // anchor+chain change. Only while active (aggregation reads the warehouse); a hidden Rolling
  // re-aggregates on its next tab-open, since __rollingBoot always calls refresh().
  function rollingActive(){ var s=document.getElementById('tabRolling'); return !!(s&&s.classList.contains('on')); }
  ['quan:instr','quan:date','quan:cell'].forEach(function(ev){
    window.addEventListener(ev,function(){ if(built&&rollingActive()) refresh(); });
  });
  if(typeof ResizeObserver!=='undefined'){
    var ro=new ResizeObserver(function(){ if(built&&document.getElementById('tabRolling')&&document.getElementById('tabRolling').classList.contains('on')) draw(); });
    document.addEventListener('DOMContentLoaded', function(){ var m=document.getElementById('rollingMount'); if(m) ro.observe(m); });
  }
})();
