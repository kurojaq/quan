/* ==========================================================================
   Sim demo broker — the Account Sim tab's live paper-trading engine.

   Proxies the Execution cockpit's order lifecycle entirely inside the
   terminal: the same verbs (BUY/SELL × MKT/LMT/STP/STP-LMT, OCO brackets,
   working orders, positions, fills), but every fill happens against the
   shared ANCHOR price — which is the live market price whenever the header
   hub's Live feed is on (js/live-anchor.js drives __qSetAnchor), and the
   operator's hand-set anchor otherwise. Nothing routes externally; this is
   the in-terminal demo of the execution engine (invariant #7 untouched).

   Wiring:
   - price ticks: 'quan:cell' fires on every anchor set; we mark the current
     instrument and sweep its working orders.
   - point values: window.__INSTR_MULT (account-sim.js) / QuanInstruments.
   - staging: window.__simBroker.stagePlan(inst, layers, tag) accepts the
     Doctrine tab's compiled three-layer plan and books it as resting orders
     with OCO brackets — Doctrine → Sim is the demo of Doctrine → Execution.
   - per-position MAE/MFE is tracked live (feeds the Mission AAR's facts).
   Account state persists at localStorage 'qsim:broker:v1'.
   ========================================================================== */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const MONO="font:11px/1.5 'SF Mono',Menlo,Consolas,monospace;";
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const KEY='qsim:broker:v1';
  const fin=v=>v!=null&&isFinite(v);
  const fmt=(v,d)=>fin(v)?(+v).toFixed(d==null?2:d):'—';
  const money=v=>{ if(!fin(v)) return '—'; const n=v<0?'−':'', a=Math.abs(v);
    return n+'$'+(a>=1e6?(a/1e6).toFixed(2)+'M':a>=1e3?(a/1e3).toFixed(1)+'k':a.toFixed(2)); };
  const pnlColor=v=>v>0?'#3f9d6b':(v<0?'#d9463b':'var(--cream)');

  function mult(inst){
    if(window.__INSTR_MULT&&fin(window.__INSTR_MULT[inst])) return window.__INSTR_MULT[inst];
    try{ const m=window.QuanInstruments&&window.QuanInstruments.mult(inst); if(fin(m)) return m; }catch(_){}
    return 1;
  }

  // ---- account state ------------------------------------------------------
  let S=null, seq=1;
  function blank(){ return {cash:100000, realized:0, orders:[], pos:{}, fills:[], marks:{}, hist:[], created:Date.now()}; }
  function load(){ try{ const v=JSON.parse(localStorage.getItem(KEY)||'null'); if(v&&v.orders){ S=v;
      seq=1+S.orders.concat(S.fills).reduce((m,o)=>Math.max(m,parseInt(String(o.id).replace(/\D/g,''),10)||0),0);
      return; } }catch(_){}
    S=blank(); }
  let saveT=null;
  function save(){ clearTimeout(saveT); saveT=setTimeout(()=>{ try{ localStorage.setItem(KEY,JSON.stringify(S)); }catch(_){} },250); }

  function posOf(inst){ return S.pos[inst]||(S.pos[inst]={qty:0,avg:0,mae:0,mfe:0}); }
  function unrealized(){ let u=0; for(const inst in S.pos){ const p=S.pos[inst], px=S.marks[inst];
    if(p.qty!==0&&fin(px)) u+=(px-p.avg)*p.qty*mult(inst); } return u; }
  function equity(){ return S.cash+S.realized+unrealized(); }
  function notionalUsed(extraInst,extraQty,extraPx){
    let n=0; for(const inst in S.pos){ const p=S.pos[inst], px=S.marks[inst];
      if(p.qty!==0&&fin(px)) n+=Math.abs(p.qty)*px*mult(inst); }
    if(extraInst&&fin(extraPx)) n+=Math.abs(extraQty)*extraPx*mult(extraInst);
    return n; }
  function levCap(){ const lv=parseFloat(($('simLev')||{}).value)||1; return equity()*Math.max(lv,1); }

  // ---- order lifecycle ----------------------------------------------------
  // o: {id,inst,side(+1/-1),qty,type:'MKT'|'LMT'|'STP'|'STPLMT',limit,stop,
  //     bracket:{stop,target}|null, reduceOnly, ocoId, tag, status, ts}
  function place(o){
    if(!o.inst) return {ok:false,error:'no instrument'};
    o.qty=Math.max(1,Math.round(o.qty||0));
    if(!(o.side===1||o.side===-1)) return {ok:false,error:'side required'};
    if(o.type!=='MKT'&&!fin(o.type==='LMT'?o.limit:o.stop)) return {ok:false,error:'price required for '+o.type};
    const px=S.marks[o.inst];
    if(!o.reduceOnly&&fin(px)&&notionalUsed(o.inst,o.qty,px)>levCap())
      return {ok:false,error:'exceeds 1:'+((($('simLev')||{}).value)||1)+' notional cap — reduce size or leverage up'};
    o.id='S'+(seq++); o.status='working'; o.ts=Date.now();
    S.orders.push(o);
    if(o.type==='MKT'&&fin(px)) fill(o,px);
    save(); renderAll(); return {ok:true,id:o.id};
  }
  function cancel(id,silent){ const o=S.orders.find(x=>x.id===id&&x.status==='working');
    if(o){ o.status='cancelled'; if(!silent){ save(); renderAll(); } } }
  function flatten(inst){ const p=S.pos[inst]; const px=S.marks[inst];
    if(!p||p.qty===0||!fin(px)) return;
    S.orders.filter(o=>o.inst===inst&&o.status==='working').forEach(o=>cancel(o.id,true));
    fill({id:'S'+(seq++),inst:inst,side:p.qty>0?-1:1,qty:Math.abs(p.qty),type:'MKT',reduceOnly:true,tag:'flatten',status:'working',ts:Date.now()},px);
    save(); renderAll(); }
  function reset(){ const eq=parseFloat(($('simEquity')||{}).value)||100000;
    S=blank(); S.cash=eq; save(); renderAll(); }

  function fill(o,px){
    o.status='filled'; o.fillPx=px; o.filledAt=Date.now();
    const p=posOf(o.inst), m=mult(o.inst), d=o.side*o.qty;
    if(p.qty!==0&&Math.sign(p.qty)!==Math.sign(p.qty+d)&&(p.qty+d)!==0){
      // flip through flat: realize the whole old position, open remainder at px
      S.realized+=(px-p.avg)*p.qty*m; p.qty+=d; p.avg=px; p.mae=0; p.mfe=0;
    } else if(p.qty!==0&&Math.sign(d)!==Math.sign(p.qty)){
      const closeQty=Math.min(Math.abs(d),Math.abs(p.qty))*Math.sign(p.qty);
      S.realized+=(px-p.avg)*closeQty*m; p.qty+=d;
      if(p.qty===0){ p.avg=0; p.mae=0; p.mfe=0; }
    } else { p.avg=(p.avg*Math.abs(p.qty)+px*Math.abs(d))/Math.max(Math.abs(p.qty)+Math.abs(d),1); p.qty+=d; }
    S.fills.unshift({id:o.id,inst:o.inst,side:o.side,qty:o.qty,px:px,type:o.type,tag:o.tag||'',ts:o.filledAt});
    if(S.fills.length>60) S.fills.length=60;
    // OCO: a filled reduce-only leg cancels its siblings
    if(o.reduceOnly&&o.ocoId) S.orders.filter(x=>x.ocoId===o.ocoId&&x.id!==o.id&&x.status==='working').forEach(x=>cancel(x.id,true));
    // bracket: an entry fill books its OCO exit pair
    if(!o.reduceOnly&&o.bracket&&(fin(o.bracket.stop)||fin(o.bracket.target))){
      const oco='OCO'+o.id;
      if(fin(o.bracket.stop)) S.orders.push({id:'S'+(seq++),inst:o.inst,side:-o.side,qty:o.qty,type:'STP',stop:o.bracket.stop,reduceOnly:true,ocoId:oco,tag:(o.tag||'')+' stop',status:'working',ts:Date.now()});
      if(fin(o.bracket.target)) S.orders.push({id:'S'+(seq++),inst:o.inst,side:-o.side,qty:o.qty,type:'LMT',limit:o.bracket.target,reduceOnly:true,ocoId:oco,tag:(o.tag||'')+' target',status:'working',ts:Date.now()});
    }
    pushHist();
  }

  function sweep(inst,px){
    for(const o of S.orders){
      if(o.status!=='working'||o.inst!==inst) continue;
      if(o.type==='LMT'){ if((o.side===1&&px<=o.limit)||(o.side===-1&&px>=o.limit)) fill(o,o.limit); }
      else if(o.type==='STP'||o.type==='STPLMT'){ if((o.side===1&&px>=o.stop)||(o.side===-1&&px<=o.stop)) fill(o,o.stop); }
      else if(o.type==='MKT') fill(o,px);
    }
    const p=S.pos[inst];
    if(p&&p.qty!==0){ const ex=(px-p.avg)*p.qty*mult(inst);
      p.mae=Math.min(p.mae||0,ex); p.mfe=Math.max(p.mfe||0,ex); }
  }
  let lastHist=0;
  function pushHist(){ const now=Date.now();
    S.hist.push({t:now,eq:equity()}); if(S.hist.length>400) S.hist.splice(0,S.hist.length-400); lastHist=now; }

  function onTick(){
    try{
      const inst=(window.__qCurInst&&window.__qCurInst())||(($('instA')||{}).value);
      if(!inst) return;
      let px=null;
      try{ const a=window.__qActiveChain&&window.__qActiveChain(); px=parseFloat(a&&a.anchor); }catch(_){}
      if(!fin(px)||px<=0){ const g=$('gAnchor'); px=g?parseFloat(g.value):NaN; }
      if(!fin(px)||px<=0) return;
      S.marks[inst]=px;
      sweep(inst,px);
      if(Date.now()-lastHist>15000) pushHist();
      save(); renderAll();
    }catch(_){}
  }

  // ---- Doctrine plan staging (proxy of the Execution path) ---------------
  function stagePlan(inst,layers,tag){
    if(!inst||!layers||!layers.length) return {ok:false,error:'empty plan'};
    let count=0, firstErr=null;
    for(const L of layers){
      const side=String(L.side).toUpperCase()==='BUY'?1:-1;
      const entry=parseFloat(L.entry); if(!fin(entry)) continue;
      const target=parseFloat(L.target);              // 'x / y' → first leg; '—' → NaN
      const stop=parseFloat(L.stop);
      const isStop=String(L.type).indexOf('STOP')===0;
      const r=place({inst:inst, side:side, qty:L.size||1, type:isStop?'STPLMT':'LMT',
        limit:isStop?null:entry, stop:isStop?entry:null,
        bracket:{stop:fin(stop)?stop:null, target:fin(target)?target:null},
        tag:(tag?tag+' · ':'')+String(L.layer||'').split(' — ')[0]});
      if(r.ok) count++; else firstErr=firstErr||r.error;
    }
    return count?{ok:true,count:count}:{ok:false,error:firstErr||'no stageable layers'};
  }

  window.__simBroker={place:place, cancel:cancel, flatten:flatten, reset:reset, stagePlan:stagePlan,
    state:()=>S, equity:equity};

  // ---- UI -----------------------------------------------------------------
  let ui=false;
  function ensureUI(){
    const host=$('simBroker'); if(!host||ui) return; ui=true;
    host.innerHTML=
      '<div style="background:var(--panel);border-radius:var(--radius-md);padding:13px 15px;">'
      +'<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">'
      +'<div style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--dim)">Demo broker — fills against the anchor / live price · proxies the Execution engine, routes nothing</div>'
      +'<div style="display:flex;gap:8px"><button class="rptbtn" id="sbReset" type="button" title="Restart the demo account at the Account $ value">Reset account</button></div></div>'
      +'<div id="sbSummary" style="display:flex;gap:16px;flex-wrap:wrap;'+MONO+'margin-bottom:9px"></div>'
      +'<div id="sbCurve" style="margin-bottom:9px"></div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px;'+MONO+'">'
      +'<select class="field" id="sbSide"><option value="1">BUY</option><option value="-1">SELL</option></select>'
      +'<input class="panchor" id="sbQty" type="number" value="1" min="1" step="1" style="width:56px" title="contracts">'
      +'<select class="field" id="sbType"><option value="MKT">MKT</option><option value="LMT" selected>LMT</option><option value="STP">STP</option><option value="STPLMT">STP-LMT</option></select>'
      +'<input class="panchor" id="sbPx" type="number" step="any" placeholder="price" style="width:92px">'
      +'<span style="color:var(--dim)">bracket</span>'
      +'<input class="panchor" id="sbTgt" type="number" step="any" placeholder="target" style="width:92px">'
      +'<input class="panchor" id="sbStp" type="number" step="any" placeholder="stop" style="width:92px">'
      +'<button class="rptbtn" id="sbPlace" type="button">Place (demo)</button>'
      +'<span id="sbMsg" style="color:var(--dim)"></span></div>'
      +'<div id="sbTables"></div></div>';
    $('sbReset').addEventListener('click',()=>{ if(confirm('Reset the demo account? All sim orders, positions and fills are cleared.')) reset(); });
    $('sbPlace').addEventListener('click',()=>{
      const inst=(window.__qCurInst&&window.__qCurInst())||(($('instA')||{}).value)||'';
      const type=$('sbType').value, pxV=parseFloat($('sbPx').value);
      const r=place({inst:inst, side:parseInt($('sbSide').value,10), qty:parseInt($('sbQty').value,10)||1,
        type:type, limit:type==='LMT'?pxV:null, stop:(type==='STP'||type==='STPLMT')?pxV:null,
        bracket:{target:parseFloat($('sbTgt').value)||null, stop:parseFloat($('sbStp').value)||null}, tag:'manual'});
      const m=$('sbMsg'); m.textContent=r.ok?('order '+r.id+' working'):('rejected: '+r.error);
      m.style.color=r.ok?'#3f9d6b':'#e0a96a'; });
  }

  function sparkline(){
    const h=S.hist; if(h.length<2) return '';
    const w=520, ht=42, lo=Math.min(...h.map(p=>p.eq)), hi=Math.max(...h.map(p=>p.eq));
    const rng=Math.max(hi-lo,1e-9);
    const pts=h.map((p,i)=>((i/(h.length-1))*w).toFixed(1)+','+((ht-4)-((p.eq-lo)/rng)*(ht-8)+2).toFixed(1)).join(' ');
    const up=h[h.length-1].eq>=h[0].eq;
    return '<svg viewBox="0 0 '+w+' '+ht+'" style="width:100%;max-width:560px;height:'+ht+'px;display:block">'
      +'<polyline points="'+pts+'" fill="none" stroke="'+(up?'#3f9d6b':'#d9463b')+'" stroke-width="1.3"/></svg>';
  }

  function renderAll(){
    const host=$('simBroker'); if(!host) return; ensureUI();
    const sum=$('sbSummary'); if(!sum) return;
    const u=unrealized(), eq=equity();
    const kv=(k,v,c)=>'<span><span style="color:var(--dim)">'+k+' </span><b style="color:'+(c||'var(--cream)')+'">'+v+'</b></span>';
    const inst=(window.__qCurInst&&window.__qCurInst())||(($('instA')||{}).value)||'—';
    sum.innerHTML=kv('equity',money(eq))+kv('realized',money(S.realized),pnlColor(S.realized))
      +kv('unrealized',money(u),pnlColor(u))
      +kv('notional',money(notionalUsed())+' / '+money(levCap()))
      +kv(inst+' mark',fmt(S.marks[inst],2))
      +kv('working',String(S.orders.filter(o=>o.status==='working').length));
    $('sbCurve').innerHTML=sparkline();
    // tables
    let t='';
    const working=S.orders.filter(o=>o.status==='working');
    const th=cols=>'<thead><tr>'+cols.map(x=>'<th style="text-align:left;padding:3px 8px;color:var(--dim);font-weight:600;border-bottom:.5px solid var(--line)">'+x+'</th>').join('')+'</tr></thead>';
    if(working.length){
      t+='<div style="'+MONO+'color:var(--dim);margin:6px 0 3px">Working orders</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;'+MONO+'">'+th(['id','inst','side','qty','type','px','tag',''])+'<tbody>';
      for(const o of working) t+='<tr><td style="padding:3px 8px;color:var(--cream)">'+o.id+'</td><td style="padding:3px 8px;color:var(--cream)">'+esc(o.inst)+'</td>'
        +'<td style="padding:3px 8px;color:'+(o.side===1?'#3f9d6b':'#d9463b')+'">'+(o.side===1?'BUY':'SELL')+'</td>'
        +'<td style="padding:3px 8px;color:var(--cream)">'+o.qty+'</td><td style="padding:3px 8px;color:var(--cream)">'+o.type+(o.reduceOnly?' <span style="color:var(--dim)">(oco)</span>':'')+'</td>'
        +'<td style="padding:3px 8px;color:var(--cream)">'+fmt(fin(o.limit)?o.limit:o.stop,2)+'</td>'
        +'<td style="padding:3px 8px;color:var(--dim)">'+esc(o.tag||'')+'</td>'
        +'<td style="padding:3px 8px"><button class="rptbtn" data-cancel="'+o.id+'" type="button">✕</button></td></tr>';
      t+='</tbody></table></div>';
    }
    const open=Object.keys(S.pos).filter(i=>S.pos[i].qty!==0);
    if(open.length){
      t+='<div style="'+MONO+'color:var(--dim);margin:8px 0 3px">Positions</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;'+MONO+'">'+th(['inst','qty','avg','mark','uPnL','MAE','MFE',''])+'<tbody>';
      for(const i of open){ const p=S.pos[i], px=S.marks[i], up=(fin(px)?(px-p.avg)*p.qty*mult(i):null);
        t+='<tr><td style="padding:3px 8px;color:var(--cream)">'+esc(i)+'</td><td style="padding:3px 8px;color:'+(p.qty>0?'#3f9d6b':'#d9463b')+'">'+p.qty+'</td>'
        +'<td style="padding:3px 8px;color:var(--cream)">'+fmt(p.avg,2)+'</td><td style="padding:3px 8px;color:var(--cream)">'+fmt(px,2)+'</td>'
        +'<td style="padding:3px 8px;color:'+pnlColor(up||0)+'">'+money(up)+'</td>'
        +'<td style="padding:3px 8px;color:#d9463b">'+money(p.mae)+'</td><td style="padding:3px 8px;color:#3f9d6b">'+money(p.mfe)+'</td>'
        +'<td style="padding:3px 8px"><button class="rptbtn" data-flat="'+esc(i)+'" type="button">Flatten</button></td></tr>'; }
      t+='</tbody></table></div>';
    }
    if(S.fills.length){
      t+='<div style="'+MONO+'color:var(--dim);margin:8px 0 3px">Fills (latest '+Math.min(S.fills.length,12)+')</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;'+MONO+'">'+th(['time','inst','side','qty','px','type','tag'])+'<tbody>';
      for(const f of S.fills.slice(0,12)) t+='<tr><td style="padding:3px 8px;color:var(--dim)">'+new Date(f.ts).toLocaleTimeString()+'</td>'
        +'<td style="padding:3px 8px;color:var(--cream)">'+esc(f.inst)+'</td><td style="padding:3px 8px;color:'+(f.side===1?'#3f9d6b':'#d9463b')+'">'+(f.side===1?'BUY':'SELL')+'</td>'
        +'<td style="padding:3px 8px;color:var(--cream)">'+f.qty+'</td><td style="padding:3px 8px;color:var(--cream)">'+fmt(f.px,2)+'</td>'
        +'<td style="padding:3px 8px;color:var(--cream)">'+f.type+'</td><td style="padding:3px 8px;color:var(--dim)">'+esc(f.tag)+'</td></tr>';
      t+='</tbody></table></div>';
    }
    if(!working.length&&!open.length&&!S.fills.length)
      t='<div style="'+MONO+'color:var(--dim)">Flat, no working orders. Place a ticket above, or stage a compiled plan from the Doctrine tab (“Stage to Account Sim”). Turn the Live feed on for real-time fills; a hand-moved anchor ticks the tape too.</div>';
    $('sbTables').innerHTML=t;
    host.querySelectorAll('[data-cancel]').forEach(b=>b.addEventListener('click',()=>cancel(b.dataset.cancel)));
    host.querySelectorAll('[data-flat]').forEach(b=>b.addEventListener('click',()=>flatten(b.dataset.flat)));
  }

  // ---- boot ---------------------------------------------------------------
  load();
  function init(){ ensureUI(); renderAll(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
  window.addEventListener('quan:cell',onTick);
  window.addEventListener('quan:instr',()=>{ renderAll(); });
})();
