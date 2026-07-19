/* ==========================================================================
   Mission console — the PRAQ discipline layer (praq-mission-discipline.md)
   rendered as the Doctrine tab's Mission / Archive views.

   IPS → PSIS: the four intelligence layers are auto-answered from the
   doctrine engine's computed state (window.__doctrineState); the operator
   annotates, then marks the PSIS complete. No Mission Brief may be opened
   until the PSIS is complete, and no trade may be logged against the entropy
   ledger until a Brief is CLOSED — the No-Brief-No-Trade rule, enforced via
   window.__quanBriefClosed consumed by doctrine-tab.js's trade logger.

   The Brief is the five-paragraph OPORD. Closing it flips Strategist →
   Ground Lead: the document becomes read-only and the only remaining moves
   are execute-as-planned or Abort & Replan (which reopens it and counts a
   revision). The AAR quotes the closed Brief verbatim (an unwritten Brief
   makes the AAR unperformable), records facts, classifies each gap into
   exactly one of causes A/B/C, and takes exactly one doctrine change.

   Storage: localStorage 'qdoc:mission:<inst>:<date>' — same keyspace family
   as the entropy ledger. Advisory throughout; nothing routes (invariant #7).
   ========================================================================== */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const MONO="font:11px/1.5 'SF Mono',Menlo,Consolas,monospace;";
  const TA='width:100%;box-sizing:border-box;background:var(--panel2,#141414);border:.5px solid var(--line,#2a2a2a);border-radius:6px;color:var(--cream,#e6e2d8);'+MONO+'padding:8px;resize:vertical;';
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmt=(v,d)=>v==null||!isFinite(v)?'—':(+v).toFixed(d==null?2:d);
  let saveTimer=null;

  function st(){ return (window.__doctrineState&&window.__doctrineState())||null; }
  function ctx(){ const s=st(); return s?{inst:s.inst,date:s.date}:{inst:'—',date:''}; }
  function key(){ const c=ctx(); return 'qdoc:mission:'+c.inst+':'+c.date; }
  function blank(){ return {psisNotes:['','','','',''], psisDone:null,
    brief:{situation:'',mission:'',execution:'',admin:'',command:'',closedAt:null,revisions:0},
    aar:{actual:'',mae:'',mfe:'',exitCW:'',gaps:[],change:'',savedAt:null}}; }
  function load(k){ try{ const v=JSON.parse(localStorage.getItem(k||key())||'null'); if(v){ const b=blank();
      return {psisNotes:v.psisNotes||b.psisNotes, psisDone:v.psisDone||null,
              brief:Object.assign(b.brief,v.brief||{}), aar:Object.assign(b.aar,v.aar||{})}; } }catch(_){}
    return blank(); }
  let M=null, mKey=null;
  function cur(){ const k=key(); if(mKey!==k){ mKey=k; M=load(k); } return M; }
  function save(){ try{ localStorage.setItem(mKey||key(),JSON.stringify(M)); }catch(_){} }
  function queueSave(){ clearTimeout(saveTimer); saveTimer=setTimeout(save,300); }

  // No-Brief-No-Trade seam (consumed by doctrine-tab.js ebLog)
  window.__quanBriefClosed=function(){ return !!cur().brief.closedAt; };

  // ---- PSIS auto-answers from engine state --------------------------------
  function psisAuto(){
    const s=st(); if(!s) return ['engine state unavailable','','','',''];
    const top=(s.scan||[]).slice(0,4).map(x=>fmt(x.k,1)+' '+x.cls+' '+x.grad+' '+x.score+'/10').join(' · ')||'no qualifying strikes';
    const cr=s.cr;
    const q1='Field state: '+(s.scan?s.scan.length:0)+' qualifying strikes. Map: '+top+'. '
      +'Book: DIDK '+fmt(s.glob&&s.glob.DIDK)+' DITK '+fmt(s.glob&&s.glob.DITK)+' DR3K '+fmt(s.glob&&s.glob.DR3K)+'.';
    const q2=cr?('Inherited Tension Vector: '+cr.prior.toUpperCase()+' prior'
      +(cr.dir!==0?(' '+(cr.dir>0?'BULLISH':'BEARISH')):'')+' — DIPLTR res '+fmt(cr.dip,4)
      +', '+cr.zcCount+' ZC (final ±'+fmt(cr.finalZC!=null?Math.abs(cr.finalZC):null,2)+(cr.potent?', potent':'')+'), entropy '+cr.entropy+'.')
      :'Inherited Tension: fold engine idle.';
    const q3=s.eb?('Temporal position: EB₀ '+fmt(s.eb.eb0,1)+' — '+s.eb.grade+'. Running '+fmt(s.ebRun,1)+'.')
      :'Temporal position: entropy budget unavailable.';
    const wm=(s.scan||[]).filter(x=>x.lr!=null&&x.lr>30).map(x=>fmt(x.k,1)).join(', ');
    const near=s.sel?fmt(s.sel.k,1):'—';
    const q4='NAI-1: approach of PDSL '+near+' (confirm/deny gradient hold). '
      +'NAI-2: live ZC quadrant vs inherited final-ZC wing. '
      +'NAI-3: entropy spike past 4 ZC (budget hit). '
      +(wm?('NAI-4: watermark test at LR>30 strikes '+wm+'.'):'');
    const vets=[];
    if(s.risq&&s.risq.veto) vets.push(s.risq.veto);
    if(s.coh&&s.coh.patterns.length) vets.push(s.coh.patterns.map(p=>'P'+p.id+' '+p.name).join('; '));
    if(s.ebRun!=null&&s.ebRun<=0) vets.push('entropy budget exhausted — observe only');
    if(s.cond<0.5) vets.push('condFactor '+fmt(s.cond,2)+' — no pre-session orders');
    const q5='Operational constraints: '+(vets.length?vets.join(' · '):'none active')+'.';
    return [q1,q2,q3,q4,q5];
  }
  const PSIS_Q=['1 · Field State','2 · Inherited Tension','3 · Temporal Position (EB)','4 · Named Areas of Interest','5 · Operational Constraints'];

  function briefSeeds(){
    const s=st(), auto=psisAuto();
    const situation=auto.join('\n');
    let execution='';
    if(s&&s.plan&&s.plan.layers&&s.plan.layers.length){
      execution=s.plan.layers.map(L=>L.layer+'\n  '+L.side+' '+L.size+' '+L.type+' @ '+L.entry+' · stop '+L.stop+' · target '+L.target+'\n  CANCEL: '+L.cancel).join('\n');
      execution+='\nABORT: coherence P3 activates; ℛ_F>4.0 at the anchor; EB reaches 0; prior reversed at CW −0.5.\nAnything not listed above is prohibited.';
    } else execution='No compiled order plan (see Console view) — write the authorized actions explicitly.';
    let admin='';
    if(s&&s.risq){
      const cost=(s.risq.rC!=null?s.risq.rC:1)+(s.risq.rI||0);
      const c18=cost*1.8;
      admin='Allocation '+fmt(s.risq.alloc,1)+' micro (ℛₓ '+fmt(s.risq.rx,1)+', Tier '+(s.risq.tier===5?'VETO':s.risq.tier)+').\n'
        +'EB_cost (A+B+C) = (ℛ_C+ℛ_I)×1.8 = '+fmt(c18,2)+' — '
        +(s.eb&&(s.ebRun-c18)>=0?'confirmed EB₀−cost ≥ 0':'EXCEEDS the running budget — reduce layers')+'.\n'
        +'Risq re-read checkpoints: CW −0.5, 0, +0.5.';
    }
    return {situation:situation, execution:execution, admin:admin};
  }

  // ---- rendering ----------------------------------------------------------
  function panel(title,body){ return '<div style="background:var(--panel);border-radius:var(--radius-md);padding:13px 15px;">'
    +'<div style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--dim);margin-bottom:8px">'+title+'</div>'+body+'</div>'; }
  function btn(id,label,dis){ return '<button class="rptbtn" id="'+id+'" type="button"'+(dis?' disabled':'')+'>'+label+'</button>'; }

  function renderMission(){
    const host=$('dcMission'); if(!host) return;
    const m=cur(), s=st(), auto=psisAuto();
    const closed=!!m.brief.closedAt;
    let h='';
    // mode banner
    h+='<div style="'+MONO+'padding:8px 12px;border-radius:var(--radius-sm);background:var(--panel);color:'+(closed?'#e8b53a':'#6fd3ff')+'">'
      +(closed?('GROUND LEAD — Brief closed '+new Date(m.brief.closedAt).toLocaleString()+' · execute or abort, no revision'
        +(m.brief.revisions?' · revisions '+m.brief.revisions:''))
        :'STRATEGIST — intelligence + planning window (Brief open)')+'</div>';
    // PSIS
    let pb='';
    for(let i=0;i<5;i++){
      pb+='<div style="margin-bottom:9px"><div style="'+MONO+'color:var(--gold);margin-bottom:3px">'+PSIS_Q[i]+'</div>'
        +'<div style="'+MONO+'color:var(--cream);white-space:pre-wrap;background:var(--panel2,#141414);border-radius:6px;padding:7px 9px;margin-bottom:4px">'+esc(auto[i])+'</div>'
        +'<textarea data-psis="'+i+'" placeholder="operator annotation…" style="'+TA+'min-height:34px"'+(closed?' readonly':'')+'>'+esc(m.psisNotes[i])+'</textarea></div>';
    }
    pb+='<div style="display:flex;gap:8px;align-items:center">'
      +btn('dmPsisDone',m.psisDone?'PSIS complete ✓':'Mark PSIS complete',closed)
      +'<span style="'+MONO+'color:var(--dim)">'+(m.psisDone?('completed '+new Date(m.psisDone).toLocaleString()):'No Mission Brief may be opened until the PSIS is complete.')+'</span></div>';
    h+=panel('PSIS — Pre-Session Intelligence Summary (auto-answered, annotate + confirm)',pb);

    // Mission Brief
    const BF=[['situation','1 · Situation — declarative field state only, no opinion'],
              ['mission','2 · Mission — exactly one sentence: claim, position, strike, rationale'],
              ['execution','3 · Execution — every authorized action; unlisted = prohibited'],
              ['admin','4 · Administration — sizing, EB cost check, max loss, CW checkpoints'],
              ['command','5 · Command & Signal — what forces reconsideration; abort-and-replan only']];
    if(!m.psisDone){ h+=panel('Mission Brief (OPORD)','<div style="'+MONO+'color:var(--dim)">Locked — complete the PSIS first.</div>'); }
    else{
      let bb='';
      for(const [f,label] of BF){
        bb+='<div style="margin-bottom:9px"><div style="'+MONO+'color:var(--gold);margin-bottom:3px">'+label+'</div>'
          +'<textarea data-brief="'+f+'" style="'+TA+'min-height:'+(f==='mission'?'34':'72')+'px"'+(closed?' readonly':'')+'>'+esc(m.brief[f])+'</textarea></div>';
      }
      bb+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
      if(!closed) bb+=btn('dmSeedSit','Seed Situation ← PSIS')+btn('dmSeedExe','Seed Execution ← order plan')+btn('dmSeedAdm','Seed Admin ← Risq/EB')
        +btn('dmClose','CLOSE BRIEF — switch to Ground Lead');
      else bb+=btn('dmAbort','Abort & Replan (reopen)')+'<span style="'+MONO+'color:var(--dim)">Closed brief is frozen — no in-mission revision.</span>';
      bb+='</div>';
      h+=panel('Mission Brief (OPORD) — No-Brief-No-Trade'+(closed?' · CLOSED':''),bb);
    }

    // AAR
    if(!closed&&!m.aar.savedAt){ h+=panel('After-Action Review','<div style="'+MONO+'color:var(--dim)">Available once a Brief has been closed (an unwritten Brief makes the AAR unperformable).</div>'); }
    else{
      let ab='<div style="'+MONO+'color:var(--gold);margin-bottom:3px">1 · What was planned (verbatim from the Brief)</div>'
        +'<div style="'+MONO+'color:var(--cream);white-space:pre-wrap;background:var(--panel2,#141414);border-radius:6px;padding:7px 9px;margin-bottom:9px;max-height:150px;overflow:auto">'
        +esc(BF.map(x=>x[1].split(' — ')[0]+'\n'+m.brief[x[0]]).join('\n\n'))+'</div>';
      ab+='<div style="'+MONO+'color:var(--gold);margin-bottom:3px">2 · What actually happened (facts only)</div>'
        +'<textarea data-aar="actual" placeholder="fills vs plan, layer fills/non-fills and why, exit…" style="'+TA+'min-height:60px">'+esc(m.aar.actual)+'</textarea>'
        +'<div style="display:flex;gap:8px;margin:6px 0 9px 0;flex-wrap:wrap">'
        +'<span style="'+MONO+'color:var(--dim);align-self:center">MAE</span><input data-aar="mae" class="panchor" style="width:80px" value="'+esc(m.aar.mae)+'">'
        +'<span style="'+MONO+'color:var(--dim);align-self:center">MFE</span><input data-aar="mfe" class="panchor" style="width:80px" value="'+esc(m.aar.mfe)+'">'
        +'<span style="'+MONO+'color:var(--dim);align-self:center">exit CW</span><input data-aar="exitCW" class="panchor" style="width:64px" value="'+esc(m.aar.exitCW)+'"></div>';
      ab+='<div style="'+MONO+'color:var(--gold);margin-bottom:3px">3 · Why they differed — one cause per gap</div>';
      for(let i=0;i<m.aar.gaps.length;i++){ const g=m.aar.gaps[i];
        ab+='<div style="display:flex;gap:8px;margin-bottom:5px"><input data-gap="'+i+'" placeholder="gap…" class="panchor" style="flex:1" value="'+esc(g.desc)+'">'
          +'<select data-gapcause="'+i+'" class="field"><option value="A"'+(g.cause==='A'?' selected':'')+'>A — Intelligence</option>'
          +'<option value="B"'+(g.cause==='B'?' selected':'')+'>B — Planning</option>'
          +'<option value="C"'+(g.cause==='C'?' selected':'')+'>C — Execution</option></select></div>'; }
      ab+='<div style="margin-bottom:9px">'+btn('dmAddGap','+ gap')+'</div>';
      ab+='<div style="'+MONO+'color:var(--gold);margin-bottom:3px">4 · Doctrine change — exactly one, before the next session</div>'
        +'<textarea data-aar="change" style="'+TA+'min-height:34px">'+esc(m.aar.change)+'</textarea>'
        +'<div style="margin-top:8px;display:flex;gap:8px;align-items:center">'+btn('dmSaveAar',m.aar.savedAt?'AAR saved ✓ (update)':'Save AAR')
        +'<span style="'+MONO+'color:var(--dim)">'+(m.aar.savedAt?('saved '+new Date(m.aar.savedAt).toLocaleString()):'')+'</span></div>';
      h+=panel('After-Action Review — plan · fact · cause · one change',ab);
    }
    host.innerHTML=h;
    wireMission(host);
  }

  function wireMission(host){
    const m=cur();
    host.querySelectorAll('[data-psis]').forEach(t=>t.addEventListener('input',()=>{ m.psisNotes[+t.dataset.psis]=t.value; queueSave(); }));
    host.querySelectorAll('[data-brief]').forEach(t=>t.addEventListener('input',()=>{ m.brief[t.dataset.brief]=t.value; queueSave(); }));
    host.querySelectorAll('[data-aar]').forEach(t=>t.addEventListener('input',()=>{ m.aar[t.dataset.aar]=t.value; queueSave(); }));
    host.querySelectorAll('[data-gap]').forEach(t=>t.addEventListener('input',()=>{ m.aar.gaps[+t.dataset.gap].desc=t.value; queueSave(); }));
    host.querySelectorAll('[data-gapcause]').forEach(t=>t.addEventListener('change',()=>{ m.aar.gaps[+t.dataset.gapcause].cause=t.value; queueSave(); }));
    const on=(id,fn)=>{ const b=$(id); if(b) b.addEventListener('click',fn); };
    on('dmPsisDone',()=>{ m.psisDone=Date.now(); save(); renderMission(); });
    on('dmSeedSit',()=>{ m.brief.situation=briefSeeds().situation; save(); renderMission(); });
    on('dmSeedExe',()=>{ m.brief.execution=briefSeeds().execution; save(); renderMission(); });
    on('dmSeedAdm',()=>{ m.brief.admin=briefSeeds().admin; save(); renderMission(); });
    on('dmClose',()=>{
      const missing=['situation','mission','execution','admin','command'].filter(f=>!String(m.brief[f]||'').trim());
      if(missing.length){ alert('All five paragraphs must be written before the Brief can close (missing: '+missing.join(', ')+').'); return; }
      m.brief.closedAt=Date.now(); save(); renderMission(); });
    on('dmAbort',()=>{ m.brief.closedAt=null; m.brief.revisions=(m.brief.revisions||0)+1; save(); renderMission(); });
    on('dmAddGap',()=>{ m.aar.gaps.push({desc:'',cause:'A'}); save(); renderMission(); });
    on('dmSaveAar',()=>{ m.aar.savedAt=Date.now(); save(); renderMission(); });
  }

  // ---- archive ------------------------------------------------------------
  function renderArchive(){
    const host=$('dcArchive'); if(!host) return;
    const pre='qdoc:mission:', items=[];
    try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
      if(k&&k.indexOf(pre)===0){ const p=k.slice(pre.length).split(':'); const v=load(k);
        items.push({key:k,inst:p[0],date:p[1]||'',mission:(v.brief.mission||'').trim(),closed:!!v.brief.closedAt,aar:!!v.aar.savedAt,rev:v.brief.revisions||0}); } } }catch(_){}
    items.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.inst.localeCompare(b.inst));
    let h='';
    if(!items.length) h=panel('Mission archive','<div style="'+MONO+'color:var(--dim)">No missions recorded yet.</div>');
    else{
      let t='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;'+MONO+'"><thead><tr>'
        +['inst','date','mission','brief','AAR','rev'].map(x=>'<th style="text-align:left;padding:3px 8px;color:var(--dim);font-weight:600;border-bottom:.5px solid var(--line)">'+x+'</th>').join('')+'</tr></thead><tbody>';
      for(const it of items){ t+='<tr><td style="padding:3px 8px;color:var(--cream)">'+esc(it.inst)+'</td><td style="padding:3px 8px;color:var(--cream)">'+esc(it.date)+'</td>'
        +'<td style="padding:3px 8px;color:var(--cream);max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(it.mission||'—')+'</td>'
        +'<td style="padding:3px 8px;color:'+(it.closed?'#3f9d6b':'#999')+'">'+(it.closed?'closed':'open')+'</td>'
        +'<td style="padding:3px 8px;color:'+(it.aar?'#3f9d6b':'#999')+'">'+(it.aar?'✓':'—')+'</td>'
        +'<td style="padding:3px 8px;color:var(--cream)">'+it.rev+'</td></tr>'; }
      t+='</tbody></table></div>';
      t+='<div style="'+MONO+'color:var(--dim);margin-top:8px">Weekly aggregate AAR (Sunday): do failures cluster by IPS layer, by trade type / Risq dimension, or correlate with a measurable state at the open? One paragraph each — see PRAQ in the Desk Wiki.</div>';
      h=panel('Mission archive — '+items.length+' session'+(items.length===1?'':'s'),t);
    }
    host.innerHTML=h;
  }

  // ---- hooks --------------------------------------------------------------
  window.__missionRender=function(view){ if(view==='mission') renderMission(); else if(view==='archive') renderArchive(); };
  window.__missionOnState=function(){ const v=$('dcView'); if(!v||v.value!=='mission') return;
    const host=$('dcMission'); if(!host||host.style.display==='none') return;
    const ae=document.activeElement; if(ae&&host.contains(ae)) return;   // never clobber active typing
    renderMission(); };
})();
