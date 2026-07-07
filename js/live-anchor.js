(function(){
  // ---- live anchor: poll a Yahoo Finance CORS proxy (Cloudflare Worker, see workers/yahoo-proxy.js) and drive the shared anchor from it ----
  // ---- full CME Group symbol/point-value tables, shared globally (Account Sim, the price Chart tab, and this live-anchor poll all read the same table) ----
  var YF_SYMS=window.__YF_SYMS||(window.__YF_SYMS={
    ES:'ES=F',MES:'MES=F',NQ:'NQ=F',MNQ:'MNQ=F',YM:'YM=F',MYM:'MYM=F',RTY:'RTY=F',M2K:'M2K=F',
    ZT:'ZT=F',ZF:'ZF=F',ZN:'ZN=F',ZB:'ZB=F',UB:'UB=F',SR3:'SR3=F',
    '6E':'6E=F','6B':'6B=F','6J':'6J=F','6A':'6A=F','6C':'6C=F','6S':'6S=F','6N':'6N=F',
    GC:'GC=F',MGC:'MGC=F',SI:'SI=F',SIL:'SIL=F',HG:'HG=F',PL:'PL=F',PA:'PA=F',
    CL:'CL=F',QM:'QM=F',NG:'NG=F',RB:'RB=F',HO:'HO=F',BZ:'BZ=F',
    ZC:'ZC=F',ZW:'ZW=F',ZS:'ZS=F',ZM:'ZM=F',ZL:'ZL=F',KE:'KE=F',ZO:'ZO=F',ZR:'ZR=F',
    LE:'LE=F',GF:'GF=F',HE:'HE=F',DC:'DC=F',
    BTC:'BTC=F',MBT:'MBT=F',ETH:'ETH=F'
  });
  var PROXY_BASE='/api';   // gated, edge-cached Pages Function (was the open quanyahoo Worker)
  var POLL_MS=10000;
  var btn=document.getElementById('liveAnchorBtn'), note=document.getElementById('liveAnchorNote');
  if(!btn||!note) return;
  var timer=null, on=false, rt=null;
  function currentSymbol(){ var inst=(document.getElementById('instA')||{}).value||''; return YF_SYMS[inst]||null; }
  function tick(){
    var inst=(document.getElementById('instA')||{}).value||'?', sym=currentSymbol();
    if(!sym){ note.textContent='no Yahoo symbol mapped for '+inst; return; }
    var _h={}; var _t=window.__authToken&&window.__authToken(); if(_t) _h['Authorization']='Bearer '+_t;
    if(window.__viewToken) _h['X-Quan-Token']=window.__viewToken;
    fetch(PROXY_BASE+'/quote?symbol='+encodeURIComponent(sym),{headers:_h}).then(function(r){ return r.json(); }).then(function(d){
      if(d && typeof d.price==='number'){
        if(window.__qSetAnchor) window.__qSetAnchor(d.price);
        if(window.__chartOnLiveTick) window.__chartOnLiveTick(sym,d.price);
        note.textContent=sym+' '+d.price+' · '+new Date().toLocaleTimeString();
      } else {
        note.textContent=(d&&d.error)?('error: '+d.error):'no price returned';
      }
    }).catch(function(){ note.textContent='proxy unreachable — check your connection'; });
  }
  function stopFeeds(){ if(timer){ clearInterval(timer); timer=null; } if(rt){ rt.close(); rt=null; } }
  function startFeeds(){
    var sym=currentSymbol();
    if(!sym){ var inst=(document.getElementById('instA')||{}).value||'?'; note.textContent='no Yahoo symbol mapped for '+inst; return; }
    stopFeeds();
    // Prefer the realtime WebSocket fan-out when configured (one upstream fetch for
    // all seats, sub-second push); otherwise fall back to per-client polling.
    if(window.__quanRealtime && window.__quanRealtime.enabled){
      rt=window.__quanRealtime.connectPrice(sym, function(price){
        if(window.__qSetAnchor) window.__qSetAnchor(price);
        if(window.__chartOnLiveTick) window.__chartOnLiveTick(sym,price);
        note.textContent=sym+' '+price+' · '+new Date().toLocaleTimeString();
      }, function(st){ if(st==='reconnecting') note.textContent=sym+' · reconnecting…'; });
      if(rt){ note.textContent=sym+' · live (realtime)…'; return; }
    }
    tick(); timer=setInterval(tick,POLL_MS);
  }
  btn.addEventListener('click',function(){
    on=!on; btn.classList.toggle('on',on);
    if(on){ note.textContent='starting…'; startFeeds(); }
    else{ stopFeeds(); note.textContent='off'; }
  });
  // re-point the feed at the new symbol if the instrument changes while Live is on
  var instSel=document.getElementById('instA');
  if(instSel) instSel.addEventListener('change',function(){ if(on) startFeeds(); });
})();