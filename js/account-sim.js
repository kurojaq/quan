(function(){
  // ---- constants ported from quan_backtest.py, generalized for user account size + leverage ----
  var KELLY_GOV=0.10, RISK_PER_TRADE=0.01, STOP_BUFFER=10.0;
  var TIER_MUL={TIER_1_FULL:1.0,TIER_2_STANDARD:0.5,TIER_3_LIGHT:0.25,STAND_DOWN:0.0};
  // ---- full CME Group point-value table (contract size × quote convention, cross-checked against each product's CME contract spec) ----
  var INSTR_MULT=window.__INSTR_MULT||(window.__INSTR_MULT={
    ES:50,MES:5,NQ:20,MNQ:2,YM:5,MYM:0.5,RTY:50,M2K:5,
    ZT:2000,ZF:1000,ZN:1000,ZB:1000,UB:1000,SR3:2500,
    '6E':125000,'6B':62500,'6J':12500000,'6A':100000,'6C':100000,'6S':125000,'6N':100000,
    GC:100,MGC:10,SI:5000,SIL:1000,HG:25000,PL:50,PA:100,
    CL:1000,QM:500,NG:10000,RB:42000,HO:42000,BZ:1000,
    ZC:50,ZW:50,ZS:50,ZM:100,ZL:600,KE:50,ZO:50,ZR:2000,
    LE:400,GF:500,HE:400,DC:2000,
    BTC:5,MBT:0.1,ETH:50
  });

  function _num(v){ if(v==null||v==='') return null; v=Number(v); return isFinite(v)?v:null; }
  function _esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _px(v,digits){ v=_num(v); if(v==null) return '—'; var neg=v<0; v=Math.abs(v);
    var d=(digits==null?2:digits); var t=v.toFixed(d);
    if(t.indexOf('.')>=0) t=t.replace(/0+$/,'').replace(/\.$/,'');
    var p=t.split('.'); p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');
    return (neg?'−':'')+p.join('.'); }
  function _m(v){ v=_num(v); if(v==null) return '—'; var neg=v<0, a=Math.abs(v), s=neg?'−':'';
    if(a>=1e9) return s+'$'+(a/1e9).toFixed(2)+'B'; if(a>=1e6) return s+'$'+(a/1e6).toFixed(2)+'M';
    if(a>=1e3) return s+'$'+(a/1e3).toFixed(1)+'k'; return s+'$'+a.toFixed(0); }
  function _pctFmt(v,d){ v=_num(v); if(v==null) return '—'; return (v<0?'−':'')+Math.abs(v).toFixed(d==null?2:d)+'%'; }
  function _r(v){ v=_num(v); if(v==null) return '—'; return (v<0?'−':'+')+Math.abs(v).toFixed(2)+'R'; }
  function card(label,val){ return '<div class="rcard"><div class="rk">'+label+'</div><div class="rv">'+(val==null||val===''?'<span class="rdash">—</span>':val)+'</div></div>'; }
  function group(title,cardsHtml){ return '<div class="rgroup"><div class="rgt">'+title+'</div><div class="rcards">'+cardsHtml+'</div></div>'; }

  // ---- order report + protocol + simulation, built entirely off the Report tab's already-computed brief (raw engine dict) ----
  // facility: 'futures' (default, unchanged) | 'cfd' (broker-quoted, price-translated off a user anchor, fractional-lot sized)
  function buildPlan(raw, inst, equity, leverage, facility, cfd){
    facility=facility||'futures'; cfd=cfd||{};
    var pointValue=facility==='cfd'?(_num(cfd.contractSize)||INSTR_MULT[inst]||1):(INSTR_MULT[inst]||1);
    var digits=facility==='cfd'?(_num(cfd.digits)!=null?_num(cfd.digits):2):null;
    var tier=raw.tier||'STAND_DOWN';
    var tierMul=(tier in TIER_MUL)?TIER_MUL[tier]:0;
    var dirStr=String(raw.direction||'').toUpperCase();
    var cdir=dirStr.indexOf('LONG')>=0?1:(dirStr.indexOf('SHORT')>=0?-1:0);
    var fstar=_num(raw.kellyf); if(fstar==null){ var hk=_num(raw.halfkelly); fstar=hk!=null?hk*2:0; }

    // ---- CFD price translation: shift every futures-space structural level by (broker anchor - futures forward) ----
    var premium=0;
    if(facility==='cfd'){ var anc=_num(cfd.anchor), fwd=_num(raw.fwd); if(anc!=null&&fwd!=null) premium=anc-fwd; }
    function tr(v){ v=_num(v); return v==null?null:v+premium; }

    var primary=cdir>0?tr(raw.dfloor):tr(raw.dceil);
    var secondary=cdir>0?tr(raw.sfloor):tr(raw.sceil);
    if(primary==null){ primary=secondary; secondary=null; }

    var standDown=(cdir===0)||tierMul<=0||!(fstar>0)||primary==null;
    var out={tier:tier,action:raw.action,bias:raw.bias,direction:raw.direction,cdir:cdir,standDown:standDown,
             facility:facility,cfd:cfd,premium:premium,digits:digits};
    if(standDown) return out;

    var stopBase=secondary!=null?secondary:primary;
    var stop=cdir>0?(stopBase-STOP_BUFFER):(stopBase+STOP_BUFFER);
    // spread only worsens the STOP fill (it executes as a market order once triggered) — limit entries/targets fill at their quoted price
    var spread=facility==='cfd'?(_num(cfd.spread)||0):0;
    var stopFill=facility==='cfd'?(cdir>0?stop-spread:stop+spread):stop;
    var stopsLevelBreach=false;
    if(facility==='cfd'){ var minDist=_num(cfd.stopsLevel)||0; if(minDist>0 && Math.abs(stop-primary)<minDist) stopsLevelBreach=true; }

    var gwalls=(raw.gwalls||[]).map(tr).filter(function(g){ return g!=null && (cdir>0?g>primary:g<primary); });
    gwalls.sort(function(a,b){ return cdir>0?(a-b):(b-a); });
    var targets=gwalls.slice(0,3);
    var t0=tr(raw.target);
    if(!targets.length && t0!=null) targets=[t0];

    var entries=secondary!=null
      ? [{label:'Primary (dealer wall)',px:primary,w:0.6},{label:'Secondary (structural)',px:secondary,w:0.4}]
      : [{label:'Primary (dealer wall)',px:primary,w:1.0}];

    var gov=Math.max(KELLY_GOV*fstar,0);
    var riskFraction=Math.min(RISK_PER_TRADE,gov)*tierMul;
    var riskBudget=equity*riskFraction;
    var notionalCap=equity*leverage;
    // Futures: whole contracts. CFD: fractional lots, 0.01-lot step (floor, so we never exceed the risk/margin cap).
    var qtyFloor=function(q){ return facility==='cfd'?Math.round(Math.floor(q/0.01)*0.01*100)/100:Math.floor(q); };
    var qtyRound=function(q){ return facility==='cfd'?Math.round(q*100)/100:Math.round(q); };

    entries.forEach(function(e){
      var riskPts=Math.abs(e.px-stop);
      var qtyRisk=qtyFloor((riskBudget*e.w)/Math.max(riskPts*pointValue,1));
      var qtyMargin=qtyFloor((notionalCap*e.w)/Math.max(e.px*pointValue,1));
      e.qty=Math.max(0,Math.min(qtyRisk,qtyMargin));
      e.bound=qtyRisk<=qtyMargin?'risk':'margin';
    });
    var totalQty=entries.reduce(function(s,e){ return s+e.qty; },0);
    var avgEntry=totalQty>0?(entries.reduce(function(s,e){ return s+e.px*e.qty; },0)/totalQty):primary;
    var riskPtsAvg=Math.abs(avgEntry-stop);

    var splits=targets.length===3?[0.34,0.33,0.33]:targets.length===2?[0.5,0.5]:targets.length===1?[1.0]:[];
    var alloc=0, legs=targets.map(function(px,i){
      var qty=(i===targets.length-1)?qtyRound(totalQty-alloc):qtyRound(totalQty*splits[i]); alloc+=qty;
      var pnl=(px-avgEntry)*cdir*qty*pointValue;
      var r=riskPtsAvg>0?(((px-avgEntry)*cdir)/riskPtsAvg):null;
      return {px:px,qty:qty,pnl:pnl,r:r};
    });

    var pnlStop=(stopFill-avgEntry)*cdir*totalQty*pointValue;
    var pnlFull=legs.reduce(function(s,l){ return s+l.pnl; },0);
    var rFull=totalQty>0&&riskPtsAvg>0?((pnlFull/pointValue)/totalQty/riskPtsAvg):null;
    var notionalUsed=totalQty*avgEntry*pointValue;
    var marginPct=notionalCap>0?(notionalUsed/notionalCap*100):0;

    out.standDown=false; out.pointValue=pointValue; out.entries=entries; out.stop=stop; out.stopFill=stopFill; out.legs=legs;
    out.totalQty=totalQty; out.avgEntry=avgEntry; out.riskPtsAvg=riskPtsAvg;
    out.pnlStop=pnlStop; out.pnlFull=pnlFull; out.rFull=rFull;
    out.notionalUsed=notionalUsed; out.notionalCap=notionalCap; out.marginPct=marginPct;
    out.equity=equity; out.leverage=leverage; out.stopsLevelBreach=stopsLevelBreach;
    out.equityIfStop=equity+pnlStop; out.equityIfFull=equity+pnlFull;
    return out;
  }

  function protocolHtml(raw, plan){
    var bias=_esc(String(raw.bias||'').replace(/_/g,' '));
    var isCfd=plan.facility==='cfd', unit=isCfd?'lots':'contracts';
    var bk='<b>Engine state.</b> '+_esc(raw.action||'—')+' &middot; tier <b>'+_esc(plan.tier)+'</b> &middot; bias '+(bias||'—')+'.';
    if(plan.standDown){
      bk+='<br><br><b>Stand down.</b> No structural edge clears the tier/Kelly/level gates for '+_esc(String(raw.direction||'no direction'))+' right now — no orders proposed.';
    } else {
      if(isCfd){
        bk+='<br><br><b>Price basis (CFD).</b> Broker anchor '+(plan.cfd.anchor!=null?_px(plan.cfd.anchor,plan.digits):'not set — premium treated as 0 until you enter one')+' vs. futures forward '+_px(raw.fwd)+' &rarr; premium '+(plan.premium>=0?'+':'')+plan.premium.toFixed(plan.digits)+' applied to every structural level below.';
      }
      bk+='<br><br><b>Entries (blended, laddered).</b> '+plan.entries.map(function(e){ return _esc(e.label)+' limit '+_px(e.px,plan.digits)+' &times; '+e.qty+' '+unit; }).join(' &middot; ')+'.';
      bk+='<br><br><b>Protective stop.</b> '+_px(plan.stop,plan.digits)+(isCfd&&plan.stopFill!==plan.stop?' &mdash; expected trigger fill '+_px(plan.stopFill,plan.digits)+' after spread (stops execute as a market order)':'')+' (structural level &plusmn; '+STOP_BUFFER+'pt buffer).';
      if(plan.stopsLevelBreach) bk+='<br><br><b>&#9888; Stops level.</b> The stop sits closer to the market than this broker&rsquo;s minimum stops distance ('+plan.cfd.stopsLevel+') &mdash; expect the broker to reject or reprice this order.';
      bk+='<br><br><b>Scale-out targets.</b> '+(plan.legs.length?plan.legs.map(function(l,i){ return 'T'+(i+1)+' '+_px(l.px,plan.digits)+' &times; '+l.qty+' '+unit; }).join(' &middot; '):'none available — no qualifying gamma-wall or target level');
      bk+='<br><br><b>Sizing.</b> Half-Kelly governed at 10% (KELLY_GOV), tier-scaled ('+_esc(plan.tier)+' = '+((TIER_MUL[plan.tier]||0)*100).toFixed(0)+'% of risk budget), capped at 1% of account risk per trade. Leverage 1:'+plan.leverage+' sets a separate notional ceiling; sizing here is '+ (plan.entries.some(function(e){return e.bound==='margin';})?'<b>leverage-capped</b> on at least one tranche':'risk-capped (leverage headroom unused)') +'.'+(isCfd?' Sized in '+unit+' at a 0.01-lot step.':'');
      if(isCfd && ((_num(plan.cfd.swapLong)||0)!==0 || (_num(plan.cfd.swapShort)||0)!==0)){
        bk+='<br><br><b>Swap (not included in PnL).</b> Long '+_num(plan.cfd.swapLong)+' pts/night &middot; short '+_num(plan.cfd.swapShort)+' pts/night &mdash; relevant only if the position is held overnight.';
      }
    }
    if(raw.flipimm && raw.flipdir) bk+='<br><br><b>Flip-watch.</b> '+_esc(raw.flipdir);
    bk+='<br><br>Field-type and magnitude carry; any directional lean stays <b>paper-only</b> until 50+ logged trades. This order report and simulation are illustrative projections off the current snapshot, not a probability-weighted forecast or investment advice.';
    return bk;
  }

  function renderPlan(raw, inst, equity, leverage, facility, cfd){
    var plan=buildPlan(raw, inst, equity, leverage, facility, cfd);
    var isCfd=plan.facility==='cfd', unit=isCfd?'lots':'contracts';
    var qtyFmt=function(q){ return isCfd?q.toFixed(2):q; };
    var html='';
    if(plan.standDown){
      html+=group('Order Report', card('Status','STAND DOWN — '+_esc(String(raw.direction||'no direction'))));
    } else {
      var oc=plan.entries.map(function(e){ return card(e.label,'LIMIT '+_px(e.px,plan.digits)+' × '+qtyFmt(e.qty)+' <span class="rdash">('+e.bound+'-capped)</span>'); }).join('');
      oc+=card('Stop','STOP '+_px(plan.stop,plan.digits)+(isCfd&&plan.stopFill!==plan.stop?' <span class="rdash">(fills ~'+_px(plan.stopFill,plan.digits)+')</span>':''));
      plan.legs.forEach(function(l,i){ oc+=card('Target '+(i+1),'LIMIT '+_px(l.px,plan.digits)+' × '+qtyFmt(l.qty)); });
      oc+=card('Avg entry',_px(plan.avgEntry,plan.digits))+card('Total qty',qtyFmt(plan.totalQty)+' '+unit)+card('Risk (pts)',plan.riskPtsAvg.toFixed(2));
      if(isCfd) oc+=card('Broker premium',(plan.premium>=0?'+':'')+plan.premium.toFixed(plan.digits));
      if(plan.stopsLevelBreach) oc+=card('Stops level','<span class="rdash">&#9888; below broker minimum ('+plan.cfd.stopsLevel+')</span>');
      html+=group('Order Report — '+(plan.cdir>0?'LONG':'SHORT')+(isCfd?' (CFD)':' (Futures)'), oc);
      var rc=card('VaR 95%',_m(raw.var95))+card('VaR 99%',_m(raw.var99))+card('CF VaR 99%',_m(raw.cfvar99));
      rc+=card('Stress F+5%',_m(raw.stresup))+card('Stress F−5%',_m(raw.stresdn));
      rc+=card('Margin used',_pctFmt(plan.marginPct,1)+' of 1:'+leverage+' cap')+card('Notional',_m(plan.notionalUsed)+' / '+_m(plan.notionalCap));
      html+=group('Risk', rc);
    }
    html+='<div class="rptBreakdown"><div class="rgt">Blended Operational Protocol</div>'+protocolHtml(raw,plan)+'</div>';
    if(!plan.standDown){
      var sc=card('If stopped out', _m(plan.pnlStop)+' ('+_r(-1)+') → equity '+_m(plan.equityIfStop));
      sc+=card('If full scale-out', _m(plan.pnlFull)+' ('+(plan.rFull!=null?_r(plan.rFull):'—')+') → equity '+_m(plan.equityIfFull));
      plan.legs.forEach(function(l,i){ sc+=card('Leg T'+(i+1)+' PnL', _m(l.pnl)+' ('+(l.r!=null?_r(l.r):'—')+')'); });
      html+=group('Account Simulation — Potential PnL (illustrative scenarios)', sc);
    }
    return html;
  }

  var equityEl, equityREl, levEl, levREl, classEl, subEl, bodyEl, presetsEl, booted=false, engHooked=false;
  var facBtnFutures, facBtnCFD, cfdRowEl, cfdAnchorEl, cfdSpreadEl, cfdDigitsEl, cfdStopsLevelEl, cfdContractSizeEl, cfdSwapLongEl, cfdSwapShortEl;
  var facility='futures', contractSizeManuallySet=false;
  var PRESETS=[1,10,20,50,100,500,2000];

  function syncPair(numEl, rngEl){ numEl.addEventListener('input',function(){ rngEl.value=numEl.value; render(); }); rngEl.addEventListener('input',function(){ numEl.value=rngEl.value; render(); }); }

  function seedContractSize(){
    if(contractSizeManuallySet || !cfdContractSizeEl) return;
    var inst=(document.getElementById('instA')||{}).value||'';
    cfdContractSizeEl.value=INSTR_MULT[inst]||'';
  }
  function setFacility(f){
    facility=f;
    facBtnFutures.classList.toggle('rptbtn-on',f==='futures');
    facBtnCFD.classList.toggle('rptbtn-on',f==='cfd');
    cfdRowEl.style.display=f==='cfd'?'flex':'none';
    if(f==='cfd') seedContractSize();
    render();
  }

  function render(){
    if(!classEl) return;
    var inst=(document.getElementById('instA')||{}).value||'';
    var date=(document.getElementById('dayDate')||{}).value||'';
    if(!window.__engBrief){ try{ if(window.__qEnsureEngine) window.__qEnsureEngine(); }catch(_){} if(!engHooked && window.__engReady){ engHooked=true; window.__engReady.then(function(){ try{render();}catch(_){} }); } }
    var data=null; try{ data=window.__reportData?window.__reportData(inst,date):null; }catch(_){ data=null; }
    var raw=data?data.__raw:null;
    if(!raw){
      classEl.textContent=window.__engBrief?'AWAITING BRIEF DATA':'ENGINE BOOTING';
      classEl.classList.add('rwait');
      subEl.textContent=window.__engBrief?('No brief for '+(inst||'?')+' · '+(date||'?')+' — load a chain in the Detector/Report tab first.'):'Engine booting — the simulation will populate once the Report tab’s engine is ready.';
      bodyEl.innerHTML='';
      return;
    }
    classEl.classList.remove('rwait');
    classEl.textContent=(data.taxonomy||raw.fieldType||inst||'—');
    subEl.textContent=[data.taxoGrade,data.bias].filter(Boolean).join(' — ')||String(raw.bias||'');
    var equity=Math.max(0,Math.min(15000000,_num(equityEl.value)||0));
    var leverage=Math.max(1,Math.min(2000,_num(levEl.value)||1));
    var cfd={
      anchor: (cfdAnchorEl&&cfdAnchorEl.value!=='')?_num(cfdAnchorEl.value):null,
      spread: _num(cfdSpreadEl&&cfdSpreadEl.value)||0,
      digits: (cfdDigitsEl&&cfdDigitsEl.value!=='')?_num(cfdDigitsEl.value):2,
      stopsLevel: _num(cfdStopsLevelEl&&cfdStopsLevelEl.value)||0,
      contractSize: (cfdContractSizeEl&&cfdContractSizeEl.value!=='')?_num(cfdContractSizeEl.value):null,
      swapLong: _num(cfdSwapLongEl&&cfdSwapLongEl.value)||0,
      swapShort: _num(cfdSwapShortEl&&cfdSwapShortEl.value)||0
    };
    bodyEl.innerHTML=renderPlan(raw, inst, equity, leverage, facility, cfd);
  }

  window.__simBoot=function(){
    if(booted) return; booted=true;
    equityEl=document.getElementById('simEquity'); equityREl=document.getElementById('simEquityR');
    levEl=document.getElementById('simLev'); levREl=document.getElementById('simLevR');
    classEl=document.getElementById('simClass'); subEl=document.getElementById('simSub'); bodyEl=document.getElementById('simBody');
    presetsEl=document.getElementById('simLevPresets');
    facBtnFutures=document.getElementById('simFacFutures'); facBtnCFD=document.getElementById('simFacCFD'); cfdRowEl=document.getElementById('simCfdRow');
    cfdAnchorEl=document.getElementById('simCfdAnchor'); cfdSpreadEl=document.getElementById('simCfdSpread'); cfdDigitsEl=document.getElementById('simCfdDigits');
    cfdStopsLevelEl=document.getElementById('simCfdStopsLevel'); cfdContractSizeEl=document.getElementById('simCfdContractSize');
    cfdSwapLongEl=document.getElementById('simCfdSwapLong'); cfdSwapShortEl=document.getElementById('simCfdSwapShort');
    if(!equityEl||!classEl) return;
    equityEl.value=equityREl.value=100000; levEl.value=levREl.value=1;
    syncPair(equityEl,equityREl); syncPair(levEl,levREl);
    PRESETS.forEach(function(p){
      var b=document.createElement('button'); b.className='rptbtn'; b.textContent='1:'+p; b.type='button';
      b.addEventListener('click',function(){ levEl.value=p; levREl.value=p; render(); });
      presetsEl.appendChild(b);
    });
    facBtnFutures.addEventListener('click',function(){ setFacility('futures'); });
    facBtnCFD.addEventListener('click',function(){ setFacility('cfd'); });
    [cfdAnchorEl,cfdSpreadEl,cfdDigitsEl,cfdStopsLevelEl,cfdSwapLongEl,cfdSwapShortEl].forEach(function(el){ el.addEventListener('input',render); });
    cfdContractSizeEl.addEventListener('input',function(){ contractSizeManuallySet=(cfdContractSizeEl.value!==''); render(); });
    window.addEventListener('quan:instr',function(){ if(facility==='cfd') seedContractSize(); render(); });
    window.addEventListener('quan:date',render);
    window.addEventListener('quan:cell',render);
    render();
  };
  window.__simRender=render;
})();