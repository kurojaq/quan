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
  var PROXY_BASE='https://quanyahoo.jqnboggan.workers.dev';
  var POLL_MS=10000;
  var btn=document.getElementById('liveAnchorBtn'), note=document.getElementById('liveAnchorNote');
  if(!btn||!note) return;
  var timer=null, on=false;
  function currentSymbol(){ var inst=(document.getElementById('instA')||{}).value||''; return YF_SYMS[inst]||null; }
  function tick(){
    var inst=(document.getElementById('instA')||{}).value||'?', sym=currentSymbol();
    if(!sym){ note.textContent='no Yahoo symbol mapped for '+inst; return; }
    fetch(PROXY_BASE+'/quote?symbol='+encodeURIComponent(sym)).then(function(r){ return r.json(); }).then(function(d){
      if(d && typeof d.price==='number'){
        if(window.__qSetAnchor) window.__qSetAnchor(d.price);
        if(window.__chartOnLiveTick) window.__chartOnLiveTick(sym,d.price);
        note.textContent=sym+' '+d.price+' · '+new Date().toLocaleTimeString();
      } else {
        note.textContent=(d&&d.error)?('error: '+d.error):'no price returned';
      }
    }).catch(function(){ note.textContent='proxy unreachable — run yahoo_proxy.py'; });
  }
  btn.addEventListener('click',function(){
    on=!on;
    btn.classList.toggle('on',on);
    if(on){ note.textContent='starting…'; tick(); timer=setInterval(tick,POLL_MS); }
    else{ if(timer) clearInterval(timer); timer=null; note.textContent='off'; }
  });
})();