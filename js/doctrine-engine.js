/* ==========================================================================
   Doctrine Engine — the wiki's execution doctrine as pure functions over
   engine OUTPUTS. Terminal invariant #1 (doctrine is frozen): this module
   never re-derives engine math — it only aggregates and classifies what the
   Heat Map iframe (per-strike rows via quanGetHeatmap) and the Field Study
   engine (window.__sopData()) already export.

   Sources of every threshold (wiki-content/analytics/):
     deep-strike-analysis.md        — PDSL/DSC criteria + 0–10 scorecard
     risq-framework.md              — five dimensions, ℛₓ, allocation formula
     risq-operational-protocol.md   — entropy budget, coherence patterns
     fibonacci-strike-architecture.md — level table + quarter levels
     three-layer-execution-model.md — Layer A/B/C order construction
     stop-architecture-loss-management.md — quarter-level stops

   Derivation notes (labeled in the UI, chosen over inventing new engine math):
     A            = netoipcr  (Net OI / PC Ratio(OI) — dealer-field-architecture §I)
     LR           = liqratio  (structure : flow)
     DR3 (0..1)   = book percentile rank of |riskreal| (Dealer Risk Realization)
     II / TI      = book percentile ranks of |invdist| / |invtxn| (DID / DIT tiers)
     DIDK/DITK/DR3K, DIDS/DITS/DR3S = kurtosis/skew of the invdist / invtxn /
       riskreal distributions across the strike ladder (same tier columns
       quan_temporal.temporal_globals derives its globals from).
     DIPLTR residual / ZC / SOP latents read off the 11-row fold that
       sop-polar.js exports; a fold zero-cross at pair row i sits at CW ±(1−0.1i),
       so "final ZC in CW[+0.5,+1]" ⇔ |cross| ≥ 0.5.
   ========================================================================== */
