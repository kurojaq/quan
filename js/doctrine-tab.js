/* ==========================================================================
   Doctrine tab — pre-session precision console.

   Renders the Deep Strike scan, Risq pre-trade read, Entropy Budget, coherence
   patterns, and the compiled three-layer order plan from js/doctrine-engine.js.
   Data: per-strike rows from the Heat Map iframe (quanGetHeatmap bridge — the
   engine itself is never duplicated, invariant #1) + window.__sopData() for the
   temporal fold. condFactor is a manual operator input until the Tick Engine
   ships (conductance needs tick-based Packet Timing). Order plans are advisory
   text — routing stays manual in the Execution tab (invariant #7).
   ========================================================================== */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const D=()=>window.QuanDoctrine;
  let booted=false, rows=null, hmMeta=null, scan=[], cr=null, glob=null, coh=null, selK=null, reqSeq=0, refreshTimer=null;

  function ctxNow(){ try{ const a=window.__qActiveChain&&window.__qActiveChain(); if(a) return {inst:a.inst,date:a.date||''}; }catch(_){}
    return {inst:(window.__qCurInst&&window.__qCurInst())||'—',date:''}; }
  function condFactor(){ const s=$('dcCond'); return s?parseFloat(s.value):1.0; }
  function cwPos(){ const s=$('dcCW'); return s?parseFloat(s.value):-1; }
  function baseAlloc(){ const s=$('dcBase'); const v=s?parseInt(s.value,10):10; return isFinite(v)?v:10; }
  function status(msg,warn){ const el=$('dcStatus'); if(el){ el.textContent=msg; el.style.color=warn?'#e0a96a':'var(--dim)'; } }

  // ---- Heat Map rows bridge ----------------------------------------------
  function fetchRows(cb){
    try{ window.__heatBoot&&window.__heatBoot(); }catch(_){}
    try{ window.__feedHeatmap&&window.__feedHeatmap(true); }catch(_){}
    const fr=$('heatFrame');
    if(!fr||!fr.contentWindow){ setTimeout(()=>fetchRows(cb),450); return; }
    const reqId='doc'+(++reqSeq); let done=false;
    function onMsg(ev){ const d=ev&&ev.data||{}; if(d.type==='quanHeatmapData'&&d.reqId===reqId){
      done=true; window.removeEventListener('message',onMsg);
      cb(d.data&&d.data.rows||null, d.data&&d.data.meta||null); } }
    window.addEventListener('message',onMsg);
    try{ fr.contentWindow.postMessage({type:'quanGetHeatmap',reqId:reqId},'*'); }catch(_){}
    setTimeout(()=>{ if(!done){ window.removeEventListener('message',onMsg); cb(null,null); } },3500);
  }

  // ---- prior-session ICF map (for the Layer-4 time-density trend) ---------
  function icfKey(inst,date){ return 'qdoc:icf:'+inst+':'+date; }
  function saveICF(inst,date){ if(!inst||!date||!scan.length) return;
    try{ const m={}; for(const s of scan) if(s.icf!=null) m[s.k]=s.icf;
      localStorage.setItem(icfKey(inst,date),JSON.stringify(m)); }catch(_){} }
  function prevICF(inst,date){ if(!inst||!date) return null;
    try{ let best=null,bd=null; const pre='qdoc:icf:'+inst+':';
      for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
        if(k&&k.indexOf(pre)===0){ const d=k.slice(pre.length); if(d<date&&(bd==null||d>bd)){bd=d;best=k;} } }
      return best?JSON.parse(localStorage.getItem(best)):null; }catch(_){ return null; } }

  // ---- entropy-budget ledger (per instrument+date) ------------------------
  function ebKey(){ const c=ctxNow(); return 'qdoc:eb:'+c.inst+':'+c.date; }
  function ebSpent(){ try{ const v=JSON.parse(localStorage.getItem(ebKey())||'null'); return (v&&v.spent)||[]; }catch(_){ return []; } }
  function ebLog(layers){ if(!glob||!cr) return; const r=risqFor(sel()); if(!r) return;
    const cost=D().ebCost(layers,r.rC,r.rI);
    const spent=ebSpent(); spent.push({layers:layers,cost:+cost.toFixed(2),at:Date.now()});
    try{ localStorage.setItem(ebKey(),JSON.stringify({spent:spent})); }catch(_){}
    render(); }
  function ebReset(){ try{ localStorage.removeItem(ebKey()); }catch(_){} render(); }

  function sel(){ return scan.find(s=>s.k===selK)||scan[0]||null; }
  function risqFor(s){ if(!s||!glob) return null;
    return D().risq(s,{globals:glob, cw:cwPos(), dipltr:cr?cr.dip:0, zcCount:cr?cr.zcCount:0,
      condFactor:condFactor(), base:baseAlloc(), p3:coh&&coh.p3}); }

  // ---- refresh pipeline ---------------------------------------------------
  function refresh(){
    const c=ctxNow();
    const sop=window.__sopData&&window.__sopData();
    cr=sop?D().closeReading(sop):null;
    fetchRows(function(rw,mt){
      rows=rw; hmMeta=mt;
      if(!rows||!rows.length){ scan=[]; glob=null; coh=null;
        status('Heat engine rows unavailable — load a chain (header hub) and retry.',true); render(); return; }
      glob=D().bookGlobals(rows); coh=D().coherence(glob);
      scan=D().scanStrikes(rows,cr,glob,prevICF(c.inst,c.date));
      saveICF(c.inst,c.date);
      if(selK==null||!scan.some(s=>s.k===selK)) selK=scan.length?scan[0].k:null;
      const src=(hmMeta&&hmMeta.inst?hmMeta.inst+' ':'')+(hmMeta&&hmMeta.exp?hmMeta.exp:'');
      status('engine rows: '+rows.length+' strikes · '+src+(sop?' · fold live':' · fold engine idle — set anchor'),!sop);
      render();
    });
  }
  function queueRefresh(){ if(!booted) return; clearTimeout(refreshTimer); refreshTimer=setTimeout(refresh,250); }

  // ---- rendering ----------------------------------------------------------
  const fmt=(v,d)=>v==null||!isFinite(v)?'—':(+v).toFixed(d==null?2:d);
  const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const dot=on=>'<span style="color:'+(on?'#3f9d6b':'#555')+'">&#9679;</span>';
  const MONO='font:11px/1.5 \'SF Mono\',Menlo,Consolas,monospace;';

  function panel(title,body){ return '<div style="background:var(--panel);border-radius:var(--radius-md);padding:13px 15px;">'
    +'<div style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);margin-bottom:8px">'+title+'</div>'+body+'</div>'; }
  function kv(k,v){ return '<div style="display:flex;justify-content:space-between;gap:12px;'+MONO+'"><span style="color:var(--dim)">'+k+'</span><span style="color:var(--cream)">'+v+'</span></div>'; }
  const dirWord=d=>d>0?'BULLISH':(d<0?'BEARISH':'NEUTRAL');
  const dirColor=d=>d>0?'#3f9d6b':(d<0?'#d9463b':'#999');

  function render(){
    const body=$('dcBody'); if(!body) return;
    const c=ctxNow();
    // banner
    const prior=cr?cr.prior.toUpperCase():'—';
    const pc=cr&&cr.prior==='strong'?'#3f9d6b':(cr&&cr.prior==='moderate'?'#e8b53a':'#999');
    const eb=cr&&glob?D().entropyBudget(cr.zcCount,risqFor(sel())?risqFor(sel()).rI:0):null;
    const spent=ebSpent(); let used=0; for(const t of spent) used+=t.cost;
    const ebRun=eb?Math.max(0,eb.eb0-used):null;
    const locked=ebRun!=null&&ebRun<=0;
    $('dcClass').innerHTML=cr?('PRIOR: <span style="color:'+pc+'">'+prior+'</span>'
      +(cr.dir!==0?' · <span style="color:'+dirColor(cr.dir)+'">'+dirWord(cr.dir)+'</span>':'')
      +(eb?' &nbsp;·&nbsp; EB '+fmt(ebRun,1)+'/'+fmt(eb.eb0,1)+(locked?' <span style="color:#d9463b">SESSION CLOSED TO NEW INITIATIONS</span>':''):'')):'AWAITING FIELD DATA';
    $('dcSub').textContent=c.inst+(c.date?' · '+c.date:'')+' · condFactor '+condFactor().toFixed(2)+' · CW '+cwPos().toFixed(1);

    let h='';
    // Close reading
    if(cr){ h+=panel('Session-close reading — inherited prior (Deep Strike Part I)',
        kv('DIPLTR residual (CW ±1.0/±0.9 fold)',fmt(cr.dip,4)+' · '+dirWord(cr.dipDir))
       +kv('Zero-crosses (fold)',cr.zcCount+(cr.finalZC!=null?' · final @ CW ±'+fmt(Math.abs(cr.finalZC),2)+(cr.potent?' (potent)':''):''))
       +kv('Entropy residual',cr.entropy+(cr.sizeCut?' · cut next-session size 30%':''))
       +kv('SOP latent orientation (wings 0.9–0.7)',dirWord(cr.latentDir))
       +kv('Synthesis',cr.aligned+'/4 aligned → '+cr.prior.toUpperCase()+' prior')); }
    else h+=panel('Session-close reading','<div style="'+MONO+'color:var(--dim)">Field Study engine idle — load a chain and set the anchor in the header hub.</div>');

    // Coherence
    if(coh){ h+=panel('Coherence patterns (DID/DIT/DR3 divergence)',
      (coh.patterns.length?coh.patterns.map(p=>'<div style="'+MONO+'color:#e0a96a">P'+p.id+' '+esc(p.name)+' — '+esc(p.resp)+'</div>').join('')
        :'<div style="'+MONO+'color:#3f9d6b">none active</div>')
      +'<div style="'+MONO+'color:var(--dim);margin-top:6px">DIDK '+fmt(glob.DIDK)+' · DITK '+fmt(glob.DITK)+' · DR3K '+fmt(glob.DR3K)
      +' · DIDS '+fmt(glob.DIDS)+' · DITS '+fmt(glob.DITS)+' · DR3S '+fmt(glob.DR3S)+'</div>'); }

    // Deep Strike table
    if(scan.length){
      let t='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;'+MONO+'">'
        +'<thead><tr>'+['strike','M','K','LR','A','class','gradient','DR3','DPT','ICF∆','score','tier']
          .map(x=>'<th style="text-align:right;padding:3px 8px;color:var(--dim);font-weight:600;border-bottom:.5px solid var(--line)">'+x+'</th>').join('')+'</tr></thead><tbody>';
      for(const s of scan.slice(0,14)){
        const on=s.k===selK;
        t+='<tr data-k="'+s.k+'" style="cursor:pointer;'+(on?'background:rgba(232,181,58,.08);':'')+'">'
          +'<td style="text-align:right;padding:3px 8px;color:'+(on?'var(--gold)':'var(--cream)')+'">'+fmt(s.k,1)+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+dot(s.crit.mass)+'</td><td style="text-align:right;padding:3px 8px">'+dot(s.crit.kurt)+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+dot(s.crit.lr)+'</td><td style="text-align:right;padding:3px 8px">'+dot(s.crit.a)+'</td>'
          +'<td style="text-align:right;padding:3px 8px;color:'+(s.cls==='PDSL'?'var(--gold)':'var(--cream)')+'">'+s.cls+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+s.grad+(s.demoted?' <span style="color:#e0a96a">⨯prior</span>':'')+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+fmt(s.dr3,2)+(s.dr3!=null?(s.dr3<0.3?' <span style="color:#3f9d6b">live</span>':(s.dr3>0.7?' <span style="color:#d9463b">spent</span>':'')):'')+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+fmt(s.dpt,1)+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+(s.icfTrend==null?'—':(s.icfTrend?'▲':'▼'))+'</td>'
          +'<td style="text-align:right;padding:3px 8px;color:var(--cream)">'+s.score+'/10</td>'
          +'<td style="text-align:right;padding:3px 8px;font-weight:700;color:'+(s.tier===1?'#3f9d6b':(s.tier===2?'#e8b53a':'#999'))+'">'+(s.tier?('T'+s.tier):'—')+'</td></tr>';
      }
      t+='</tbody></table></div>';
      h+=panel('Deep Strike scan — 4-criteria observable field (Mass>±2 · Kurt>4.5 · LR>8 · |A|>20)',t);
    } else h+=panel('Deep Strike scan','<div style="'+MONO+'color:var(--dim)">No strikes meet 3-of-4 criteria (or engine rows unavailable).</div>');

    // Risq panel + order plan for the selected strike
    const s=sel();
    if(s&&glob){
      const r=risqFor(s);
      const dim=(name,v,thr,lab)=>kv(name,fmt(v)+(v!=null&&thr(v)?' <span style="color:#d9463b">'+lab+'</span>':''));
      let rb=dim('ℛ_F field (jerk/mass)',r.rF,v=>v>4,'VETO')
        +dim('ℛ_T temporal (CW×DR3)',r.rT,v=>v>0.6,'compress')
        +dim('ℛ_I information (cond,ZC)',r.rI,v=>v>2,'live-confirm only')
        +dim('ℛ_C coherence',r.rC,v=>v>1.5,'reduce 30%')
        +dim('ℛ_Ω inertia (II/TI)',r.rOm,v=>v>3,'partial targets')
        +kv('ℛₓ Risq Ratio','<b style="color:'+(r.tier<=2?'#3f9d6b':(r.tier===3?'#e8b53a':'#d9463b'))+'">'+fmt(r.rx,1)+'</b> · Tier '+(r.tier===5?'VETO':r.tier))
        +kv('Mechanical allocation','<b>'+fmt(r.alloc,1)+'</b> micro ('+baseAlloc()+' base × min(ℛₓ/15,1) × cond)');
      if(r.veto) rb+='<div style="'+MONO+'color:#d9463b;margin-top:6px">'+esc(r.veto)+'</div>';
      h+=panel('Risq — pre-trade read @ '+fmt(s.k,1),rb);

      const anch=D().fibAnchors(scan);
      const plan=D().orderPlan(s,anch,{condFactor:condFactor(),risqTier:r.tier,alloc:r.alloc});
      let pb='';
      if(anch) pb+='<div style="'+MONO+'color:var(--dim);margin-bottom:6px">Fib anchors AL '+fmt(anch.al,1)+' → AH '+fmt(anch.ah,1)+' ('+anch.dir+', range '+fmt(anch.range,1)+')</div>';
      if(plan.layers.length){
        pb+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;'+MONO+'"><thead><tr>'
          +['layer','type','side','size','entry','stop','target'].map(x=>'<th style="text-align:left;padding:3px 8px;color:var(--dim);font-weight:600;border-bottom:.5px solid var(--line)">'+x+'</th>').join('')+'</tr></thead><tbody>';
        for(const L of plan.layers) pb+='<tr>'+[L.layer,L.type,L.side,L.size,L.entry,L.stop,L.target]
          .map(x=>'<td style="padding:3px 8px;color:var(--cream)">'+esc(x)+'</td>').join('')+'</tr>';
        pb+='</tbody></table></div>';
        for(const L of plan.layers) pb+='<div style="'+MONO+'color:var(--dim);margin-top:4px">• <b>'+esc(L.layer.split(' — ')[0])+'</b>: '+esc(L.note)+' <i>'+esc(L.cancel)+'</i></div>';
        if(plan.gateNote) pb+='<div style="'+MONO+'color:#e0a96a;margin-top:6px">'+esc(plan.gateNote)+'</div>';
        pb+='<div style="'+MONO+'color:var(--dim);margin-top:6px">'+esc(plan.note)+'</div>';
        pb+='<div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap"><button class="rptbtn" id="dcCopyPlan" type="button">Copy plan</button>'
          +'<span style="'+MONO+'color:var(--dim);align-self:center">Advisory only — route manually via the Execution tab.</span></div>';
      } else pb+='<div style="'+MONO+'color:#e0a96a">'+esc(plan.note)+'</div>';
      h+=panel('Order architecture — three-layer build @ '+fmt(s.k,1),pb);

      // EB ledger
      let ebB=eb?kv('EB₀ (10 − ZC×1.5 − ℛ_I×2)',fmt(eb.eb0,1)+' · '+esc(eb.grade)):'';
      ebB+=kv('Consumed',fmt(used,1)+' ('+spent.length+' trade'+(spent.length===1?'':'s')+')');
      ebB+=kv('Running budget','<b style="color:'+(locked?'#d9463b':'var(--cream)')+'">'+fmt(ebRun,1)+'</b>'+(locked?' — observe only':''));
      ebB+='<div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap">'
        +'<button class="rptbtn" id="dcEbA" type="button"'+(locked?' disabled':'')+'>Log trade: A</button>'
        +'<button class="rptbtn" id="dcEbAB" type="button"'+(locked?' disabled':'')+'>A+B</button>'
        +'<button class="rptbtn" id="dcEbABC" type="button"'+(locked?' disabled':'')+'>A+B+C</button>'
        +'<button class="rptbtn" id="dcEbReset" type="button">Reset session</button></div>';
      h+=panel('Entropy budget — session information capital',ebB);
    }

    h+='<div style="'+MONO+'color:var(--dim);padding:2px 4px">Derivations: A=NetOI/PCR(OI) · DR3/II/TI = book percentile of |riskreal|/|invdist|/|invtxn| · '
      +'DIDK…DR3S = kurt/skew of the three dealer-tier distributions · condFactor manual until the Tick Engine ships. '
      +'Full doctrine: Desk Wiki → Analytics.</div>';
    body.innerHTML=h;

    body.querySelectorAll('tr[data-k]').forEach(tr=>tr.addEventListener('click',()=>{ selK=parseFloat(tr.dataset.k); render(); }));
    const cp=$('dcCopyPlan'); if(cp) cp.addEventListener('click',copyPlan);
    const bA=$('dcEbA'); if(bA) bA.addEventListener('click',()=>ebLog('A'));
    const bAB=$('dcEbAB'); if(bAB) bAB.addEventListener('click',()=>ebLog('AB'));
    const bABC=$('dcEbABC'); if(bABC) bABC.addEventListener('click',()=>ebLog('ABC'));
    const bR=$('dcEbReset'); if(bR) bR.addEventListener('click',ebReset);
  }

  function copyPlan(){
    const s=sel(); if(!s||!glob) return;
    const r=risqFor(s), anch=D().fibAnchors(scan), plan=D().orderPlan(s,anch,{condFactor:condFactor(),risqTier:r.tier,alloc:r.alloc});
    const c=ctxNow();
    let txt='QU\'AN DOCTRINE ORDER PLAN — '+c.inst+' '+c.date+' @ '+s.k+'\n'
      +'Prior: '+(cr?cr.prior:'—')+' · Score '+s.score+'/10 (T'+s.tier+') · ℛₓ '+r.rx.toFixed(1)+' (Tier '+(r.tier===5?'VETO':r.tier)+') · cond '+condFactor().toFixed(2)+'\n\n';
    for(const L of plan.layers) txt+=L.layer+'\n  '+L.side+' '+L.size+' '+L.type+' @ '+L.entry+' · stop '+L.stop+' · target '+L.target+'\n  '+L.note+'\n  CANCEL: '+L.cancel+'\n\n';
    txt+=plan.note+'\nAdvisory only — no order is routed by this tab.';
    try{ navigator.clipboard.writeText(txt); status('Order plan copied.'); }catch(_){ status('Clipboard unavailable.',true); }
  }

  // ---- boot ---------------------------------------------------------------
  window.__doctrineBoot=function(){
    if(booted){ queueRefresh(); return; } booted=true;
    ['dcCond','dcBase'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('change',()=>render()); });
    const cw=$('dcCW'); if(cw) cw.addEventListener('input',()=>{ const o=$('dcCWv'); if(o) o.textContent=parseFloat(cw.value).toFixed(1); render(); });
    const rf=$('dcRefresh'); if(rf) rf.addEventListener('click',refresh);
    window.addEventListener('quan:sop',queueRefresh);
    window.addEventListener('quan:cell',queueRefresh);
    refresh();
  };
})();
