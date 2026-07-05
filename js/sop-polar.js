(function(){
  const $=id=>document.getElementById(id);
  if(!$('pAnchor')) return;   // Field Study tab not present on this page
  let ready=false, lastRW=null;
  let lastRipn=null;                 // RIPN handshake inspection data from the last compute()
  let _ripnSel=Object.create(null);  // operator-selected anchor row, keyed per (instrument|session)

  const sessT=cw=>(cw+1)/2;
  const fmt=v=>(v>=0?'+':'')+v.toFixed(4), fmt0=v=>v.toFixed(4);
  // ===== Qu'an engine (ingest_chain + realization_waves) — JS port, validated bit-for-bit vs Python =====
  function cleanNum(s){ if(s==null) return NaN; s=String(s).replace(/,/g,'').replace(/s$/,'').trim();
    if(s===''||s==='N/A'||s==='nan'||s==='None') return NaN; const v=parseFloat(s); return isFinite(v)?v:NaN; }
  function parseCsvLine(line){ const out=[]; let cur='',q=false;
    for(let i=0;i<line.length;i++){ const c=line[i];
      if(q){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
      else { if(c==='"') q=true; else if(c===','){ out.push(cur); cur=''; } else cur+=c; } }
    out.push(cur); return out; }
  function ingestChain(text){
    const lines=text.replace(/\r/g,'').split('\n').filter(l=>l.length);
    const head=parseCsvLine(lines[0]).map(h=>h.replace(/^﻿/,'').replace(/^"|"$/g,'').trim());
    const nth=(name,k)=>{ let c=0; for(let i=0;i<head.length;i++){ if(head[i]===name){ if(c===k) return i; c++; } } return -1; };
    const ix={strike:nth('Strike',0),callPrem:nth('Premium',0),putPrem:nth('Premium',1),
      callOI:nth('Open Int',0),putOI:nth('Open Int',1)};
    if(ix.strike<0||ix.callPrem<0||ix.putPrem<0||ix.callOI<0||ix.putOI<0) return null;
    const rows=[];
    for(let i=1;i<lines.length;i++){ const f=parseCsvLine(lines[i]); const strike=cleanNum(f[ix.strike]); if(!isFinite(strike)) continue;
      rows.push({strike,callPrem:cleanNum(f[ix.callPrem]),putPrem:cleanNum(f[ix.putPrem]),callOI:cleanNum(f[ix.callOI]),putOI:cleanNum(f[ix.putOI])}); }
    rows.sort((a,b)=>a.strike-b.strike); return rows;
  }
  function percentile(sorted,p){ const n=sorted.length; if(n===0) return NaN; if(n===1) return sorted[0];
    const rank=p/100*(n-1), lo=Math.floor(rank), frac=rank-lo; if(lo+1>=n) return sorted[n-1]; return sorted[lo]+frac*(sorted[lo+1]-sorted[lo]); }
  const CW_STEPS=21, DT=0.1, BI_CLIP=5.0, PAIR_ROWS=11;
  // RIPN_METHOD — canonical Chronometer initialization (Quanyun, 2026-06-26). 'golden' = Golden-Reference:
  // RAW RIPN min-max, anchor = a RIPN row (auto = first 0/1, or operator handshake), FORWARD window ai..ai+20,
  // Book _step edge rule (k=20 divides by -1). 'atm' = LEGACY: winsorized RIPN (BI_CLIP=5) + ATM-centered
  // window — kept behind this flag for side-by-side validation vs the workbook, retire once confirmed.
  let RIPN_METHOD='golden';
  function realizationWaves(rows, anchor, anchorIdx){
    const n=rows.length; if(n<17) return null; const fz=v=>(v==null||!isFinite(v))?0:v;
    const strikes=rows.map(r=>r.strike); const ap=new Array(n);
    for(let i=0;i<n;i++){ const netOI=fz(rows[i].putOI)-fz(rows[i].callOI), netPrem=fz(rows[i].putPrem)-fz(rows[i].callPrem);
      ap[i]=(netOI!==0&&netPrem!==0)?netPrem/netOI:NaN; }
    const bh0=ap.map(v=>Math.abs(v)); const valid=bh0.filter(v=>isFinite(v)); if(valid.length<5) return null;
    let bh=bh0, lo, hi;
    if(RIPN_METHOD==='atm' && BI_CLIP>0){ const s=valid.slice().sort((a,b)=>a-b); lo=percentile(s,BI_CLIP); hi=percentile(s,100-BI_CLIP); bh=bh0.map(v=>isFinite(v)?Math.min(Math.max(v,lo),hi):v); }
    else { lo=Math.min(...valid); hi=Math.max(...valid); }   // golden = raw min-max (no winsorize)
    const rng=hi-lo; const bi=bh.map(v=>isFinite(v)?(rng>0?(v-lo)/rng:0):NaN);
    const br=new Array(n-1).fill(NaN); for(let i=0;i<n-1;i++) if(isFinite(bi[i])&&isFinite(bi[i+1])) br[i]=bi[i+1]-bi[i];
    const cw=[]; for(let k=0;k<CW_STEPS;k++) cw.push(Math.round((k*0.1-1.0)*1e10)/1e10);
    const cwStep=k=>{ const nxt=(k+1)<CW_STEPS?cw[k+1]:0.0; return nxt-cw[k]; };   // 0.1; Book edge cell k=20 = -1.0
    // AUTO anchor: golden = first RIPN 0/1 row (Book handshake); atm = nearest strike to price
    let auto_ai=-1;
    if(RIPN_METHOD==='atm'){ let best=Infinity; for(let i=0;i<n;i++){ const d=Math.abs(strikes[i]-anchor); if(d<best){best=d;auto_ai=i;} } }
    else { for(let i=0;i<n;i++){ if(bi[i]===0.0||bi[i]===1.0){ auto_ai=i; break; } } }
    // OPERATOR HANDSHAKE: anchorIdx overrides the auto pick when valid (the RIPN-row selection)
    let ai=auto_ai, manual=false;
    if(anchorIdx!=null){ const ix=Math.trunc(anchorIdx); if(ix>=0&&ix<n&&isFinite(bi[ix])){ ai=ix; manual=true; } }
    if(ai<0) return null;
    const cc=new Array(CW_STEPS).fill(0), cd=new Array(CW_STEPS).fill(0); let covered;
    if(RIPN_METHOD==='atm'){
      const base=ai-(CW_STEPS>>1);
      for(let k=0;k<CW_STEPS;k++){ const a=base+k,b=base+k+1; if(a>=0&&a<br.length&&b>=0&&b<br.length&&isFinite(br[a])&&isFinite(br[b])) cc[k]=(br[b]-br[a])/DT; }
      for(let k=0;k<CW_STEPS-1;k++) cd[k]=(cc[k+1]-cc[k])/DT;
      covered=(base>=0&&base+CW_STEPS<br.length);
    } else {
      // GOLDEN — forward derivative chain from the anchor row, Book _step edge rule (matches Python exactly)
      for(let k=0;k<CW_STEPS;k++){ const a=ai+k,b=ai+k+1,d=cwStep(k); if(a>=0&&a<br.length&&b>=0&&b<br.length&&isFinite(br[a])&&isFinite(br[b])&&d!==0) cc[k]=(br[b]-br[a])/d; }
      for(let k=0;k<CW_STEPS;k++){ const d=cwStep(k); const cc_next=(k+1)<CW_STEPS?cc[k+1]:0.0; cd[k]=d!==0?(cc_next-cc[k])/d:0.0; }
      covered=(ai+CW_STEPS)<=br.length;
    }
    // pairs: fold the 21-cell axis from opposite ends toward center (golden-reference TSC(Curvature) schema)
    //   sop=Sum of Pairs, pm=Pairs Multiplied, pd=Pairs Divided, dip=Difference In Pairs Left-to-Right (DIPLTR)
    const pairs=B=>{ const sop=[],pm=[],pd=[],dip=[]; for(let nn=0;nn<PAIR_ROWS;nn++){ const hival=B[nn],loval=B[20-nn];
      sop.push(hival+loval); pm.push(hival*loval); pd.push(loval!==0?hival/loval:0); dip.push(hival-loval); } return {sop,pm,pd,dip}; };
    const pG=pairs(cc), pC=pairs(cd);
    const sopG=pG.sop, sopC=pC.sop; const fold=sopG.map((g,i)=>g*sopC[i]);
    const cross=[]; for(let i=1;i<PAIR_ROWS;i++){ if(fold[i]===0) continue; const sc=Math.sign(fold[i]), sp=Math.sign(fold[i-1]); if(sc!==0&&sp!==0&&sc!==sp) cross.push(Math.round(cw[i]*100)/100); }
    // ---- Field Study derivations (golden-reference TSC(Curvature) schema; gradient pairing used as canonical) ----
    const ds=pG.sop.map((s,i)=>s!==0?pG.dip[i]/s:0);                    // Difference/Sum (the "DS" sheet)
    const soppm=pG.sop.map((s,i)=>pG.pm[i]!==0?s/pG.pm[i]:0);           // Sum of Pairs / Pairs Multiplied
    const diplTRpd=pG.pd.map((d,i)=>d!==0?pG.dip[i]/d:0);               // DIPLTR / Pairs Divided
    const swf=soppm.map((s,i)=>s!==0?diplTRpd[i]/s:0);                  // SWF: DIPLTRPD/SOPPM chain
    function dphase(A,B){ const nn=A.length; const out=[]; for(let k=0;k<nn-1;k++){ const s1=A[k]+A[k+1],s2=B[k]+B[k+1];
      const num=s1!==0?(A[k+1]-A[k])/s1:0, den=s2!==0?(B[k+1]-B[k])/s2:0; out.push(den!==0?num/den:0); } out.push(0); return out; }
    const dp21=dphase(cc,cd); const dualPhase=[]; for(let nn=0;nn<PAIR_ROWS;nn++) dualPhase.push(dp21[nn]);   // the "Dual Phase" sheet
    // RIPN inspection rows for the handshake panel: [idx, strike, RIPN[0,1], AP, tuning(BR)]
    const ripn_rows=[]; for(let r=0;r<n;r++) ripn_rows.push([r, strikes[r], (isFinite(bi[r])?bi[r]:null), (isFinite(ap[r])?ap[r]:null), (r<br.length&&isFinite(br[r])?br[r]:null)]);
    return {cw,cc,cd,sopG,sopC,fold,cross,ds,dualPhase,swf,atm_strike:strikes[ai],anchor_strike:strikes[ai],n_strikes:n,covered,
            ripn_rows,auto_idx:auto_ai,used_idx:ai,manual_anchor:manual,method:RIPN_METHOD};
  }

  function compute(text, anchor, anchorIdx){
    if(!(anchor>0)) return {err:'Enter the session-open anchor price.'};
    const rows=ingestChain(text);
    if(!rows) return {err:'Not a Barchart side-by-side chain (need Strike / Premium / Open Int columns).'};
    if(rows.length<17) return {err:'Need ≥17 strikes (got '+(rows?rows.length:0)+').'};
    const rw=realizationWaves(rows, anchor, anchorIdx);
    if(!rw) return {err:'Engine could not resolve a pressure field from this chain.'};
    lastRW=rw;   // engine-exact 11-pair-row waves for the Field Study tab
    // RIPN handshake inspection data (Quanyun) — the operator's view of the initialization point
    lastRipn={rows:rw.ripn_rows, auto:rw.auto_idx, used:rw.used_idx, manual:rw.manual_anchor,
              anchor_strike:rw.anchor_strike, method:rw.method, n:rw.n_strikes};
    const _degen=!rw.fold.some(x=>Math.abs(x)>1e-9);
    const _alabel=(rw.method==='atm'?'ATM ':'anchor ')+rw.anchor_strike.toFixed(0)+(rw.method==='atm'?'':(rw.manual_anchor?' (handshake)':' (auto)'));
    return {ok:true, degenerate:_degen, src:'engine · '+rw.method+' · '+_alabel+' · '+rw.n_strikes+' strikes · coherence breaks CW '+(rw.cross.length?rw.cross.join(', '):'none')+(rw.covered?'':' · ⚠ window not fully covered')};
  }

  // ---- Headline / Field Study toggle ----
  let pmode='head';
  const headView=$('pHeadView'), fieldView=$('pFieldView');
  function setPMode(m){ pmode=m;
    const _sel=$('pViewSel'); if(_sel&&_sel.value!==m)_sel.value=m;
    if(headView)headView.style.display=(m==='head')?'flex':'none';
    if(fieldView)fieldView.style.display=(m==='field')?'flex':'none';
    if(window.__sopResize) window.__sopResize();
  }
  { const pvSel=$('pViewSel'); if(pvSel)pvSel.addEventListener('change',()=>setPMode(pvSel.value)); }
  try{ setPMode('head'); }catch(_e){}

  let _lastCsv=null;
  // Per-instrument data is owned centrally by the header hub (window.__q*). This tab is a render target.
  window.__polarClear=function(){ _lastCsv=null; ready=false; lastRW=null;
    $('pFn').textContent='no session loaded'; const s=$('pSrc'); if(s){s.textContent='no session loaded'; s.style.color='#8f8c82';} showAnchorPrompt(null); emitSop(); };
  window.__polarSetAnchor=function(v){ $('pAnchor').value=(v==null?'':v); if(_lastCsv!=null) runEngine(); };
  // ---- engine-exact SOP panel data for the Field Study tab (golden 'SOP Folding' sheet formulas) ----
  function emitSop(){ window.dispatchEvent(new CustomEvent('quan:sop')); }
  window.__sopData=function(){ const rw=lastRW; if(!ready||!rw) return null;
    const g=rw.sopG,c=rw.sopC,J=rw.fold,n=g.length, pair=[],tension=[],pcurv=[],gc=[],cg=[];
    for(let i=0;i<n;i++){ pair.push(Math.round(i*0.1*1e10)/1e10);
      const Jn=J[i],Jx=(i+1<n?J[i+1]:0); tension.push(Jn+Jx); pcurv.push(Jx-Jn);   // K=J+next, L=Jnext-J
      gc.push(c[i]!==0?g[i]/c[i]:0); cg.push(g[i]!==0?c[i]/g[i]:0); }                 // H=SOPG/SOPC, I=SOPC/SOPG
    return {pair,sopG:g,sopC:c,product:J,tension,pcurv,gc,cg,
      ds:rw.ds, dualPhase:rw.dualPhase, swf:rw.swf,                        // Field Study: DS / Dual Phase / SWF
      cw:rw.cw,pg:rw.cc,pc:rw.cd,                                 // 21-cell pressure gradient/curvature
      atm:rw.atm_strike,n_strikes:rw.n_strikes,covered:rw.covered,cross:rw.cross}; };
  function showAnchorPrompt(msg){ const el=$('pAnchorPrompt'); if(!el) return;
    if(msg){ const m=$('pAnchorPromptMsg'); if(m) m.textContent=msg; el.style.display='flex'; } else el.style.display='none'; }
  function runEngine(){ if(_lastCsv==null){ showAnchorPrompt(null); lastRW=null; lastRipn=null; ready=false; emitSop(); window.dispatchEvent(new CustomEvent('quan:ripn')); return; } const anchor=parseFloat($('pAnchor').value);
    const _sel=_ripnSel[_ripnKey()];
    const res=compute(_lastCsv, anchor, (_sel==null?null:_sel));
    const srcEl=$('pSrc');
    if(res.err){ if(srcEl){srcEl.textContent=res.err; srcEl.style.color='#e07a6a';} showAnchorPrompt(res.err); ready=false; lastRW=null; lastRipn=null; emitSop(); window.dispatchEvent(new CustomEvent('quan:ripn')); return; }
    if(srcEl){ srcEl.style.color='#6f675a'; srcEl.textContent=res.src; }
    showAnchorPrompt(res.degenerate ? "This expiry's ATM open interest is empty — pressure field can't resolve. Toggle to the other expiry (Daily/EOM), or load an EOD/settlement chain." : null);
    ready=true; emitSop(); window.dispatchEvent(new CustomEvent('quan:ripn')); }
  // ---- RIPN HANDSHAKE bridge (Quanyun): the operator's reference-sample selection drives the whole chain ----
  function _ripnKey(){ try{ const a=window.__qActiveChain&&window.__qActiveChain(); if(a&&a.inst) return a.inst+'|'+(a.date||''); }catch(_){} return '_default'; }
  window.__ripnData=function(){ return lastRipn; };                       // {rows:[idx,strike,RIPN,AP,tuning], auto, used, manual, anchor_strike, method, n}
  window.__ripnPick=function(idx){ const k=_ripnKey(); if(idx==null||idx<0) delete _ripnSel[k]; else _ripnSel[k]=idx|0; if(_lastCsv!=null) runEngine(); };
  window.__ripnAuto=function(){ window.__ripnPick(null); };
  window.__ripnGlobal=(window.QuanRipnTuning?window.QuanRipnTuning.create({responsiveness:1,sensitivity:0,smoothing:0.2,weighting:1}):null);
  window.__ripnCfg=function(inst){ try{ if(!window.__ripnGlobal) return null; return inst?window.__ripnGlobal.forInstrument(inst):window.__ripnGlobal.global(); }catch(_){ return null; } };               // reset to the auto-suggested anchor
  // ---- RIPN handshake panel: the parsed RIPN column as a clickable table (Quanyun's primary interface) ----
  (function(){
    const $r=id=>document.getElementById(id);
    const fz=(v,d)=>(v==null||!isFinite(v))?'—':(+v).toFixed(d);
    const fAP=v=>{ if(v==null||!isFinite(v)) return '—'; const a=Math.abs(v); return (v<0?'−':'')+(a>=1e6?(a/1e6).toFixed(1)+'M':a>=1e3?(a/1e3).toFixed(0)+'k':a.toFixed(0)); };
    function render(){
      const p=$r('ripnPanel'); if(!p) return; const head=$r('ripnHead'), tbl=$r('ripnTbl');
      const d=window.__ripnData&&window.__ripnData();
      if(!d||!d.rows||!d.rows.length){ if(head)head.textContent='No chain loaded — the RIPN column appears once the engine has a chain + anchor.'; if(tbl)tbl.innerHTML=''; return; }
      const auto=d.auto, used=d.used;
      head.innerHTML='anchor <b style="color:var(--cream)">'+(d.anchor_strike!=null?(+d.anchor_strike).toFixed(0):'—')+'</b> · '
        +(d.manual?'<span style="color:#e8b53a">handshake</span>':'<span style="color:#6fd3ff">auto</span>')
        +' · row '+used+(auto>=0&&auto!==used?' · auto was '+auto:'')+' · '+d.n+' strikes';
      let h='<thead><tr>'+['#','strike','RIPN','AP','tuning'].map(x=>'<th style="position:sticky;top:0;background:#26262d;text-align:right;padding:3px 7px;color:#8f8c82;font-weight:600;font-size:9.5px;border-bottom:0.5px solid #3a3a42">'+x+'</th>').join('')+'</tr></thead><tbody>';
      for(const r of d.rows){ const idx=r[0],strike=r[1],ripn=r[2],ap=r[3],tun=r[4];
        const isAuto=idx===auto, isUsed=idx===used, anchorRipn=(ripn===0||ripn===1);
        const mark=isUsed?'<span style="color:#e8b53a">▸</span> ':(isAuto?'<span style="color:#6fd3ff">·</span> ':'');
        h+='<tr data-idx="'+idx+'" class="ripnRow" style="cursor:pointer;'+(isUsed?'background:#3a3320':'')+'">'
          +'<td style="text-align:right;padding:2px 7px;color:#8f8c82">'+mark+idx+'</td>'
          +'<td style="text-align:right;padding:2px 7px;color:var(--cream)">'+(+strike).toFixed(0)+'</td>'
          +'<td style="text-align:right;padding:2px 7px;color:'+(anchorRipn?'#e8b53a':'var(--cream-dim)')+'">'+fz(ripn,3)+'</td>'
          +'<td style="text-align:right;padding:2px 7px;color:#8f8c82">'+fAP(ap)+'</td>'
          +'<td style="text-align:right;padding:2px 7px;color:#8f8c82">'+fz(tun,3)+'</td></tr>'; }
      tbl.innerHTML=h+'</tbody>';
      tbl.querySelectorAll('.ripnRow').forEach(tr=>tr.addEventListener('click',()=>{ const i=parseInt(tr.getAttribute('data-idx'),10); if(isFinite(i)&&window.__ripnPick) window.__ripnPick(i); }));
      const sel=tbl.querySelector('tr[data-idx="'+used+'"]'); if(sel&&sel.scrollIntoView){ try{ sel.scrollIntoView({block:'center'}); }catch(_){} }
    }
    function bind(){ const t=$r('ripnToggle'),c=$r('ripnClose'),a=$r('ripnAutoBtn'),g=$r('ripnGo'),inp=$r('ripnIdxInput'),p=$r('ripnPanel');
      if(t&&!t.__b){ t.__b=1; t.addEventListener('click',()=>{ if(!p)return; const show=(p.style.display==='none'||!p.style.display); p.style.display=show?'flex':'none'; if(show) render(); }); }
      if(c&&!c.__b){ c.__b=1; c.addEventListener('click',()=>{ if(p)p.style.display='none'; }); }
      if(a&&!a.__b){ a.__b=1; a.addEventListener('click',()=>{ window.__ripnAuto&&window.__ripnAuto(); }); }
      if(g&&!g.__b){ g.__b=1; g.addEventListener('click',()=>{ const v=parseInt(inp.value,10); if(isFinite(v)&&window.__ripnPick) window.__ripnPick(v); }); }
      if(inp&&!inp.__b){ inp.__b=1; inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ const v=parseInt(inp.value,10); if(isFinite(v)&&window.__ripnPick) window.__ripnPick(v); } }); }
      ['responsiveness','sensitivity','smoothing','weighting'].forEach(function(kk){ var sl=$r('ripnTune_'+kk); if(sl&&!sl.__b){ sl.__b=1; sl.addEventListener('input',function(){ var val=parseFloat(sl.value); if(window.__ripnGlobal&&window.__ripnGlobal.set) window.__ripnGlobal.set(kk,val); var vv=$r('ripnTune_'+kk+'_v'); if(vv) vv.textContent=val.toFixed(2); try{ window.dispatchEvent(new CustomEvent('quan:ripn-tune',{detail:(window.__ripnCfg?window.__ripnCfg():null)})); }catch(_){} }); } });
    }
    window.addEventListener('quan:ripn', render);
    bind(); if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', bind);
  })();
  window.__polarLoadChain=function(text,name){ $('pFn').textContent=name; _lastCsv=text; runEngine(); };
  $('pFile').addEventListener('change',e=>{const f=e.target.files[0]; if(!f) return; const r=new FileReader();
    r.onload=ev=>{ if(window.__qLoadChain) window.__qLoadChain(ev.target.result,f.name); else window.__polarLoadChain(ev.target.result,f.name); }; r.readAsText(f); });
  $('pAnchor').addEventListener('change',()=>{ if(window.__qSetAnchor) window.__qSetAnchor($('pAnchor').value); else runEngine(); });
  let anchorLocked=false;
  $('pLock').addEventListener('click',()=>{ anchorLocked=!anchorLocked;
    $('pAnchor').disabled=anchorLocked;
    $('pLock').classList.toggle('locked',anchorLocked);
    $('pLock').innerHTML=anchorLocked?'&#128274;':'&#128275;';
    $('pLock').title=anchorLocked?'Anchor locked for session — click to unlock':'Lock anchor for the session'; });

  let booted=false;
  window.__polarBoot=function(){ if(booted) return; booted=true; if(window.__sopResize) window.__sopResize(); };
})();

