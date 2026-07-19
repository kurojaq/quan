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
  // The anchor is the tab's price agent: the header hub's shared anchor, which
  // the Live feed drives in real time when it's on (js/live-anchor.js).
  function anchorPx(){ try{ const a=window.__qActiveChain&&window.__qActiveChain(); const v=parseFloat(a&&a.anchor);
      if(isFinite(v)&&v>0) return v; }catch(_){}
    const g=document.getElementById('gAnchor'); const v=g?parseFloat(g.value):NaN;
    return (isFinite(v)&&v>0)?v:null; }
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
  function ebLog(layers){ if(!glob||!cr) return;
    // PRAQ No-Brief-No-Trade rule (praq-mission-discipline.md) — soft dependency on the Mission module
    if(window.__quanBriefClosed&&!window.__quanBriefClosed()){ status('No-Brief-No-Trade: close a Mission Brief first (Mission view).',true); return; }
    const r=risqFor(sel()); if(!r) return;
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
      scan=D().scanStrikes(rows,cr,glob,prevICF(c.inst,c.date),anchorPx());
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
    const apx=anchorPx();
    $('dcSub').textContent=c.inst+(c.date?' · '+c.date:'')+(apx!=null?' · anchor '+fmt(apx,2):' · no anchor')
      +' · condFactor '+condFactor().toFixed(2)+' · CW '+cwPos().toFixed(1);
    const anch=(scan.length&&glob)?D().fibAnchors(scan,apx):null;

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
      const roleColor=r=>r==='support'?'#3f9d6b':(r==='resistance'?'#d9463b':(r==='phase'?'#6fd3ff':'#e0a96a'));
      let t='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;'+MONO+'">'
        +'<thead><tr>'+['strike','Δanchor','role','M','K','LR','A','class','grad','DR3','ICF∆','score','adj·w','tier']
          .map(x=>'<th style="text-align:right;padding:3px 8px;color:var(--dim);font-weight:600;border-bottom:.5px solid var(--line)">'+x+'</th>').join('')+'</tr></thead><tbody>';
      for(const s of scan.slice(0,14)){
        const on=s.k===selK;
        t+='<tr data-k="'+s.k+'" style="cursor:pointer;'+(on?'background:rgba(232,181,58,.08);':'')+'">'
          +'<td style="text-align:right;padding:3px 8px;color:'+(on?'var(--gold)':'var(--cream)')+'">'+fmt(s.k,1)+'</td>'
          +'<td style="text-align:right;padding:3px 8px;color:'+(s.dAnchor==null?'var(--dim)':(s.dAnchor>=0?'#3f9d6b':'#d9463b'))+'">'+(s.dAnchor==null?'—':((s.dAnchor>=0?'+':'')+fmt(s.dAnchor,1)))+'</td>'
          +'<td style="text-align:right;padding:3px 8px;color:'+roleColor(s.spotRole)+'">'+(s.spotRole||'—')+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+dot(s.crit.mass)+'</td><td style="text-align:right;padding:3px 8px">'+dot(s.crit.kurt)+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+dot(s.crit.lr)+'</td><td style="text-align:right;padding:3px 8px">'+dot(s.crit.a)+'</td>'
          +'<td style="text-align:right;padding:3px 8px;color:'+(s.cls==='PDSL'?'var(--gold)':'var(--cream)')+'">'+s.cls+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+s.grad+(s.demoted?' <span style="color:#e0a96a">⨯prior</span>':'')+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+fmt(s.dr3,2)+(s.dr3!=null?(s.dr3<0.3?' <span style="color:#3f9d6b">live</span>':(s.dr3>0.7?' <span style="color:#d9463b">spent</span>':'')):'')+'</td>'
          +'<td style="text-align:right;padding:3px 8px">'+(s.icfTrend==null?'—':(s.icfTrend?'▲':'▼'))+'</td>'
          +'<td style="text-align:right;padding:3px 8px;color:var(--cream)">'+s.score+'/10</td>'
          +'<td style="text-align:right;padding:3px 8px;color:var(--cream)">'+fmt(s.wScore,1)+'</td>'
          +'<td style="text-align:right;padding:3px 8px;font-weight:700;color:'+(s.tier===1?'#3f9d6b':(s.tier===2?'#e8b53a':'#999'))+'">'+(s.tier?('T'+s.tier):'—')+'</td></tr>';
      }
      t+='</tbody></table></div>';
      if(apx!=null) t+='<div style="'+MONO+'color:var(--dim);margin-top:5px">Ranked by anchor-adjacency-weighted score (adj·w = score × 1/(1+|Δ|/10-strike window)) — doctrinal 0–10 score untouched; far-OTM PDSLs stay listed but yield rank to actionable ones. Live feed on = this re-ranks in real time.</div>';
      h+=panel('Deep Strike scan — 4-criteria observable field (Mass>±2 · Kurt>4.5 · LR>8 · |A|>20)'+(apx!=null?' · anchored @ '+fmt(apx,2):''),t);
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

      const plan=D().orderPlan(s,anch,{condFactor:condFactor(),risqTier:r.tier,alloc:r.alloc});
      let pb='';
      if(anch) pb+='<div style="'+MONO+'color:var(--dim);margin-bottom:6px">Fib anchors AL '+fmt(anch.al,1)+' → AH '+fmt(anch.ah,1)+' ('+anch.dir+', range '+fmt(anch.range,1)+')'
        +(anch.bracket?' · <span style="color:#3f9d6b">bracketing the anchor</span>':(apx!=null?' · <span style="color:#e0a96a">⚠ one-sided — no qualifying strike on the other side of price</span>':''))+'</div>';
      if(plan.layers.length){
        const dAnc=v=>{ const n=parseFloat(v); return (apx!=null&&isFinite(n))?((n-apx>=0?'+':'')+fmt(n-apx,1)):'—'; };
        pb+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;'+MONO+'"><thead><tr>'
          +['layer','type','side','size','entry','Δanchor','stop','target'].map(x=>'<th style="text-align:left;padding:3px 8px;color:var(--dim);font-weight:600;border-bottom:.5px solid var(--line)">'+x+'</th>').join('')+'</tr></thead><tbody>';
        for(const L of plan.layers) pb+='<tr>'+[L.layer,L.type,L.side,L.size,L.entry,dAnc(L.entry),L.stop,L.target]
          .map(x=>'<td style="padding:3px 8px;color:var(--cream)">'+esc(x)+'</td>').join('')+'</tr>';
        pb+='</tbody></table></div>';
        for(const L of plan.layers) pb+='<div style="'+MONO+'color:var(--dim);margin-top:4px">• <b>'+esc(L.layer.split(' — ')[0])+'</b>: '+esc(L.note)+' <i>'+esc(L.cancel)+'</i></div>';
        if(plan.gateNote) pb+='<div style="'+MONO+'color:#e0a96a;margin-top:6px">'+esc(plan.gateNote)+'</div>';
        pb+='<div style="'+MONO+'color:var(--dim);margin-top:6px">'+esc(plan.note)+'</div>';
        pb+='<div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap"><button class="rptbtn" id="dcCopyPlan" type="button">Copy plan</button>'
          +(window.__simBroker?'<button class="rptbtn" id="dcStageSim" type="button">Stage to Account Sim (demo)</button>':'')
          +'<span style="'+MONO+'color:var(--dim);align-self:center">Advisory only — live routing stays manual in the Execution tab. Staging fills against the anchor price in the Sim demo broker.</span></div>';
      } else pb+='<div style="'+MONO+'color:#e0a96a">'+esc(plan.note)+'</div>';
      h+=panel('Order architecture — three-layer build @ '+fmt(s.k,1),pb);

      // Risq Surface — the CW × Fibonacci quadrant map, literalized
      // (risq-operational-protocol.md describes it as "mental, not software-generated")
      if(anch) h+=panel('Risq surface — CW × Fibonacci quadrants',surfaceSVG(anch,s));

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
    const sg=$('dcStageSim'); if(sg) sg.addEventListener('click',stageToSim);
    const bA=$('dcEbA'); if(bA) bA.addEventListener('click',()=>ebLog('A'));
    const bAB=$('dcEbAB'); if(bAB) bAB.addEventListener('click',()=>ebLog('AB'));
    const bABC=$('dcEbABC'); if(bABC) bABC.addEventListener('click',()=>ebLog('ABC'));
    const bR=$('dcEbReset'); if(bR) bR.addEventListener('click',ebReset);

    // published state for the Mission console (js/doctrine-mission.js)
    window.__doctrineState=function(){ const ss=sel(); const rr=(ss&&glob)?risqFor(ss):null;
      return {inst:c.inst, date:c.date, cr:cr, scan:scan, glob:glob, coh:coh, sel:ss, risq:rr,
        anchor:anchorPx(), eb:eb, ebRun:ebRun, cond:condFactor(), cw:cwPos(), base:baseAlloc(), anch:anch,
        plan:(ss&&rr)?D().orderPlan(ss,anch,{condFactor:condFactor(),risqTier:rr.tier,alloc:rr.alloc}):null}; };
    if(window.__missionOnState) window.__missionOnState();
  }

  // ---- Risq Surface (CW × Fib quadrant map) -------------------------------
  function surfaceSVG(anch,s){
    const W=560,H=240,X0=34,X1=W-14,Y0=12,Y1=H-22;
    const x=cw=>X0+(cw+1)/2*(X1-X0);
    const y=f=>Y0+(1.7-f)/1.8*(Y1-Y0);
    const band=(cwA,cwB,fA,fB,fill,op)=>'<rect x="'+x(cwA)+'" y="'+y(fB)+'" width="'+(x(cwB)-x(cwA))+'" height="'+(y(fA)-y(fB))+'" fill="'+fill+'" opacity="'+op+'"/>';
    let svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block">';
    svg+=band(-1,0,0.382,0.618,'#3f9d6b',0.14)+band(0,1,0.382,0.618,'#e8b53a',0.12);
    svg+=band(0,1,-0.1,0.236,'#d9463b',0.08)+band(0,1,0.786,1.7,'#d9463b',0.08);
    svg+=band(-1,0,-0.1,0.236,'#6fd3ff',0.07)+band(-1,0,0.786,1.7,'#6fd3ff',0.07);
    for(const f of [0,0.236,0.382,0.5,0.618,0.786,1,1.272,1.618])
      svg+='<line x1="'+X0+'" y1="'+y(f)+'" x2="'+X1+'" y2="'+y(f)+'" stroke="var(--line,#333)" stroke-width="0.5"/>'
        +'<text x="4" y="'+(y(f)+3)+'" fill="var(--dim,#8f8c82)" font-size="8" font-family="Menlo,monospace">'+f.toFixed(3)+'</text>';
    svg+='<line x1="'+x(0)+'" y1="'+Y0+'" x2="'+x(0)+'" y2="'+Y1+'" stroke="var(--cream,#ddd)" stroke-width="0.7" stroke-dasharray="3 3"/>';
    for(const cw of [-0.5,0.5]) svg+='<line x1="'+x(cw)+'" y1="'+Y0+'" x2="'+x(cw)+'" y2="'+Y1+'" stroke="var(--line,#333)" stroke-width="0.5"/>';
    for(const cw of [-1,-0.5,0,0.5,1]) svg+='<text x="'+(x(cw)-8)+'" y="'+(H-8)+'" fill="var(--dim,#8f8c82)" font-size="8" font-family="Menlo,monospace">'+(cw>0?'+':'')+cw.toFixed(1)+'</text>';
    const q=(cx,f,t)=>'<text x="'+x(cx)+'" y="'+y(f)+'" fill="var(--dim,#8f8c82)" font-size="9" font-family="Menlo,monospace" text-anchor="middle">'+t+'</text>';
    svg+=q(-0.5,0.5,'I · PREPARATION')+q(0.5,0.5,'II · EXECUTION')+q(0.5,1.45,'III · BOUNDARY')+q(-0.5,1.45,'IV · LOADING')+q(0.5,0.06,'III')+q(-0.5,0.06,'IV');
    const clampF=f=>Math.max(-0.1,Math.min(1.7,f));
    // selected strike = a level line on the grid; the PRICE (anchor, live when
    // the feed is on) is the exposure marker — the surface tracks price, not
    // the strike, so far-OTM selections read as distance instead of presence.
    const fpS=clampF((s.k-anch.al)/anch.range);
    svg+='<line x1="'+X0+'" y1="'+y(fpS)+'" x2="'+X1+'" y2="'+y(fpS)+'" stroke="var(--gold,#e8b53a)" stroke-width="0.9" stroke-dasharray="5 3"/>'
      +'<text x="'+(X1-4)+'" y="'+(y(fpS)-3)+'" fill="var(--gold,#e8b53a)" font-size="8" font-family="Menlo,monospace" text-anchor="end">PDSL '+fmt(s.k,1)+'</text>';
    const apx=anchorPx(); let cap='';
    if(apx!=null){
      const fpA=clampF((apx-anch.al)/anch.range);
      svg+='<circle cx="'+x(cwPos())+'" cy="'+y(fpA)+'" r="5" fill="none" stroke="var(--cream,#e6e2d8)" stroke-width="1.6"/>'
        +'<circle cx="'+x(cwPos())+'" cy="'+y(fpA)+'" r="1.6" fill="var(--cream,#e6e2d8)"/>'
        +'<text x="'+(x(cwPos())+8)+'" y="'+(y(fpA)+3)+'" fill="var(--cream,#e6e2d8)" font-size="8" font-family="Menlo,monospace">price '+fmt(apx,1)+'</text>';
      cap='price '+fmt(apx,1)+' at Fib '+fmt((apx-anch.al)/anch.range,3)+' × CW '+cwPos().toFixed(1)+' · selected PDSL '+fmt(s.k,1)+' ('+((s.k-apx)>=0?'+':'')+fmt(s.k-apx,1)+' from price)';
    } else cap='no anchor price — set the anchor (or turn the Live feed on) to place price on the surface';
    svg+='</svg>';
    return svg+'<div style="'+MONO+'color:var(--dim);margin-top:4px">'+cap
      +' — pending orders belong in Quadrant I; Quadrant IV holds only Watermark-level (LR&gt;30) overnight exposure at 50% size; no new initiations past CW +0.5.</div>';
  }

  function stageToSim(){
    if(!window.__simBroker) return;
    const s=sel(); if(!s||!glob) return;
    const r=risqFor(s), anch=D().fibAnchors(scan,anchorPx());
    const plan=D().orderPlan(s,anch,{condFactor:condFactor(),risqTier:r.tier,alloc:r.alloc});
    if(!plan.layers.length){ status(plan.note||'Nothing to stage.',true); return; }
    const c=ctxNow();
    const res=window.__simBroker.stagePlan(c.inst,plan.layers,'PDSL '+fmt(s.k,1));
    status(res&&res.ok?('Staged '+res.count+' order'+(res.count===1?'':'s')+' to the Sim demo broker (Account Sim tab).')
                      :('Stage failed: '+((res&&res.error)||'sim broker unavailable')),!(res&&res.ok));
  }

  function copyPlan(){
    const s=sel(); if(!s||!glob) return;
    const r=risqFor(s), anch=D().fibAnchors(scan,anchorPx()), plan=D().orderPlan(s,anch,{condFactor:condFactor(),risqTier:r.tier,alloc:r.alloc});
    const c=ctxNow();
    let txt='QU\'AN DOCTRINE ORDER PLAN — '+c.inst+' '+c.date+' @ '+s.k+'\n'
      +'Prior: '+(cr?cr.prior:'—')+' · Score '+s.score+'/10 (T'+s.tier+') · ℛₓ '+r.rx.toFixed(1)+' (Tier '+(r.tier===5?'VETO':r.tier)+') · cond '+condFactor().toFixed(2)+'\n\n';
    for(const L of plan.layers) txt+=L.layer+'\n  '+L.side+' '+L.size+' '+L.type+' @ '+L.entry+' · stop '+L.stop+' · target '+L.target+'\n  '+L.note+'\n  CANCEL: '+L.cancel+'\n\n';
    txt+=plan.note+'\nAdvisory only — no order is routed by this tab.';
    try{ navigator.clipboard.writeText(txt); status('Order plan copied.'); }catch(_){ status('Clipboard unavailable.',true); }
  }

  // ---- boot ---------------------------------------------------------------
  function applyDcView(v){
    const map={console:'dcBody',mission:'dcMission',archive:'dcArchive'};
    for(const k in map){ const el=$(map[k]); if(el) el.style.display=(k===v)?'':'none'; }
    if(v!=='console'&&window.__missionRender) window.__missionRender(v);
  }

  window.__doctrineBoot=function(){
    if(booted){ queueRefresh(); return; } booted=true;
    ['dcCond','dcBase'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('change',()=>render()); });
    const vw=$('dcView'); if(vw) vw.addEventListener('change',()=>applyDcView(vw.value));
    const cw=$('dcCW'); if(cw) cw.addEventListener('input',()=>{ const o=$('dcCWv'); if(o) o.textContent=parseFloat(cw.value).toFixed(1); render(); });
    const rf=$('dcRefresh'); if(rf) rf.addEventListener('click',refresh);
    window.addEventListener('quan:sop',queueRefresh);
    window.addEventListener('quan:cell',queueRefresh);
    refresh();
  };
})();