(function(){
  'use strict';

  // ---- small stats over engine-exported columns ---------------------------
  function fin(v){ return v!=null && isFinite(v); }
  function col(rows,f){ const o=[]; for(const r of rows){ if(fin(r[f])) o.push(+r[f]); } return o; }
  function mean(a){ let s=0; for(const v of a) s+=v; return a.length?s/a.length:0; }
  function moment(a,m,n){ let s=0; for(const v of a) s+=Math.pow(v-m,n); return a.length?s/a.length:0; }
  function kurt(a){ if(a.length<4) return null; const m=mean(a), v=moment(a,m,2); if(v<=0) return null; return moment(a,m,4)/(v*v); }               // raw 4th standardized moment (Gaussian=3)
  function skew(a){ if(a.length<3) return null; const m=mean(a), v=moment(a,m,2); if(v<=0) return null; return moment(a,m,3)/Math.pow(v,1.5); }
  function pctlRank(sortedAbs,v){ if(!sortedAbs.length) return null; let lo=0,hi=sortedAbs.length; const x=Math.abs(v);
    while(lo<hi){ const mid=(lo+hi)>>1; if(sortedAbs[mid]<=x) lo=mid+1; else hi=mid; } return lo/sortedAbs.length; }
  function sortedAbs(a){ return a.map(Math.abs).sort((x,y)=>x-y); }
  function sgn(v){ return v>0?1:(v<0?-1:0); }

  // ---- Part I: session-close reading (deep-strike-analysis.md Part I) -----
  function closeReading(sop){
    if(!sop||!sop.ds||!sop.sopG) return null;
    const dip=sop.ds.map((d,i)=>d*sop.sopG[i]);                      // ds = DIPLTR/SOP ⇒ DIPLTR = ds·SOP
    const scale=Math.max.apply(null,dip.map(Math.abs).concat([1e-12]));
    const eps=0.02*scale;
    const res=(dip[0]+dip[1])/2;                                     // fold rows 0–1 span CW ±1.0 / ±0.9
    const dipDir=res>eps?1:(res<-eps?-1:0);
    const cross=sop.cross||[];
    const finalZC=cross.length?cross[cross.length-1]:null;
    const potent=finalZC!=null&&Math.abs(finalZC)>=0.5;              // final ZC in CW[+0.5,+1] wing
    const zcCount=cross.length;
    const entGrade=zcCount<=2?'clean':(zcCount<=4?'moderate':'turbulent');
    // SOP latent orientation at CW wings 0.9/0.8/0.7 = fold rows 1–3
    let gs=0,cs=0; for(let i=1;i<=3;i++){ gs+=sgn(sop.sopG[i]); cs+=sgn(sop.sopC[i]); }
    const latDir=(gs>=2&&cs>=2)?1:((gs<=-2&&cs<=-2)?-1:0);
    // Synthesis: 2 directional signals + 2 quality signals; 3-of-4 aligned = Strong
    const dir=(dipDir!==0)?dipDir:latDir;
    let aligned=0;
    if(dipDir!==0&&dipDir===dir) aligned++;
    if(latDir!==0&&latDir===dir) aligned++;
    if(potent) aligned++;
    if(zcCount<=2) aligned++;
    const prior=(dir!==0&&aligned>=3)?'strong':((dir!==0&&aligned>=2)?'moderate':'none');
    return {dip:res, dipDir:dipDir, zcCount:zcCount, finalZC:finalZC, potent:potent,
            entropy:entGrade, sizeCut:zcCount>=5, latentDir:latDir, dir:dir, aligned:aligned, prior:prior};
  }

  // ---- book-level distributional globals (over the three dealer tiers) ----
  function bookGlobals(rows){
    const did=col(rows,'invdist'), dit=col(rows,'invtxn'), dr3=col(rows,'riskreal');
    return { DIDK:kurt(did), DITK:kurt(dit), DR3K:kurt(dr3),
             DIDS:skew(did), DITS:skew(dit), DR3S:skew(dr3),
             _didAbs:sortedAbs(did), _ditAbs:sortedAbs(dit), _dr3Abs:sortedAbs(dr3), n:did.length };
  }

  // ---- coherence misalignment patterns (risq-operational-protocol.md) -----
  function coherence(g){
    if(!g||g.DIDK==null||g.DITK==null||g.DR3K==null) return {patterns:[], p3:false};
    const out=[];
    if(g.DIDK>5.0&&g.DITK<2.5) out.push({id:1,name:'Intent/Transaction split',resp:'Structure without flow (inertia) — Layer A only until DITK>3.5'});
    if(g.DITK>4.0&&g.DR3K<2.0) out.push({id:2,name:'Transaction/Realization split',resp:'Flow not landing at the PDSL — close all layers, re-scan'});
    const p3=(g.DIDS!=null&&g.DITS!=null&&g.DR3S!=null)&&(sgn(g.DIDS)!==sgn(g.DITS)||sgn(g.DIDS)!==sgn(g.DR3S));
    if(p3) out.push({id:3,name:'Directional reversal',resp:'Most serious break — no entries, cancel all pending, observe only'});
    return {patterns:out, p3:p3};
  }

  // ---- Deep Strike scan (deep-strike-analysis.md Part II, layers 1–5) -----
  // prevICF: optional {strike -> icf} map from the prior session's scan (for
  // the ICF Time Density trend); null ⇒ trend unavailable (+1 never granted).
  function scanStrikes(rows, cr, g, prevICF){
    const byK=rows.filter(r=>fin(r.k)&&fin(r.mass)).sort((a,b)=>a.k-b.k);
    const fMax=Math.max.apply(null, byK.map(r=>Math.abs(r.force||0)).concat([1e-12]));
    const out=[];
    for(let i=0;i<byK.length;i++){
      const r=byK[i];
      const crit={ mass: fin(r.mass)&&Math.abs(r.mass)>2.0,
                   kurt: fin(r.kurt)&&r.kurt>4.5,
                   lr:   fin(r.liqratio)&&r.liqratio>8.0,
                   a:    fin(r.netoipcr)&&Math.abs(r.netoipcr)>20 };
      const nHit=(crit.mass?1:0)+(crit.kurt?1:0)+(crit.lr?1:0)+(crit.a?1:0);
      if(nHit<3) continue;                                           // background levels are never anchors
      const cls=nHit===4?'PDSL':'DSC';
      // Layer 2 — gradient by Force and its neighbor differential
      const fp=i>0?(byK[i-1].force||0):null, fn_=(i<byK.length-1)?(byK[i+1].force||0):null;
      const f=r.force||0, slope=(fp!=null&&fn_!=null)?(fn_-fp):null;
      let grad='ambiguous';
      if(Math.abs(f)<0.05*fMax) grad='phase';
      else if(f>0&&(slope==null||slope>=0)) grad='ascending';
      else if(f<0&&(slope==null||slope<=0)) grad='descending';
      // Layer 4 — dealer temporal position
      const dr3=fin(r.riskreal)?pctlRank(g._dr3Abs,r.riskreal):null;
      const icfTrend=(prevICF&&fin(r.icf)&&fin(prevICF[r.k]))?(r.icf>prevICF[r.k]):null;
      const live=(dr3!=null&&dr3<0.3)&&icfTrend!==false;             // unknown trend ⇒ not disqualifying, but no +1
      // Layer 3+5 — scorecard
      const dirWord=grad==='ascending'?1:(grad==='descending'?-1:0);
      const priorAligned=cr&&cr.prior!=='none'&&dirWord!==0&&cr.dir===dirWord;
      let score=0;
      if(nHit===4) score+=3;
      if(grad!=='ambiguous') score+=2;
      if(priorAligned) score+=2;
      if(dr3!=null&&dr3<0.3) score+=2;
      if(icfTrend===true) score+=1;
      const demoted=cr&&cr.prior!=='none'&&dirWord!==0&&cr.dir===-dirWord;  // conflicting prior ⇒ watch-only
      const tier=demoted?3:(score>=8?1:(score>=6?2:(score>=4?3:0)));
      out.push({k:r.k, cls:cls, crit:crit, nHit:nHit, grad:grad, dr3:dr3, dpt:fin(r.dpremT)?r.dpremT:null,
                icf:fin(r.icf)?r.icf:null, icfTrend:icfTrend, live:live, score:score, tier:tier,
                demoted:demoted, priorAligned:priorAligned,
                mass:r.mass, kurtV:r.kurt, lr:r.liqratio, a:r.netoipcr, force:r.force, jerk:r.jerk,
                invdist:r.invdist, invtxn:r.invtxn, riskreal:r.riskreal});
    }
    out.sort((a,b)=>b.score-a.score||Math.abs(b.mass)-Math.abs(a.mass));
    return out;
  }

  // ---- Risq: five dimensions + ℛₓ + mechanical allocation -----------------
  function risq(s, ctx){
    const g=ctx.globals;
    const rF=Math.log(1+Math.abs(s.jerk||0))*(1/Math.max(Math.abs(s.mass||0),0.01));
    const dr3=s.dr3!=null?s.dr3:0.5;
    const rT=Math.max(ctx.cw||0,0)*dr3*(1+Math.abs(ctx.dipltr||0));
    const rI=(1/Math.max(ctx.condFactor,0.01))*Math.log(1+(ctx.zcCount||0));
    let rC=null;
    if(g&&g.DIDK&&g.DITK&&g.DR3K!=null&&g.DITK!==0){
      const it=g.DIDK/g.DITK;
      rC=Math.abs(it-1)+Math.abs((g.DIDS&&g.DITS)?(g.DIDS/g.DITS-1):0)+(it!==0?Math.abs(g.DR3K/it-1):0);
    }
    const II=fin(s.invdist)?pctlRank(g._didAbs,s.invdist):null;
    const TI=fin(s.invtxn)?pctlRank(g._ditAbs,s.invtxn):null;
    const rOm=(II!=null&&TI!=null)?Math.max(II,0.01)/Math.max(TI,0.01):null;
    const den=Math.max(rF,0.1)*Math.max(rT,0.1)*Math.max(rC!=null?rC:1,0.1)*Math.max(rOm!=null?rOm:1,0.1);
    const rx=(Math.abs(s.a||0)*Math.abs(s.force||0)*ctx.condFactor)/den;
    const tier=rx>15?1:(rx>=8?2:(rx>=4?3:(rx>=1?4:5)));              // 5 = veto
    const veto=rF>4.0?'ℛ_F > 4.0 — structural veto, no entry':(ctx.p3?'Coherence Pattern 3 active — no entries':null);
    const alloc=(ctx.base||0)*Math.min(rx/15,1)*ctx.condFactor;
    return {rF:rF, rT:rT, rI:rI, rC:rC, rOm:rOm, II:II, TI:TI, rx:rx, tier:tier, veto:veto,
            alloc:veto||tier>=4?0:alloc};
  }

  // ---- Entropy Budget (risq-operational-protocol.md) ----------------------
  function entropyBudget(zcCount, rI){
    const eb0=Math.max(0, Math.min(10, 10-(zcCount*1.5)-(rI*2)));
    const grade=eb0>=8?'High — full allocation':(eb0>=5?'Moderate — Tiers 1–2 only, no Layer C'
               :(eb0>=3?'Low — Layer A only at the highest-scoring PDSL':'Minimal — observe only'));
    return {eb0:eb0, grade:grade};
  }
  function ebCost(layers, rC, rI){
    const mult=layers==='A'?0.5:(layers==='AB'?1.0:1.8);
    return ((rC!=null?rC:1)+(rI||0))*mult;
  }

  // ---- Fibonacci strike architecture --------------------------------------
  // Anchors: the two highest-scoring PDSLs (fall back to best DSC when only one
  // PDSL exists). Orientation from the dominant anchor's gradient.
  function fibAnchors(scan){
    const p=scan.filter(s=>s.cls==='PDSL');
    let a1=p[0]||scan[0], a2=p[1]||scan.find(s=>s!==a1);
    if(!a1||!a2||a1.k===a2.k) return null;
    const al=Math.min(a1.k,a2.k), ah=Math.max(a1.k,a2.k);
    const lead=a1.score>=a2.score?a1:a2;
    const dir=lead.grad==='descending'?'descending':'ascending';
    return {al:al, ah:ah, range:ah-al, dir:dir, lead:lead.k};
  }
  const FIB_LEVELS=[0,0.236,0.382,0.5,0.618,0.786,1,1.272,1.618];
  function fibGrid(anch){
    const px=f=>anch.al+f*anch.range;
    const levels=FIB_LEVELS.map(f=>({f:f,px:px(f)}));
    const quarters=[];
    const majors=[0,0.236,0.382,0.5,0.618,0.786,1];
    for(let i=0;i<majors.length-1;i++){ const w=(majors[i+1]-majors[i])/4;
      for(let q=1;q<=3;q++){ const f=majors[i]+q*w; quarters.push({f:+f.toFixed(3),px:px(f)}); } }
    return {levels:levels, quarters:quarters, px:px};
  }

  // ---- Three-layer order plan (three-layer-execution-model.md +
  //      stop-architecture-loss-management.md) ------------------------------
  function orderPlan(s, anch, ctx){
    if(!anch) return {layers:[], note:'Need two anchor strikes (2+ PDSL/DSC) for the Fibonacci grid.'};
    const grid=fibGrid(anch), px=grid.px;
    const long=s.grad!=='descending';
    const side=long?'BUY':'SELL', ex=long?'SELL':'BUY';
    const rd=v=>+v.toFixed(2);
    // condFactor gate (three-layer-execution-model.md)
    const cf=ctx.condFactor;
    let allow={A:true,B:true,C:true}, cScale=1, gateNote=null;
    if(cf>=1.10){ }
    else if(cf>=1.00){ cScale=0.5; }
    else if(cf>=0.50){ allow.B=false; allow.C=false; gateNote='condFactor 0.50 — Layer A only, B/C cancelled'; }
    else return {layers:[], note:'condFactor < 0.50 — no pre-session orders; live confirmation required even for Layer A.'};
    // Risq tier further constrains (risq-framework.md ℛₓ table)
    if(ctx.risqTier>=4) return {layers:[], note:'ℛₓ tier '+(ctx.risqTier===5?'VETO':'4 (observe)')+' — no exposure permitted.'};
    if(ctx.risqTier===3){ allow.B=false; allow.C=false; gateNote=(gateNote?gateNote+'; ':'')+'ℛₓ Tier 3 — Layer A only'; }
    else if(ctx.risqTier===2){ allow.C=false; }
    const total=Math.max(ctx.alloc||0,0);
    const sz=w=>Math.max(Math.round(total*w),total>0?1:0);
    const layers=[];
    // Long build reads 0.382→0.618 upward; short build mirrors from the 0.618 side.
    const F=f=>long?f:1-f;
    layers.push({layer:'A — Structural Anchor', type:'LIMIT', side:side, size:sz(0.30),
      entry:rd(px(F(0.382))), stop:rd(px(long?-0.059:1.059)), target:'— (build base)',
      note:'Entry at the 0.382 anchor retrace; stop at the −0.059 quarter beyond the PDSL, never inside the nearest negative-Mass strike.',
      cancel:'Cancel if a live ZC fires in the wrong CW quadrant before fill, or condFactor drops below 0.50.'});
    if(allow.B) layers.push({layer:'B — Confirmation Add', type:'LIMIT', side:side, size:sz(0.40),
      entry:rd(px(F(0.412))), stop:rd(px(long?0.345:0.655)), target:rd(px(F(0.618))),
      note:'Fires only after Layer A fills AND a confirming μ-Wave forms (μ-2 completion). Trail stop to 0.309 once μ-3 confirms.',
      cancel:'Cancel if no μ-Wave confirmation within 2 CW increments of the Layer A fill.'});
    if(allow.C) layers.push({layer:'C — Momentum Extension', type:'STOP-LIMIT', side:side, size:Math.max(Math.round(sz(0.30)*cScale),0),
      entry:rd(px(F(0.618))), stop:rd(px(0.5)), target:rd(px(F(0.786)))+' / '+rd(px(F(1.0))),
      note:'Breakout confirmation trap 1–2 ticks beyond 0.618; always stop-limit, never stop-market. Trail to 0.618 once price reaches 0.786.',
      cancel:'Armed only after 0.618 clears by CW=0; cancel at CW=+0.5.'});
    return {layers:layers, exSide:ex, grid:grid, long:long, gateNote:gateNote,
      note:'OCO bracket on every filled layer; never widen a stop — tighten or trail only. One re-entry max per PDSL after a stop-out, at 50% size.'};
  }

  window.QuanDoctrine={ closeReading:closeReading, bookGlobals:bookGlobals, coherence:coherence,
    scanStrikes:scanStrikes, risq:risq, entropyBudget:entropyBudget, ebCost:ebCost,
    fibAnchors:fibAnchors, fibGrid:fibGrid, orderPlan:orderPlan };
})();