(function(){
  const $=id=>document.getElementById(id);
  const canvas=$('skcv'),overlay=$('skoverlay'),ctx=canvas.getContext('2d'),octx=overlay.getContext('2d'),
        dotTip=$('skDotTip'),chartwrap=canvas.parentElement;
  const ORDC={1:'#e8b53a',2:'#6fd3ff',3:'#c9a0ff',4:'#f06a6a',5:'#5fcf8f',6:'#ff9a4d',7:'#9fb0ff',8:'#ff7fd0',9:'#d4c47a'};
  const RAWC='#f5f1e6', STATEC='#7fd1e0', ANCHC='#d6aaa2';
  // canonical column reference (deepstrikenq schema, Strike excluded) — dropdown always lists these
  const REF_COLS=["Net Premium","Dealer Premium Time","Dealer Posture Ratio","Dealer Posture Ratio/Dealer Premium Time",
    "Dealer Inventory Distribution Ratio","Dealer Postured Time/DID","Did Underlying State Implications",
    "Dealer Inventory Transaction Ratio","Transaction Flows","Dealer Risk Realization Ratio","Realization State Implications",
    "Dealer Posture to Intent Ratio","Dealer Posture to Transaction Ratio","Dealer Posture to Risk Ratio"];
  // OI Map views (chain-derived per-strike), golden/dealer basis: net = putOI - callOI
  const EXTRA_COLS=["Net OI (puts\u2212calls)","Total OI (calls+puts)"];
  const REF_SET=new Set(REF_COLS.map(s=>s.toLowerCase().replace(/[^a-z0-9]/g,'')));
  const EXTRA_SET=new Set(EXTRA_COLS);

  let header=[], rawRows=[], data=[], xIdx=0, cols=[], curCol=null;
  let pts=[], statePts=[], isState=false, xExt=null, fitCache={};
  let viewLo=0,viewHi=1,yLo=0,yHi=1, cursor=null, anchorVal=NaN, anchorLocked=false;
  let barMode=false, barSigned=false;
  let pgMode=false, pgData=null, gammaWalls=[], chainPG=[], greeksText=null;
  const PG_VIEW='Pressure \u2192 Gravity';
  // per-instrument data owned centrally by the header hub (window.__q*); this tab is a render target.
  const chainOI={}; let greekLevels=[], chainAP=[];
  const PAD_L=58,PAD_R=22,PAD_T=26,PAD_B=36;
  const nrm=s=>String(s).toLowerCase().replace(/\s+/g,' ').trim();

  function parseCSV(text){ const rows=[]; let row=[],cell='',q=false;
    for(let i=0;i<text.length;i++){const c=text[i];
      if(q){ if(c==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=c; }
      else { if(c==='"')q=true; else if(c===','){row.push(cell);cell='';}
        else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
        else if(c==='\r'){} else cell+=c; } }
    if(cell.length||row.length){row.push(cell);rows.push(row);} return rows; }
  function num(v){ if(v==null)return NaN; let s=String(v).replace(/,/g,'').replace(/"/g,'').trim();
    if(s.endsWith('s'))s=s.slice(0,-1); if(s===''||s==='-')return NaN; const n=parseFloat(s); return isFinite(n)?n:NaN; }

  function safediv(a,b){ return (!isFinite(a)||!isFinite(b)||b===0)?NaN:a/b; }
  function findCol(hdr,name,lo,hi){ const t=name.toLowerCase(); for(let i=lo;i<hi;i++) if((hdr[i]||'').toLowerCase().trim()===t) return i; return -1; }

  function ingest(text){
    const rows=parseCSV(text).filter(r=>r.length>1); if(!rows.length) return false;
    const rawHeader=rows[0].map(h=>String(h).replace(/^\ufeff/,'').trim());
    const low=rawHeader.map(h=>h.toLowerCase());
    const isChain = low.includes('type') && low.includes('open int') && low.includes('premium') && low.includes('strike');
    if(isChain) return ingestChain(rows,rawHeader);
    // pre-computed strike-field export
    header=rawHeader;
    rawRows=rows.slice(1).map(r=>header.map((_,i)=>r[i]==null?'':r[i]));
    data=rawRows.map(r=>r.map(num));
    xIdx=header.findIndex(h=>/^strike$/i.test(h)); if(xIdx<0)xIdx=0;
    finishLoad(); return true;
  }

  // Compute the 14 dealer-field columns from a raw Barchart side-by-side chain,
  // using the golden_reference Book formulas (chain-only; no relativistic deps).
  function ingestChain(rows,rh){
    const low=rh.map(h=>h.toLowerCase().trim());
    const sIdx=low.indexOf('strike');
    const cLatest=findCol(rh,'Latest',0,sIdx), cVol=findCol(rh,'Volume',0,sIdx), cOI=findCol(rh,'Open Int',0,sIdx), cPrem=findCol(rh,'Premium',0,sIdx);
    const pLatest=findCol(rh,'Latest',sIdx+1,rh.length), pVol=findCol(rh,'Volume',sIdx+1,rh.length), pOI=findCol(rh,'Open Int',sIdx+1,rh.length), pPrem=findCol(rh,'Premium',sIdx+1,rh.length);
    for(const k in chainOI) delete chainOI[k];
    const recs=[];
    for(const r of rows.slice(1)){ const strike=num(r[sIdx]); if(!isFinite(strike))continue;
      const g=i=>{ if(i<0)return 0; const v=num(r[i]); return isFinite(v)?v:0; };
      const cP=g(cPrem),pP=g(pPrem),cO=g(cOI),pO=g(pOI),cV=g(cVol),pV=g(pVol),cLt=g(cLatest),pLt=g(pLatest);
      const K=pLt-cLt, L=pV-cV, O=pO-cO, P=O-L, AO=pP-cP;
      const AP=AO*K, AQ=safediv(AO,P), AS=safediv(AO,O), AV=safediv(AO,L);
      const AR=safediv(AQ,AP), AT=safediv(AR,AS), AX=safediv(AS,AV), AZ=safediv(AQ,AS), BA=safediv(AQ,AV), BB=safediv(AQ,AX);
      // Liquidity Ratio T (golden col U): (NetOI/PCR_OI)/(NetVol/PCR_Vol)
      const liqT=safediv(safediv(O,safediv(pO,cO)), safediv(L,safediv(pV,cV)));
      chainOI[strike]=[cO,pO];
      recs.push({strike,AO,AP,AQ,AR,AS,AT,AV,AX,AZ,BA,BB,netOI:(pO-cO),totOI:(pO+cO),liqT}); }
    // state flips (sign change vs previous row; blank breaks)
    const flip=key=>{ const out=new Array(recs.length).fill(''); let prev=null;
      for(let i=0;i<recs.length;i++){ const v=recs[i][key];
        if(isFinite(v)&&prev!=null&&isFinite(prev)&&((v>0&&prev<0)||(v<0&&prev>0))) out[i]='State Flip';
        prev=isFinite(v)?v:null; } return out; };
    const fAS=flip('AS'), fAV=flip('AV'), fAX=flip('AX');
    // per-strike AP (= netPrem/netOI = DID) sorted by strike, for the realization-fold energy
    chainAP=recs.map(r=>({strike:r.strike, ap:((r.netOI!==0&&r.AO!==0)?r.AO/r.netOI:NaN)})).sort((a,b)=>a.strike-b.strike);
    chainPG=recs.map(r=>({strike:r.strike, did:r.AS, dit:r.AV, dr3:r.AX, netOI:r.netOI, liqT:r.liqT})).sort((a,b)=>a.strike-b.strike);
    // synthesize a strike-field table with the canonical column names
    const NAMES=["Strike"].concat(REF_COLS).concat(EXTRA_COLS);
    const map={"Net Premium":"AO","Dealer Premium Time":"AP","Dealer Posture Ratio":"AQ",
      "Dealer Posture Ratio/Dealer Premium Time":"AR","Dealer Inventory Distribution Ratio":"AS",
      "Dealer Postured Time/DID":"AT","Dealer Inventory Transaction Ratio":"AV",
      "Dealer Risk Realization Ratio":"AX","Dealer Posture to Intent Ratio":"AZ",
      "Dealer Posture to Transaction Ratio":"BA","Dealer Posture to Risk Ratio":"BB",
      "Net OI (puts\u2212calls)":"netOI","Total OI (calls+puts)":"totOI"};
    const stateMap={"Did Underlying State Implications":fAS,"Transaction Flows":fAV,"Realization State Implications":fAX};
    header=NAMES.slice();
    rawRows=recs.map((rec,ri)=>NAMES.map(nm=>{
      if(nm==='Strike') return String(rec.strike);
      if(stateMap[nm]) return stateMap[nm][ri];
      const k=map[nm]; const v=rec[k]; return isFinite(v)?String(v):''; }));
    data=rawRows.map(r=>r.map(num));
    xIdx=0; finishLoad(); return true;
  }

  function finishLoad(){
    const fileIdx={}; header.forEach((h,i)=>{ if(i===xIdx)return; const k=nrm(h); if(fileIdx[k]==null)fileIdx[k]=i; });
    const order=[], seen=new Set();
    REF_COLS.forEach(nm=>{ const k=nrm(nm); if(seen.has(k))return; seen.add(k); order.push({name:nm,idx:fileIdx[k]!=null?fileIdx[k]:-1}); });
    header.forEach((h,i)=>{ if(i===xIdx)return; const k=nrm(h); if(seen.has(k))return; seen.add(k); order.push({name:h,idx:i}); });
    cols=order.map(o=>{ let numeric=false,hasTxt=false,hasData=false;
      if(o.idx>=0){ numeric=data.some(r=>isFinite(r[o.idx]));
        hasTxt=rawRows.some(r=>{const v=(r[o.idx]||'').trim();return v!==''&&!isFinite(num(v));});
        hasData=numeric||rawRows.some(r=>(r[o.idx]||'').trim()!==''); }
      return {idx:o.idx,name:o.name,numeric,state:(!numeric&&hasTxt),hasData}; });
    const xs=data.map(r=>r[xIdx]).filter(isFinite);
    xExt=xs.length?[Math.min(...xs),Math.max(...xs)]:[0,1];
    const sel=$('skCol');
    if(chainPG.length) cols.push({idx:-2,name:PG_VIEW,pg:true,numeric:true,state:false,hasData:true});
    const groupOf=c=> c.pg?'Composite' : (REF_SET.has(nrm(c.name))?'Dealer / realization field' : (EXTRA_SET.has(c.name)?'Open interest':'Other columns'));
    let html='', curG=null;
    cols.forEach((c,ci)=>{ const g=groupOf(c); if(g!==curG){ if(curG!==null)html+='</optgroup>'; html+='<optgroup label="'+g+'">'; curG=g; }
      const tag=(c.idx<0||!c.hasData)?' \u00b7 \u2014':(c.numeric?'':' \u00b7 state');
      html+='<option value="'+ci+'">'+c.name+tag+'</option>'; });
    if(curG!==null)html+='</optgroup>'; sel.innerHTML=html;
    let di=cols.findIndex(c=>c.hasData&&c.numeric&&/realization ratio/i.test(c.name));
    if(di<0)di=cols.findIndex(c=>c.hasData&&c.numeric); if(di<0)di=0;
    sel.value=di; selectCol(di);
  }

  function selectCol(ci){ curCol=+ci; fitCache={}; pgMode=false; barMode=false;
    const c=cols[curCol]||{}, fi=c.idx;
    if(c.pg){ pgMode=true; isState=false; pts=[]; statePts=[];
      pgData=computePG(anchorVal);
      $('skTitle').textContent='Pressure \u2192 Gravity'+(pgData?' \u00b7 by strike':' \u00b7 load chain');
      $('skN').textContent=pgData?(pgData.intent.length+pgData.transaction.length+pgData.realization.length):'\u2014';
      if($('skViews'))$('skViews').style.display='flex';
      if(chainPG.length)xExt=[chainPG[0].strike,chainPG[chainPG.length-1].strike];
      resetView(false); if(isFinite(anchorVal))setView('atm',false); draw(); return; }
    if(fi==null||fi<0||!c.hasData){ pts=[];statePts=[];isState=false;
      $('skN').textContent='\u2014'; $('skTitle').textContent=(c.name||'')+' \u00b7 not in this file'; resetView(false); draw(); return; }
    isState=!!c.state;
    if(isState){ statePts=data.map((r,ri)=>[r[xIdx],(rawRows[ri][fi]||'').trim()]).filter(p=>isFinite(p[0])&&p[1]!=='').sort((a,b)=>a[0]-b[0]); pts=[];
      $('skN').textContent=statePts.length||'\u2014'; $('skTitle').textContent=(c.name||'')+(statePts.length?' \u00b7 state markers':''); }
    else { statePts=[]; pts=data.map(r=>[r[xIdx],r[fi]]).filter(p=>isFinite(p[0])&&isFinite(p[1])).sort((a,b)=>a[0]-b[0]);
      $('skN').textContent=pts.length||'\u2014'; $('skTitle').textContent=(c.name||'')+(pts.length?' \u00b7 vs strike':''); }
    barMode=EXTRA_SET.has(c.name)&&!isState; barSigned=(c.name===EXTRA_COLS[0]);
    if($('skViews'))$('skViews').style.display=barMode?'flex':'none';
    resetView(false);
    if(barMode&&isFinite(anchorVal)) setView('atm',false);
    draw();
  }

  function norm(x){ const c=(xExt[0]+xExt[1])/2, s=Math.max(1e-9,(xExt[1]-xExt[0])/2); return (x-c)/s; }
  function polyfit(P,deg){ const n=deg+1, X=P.map(p=>norm(p[0])), Y=P.map(p=>p[1]);
    const ps=new Array(2*deg+1).fill(0); for(let i=0;i<X.length;i++){let xp=1;for(let k=0;k<2*deg+1;k++){ps[k]+=xp;xp*=X[i];}}
    const A=[],b=new Array(n).fill(0);
    for(let r=0;r<n;r++){A.push(ps.slice(r,r+n).slice()); for(let i=0;i<X.length;i++)b[r]+=Y[i]*Math.pow(X[i],r);}
    for(let c=0;c<n;c++){ let piv=c; for(let r=c+1;r<n;r++) if(Math.abs(A[r][c])>Math.abs(A[piv][c]))piv=r;
      if(piv!==c){const t=A[piv];A[piv]=A[c];A[c]=t; const tb=b[piv];b[piv]=b[c];b[c]=tb;}
      if(Math.abs(A[c][c])<1e-12) continue;
      for(let r=0;r<n;r++){ if(r===c)continue; const f=A[r][c]/A[c][c]; for(let k=c;k<n;k++)A[r][k]-=f*A[c][k]; b[r]-=f*b[c]; } }
    const coef=new Array(n); for(let c=0;c<n;c++) coef[c]=Math.abs(A[c][c])<1e-12?0:b[c]/A[c][c]; return coef; }
  function polyval(c,xn){ let y=0,xp=1; for(let i=0;i<c.length;i++){y+=c[i]*xp;xp*=xn;} return y; }
  function rsq(P,c){ if(P.length<2)return 0; const ym=P.reduce((s,p)=>s+p[1],0)/P.length;
    let ss=0,st=0; for(const p of P){const e=p[1]-polyval(c,norm(p[0]));ss+=e*e; st+=(p[1]-ym)*(p[1]-ym);} return st<1e-12?1:1-ss/st; }
  function fitOf(deg){ if(fitCache[deg])return fitCache[deg]; if(pts.length<deg+1)return null;
    const c=polyfit(pts,deg); fitCache[deg]={c,r2:rsq(pts,c)}; return fitCache[deg]; }

  let W=0,H=0;
  function sizeCanvas(){ const dpr=window.devicePixelRatio||1, w=canvas.clientWidth,h=canvas.clientHeight; if(!w||!h)return;
    for(const cv of [canvas,overlay]){ cv.width=w*dpr; cv.height=h*dpr; }
    ctx.setTransform(dpr,0,0,dpr,0,0); octx.setTransform(dpr,0,0,dpr,0,0); W=w;H=h; draw(); }
  window.__skResize=sizeCanvas;

  function niceTicks(lo,hi,target){ const span=hi-lo; if(span<=0)return [lo];
    const raw=span/target, mag=Math.pow(10,Math.floor(Math.log10(raw))), n=raw/mag;
    const step=(n<1.5?1:n<3?2:n<7?5:10)*mag; const out=[]; let t=Math.ceil(lo/step)*step;
    for(;t<=hi+step*1e-6;t+=step) out.push(Math.abs(t)<step*1e-6?0:t); return out; }
  function fmtX(v){ return Math.abs(v)>=1000? v.toLocaleString(undefined,{maximumFractionDigits:0}) : (''+(Math.round(v*100)/100)); }
  function fmtY(v){ const a=Math.abs(v); if(a!==0&&(a<0.01||a>=1e5))return v.toExponential(1); return (''+(Math.round(v*1000)/1000)); }

  function resetView(redraw){
    viewLo=xExt?xExt[0]:0; viewHi=xExt?xExt[1]:1; if(viewLo===viewHi){viewLo-=1;viewHi+=1;}
    const xpad=(viewHi-viewLo)*0.02; viewLo-=xpad; viewHi+=xpad;
    if(pts.length){ const ys=pts.map(p=>p[1]).slice().sort((a,b)=>a-b);
      const pc=q=>ys[Math.max(0,Math.min(ys.length-1,Math.floor(q*(ys.length-1))))];
      let ymin=pc(0.02), ymax=pc(0.98); if(ymin===ymax){ymin-=1;ymax+=1;}
      const yp=(ymax-ymin)*0.12; yLo=ymin-yp; yHi=ymax+yp;
      if(barMode){ const vals=pts.map(p=>p[1]);
        if(barSigned){ const m=Math.max(1e-9,...vals.map(Math.abs)); yLo=-m*1.08; yHi=m*1.08; }
        else { const m=Math.max(0,...vals); yLo=0; yHi=(m||1)*1.08; } } }
    else { yLo=0; yHi=1; }
    if(pgMode&&pgData){ const mags=[...pgData.intent,...pgData.transaction,...pgData.realization].map(p=>Math.abs(p[1])).filter(isFinite);
      const ymax=mags.length?Math.max(...mags):1; yLo=0; yHi=(ymax||1)*1.12; }
    if(barMode||pgMode){ const a=$('skVatm'),f=$('skVfield'),b=$('skVall'); if(a)a.classList.remove('on'); if(f)f.classList.remove('on'); if(b)b.classList.add('on'); }
    if(redraw!==false)draw();
  }

  function draw(){
    if(!W||!H){ if(canvas.clientWidth)sizeCanvas(); return; }
    ctx.clearRect(0,0,W,H); ctx.fillStyle='#07090d'; ctx.fillRect(0,0,W,H);
    const pW=W-PAD_L-PAD_R, pH=H-PAD_T-PAD_B;
    const mapX=x=>PAD_L+((x-viewLo)/(viewHi-viewLo))*pW;
    const mapY=y=>PAD_T+(1-(y-yLo)/(yHi-yLo))*pH;
    const invX=px=>viewLo+((px-PAD_L)/pW)*(viewHi-viewLo);
    ctx.fillStyle='#0b0f14'; ctx.fillRect(PAD_L,PAD_T,pW,pH);

    const xt=niceTicks(viewLo,viewHi,8);
    ctx.font='9px SF Mono,Menlo,monospace'; ctx.lineWidth=0.5;
    ctx.textAlign='center'; ctx.textBaseline='top';
    for(const tx of xt){ const x=mapX(tx); if(x<PAD_L-1||x>PAD_L+pW+1)continue;
      ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.beginPath();ctx.moveTo(x,PAD_T);ctx.lineTo(x,PAD_T+pH);ctx.stroke();
      ctx.fillStyle='#8f8c82'; ctx.fillText(fmtX(tx),x,PAD_T+pH+5); }
    if(!isState){ const yt=niceTicks(yLo,yHi,7); ctx.textAlign='right'; ctx.textBaseline='middle';
      for(const ty of yt){ const y=mapY(ty); if(y<PAD_T-1||y>PAD_T+pH+1)continue;
        ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.beginPath();ctx.moveTo(PAD_L,y);ctx.lineTo(PAD_L+pW,y);ctx.stroke();
        ctx.fillStyle='#8f8c82'; ctx.fillText(fmtY(ty),PAD_L-7,y); }
      if(yLo<0&&yHi>0){ const yz=mapY(0); ctx.strokeStyle='rgba(232,227,214,0.45)'; ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(PAD_L,yz);ctx.lineTo(PAD_L+pW,yz);ctx.stroke(); } }

    if(!pts.length&&!statePts.length&&!pgMode){ ctx.fillStyle='#8f8c82'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font='12px -apple-system,Segoe UI,sans-serif';
      ctx.fillText('load a strike-field CSV \u2014 first column is Strike (x), pick any other column',PAD_L+pW/2,PAD_T+pH/2);
      drawGreekBars(mapX,pW,pH); drawAnchor(mapX,pW,pH); drawLegend(); return; }

    ctx.save(); ctx.beginPath(); ctx.rect(PAD_L,PAD_T,pW,pH); ctx.clip();
    if(isState){
      ctx.strokeStyle='rgba(127,209,224,0.65)'; ctx.lineWidth=1; ctx.setLineDash([5,4]);
      ctx.fillStyle=STATEC; ctx.font='8px SF Mono,Menlo,monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
      for(const sp of statePts){ const X=mapX(sp[0]); if(X<PAD_L-1||X>PAD_L+pW+1)continue;
        ctx.beginPath();ctx.moveTo(X,PAD_T);ctx.lineTo(X,PAD_T+pH);ctx.stroke(); ctx.fillText(fmtX(sp[0]),X,PAD_T+3); }
      ctx.setLineDash([]);
    } else if(pgMode){
      drawPG(mapX,mapY,pW,pH);
    } else if(barMode){
      drawBars(mapX,mapY,pW,pH);
    } else {
      if($('skRaw').checked){
        ctx.strokeStyle=RAWC; ctx.lineWidth=1.1; ctx.globalAlpha=0.9; ctx.beginPath();
        pts.forEach((p,i)=>{const X=mapX(p[0]),Y=mapY(p[1]); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);}); ctx.stroke();
        ctx.globalAlpha=1; ctx.fillStyle=RAWC; const dense=pts.length>160;
        pts.forEach(p=>{const X=mapX(p[0]),Y=mapY(p[1]); ctx.beginPath();ctx.arc(X,Y,dense?1.1:2,0,Math.PI*2);ctx.fill();});
      }
      const maxO=+$('skOrder').value, x0=Math.max(viewLo,xExt[0]), x1=Math.min(viewHi,xExt[1]), N=320;
      for(let deg=1;deg<=maxO;deg++){ const f=fitOf(deg); if(!f)continue;
        ctx.strokeStyle=ORDC[deg]; ctx.lineWidth=1.7; ctx.globalAlpha=0.92; ctx.lineJoin='round';
        ctx.shadowColor=ORDC[deg]; ctx.shadowBlur=3; ctx.beginPath();
        for(let i=0;i<=N;i++){ const x=x0+(x1-x0)*i/N, Y=mapY(polyval(f.c,norm(x))), X=mapX(x); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); }
        ctx.stroke(); ctx.shadowBlur=0; }
      ctx.globalAlpha=1;
    }
    ctx.restore();

    drawGreekBars(mapX,pW,pH); drawAnchor(mapX,pW,pH);

    if(cursor&&!tool){ let mx=cursor.x; if(mx>=PAD_L&&mx<=PAD_L+pW){ let xv=invX(mx);
      // lock onto the nearest column (strike) in bar / PG views
      if(barMode&&pts.length){ let best=pts[0],bd=1e18; for(const p of pts){const d=Math.abs(p[0]-xv);if(d<bd){bd=d;best=p;}} xv=best[0]; mx=mapX(xv); }
      else if(pgMode&&pgData){ const ks=pgStrikes(); if(ks.length){ let bs=ks[0],bd=1e18; for(const s of ks){const d=Math.abs(s-xv);if(d<bd){bd=d;bs=s;}} xv=bs; mx=mapX(xv); } }
      ctx.strokeStyle='rgba(127,209,224,0.5)'; ctx.lineWidth=1; ctx.setLineDash([5,4]);
      ctx.beginPath();ctx.moveTo(mx,PAD_T);ctx.lineTo(mx,PAD_T+pH);ctx.stroke(); ctx.setLineDash([]);
      // snapped markers on each curve + collect secondary readout
      let sub='';
      if(isState){ const nf=nearestState(xv); if(nf)sub=nf[1]+' @ '+fmtX(nf[0]); }
      else if(pgMode){ sub=pgAt(xv); }
      else if(barMode){ const rn=nearestRaw(xv); if(rn) sub=(barSigned?(rn[1]>=0?'put-heavy floor +':'call-heavy ceiling '):'OI ')+fmtY(rn[1]); }
      else { const maxO2=+$('skOrder').value;
        for(let deg=1;deg<=maxO2;deg++){ const f=fitOf(deg); if(!f||xv<xExt[0]||xv>xExt[1])continue;
          const Y=mapY(polyval(f.c,norm(xv))); ctx.fillStyle=ORDC[deg]; ctx.beginPath();ctx.arc(mx,Y,3.2,0,Math.PI*2);ctx.fill(); }
        const rn=nearestRaw(xv); if(rn)sub='raw '+fmtY(rn[1]); }
      // top-pinned indicator chip (detector spec): solid bg, drawn over curves, clamped to plot
      let label='strike '+fmtX(xv); if(isFinite(anchorVal))label+='   \u0394 '+fmtX(xv-anchorVal);
      ctx.font='10px SF Mono,Menlo,monospace'; ctx.textAlign='center';
      const padc=8, lw=ctx.measureText(label).width, sw=sub?ctx.measureText(sub).width:0, tw=Math.max(lw,sw)+padc*2, ch=sub?31:18;
      const lx=Math.max(PAD_L,Math.min(PAD_L+pW-tw,mx-tw/2));
      ctx.fillStyle='rgba(46,46,50,0.97)'; ctx.fillRect(lx,PAD_T+2,tw,ch);
      ctx.strokeStyle='#4c4c54'; ctx.lineWidth=0.5; ctx.strokeRect(lx,PAD_T+2,tw,ch);
      ctx.textBaseline='middle'; ctx.fillStyle='#7fd1e0'; ctx.fillText(label,lx+tw/2,PAD_T+(sub?11:11));
      if(sub){ ctx.fillStyle='#a6a299'; ctx.fillText(sub,lx+tw/2,PAD_T+23); }
    } }
    dotTip.style.display='none';

    drawLegend();
  }
  // Realization-fold energy (quan_realization _pressure_inputs, ported): ATM-centered 21-cell
  // fold window; live = Σ|clamp(PG·PC,±8)|; displaced when live < 1.0.
  function foldEnergy(anchor){
    if(!chainAP.length||chainAP.length<17||!isFinite(anchor))return null;
    const strikes=chainAP.map(o=>o.strike), ap=chainAP.map(o=>o.ap), N=strikes.length;
    const bh=ap.map(v=>isFinite(v)?Math.abs(v):NaN);
    const valid=bh.filter(isFinite).sort((a,b)=>a-b); if(valid.length<5)return null;
    const pct=p=>{ const idx=p/100*(valid.length-1), lo=Math.floor(idx), hi=Math.ceil(idx); return lo===hi?valid[lo]:valid[lo]+(valid[hi]-valid[lo])*(idx-lo); };
    const lo=pct(5), hi=pct(95), rng=hi-lo;
    const bi=bh.map(v=> isFinite(v)? (rng>0?(Math.min(hi,Math.max(lo,v))-lo)/rng:0) : NaN);
    const br=new Array(N-1).fill(NaN);
    for(let i=0;i<N-1;i++) if(isFinite(bi[i])&&isFinite(bi[i+1])) br[i]=bi[i+1]-bi[i];
    let atm=0,bd=1e18; for(let i=0;i<N;i++){const d=Math.abs(strikes[i]-anchor);if(d<bd){bd=d;atm=i;}}
    const base=atm-10, cc=new Array(21).fill(0);
    for(let k=0;k<21;k++){ const a=base+k,b=base+k+1; if(a>=0&&b>=0&&a<br.length&&b<br.length&&isFinite(br[a])&&isFinite(br[b])) cc[k]=(br[b]-br[a])/0.1; }
    const cd=new Array(21).fill(0); for(let k=0;k<20;k++) cd[k]=(cc[k+1]-cc[k])/0.1;
    let live=0; for(let k=0;k<21;k++){ let v=cc[k]*cd[k]; live+=Math.abs(Math.max(-8,Math.min(8,v))); }
    return {live, flag:live<1.0, covered:(base>=0)&&((base+21)<br.length)};
  }
  // Pressure -> Gravity (quan_pressure_path, ported chain-only): intent/transaction/realization
  // peaks (gated by liquidity), watermarks (|LiqRatio|>=20), gamma walls, nearest-gravity reading.
  function computePG(anchor){
    if(!chainPG.length||!isFinite(anchor))return null;
    const span=700, near=chainPG.filter(r=>r.strike>=anchor-span&&r.strike<=anchor+span);
    if(!near.length)return null;
    const oim=near.map(r=>Math.abs(r.netOI)).filter(isFinite).sort((a,b)=>a-b);
    const med=oim.length?(oim.length%2?oim[(oim.length-1)/2]:(oim[oim.length/2-1]+oim[oim.length/2])/2):0;
    const floor=Math.max(med,1.0), gated=near.filter(r=>Math.abs(r.netOI)>=floor);
    const peaks=key=>gated.filter(r=>isFinite(r[key])).slice().sort((a,b)=>Math.abs(b[key])-Math.abs(a[key])).slice(0,3).map(r=>[r.strike,r[key]]);
    const intent=peaks('did'), transaction=peaks('dit'), realization=peaks('dr3');
    const watermarks=near.filter(r=>isFinite(r.liqT)&&Math.abs(r.liqT)>=20).sort((a,b)=>Math.abs(b.liqT)-Math.abs(a.liqT)).slice(0,6)
      .map(r=>[r.strike,r.liqT,r.liqT>0?'OI_parked':'flow_churn']);
    const gw=(gammaWalls||[]).filter(g=>g[0]>=anchor-span&&g[0]<=anchor+span).slice(0,5);
    const dom=intent.length?intent[0]:null;
    let above=null,below=null,bias=null,reading='';
    if(dom){ const gpts=watermarks.map(w=>w[0]).concat(gw.map(g=>g[0]));
      const ab=gpts.filter(g=>g>dom[0]), be=gpts.filter(g=>g<dom[0]);
      above=ab.length?Math.min(...ab):null; below=be.length?Math.max(...be):null;
      reading='Pressure peaks at '+Math.round(dom[0])+'; nearest gravity '+(below!=null?Math.round(below):'\u2014')+' below / '+(above!=null?Math.round(above):'\u2014')+' above.'; }
    return {intent,transaction,realization,watermarks,gammaWalls:gw,dom,above,below,bias,reading};
  }
  const PGC={intent:'#6fd3ff', transaction:'#e8b53a', realization:'#c9a0ff'};
  function drawPG(mapX,mapY,pW,pH){ if(!pgData)return; const y0=mapY(0);
    const vline=(x,color,dash,label)=>{ const X=mapX(x); if(X<PAD_L-1||X>PAD_L+pW+1)return;
      ctx.strokeStyle=color; ctx.lineWidth=1; ctx.setLineDash(dash); ctx.beginPath();ctx.moveTo(X,PAD_T);ctx.lineTo(X,PAD_T+pH);ctx.stroke(); ctx.setLineDash([]);
      ctx.save(); ctx.translate(X+3,PAD_T+5); ctx.rotate(Math.PI/2); ctx.fillStyle=color; ctx.font='8px SF Mono,Menlo,monospace'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(label,0,0); ctx.restore(); };
    for(const w of pgData.watermarks) vline(w[0],'#e0a23a',[4,3],'WM '+fmtX(w[0]));
    for(const g of pgData.gammaWalls) vline(g[0],'#ff79c6',[2,3],fmtX(g[0])+' \u03b3');
    const bands=[['intent',-2.5],['transaction',0],['realization',2.5]];
    for(const [key,dx] of bands){ ctx.strokeStyle=PGC[key]; ctx.fillStyle=PGC[key]; ctx.lineWidth=2.2;
      for(const p of pgData[key]){ const X=mapX(p[0])+dx; if(X<PAD_L-3||X>PAD_L+pW+3)continue; const Y=mapY(Math.abs(p[1]));
        ctx.beginPath();ctx.moveTo(X,y0);ctx.lineTo(X,Y);ctx.stroke(); ctx.beginPath();ctx.arc(X,Y,3,0,Math.PI*2);ctx.fill(); } }
    if(pgData.reading){ ctx.fillStyle='#c7c2b6'; ctx.font='10px SF Mono,Menlo,monospace'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(pgData.reading,PAD_L+6,PAD_T+6); } }

  function pgStrikes(){ if(!pgData)return []; const s=new Set();
    for(const k of ['intent','transaction','realization']) for(const p of pgData[k]) s.add(p[0]);
    for(const w of pgData.watermarks) s.add(w[0]); for(const g of pgData.gammaWalls) s.add(g[0]); return [...s]; }
  function pgAt(strike){ if(!pgData)return ''; const parts=[], find=arr=>arr.find(p=>p[0]===strike);
    const ii=find(pgData.intent); if(ii)parts.push('intent '+fmtY(ii[1]));
    const tt=find(pgData.transaction); if(tt)parts.push('trans '+fmtY(tt[1]));
    const rr=find(pgData.realization); if(rr)parts.push('realiz '+fmtY(rr[1]));
    const ww=pgData.watermarks.find(w=>w[0]===strike); if(ww)parts.push('WM '+fmtY(ww[1])+' '+ww[2]);
    const gg=pgData.gammaWalls.find(g=>g[0]===strike); if(gg)parts.push('\u03b3 wall'); return parts.join(' \u00b7 '); }
  function drawBars(mapX,mapY,pW,pH){ if(!pts.length)return;
    let diffs=[]; for(let i=1;i<pts.length;i++){const d=pts[i][0]-pts[i-1][0]; if(d>0)diffs.push(d);}
    diffs.sort((a,b)=>a-b); const step=diffs.length?diffs[diffs.length>>1]:1;
    const bw=Math.max(1.5,Math.min(22,(step/(viewHi-viewLo))*pW*0.6)), y0=mapY(0);
    // fold window band (ATM +/-10 strikes) for total-OI view
    if(!barSigned&&isFinite(anchorVal)){
      let ai=0,bd=1e18; pts.forEach((p,i)=>{const d=Math.abs(p[0]-anchorVal);if(d<bd){bd=d;ai=i;}});
      const lo=Math.max(0,ai-10), hi=Math.min(pts.length-1,ai+10);
      const xl=Math.max(PAD_L,mapX(pts[lo][0])-bw), xr=Math.min(PAD_L+pW,mapX(pts[hi][0])+bw);
      if(xr>xl){ ctx.fillStyle='rgba(214,170,162,0.12)'; ctx.fillRect(xl,PAD_T,xr-xl,pH); } }
    for(const p of pts){ const X=mapX(p[0]); if(X<PAD_L-bw||X>PAD_L+pW+bw)continue; const Y=mapY(p[1]);
      if(barSigned){ ctx.fillStyle=p[1]>=0?'#6fd3ff':'#e0a23a'; const top=Math.min(Y,y0); ctx.fillRect(X-bw/2,top,bw,Math.max(0.6,Math.abs(Y-y0))); }
      else { ctx.fillStyle='#6fd3ff'; ctx.fillRect(X-bw/2,Y,bw,Math.max(0.6,y0-Y)); } }
    // readout (top-right), theme-dim
    ctx.font='10px SF Mono,Menlo,monospace'; ctx.textAlign='right'; ctx.textBaseline='top'; ctx.fillStyle='#a6a299';
    if(barSigned){ let fl=0,ce=0; for(const p of pts){ if(p[1]>0)fl+=p[1]; else ce-=p[1]; }
      ctx.fillText('floors \u03a3 '+fmtX(fl)+'  \u00b7  ceilings \u03a3 '+fmtX(ce),PAD_L+pW-4,PAD_T+4); }
    else if(isFinite(anchorVal)){ let ai=0,bd=1e18; pts.forEach((p,i)=>{const d=Math.abs(p[0]-anchorVal);if(d<bd){bd=d;ai=i;}});
      const lo=Math.max(0,ai-10), hi=Math.min(pts.length-1,ai+10); let tot=0,win=0;
      for(let i=0;i<pts.length;i++){ tot+=pts[i][1]; if(i>=lo&&i<=hi)win+=pts[i][1]; }
      const pct=tot>0?(100*win/tot).toFixed(1):'0.0';
      const fe=foldEnergy(anchorVal);
      ctx.fillText('window OI '+pct+'% \u00b7 ATM\u00b110'+(fe?' \u00b7 fold '+fe.live.toFixed(2):''),PAD_L+pW-4,PAD_T+4);
      if(fe){ ctx.font='bold 10px SF Mono,Menlo,monospace';
        ctx.fillStyle=fe.flag?'#e0a23a':'#8f8c82';
        ctx.fillText(fe.flag?'FIELD DISPLACED \u2014 read beyond ATM':'field at the money',PAD_L+pW-4,PAD_T+18); } } }

  function fieldCenter(){
    if(gammaWalls&&gammaWalls.length)return gammaWalls[0][0];
    if(pgMode&&pgData&&pgData.dom)return pgData.dom[0];
    if(pts.length){ let best=pts[0],bv=-1; for(const p of pts){const a=Math.abs(p[1]);if(a>bv){bv=a;best=p;}} return best[0]; }
    return isFinite(anchorVal)?anchorVal:(xExt?(xExt[0]+xExt[1])/2:0);
  }
  function rescaleYToView(){
    if(pgMode&&pgData){ const mags=[...pgData.intent,...pgData.transaction,...pgData.realization]
        .filter(p=>p[0]>=viewLo&&p[0]<=viewHi).map(p=>Math.abs(p[1])).filter(isFinite);
      const m=mags.length?Math.max(...mags):1; yLo=0; yHi=(m||1)*1.12; return; }
    if(barMode){ const vis=pts.filter(p=>p[0]>=viewLo&&p[0]<=viewHi).map(p=>p[1]).filter(isFinite);
      if(barSigned){ const m=Math.max(1e-9,...vis.map(Math.abs)); yLo=-m*1.08; yHi=m*1.08; }
      else { const m=Math.max(0,...vis); yLo=0; yHi=(m||1)*1.08; } } }
  function setView(mode,redraw){ if(!xExt)return;
    if(mode==='atm'&&isFinite(anchorVal)){ viewLo=anchorVal-600; viewHi=anchorVal+600; }
    else if(mode==='field'){ const fc=fieldCenter(); viewLo=fc-400; viewHi=fc+400; }
    else { viewLo=xExt[0]; viewHi=xExt[1]; const xp=(viewHi-viewLo)*0.02; viewLo-=xp; viewHi+=xp; mode='all'; }
    if(barMode||pgMode)rescaleYToView();
    const a=$('skVatm'),f=$('skVfield'),b=$('skVall');
    if(a)a.classList.toggle('on',mode==='atm'); if(f)f.classList.toggle('on',mode==='field'); if(b)b.classList.toggle('on',mode==='all');
    if(redraw!==false)draw(); }

  function drawAnchor(mapX,pW,pH){ if(!isFinite(anchorVal))return; const ax=mapX(anchorVal);
    if(ax<PAD_L-1||ax>PAD_L+pW+1)return;
    ctx.save(); ctx.strokeStyle=ANCHC; ctx.lineWidth=1.5; ctx.beginPath();ctx.moveTo(ax,PAD_T);ctx.lineTo(ax,PAD_T+pH);ctx.stroke();
    ctx.fillStyle=ANCHC; ctx.font='9px SF Mono,Menlo,monospace'; ctx.textAlign='left'; ctx.textBaseline='top';
    const lx=Math.min(ax+4,PAD_L+pW-58); ctx.fillText('\u2693 '+fmtX(anchorVal),lx,PAD_T+2); ctx.restore(); }

  // ---- Greeks: parse a Barchart volatility-greeks export, derive convention-free key strikes ----
  const GBARC={wall:'#ff79c6', atm:'#79e0ff', gex:'#f5d76e', charm:'#6ee7c0'};
  const GK_R=0.053, GK_TDAYS=1.0;     // golden assumptions: r, default front-weekly T (days)
  let gkTdays=GK_TDAYS;               // overridden from the greeks filename's expiry vs snapshot date
  function parseTDaysFromName(name){
    if(!name)return null;
    const me=name.match(/exp(\d{2})_(\d{2})_(\d{2})/);                 // expiry MM_DD_YY
    const md=name.match(/(?:showall|intraday|daily)(\d{2})(\d{2})(\d{4})/); // snapshot MMDDYYYY
    if(!me||!md)return null;
    const exp=Date.UTC(2000+(+me[3]),(+me[1])-1,+me[2]);
    const dat=Date.UTC(+md[3],(+md[1])-1,+md[2]);
    const days=(exp-dat)/86400000;
    return isFinite(days)?Math.max(days,0.25):null;                   // clamp >0 so charm stays finite
  }
  function charmBS(K,sigma,F,r,T){     // golden 'Greeks & IV Surface'!R formula, per-day
    if(!(sigma>0&&F>0&&K>0&&T>0))return NaN;
    const srt=sigma*Math.sqrt(T), d1=(Math.log(F/K)+(sigma*sigma/2)*T)/srt, d2=d1-srt;
    const phi=Math.exp(-d1*d1/2)/Math.sqrt(2*Math.PI);
    return -Math.exp(-r*T)*phi*( d2/(2*T) - ((r+sigma*sigma/2)*d1)/srt )/365;
  }
  function parseGreeks(text){
    const rows=parseCSV(text).filter(r=>r.length>1); if(!rows.length) return false;
    const gh=rows[0].map(h=>String(h).replace(/^\ufeff/,'').trim());
    const low=gh.map(h=>h.toLowerCase());
    if(!(low.includes('gamma')&&low.includes('delta')&&low.includes('strike'))){ greekLevels=[]; return false; }
    const sIdx=low.indexOf('strike');
    const cG=findCol(gh,'Gamma',0,sIdx), pG=findCol(gh,'Gamma',sIdx+1,gh.length);
    const cD=findCol(gh,'Delta',0,sIdx);
    const cIV=findCol(gh,'IV',0,sIdx), pIV=findCol(gh,'IV',sIdx+1,gh.length);
    const recs=[];
    for(const r of rows.slice(1)){ const strike=num(r[sIdx]); if(!isFinite(strike))continue;
      const gv=i=>{ if(i<0)return NaN; const v=num(r[i]); return isFinite(v)?v:NaN; };
      const iv=i=>{ if(i<0)return NaN; const v=num(r[i]); return isFinite(v)&&v>0?v/100:NaN; };  // "15.5%" -> 0.155
      recs.push({strike,cG:gv(cG),pG:gv(pG),cD:gv(cD),cIV:iv(cIV),pIV:iv(pIV)}); }
    if(!recs.length){ greekLevels=[]; return false; }
    // Max gamma wall (peak total gamma)
    let wall=null,wb=-1; for(const r of recs){ const g=(isFinite(r.cG)?r.cG:0)+(isFinite(r.pG)?r.pG:0); if(g>wb){wb=g;wall=r.strike;} }
    // ATM = strike where call delta closest to 0.5
    let atm=null,ab=1e18; for(const r of recs){ if(!isFinite(r.cD))continue; const d=Math.abs(r.cD-0.5); if(d<ab){ab=d;atm=r.strike;} }
    // Peak GEX magnitude = gamma * (callOI+putOI) from the loaded chain (if present)
    let gex=null,gb=-1, haveOI=Object.keys(chainOI).length>0;
    if(haveOI){ for(const r of recs){ const oi=chainOI[r.strike]; if(!oi)continue;
      const g=(isFinite(r.cG)?r.cG:0); const v=Math.abs(g*(oi[0]+oi[1])); if(v>gb){gb=v;gex=r.strike;} } }
    // Peak |Charm| (BS, golden formula): needs spot F=anchor + per-strike IV_mid
    let charm=null,cb=-1, F=anchorVal, T=gkTdays/365;
    if(isFinite(F)){ for(const r of recs){ const ivs=[r.cIV,r.pIV].filter(isFinite);
      if(!ivs.length)continue; const ivm=ivs.reduce((a,b)=>a+b,0)/ivs.length;
      const ch=charmBS(r.strike,ivm,F,GK_R,T); if(isFinite(ch)&&Math.abs(ch)>cb){cb=Math.abs(ch);charm=r.strike;} } }
    greekLevels=[];
    if(wall!=null)  greekLevels.push({x:wall,c:GBARC.wall,lab:'\u0393 wall'});
    if(atm!=null)   greekLevels.push({x:atm,c:GBARC.atm,lab:'ATM \u0394.5'});
    if(gex!=null)   greekLevels.push({x:gex,c:GBARC.gex,lab:'max GEX'});
    if(charm!=null) greekLevels.push({x:charm,c:GBARC.charm,lab:'charm('+(gkTdays>=1?Math.round(gkTdays):gkTdays.toFixed(1))+'d)'});
    // top-5 gamma-wall strikes (total gamma) for the Pressure->Gravity gravity points
    gammaWalls=recs.map(r=>[r.strike,(isFinite(r.cG)?r.cG:0)+(isFinite(r.pG)?r.pG:0)])
      .filter(g=>g[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
    if(pgMode&&curCol!=null&&cols[curCol]&&cols[curCol].pg){ pgData=computePG(anchorVal); }
    return true;
  }
  function drawGreekBars(mapX,pW,pH){ if(!$('skGreeks').checked||!greekLevels.length)return;
    ctx.save(); ctx.font='9px SF Mono,Menlo,monospace'; ctx.textBaseline='top';
    let row=0;
    for(const g of greekLevels){ const gx=mapX(g.x); if(gx<PAD_L-1||gx>PAD_L+pW+1)continue;
      ctx.strokeStyle=g.c; ctx.lineWidth=1.3; ctx.setLineDash([3,3]);
      ctx.beginPath();ctx.moveTo(gx,PAD_T);ctx.lineTo(gx,PAD_T+pH);ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle=g.c; ctx.textAlign='left';
      const lx=Math.min(gx+4,PAD_L+pW-70); ctx.fillText(g.lab+' '+fmtX(g.x),lx,PAD_T+pH-12-(row%4)*12); row++; }
    ctx.restore(); }
  function nearestRaw(x){ if(!pts.length)return null; let best=null,bd=1e18; for(const p of pts){const d=Math.abs(p[0]-x);if(d<bd){bd=d;best=p;}} return best; }
  function nearestState(x){ if(!statePts.length)return null; let best=null,bd=1e18; for(const p of statePts){const d=Math.abs(p[0]-x);if(d<bd){bd=d;best=p;}} return best; }

  function drawLegend(){
    let pre=isFinite(anchorVal)?'<span><span class="sw" style="border-top-color:'+ANCHC+'"></span>\u2693 ATM '+fmtX(anchorVal)+'</span>':'';
    if(pgMode){ let h=pre;
      h+='<span><span class="sw" style="border-top-color:'+PGC.intent+'"></span>intent (DID)</span><span><span class="sw" style="border-top-color:'+PGC.transaction+'"></span>transaction (DIT)</span><span><span class="sw" style="border-top-color:'+PGC.realization+'"></span>realization (DR3)</span>';
      h+='<span><span class="sw" style="border-top-color:#e0a23a;border-top-style:dashed"></span>watermark (|T|\u226520)</span><span><span class="sw" style="border-top-color:#ff79c6;border-top-style:dashed"></span>gamma wall</span>';
      $('skLegend').innerHTML=h; return; }
    if(barMode){ let h=pre;
      if(barSigned){ h+='<span><span class="sw" style="border-top-color:#6fd3ff"></span>put-heavy (floor, up)</span><span><span class="sw" style="border-top-color:#e0a23a"></span>call-heavy (ceiling, down)</span>'; }
      else { h+='<span><span class="sw" style="border-top-color:#6fd3ff"></span>total OI</span>'; if(isFinite(anchorVal))h+='<span><span class="sw" style="border-top-color:rgba(214,170,162,0.6)"></span>fold window (ATM\u00b110)</span>'; }
      $('skLegend').innerHTML=h; return; }
    if(isState){ const lbl=statePts.length?statePts[0][1]:'state';
      $('skLegend').innerHTML=pre+'<span><span class="sw" style="border-top-color:'+STATEC+';border-top-style:dashed"></span>'+lbl+' \u00b7 '+statePts.length+' strikes</span>'; return; }
    const maxO=+$('skOrder').value; let h=pre;
    if($('skRaw').checked) h+='<span><span class="sw" style="border-top-color:'+RAWC+'"></span>raw</span>';
    for(let deg=1;deg<=maxO;deg++){ const f=fitOf(deg);
      h+='<span><span class="sw" style="border-top-color:'+ORDC[deg]+'"></span>P'+deg+(f?' \u00b7 R\u00b2 '+f.r2.toFixed(3):'')+'</span>'; }
    if($('skGreeks').checked) for(const g of greekLevels) h+='<span><span class="sw" style="border-top-color:'+g.c+';border-top-style:dashed"></span>'+g.lab+' '+fmtX(g.x)+'</span>';
    $('skLegend').innerHTML=h;
  }

  // anchor controls
  function setAnchor(v){ anchorVal=parseFloat(v); if(greeksText)parseGreeks(greeksText); if(pgMode)pgData=computePG(anchorVal); draw(); }
  window.__strikeSetAnchor=function(v){ $('skAnchor').value=(v==null?'':v); setAnchor($('skAnchor').value); };
  $('skAnchor').addEventListener('input',()=>{ if(window.__qSetAnchor)window.__qSetAnchor($('skAnchor').value); else setAnchor($('skAnchor').value); });
  $('skAnchor').addEventListener('change',()=>{ if(window.__qSetAnchor)window.__qSetAnchor($('skAnchor').value); else setAnchor($('skAnchor').value); });
  $('skLock').addEventListener('click',()=>{ anchorLocked=!anchorLocked; $('skAnchor').disabled=anchorLocked;
    $('skLock').classList.toggle('locked',anchorLocked); $('skLock').innerHTML=anchorLocked?'&#128274;':'&#128275;';
    $('skLock').title=anchorLocked?'Anchor locked \u2014 click to unlock':'Lock anchor for the session'; });

  canvas.addEventListener('wheel',e=>{ if(!pts.length&&!statePts.length)return; e.preventDefault();
    const r=canvas.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    const pW=W-PAD_L-PAD_R, pH=H-PAD_T-PAD_B;
    if(e.shiftKey&&!isState){ const yv=yLo+(1-(my-PAD_T)/pH)*(yHi-yLo); const cur=yHi-yLo;
      let s=e.deltaY<0?0.86:1/0.86, w=cur*s; const lo=yv-(yv-yLo)*(w/cur); yLo=lo; yHi=lo+w; }
    else { const xv=viewLo+((mx-PAD_L)/pW)*(viewHi-viewLo); const cur=viewHi-viewLo;
      let s=e.deltaY<0?0.85:1/0.85, w=cur*s; const lo=xv-(xv-viewLo)*(w/cur); viewLo=lo; viewHi=lo+w; }
    draw(); },{passive:false});
  canvas.addEventListener('mousemove',e=>{ if(!pts.length&&!statePts.length&&!pgMode)return; const r=canvas.getBoundingClientRect();
    cursor={x:e.clientX-r.left,y:e.clientY-r.top}; if(!tool)draw(); });
  canvas.addEventListener('mouseleave',()=>{ cursor=null; draw(); });
  canvas.addEventListener('dblclick',()=>resetView());
  $('skReset').addEventListener('click',()=>resetView());
  $('skOrder').addEventListener('input',()=>{ $('skOrderV').textContent=$('skOrder').value; draw(); });
  $('skRaw').addEventListener('change',draw);
  $('skCol').addEventListener('change',e=>selectCol(e.target.value));
  $('skGreeks').addEventListener('change',draw);
  if($('skVatm'))$('skVatm').addEventListener('click',()=>setView('atm'));
  if($('skVfield'))$('skVfield').addEventListener('click',()=>setView('field'));
  if($('skVall'))$('skVall').addEventListener('click',()=>setView('all'));
  $('skGFile').addEventListener('change',e=>{ const f=e.target.files[0]; if(!f)return;
    const td=parseTDaysFromName(f.name); const rd=new FileReader();
    rd.onload=ev=>{ const gkt=(td!=null?td:GK_TDAYS); if(window.__qLoadGreeks) window.__qLoadGreeks(ev.target.result,f.name,gkt); else window.__strikeLoadGreeks(ev.target.result,f.name,gkt); };
    rd.readAsText(f); });
  window.__strikeLoadGreeks=function(text,name,gkt){ greeksText=text; gkTdays=(gkt!=null?gkt:(parseTDaysFromName(name)!=null?parseTDaysFromName(name):GK_TDAYS)); $('skGFn').textContent=name||'none'; parseGreeks(text); if(pgMode)pgData=computePG(anchorVal); draw(); };
  window.__strikeClearGreeks=function(){ greeksText=null; gkTdays=GK_TDAYS; greekLevels=[]; $('skGFn').textContent='none'; if(pgMode)pgData=computePG(anchorVal); draw(); };
  window.__strikeLoadChain=function(text,name){ $('skFn').textContent=name; anchorVal=parseFloat($('skAnchor').value);
    if(ingest(text)){ if(greeksText)parseGreeks(greeksText); if(pgMode)pgData=computePG(anchorVal); draw(); } };
  window.__strikeClear=function(){ header=[];cols=[];data=[];rawRows=[];pts=[];statePts=[];curCol=null;
    $('skFn').textContent='none'; $('skCol').innerHTML='<option>load a chain</option>'; $('skN').textContent='\u2014'; $('skTitle').textContent=''; draw(); };
  $('skFile').addEventListener('change',e=>{ const f=e.target.files[0]; if(!f)return;
    const rd=new FileReader(); rd.onload=ev=>{ if(window.__qLoadChain) window.__qLoadChain(ev.target.result,f.name); else window.__strikeLoadChain(ev.target.result,f.name); }; rd.readAsText(f); });

  // per-instrument dataset swap is orchestrated by the header hub (window.__q*) on quan:instr.

  let drawing=false,lastPt=null,tool=null,snap=null,startPt=null,tbN=0;
  function clearDraw(){ octx.save();octx.setTransform(1,0,0,1,0,0);octx.clearRect(0,0,overlay.width,overlay.height);octx.restore();
    chartwrap.querySelectorAll('.textbox').forEach(b=>b.remove()); }
  function addTextBox(){ const b=document.createElement('div'); b.className='textbox';
    const off=20+(tbN++%6)*22; b.style.left=off+'px'; b.style.top=off+'px';
    const head=document.createElement('div'); head.className='tb-head';
    const x=document.createElement('span'); x.className='tb-x'; x.innerHTML='&#10006;'; x.addEventListener('click',()=>b.remove());
    head.appendChild(x); const ta=document.createElement('textarea'); ta.placeholder='note\u2026';
    b.appendChild(head); b.appendChild(ta); chartwrap.appendChild(b);
    head.addEventListener('pointerdown',e=>{ if(e.target===x)return; e.preventDefault();
      const wr=chartwrap.getBoundingClientRect(),bx=b.getBoundingClientRect(),ox=e.clientX-bx.left,oy=e.clientY-bx.top;
      try{head.setPointerCapture(e.pointerId);}catch(_){}
      const mv=ev=>{let nx=ev.clientX-wr.left-ox,ny=ev.clientY-wr.top-oy;
        nx=Math.max(0,Math.min(wr.width-b.offsetWidth,nx)); ny=Math.max(0,Math.min(wr.height-b.offsetHeight,ny));
        b.style.left=nx+'px';b.style.top=ny+'px';};
      const up=()=>{head.removeEventListener('pointermove',mv);head.removeEventListener('pointerup',up);};
      head.addEventListener('pointermove',mv); head.addEventListener('pointerup',up); });
    setTimeout(()=>ta.focus(),0); }
  function setTool(t){ tool=(tool===t)?null:t;
    $('skDraw').classList.toggle('on',tool==='free'); $('skLine').classList.toggle('on',tool==='line'); $('skArrow').classList.toggle('on',tool==='arrow');
    overlay.classList.toggle('drawmode',tool!=null); drawing=false; if(tool){cursor=null;dotTip.style.display='none';draw();} }
  function pen(){ octx.strokeStyle='#ffe14d'; octx.lineWidth=2.4; octx.lineCap='round'; octx.lineJoin='round'; }
  function arrowHead(x1,y1,x2,y2){ const a=Math.atan2(y2-y1,x2-x1),len=12,sp=Math.PI/7;
    octx.beginPath();octx.moveTo(x2,y2);octx.lineTo(x2-len*Math.cos(a-sp),y2-len*Math.sin(a-sp));
    octx.moveTo(x2,y2);octx.lineTo(x2-len*Math.cos(a+sp),y2-len*Math.sin(a+sp));octx.stroke(); }
  $('skText').addEventListener('click',addTextBox);
  $('skDraw').addEventListener('click',()=>setTool('free'));
  $('skLine').addEventListener('click',()=>setTool('line'));
  $('skArrow').addEventListener('click',()=>setTool('arrow'));
  $('skClear').addEventListener('click',clearDraw);
  overlay.addEventListener('pointerdown',e=>{ if(!tool)return; drawing=true; const r=overlay.getBoundingClientRect(),p={x:e.clientX-r.left,y:e.clientY-r.top};
    lastPt=p;startPt=p; if(tool!=='free'){try{snap=octx.getImageData(0,0,overlay.width,overlay.height);}catch(_){snap=null;}}
    try{overlay.setPointerCapture(e.pointerId);}catch(_){} });
  overlay.addEventListener('pointermove',e=>{ if(!tool||!drawing)return; const r=overlay.getBoundingClientRect(),p={x:e.clientX-r.left,y:e.clientY-r.top}; pen();
    if(tool==='free'){octx.beginPath();octx.moveTo(lastPt.x,lastPt.y);octx.lineTo(p.x,p.y);octx.stroke();lastPt=p;}
    else { if(snap){octx.save();octx.setTransform(1,0,0,1,0,0);octx.putImageData(snap,0,0);octx.restore();}
      octx.beginPath();octx.moveTo(startPt.x,startPt.y);octx.lineTo(p.x,p.y);octx.stroke();
      if(tool==='arrow')arrowHead(startPt.x,startPt.y,p.x,p.y); } });
  overlay.addEventListener('pointerup',()=>{drawing=false;snap=null;});
  overlay.addEventListener('pointerleave',()=>{drawing=false;snap=null;});
  overlay.addEventListener('wheel',e=>{e.preventDefault();},{passive:false});

  window.addEventListener('resize',()=>{ if($('tabStrike').classList.contains('on'))sizeCanvas(); });
  $('skOrderV').textContent=$('skOrder').value;
})();

(function(){
  const $=id=>document.getElementById(id);
  const head=$('sopHead'), field=$('sopField'); if(!head||!field) return;
  const hctx=head.getContext('2d'), fctx=field.getContext('2d');
  const BG='#07090d',PLOT='#0b0f14',FG='#c7cdd7',FRAME='rgba(255,255,255,0.10)',ZERO='rgba(255,255,255,0.72)',CYAN='#6fd3ff';
  const WHITE='#ffffff',RED='#d9463b',GOLD='#e8b53a',TEAL='#3f9d6b';
  let hoverT=null, hoverF=null;
  const cr=(p0,p1,p2,p3,t)=>{const t2=t*t,t3=t2*t;return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);};
  function crEval(arr,t){ const n=arr.length; if(n<2) return arr[0]||0; const pos=t*(n-1); let i=Math.floor(pos); if(i>n-2)i=n-2; if(i<0)i=0; const lt=pos-i;
    return cr(arr[Math.max(i-1,0)],arr[i],arr[Math.min(i+1,n-1)],arr[Math.min(i+2,n-1)],lt); }
  function clockT(t){ const sec=window.__cwToSec?window.__cwToSec(t):Math.round(64800+Math.abs(t)*82800)%86400; const totalMin=Math.round(sec/60)%1440; const H=Math.floor(totalMin/60),Mn=totalMin%60; const ap=H<12?'AM':'PM'; let h=H%12; if(h===0)h=12; return h+':'+String(Mn).padStart(2,'0')+' '+ap+' ET'; }
  const fmt=v=>(v>=0?'+':'')+(Math.abs(v)>=1000?v.toFixed(0):v.toFixed(3));
  function fit(cv,ctx){ const w=cv.clientWidth,h=cv.clientHeight; if(!w||!h) return null;
    const dpr=Math.min(devicePixelRatio||1,2); const W=Math.round(w*dpr),H=Math.round(h*dpr);
    if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H;} ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h); return {w,h}; }
  function range(lines){ let lo=Infinity,hi=-Infinity; for(const ln of lines) for(const v of ln.d) if(isFinite(v)){ if(v<lo)lo=v; if(v>hi)hi=v; }
    if(!isFinite(lo)){lo=-1;hi=1;} if(lo===hi){lo-=1;hi+=1;} const pad=(hi-lo)*0.12; return [lo-pad,hi+pad]; }
  // ---------- headline ----------
  function drawHead(){
    const f=fit(head,hctx); if(!f) return; const {w,h}=f;
    hctx.fillStyle=BG; hctx.fillRect(0,0,w,h);
    const d=window.__sopData&&window.__sopData();
    if(!d){ hctx.fillStyle='#6f675a'; hctx.font='12px monospace'; hctx.textAlign='left'; hctx.fillText('load a session chain + anchor (set on any chain tab) — the engine computes the SOP field',16,26); return; }
    const x=d.pair, lines=[{d:d.product,c:WHITE,lw:2.4,lab:'product'},{d:d.sopC,c:RED,lw:1.5,lab:'curvature'},{d:d.sopG,c:GOLD,lw:1.5,lab:'gradient'},{d:d.tension,c:TEAL,lw:1.5,lab:'tension/envelope'}];
    const padL=42,padR=14,padT=30,padB=30, x0=padL,x1=w-padR,y0=padT,y1=h-padB;
    const [ylo,yhi]=range(lines);
    const xAt=t=>x0+t*(x1-x0), yAt=v=>y1-(v-ylo)/(yhi-ylo)*(y1-y0);
    hctx.fillStyle=PLOT; hctx.fillRect(x0,y0,x1-x0,y1-y0);
    // grid
    hctx.lineWidth=0.5; hctx.font='9px monospace'; hctx.fillStyle='#a6a299'; hctx.strokeStyle='rgba(255,255,255,0.05)'; hctx.textAlign='center';
    for(let t=0;t<=10;t++){ const X=xAt(t/10); hctx.beginPath(); hctx.moveTo(X,y0); hctx.lineTo(X,y1); hctx.stroke(); if(t%2===0) hctx.fillText((t/10).toFixed(1),X,y1+13); }
    hctx.textAlign='right';
    for(let k=0;k<=4;k++){ const v=ylo+(yhi-ylo)*k/4, Y=yAt(v); hctx.beginPath(); hctx.moveTo(x0,Y); hctx.lineTo(x1,Y); hctx.stroke(); hctx.fillText(v.toFixed(Math.abs(v)>=100?0:1),x0-4,Y+3); }
    // coherence breaks (sign change in product/fold)
    const breaks=[]; for(let i=1;i<d.product.length;i++){ if(d.product[i]===0)continue; const a=Math.sign(d.product[i]),b=Math.sign(d.product[i-1]); if(a&&b&&a!==b)breaks.push(i); }
    hctx.setLineDash([3,3]); hctx.strokeStyle='rgba(111,211,255,0.5)';
    breaks.forEach(i=>{ const X=xAt(i/10); hctx.beginPath(); hctx.moveTo(X,y0); hctx.lineTo(X,y1); hctx.stroke(); }); hctx.setLineDash([]);
    // zero line
    if(ylo<0&&yhi>0){ hctx.strokeStyle=ZERO; hctx.lineWidth=0.8; const Y=yAt(0); hctx.beginPath(); hctx.moveTo(x0,Y); hctx.lineTo(x1,Y); hctx.stroke(); }
    hctx.strokeStyle=FRAME; hctx.lineWidth=1; hctx.strokeRect(x0,y0,x1-x0,y1-y0);
    // smoothed curves
    for(const ln of lines){ hctx.strokeStyle=ln.c; hctx.lineWidth=ln.lw; hctx.beginPath(); const n=x.length;
      for(let i=0;i<n-1;i++){ const yA=Math.max(-1,Math.min(1,i)); void yA;
        const p0y=ln.d[Math.max(i-1,0)],p1y=ln.d[i],p2y=ln.d[i+1],p3y=ln.d[Math.min(i+2,n-1)];
        const p0x=x[Math.max(i-1,0)],p1x=x[i],p2x=x[i+1],p3x=x[Math.min(i+2,n-1)];
        for(let s=0;s<=18;s++){ const t=s/18; const X=xAt(cr(p0x,p1x,p2x,p3x,t)), Y=yAt(cr(p0y,p1y,p2y,p3y,t)); (i===0&&s===0)?hctx.moveTo(X,Y):hctx.lineTo(X,Y); } }
      hctx.stroke(); }
    // title + xlabel
    hctx.fillStyle=FG; hctx.font='12px monospace'; hctx.textAlign='left'; hctx.fillText('SOP wave field (headline) — product = fold/coherence wave',x0,18);
    hctx.font='9px monospace'; hctx.fillStyle='#8f8c82'; hctx.textAlign='center'; hctx.fillText('chronometer watch  (0 ATM → 1 expiry arc)',(x0+x1)/2,h-6);
    // legend lower-left
    hctx.textAlign='left'; hctx.font='9px monospace'; let ly=y1-4-lines.length*11;
    lines.forEach(ln=>{ hctx.strokeStyle=ln.c; hctx.lineWidth=2; hctx.beginPath(); hctx.moveTo(x0+6,ly); hctx.lineTo(x0+22,ly); hctx.stroke(); hctx.fillStyle=FG; hctx.fillText(ln.lab,x0+27,ly+3); ly+=11; });
    // hover crosshair
    if(hoverT!=null){ const t=hoverT, X=xAt(t);
      hctx.strokeStyle='rgba(255,255,255,0.7)'; hctx.lineWidth=1; hctx.beginPath(); hctx.moveTo(X,y0); hctx.lineTo(X,y1); hctx.stroke();
      lines.forEach(ln=>{ const Y=yAt(crEval(ln.d,t)); hctx.fillStyle=ln.c; hctx.beginPath(); hctx.arc(X,Y,3,0,7); hctx.fill(); });
      let nb=null,bd=1; breaks.forEach(i=>{const dd=Math.abs(i/10-t); if(dd<bd){bd=dd;nb=i;}}); const isBrk=(nb!=null&&bd<=0.025);
      const txt=['t '+t.toFixed(2)+' · '+clockT(t)+(isBrk?'  ◆ coherence break':(nb!=null?'  · break @ '+(nb/10).toFixed(1):'')),
        'product '+fmt(crEval(d.product,t))+'   tension '+fmt(crEval(d.tension,t)),
        'gradient '+fmt(crEval(d.sopG,t))+'   curvature '+fmt(crEval(d.sopC,t))];
      hctx.font='9px monospace'; let bw=0; txt.forEach(s=>bw=Math.max(bw,hctx.measureText(s).width)); bw+=12;
      let bx=Math.min(X+10,x1-bw), by=y0+6; if(bx<x0)bx=x0;
      hctx.fillStyle='rgba(18,18,22,0.94)'; hctx.strokeStyle='#4c4c54'; hctx.lineWidth=1; hctx.fillRect(bx,by,bw,txt.length*12+6); hctx.strokeRect(bx,by,bw,txt.length*12+6);
      hctx.textAlign='left'; txt.forEach((s,k)=>{ hctx.fillStyle=k===0?(isBrk?CYAN:FG):FG; hctx.fillText(s,bx+6,by+13+k*12); });
    }
    // source note
    hctx.font='9px monospace'; hctx.fillStyle='#8f8c82'; hctx.textAlign='right';
    hctx.fillText('ATM '+(d.atm!=null?Math.round(d.atm):'—')+' · '+d.n_strikes+' strikes · breaks '+(breaks.length?breaks.map(i=>(i/10).toFixed(1)).join(', '):'none')+(d.covered?'':' · ⚠ not fully covered'), x1, 18);
  }
  // ---------- Field Study: DS / Dual Phase / SWF, one visualization with crossing + intersection times ----------
  // Generalizes Detector's findBreaches (sign-flip + linear interpolation) and computeAligned (pairwise
  // tolerance match) from 2 series to 3 -- see js/detector.js for the original 2-series pattern.
  function findBreaches(d){ const out=[]; for(let i=0;i<d.length-1;i++){ const a=d[i],b=d[i+1];
    if((a<=0&&b>0)||(a>0&&b<=0)){ const t=-a/(b-a); out.push(i+t); } } return out; }
  function drawFieldStudy(){
    const f=fit(field,fctx); if(!f) return; const {w,h}=f;
    fctx.fillStyle=BG; fctx.fillRect(0,0,w,h);
    const d=window.__sopData&&window.__sopData();
    if(!d){ fctx.fillStyle='#6f675a'; fctx.font='12px monospace'; fctx.textAlign='left'; fctx.fillText('load a session chain + anchor — the engine computes DS / Dual Phase / SWF',16,26); return; }
    const series=[{d:d.ds,c:WHITE,lab:'DS (Difference/Sum)'},{d:d.dualPhase,c:GOLD,lab:'Dual Phase'},{d:d.swf,c:CYAN,lab:'SWF (DIPLTRPD/SOPPM)'}];
    const x=d.pair;
    const padL=42,padR=14,padT=30,padB=30, x0=padL,x1=w-padR,y0=padT,y1=h-padB;
    const [ylo,yhi]=range(series);
    const xAt=t=>x0+t*(x1-x0), yAt=v=>y1-(v-ylo)/(yhi-ylo)*(y1-y0);
    fctx.fillStyle=PLOT; fctx.fillRect(x0,y0,x1-x0,y1-y0);
    // grid
    fctx.lineWidth=0.5; fctx.font='9px monospace'; fctx.fillStyle='#a6a299'; fctx.strokeStyle='rgba(255,255,255,0.05)'; fctx.textAlign='center';
    for(let t=0;t<=10;t++){ const X=xAt(t/10); fctx.beginPath(); fctx.moveTo(X,y0); fctx.lineTo(X,y1); fctx.stroke(); if(t%2===0) fctx.fillText((t/10).toFixed(1),X,y1+13); }
    fctx.textAlign='right';
    for(let k=0;k<=4;k++){ const v=ylo+(yhi-ylo)*k/4, Y=yAt(v); fctx.beginPath(); fctx.moveTo(x0,Y); fctx.lineTo(x1,Y); fctx.stroke(); fctx.fillText(v.toFixed(Math.abs(v)>=100?0:1),x0-4,Y+3); }
    if(ylo<0&&yhi>0){ fctx.strokeStyle=ZERO; fctx.lineWidth=0.8; const Y=yAt(0); fctx.beginPath(); fctx.moveTo(x0,Y); fctx.lineTo(x1,Y); fctx.stroke(); }
    fctx.strokeStyle=FRAME; fctx.lineWidth=1; fctx.strokeRect(x0,y0,x1-x0,y1-y0);
    // curves (straight-segment across the 11-point pair axis)
    series.forEach(s=>{ fctx.strokeStyle=s.c; fctx.lineWidth=1.8; fctx.beginPath();
      for(let i=0;i<x.length;i++){ const X=xAt(x[i]),Y=yAt(s.d[i]); i?fctx.lineTo(X,Y):fctx.moveTo(X,Y); } fctx.stroke(); });
    // per-series zero-crossings ("breaches") + pairwise-aligned crossings across series (tol ±0.05 on the pair axis)
    const TOL=0.05;
    const breaches=series.map(s=>findBreaches(s.d).map(bi=>bi/10));
    series.forEach((s,si)=>{ breaches[si].forEach(t=>{ const X=xAt(t),Y=yAt(0); fctx.fillStyle=s.c; fctx.beginPath(); fctx.arc(X,Y,3,0,7); fctx.fill(); }); });
    const aligned=[];
    for(let i=0;i<series.length;i++) for(let j=i+1;j<series.length;j++){
      for(const a of breaches[i]) for(const b of breaches[j]) if(Math.abs(a-b)<=TOL) aligned.push((a+b)/2); }
    fctx.setLineDash([6,4]); fctx.strokeStyle='rgba(127,209,224,0.55)'; fctx.lineWidth=1.4;
    aligned.forEach(t=>{ const X=xAt(t); fctx.beginPath(); fctx.moveTo(X,y0); fctx.lineTo(X,y1); fctx.stroke(); }); fctx.setLineDash([]);
    fctx.strokeStyle='rgba(127,209,224,0.9)'; fctx.lineWidth=1.6;
    aligned.forEach(t=>{ const X=xAt(t); fctx.beginPath(); fctx.arc(X,(y0+y1)/2,8,0,Math.PI*2); fctx.stroke(); });
    // title + xlabel
    fctx.fillStyle=FG; fctx.font='12px monospace'; fctx.textAlign='left'; fctx.fillText('Field Study — DS / Dual Phase / SWF, crossing + intersection times',x0,18);
    fctx.font='9px monospace'; fctx.fillStyle='#8f8c82'; fctx.textAlign='center'; fctx.fillText('chronometer watch  (0 ATM → 1 expiry arc)',(x0+x1)/2,h-6);
    // legend lower-left
    fctx.textAlign='left'; fctx.font='9px monospace'; let ly=y1-4-series.length*11;
    series.forEach(s=>{ fctx.strokeStyle=s.c; fctx.lineWidth=2; fctx.beginPath(); fctx.moveTo(x0+6,ly); fctx.lineTo(x0+22,ly); fctx.stroke(); fctx.fillStyle=FG; fctx.fillText(s.lab,x0+27,ly+3); ly+=11; });
    // hover crosshair
    if(hoverF!=null){ const t=hoverF, X=xAt(t);
      fctx.strokeStyle='rgba(255,255,255,0.7)'; fctx.lineWidth=1; fctx.beginPath(); fctx.moveTo(X,y0); fctx.lineTo(X,y1); fctx.stroke();
      const txt=['t '+t.toFixed(2)+' · '+clockT(t)];
      series.forEach(s=>{ const val=crEval(s.d,t); const Y=yAt(val); fctx.fillStyle=s.c; fctx.beginPath(); fctx.arc(X,Y,3,0,7); fctx.fill(); txt.push(s.lab+' '+fmt(val)); });
      fctx.font='9px monospace'; let bw=0; txt.forEach(s=>bw=Math.max(bw,fctx.measureText(s).width)); bw+=12;
      let bx=Math.min(X+10,x1-bw), by=y0+6; if(bx<x0)bx=x0;
      fctx.fillStyle='rgba(18,18,22,0.94)'; fctx.strokeStyle='#4c4c54'; fctx.lineWidth=1; fctx.fillRect(bx,by,bw,txt.length*12+6); fctx.strokeRect(bx,by,bw,txt.length*12+6);
      fctx.textAlign='left'; txt.forEach((s2,k)=>{ fctx.fillStyle=FG; fctx.fillText(s2,bx+6,by+13+k*12); });
    }
    fctx.font='9px monospace'; fctx.fillStyle='#8f8c82'; fctx.textAlign='right';
    fctx.fillText((aligned.length?aligned.length+' aligned crossing'+(aligned.length===1?'':'s'):'no aligned crossings')+' · tol ±'+TOL, x1, 18);
  }
  function redraw(){ drawHead(); drawFieldStudy(); }
  window.addEventListener('quan:ripn-tune', function(){ if($('tabPolar')&&$('tabPolar').classList.contains('on')) redraw(); });
  window.addEventListener('quan:sop',redraw);
  window.addEventListener('resize',()=>{ if($('tabPolar')&&$('tabPolar').classList.contains('on')) redraw(); });
  window.__sopResize=redraw;
  // headline hover trace
  head.addEventListener('mousemove',e=>{ const d=window.__sopData&&window.__sopData(); if(!d){hoverT=null;return;}
    const r=head.getBoundingClientRect(); const padL=42,padR=14,x0=padL,x1=r.width-padR;
    hoverT=Math.max(0,Math.min(1,(e.clientX-r.left-x0)/(x1-x0))); drawHead(); });
  head.addEventListener('mouseleave',()=>{ hoverT=null; drawHead(); });
  // field study hover trace
  field.addEventListener('mousemove',e=>{ const d=window.__sopData&&window.__sopData(); if(!d){hoverF=null;return;}
    const r=field.getBoundingClientRect(); const padL=42,padR=14,x0=padL,x1=r.width-padR;
    hoverF=Math.max(0,Math.min(1,(e.clientX-r.left-x0)/(x1-x0))); drawFieldStudy(); });
  field.addEventListener('mouseleave',()=>{ hoverF=null; drawFieldStudy(); });
})();