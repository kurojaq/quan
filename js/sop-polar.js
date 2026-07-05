(function(){
  const $=id=>document.getElementById(id);
  const canvas=$('pcv'); if(!canvas||typeof THREE==='undefined') return;
  const tip=$('ptip');
  let M=1600, CW=null, P=null,C=null,G=null,E=null, arrs=[], zc=[], dipIdx=0, ready=false, lastRW=null;
  let lastRipn=null;                 // RIPN handshake inspection data from the last compute()
  let _ripnSel=Object.create(null);  // operator-selected anchor row, keyed per (instrument|session)
  let mode2d=false, hover2d=null;
  const cv2=$('pcv2d'), ctx2=cv2?cv2.getContext('2d'):null;
  const els={cw:$('pCw'),t:$('pT'),clk:$('pClk'),p:$('pProd'),c:$('pCurv'),g:$('pGrad'),e:$('pEnv'),z:$('pDip'),src:$('pSrc')};

  const sessT=cw=>(cw+1)/2;
  function clockOf(cw){const f=sessT(cw);let mins=Math.round(f*23*60);let hh=(18*60+mins)%(24*60);const H=Math.floor(hh/60),Mn=hh%60;const ap=H<12?'AM':'PM';let h=H%12;if(h===0)h=12;return h+':'+String(Mn).padStart(2,'0')+' '+ap+' ET';}
  function nowCW(){const now=new Date();const utc=now.getTime()+now.getTimezoneOffset()*60000;const et=new Date(utc-4*3600000);let mins=et.getHours()*60+et.getMinutes();let since=(mins-18*60+1440)%1440;let f=Math.max(0,Math.min(1,since/(23*60)));return f*2-1;}
  const fmt=v=>(v>=0?'+':'')+v.toFixed(4), fmt0=v=>v.toFixed(4);
  function cr(p0,p1,p2,p3,t){const t2=t*t,t3=t2*t;return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);}
  function resample(src){const N0=src.length;const out=new Float32Array(M);
    for(let m=0;m<M;m++){const f=m/(M-1)*(N0-1);const i=Math.min(Math.floor(f),N0-2);const t=f-i;
      out[m]=cr(src[Math.max(i-1,0)],src[i],src[Math.min(i+1,N0-1)],src[Math.min(i+2,N0-1)],t);}return out;}
  const nrm=a=>{let m=0;for(const v of a)m=Math.max(m,Math.abs(v));m=m||1;const o=new Float32Array(a.length);for(let i=0;i<a.length;i++)o[i]=a[i]/m;return o;};
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
    const head=parseCsvLine(lines[0]).map(h=>h.replace(/^\ufeff/,'').replace(/^"|"$/g,'').trim());
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
    const pairs=B=>{ const sop=[]; for(let nn=0;nn<PAIR_ROWS;nn++) sop.push(B[nn]+B[20-nn]); return sop; };
    const sopG=pairs(cc), sopC=pairs(cd); const fold=sopG.map((g,i)=>g*sopC[i]);
    const cross=[]; for(let i=1;i<PAIR_ROWS;i++){ if(fold[i]===0) continue; const sc=Math.sign(fold[i]), sp=Math.sign(fold[i-1]); if(sc!==0&&sp!==0&&sc!==sp) cross.push(Math.round(cw[i]*100)/100); }
    // RIPN inspection rows for the handshake panel: [idx, strike, RIPN[0,1], AP, tuning(BR)]
    const ripn_rows=[]; for(let r=0;r<n;r++) ripn_rows.push([r, strikes[r], (isFinite(bi[r])?bi[r]:null), (isFinite(ap[r])?ap[r]:null), (r<br.length&&isFinite(br[r])?br[r]:null)]);
    return {cw,cc,cd,sopG,sopC,fold,cross,atm_strike:strikes[ai],anchor_strike:strikes[ai],n_strikes:n,covered,
            ripn_rows,auto_idx:auto_ai,used_idx:ai,manual_anchor:manual,method:RIPN_METHOD};
  }

  function compute(text, anchor, anchorIdx){
    if(!(anchor>0)) return {err:'Enter the session-open anchor price.'};
    const rows=ingestChain(text);
    if(!rows) return {err:'Not a Barchart side-by-side chain (need Strike / Premium / Open Int columns).'};
    if(rows.length<17) return {err:'Need ≥17 strikes (got '+(rows?rows.length:0)+').'};
    const rw=realizationWaves(rows, anchor, anchorIdx);
    if(!rw) return {err:'Engine could not resolve a pressure field from this chain.'};
    lastRW=rw;   // engine-exact 11-pair-row waves for the SOP Field tab (panel set)
    // RIPN handshake inspection data (Quanyun) — the operator's view of the initialization point
    lastRipn={rows:rw.ripn_rows, auto:rw.auto_idx, used:rw.used_idx, manual:rw.manual_anchor,
              anchor_strike:rw.anchor_strike, method:rw.method, n:rw.n_strikes};
    // SOP fold is symmetric (Sum of Pairs) — mirror the 11 pair-rows onto the full 21-cell CW axis.
    const mir=arr11=>{ const o=new Array(CW_STEPS); for(let k=0;k<CW_STEPS;k++) o[k]=arr11[Math.min(k,20-k)]; return o; };
    const prod21=mir(rw.fold), grad21=mir(rw.sopG), curv21=mir(rw.sopC);
    M=1600; CW=new Float32Array(M); for(let m=0;m<M;m++) CW[m]=-1+2*m/(M-1);
    const product=resample(prod21), gradient=resample(grad21), curvature=resample(curv21);
    const envelope=new Float32Array(M); for(let i=0;i<M;i++){let s=0,c=0;for(let k=-120;k<=120;k++){const j=i+k;if(j>=0&&j<M){s+=product[j];c++;}}envelope[i]=s/c;}
    P=nrm(product);C=nrm(curvature);G=nrm(gradient);E=nrm(envelope); arrs=[P,C,G,E];
    // dips = the engine's REAL coherence-break crossings (+ their mirror), plus the deepest fold point
    const idxOf=c=>Math.max(0,Math.min(M-1,Math.round((c+1)/2*(M-1))));
    const set=new Set(); rw.cross.forEach(c=>{ set.add(idxOf(c)); set.add(idxOf(-c)); });
    zc=[...set];
    dipIdx=0; for(let i=1;i<M;i++) if(P[i]<P[dipIdx]) dipIdx=i;
    const _degen=!rw.fold.some(x=>Math.abs(x)>1e-9);
    const _alabel=(rw.method==='atm'?'ATM ':'anchor ')+rw.anchor_strike.toFixed(0)+(rw.method==='atm'?'':(rw.manual_anchor?' (handshake)':' (auto)'));
    return {ok:true, degenerate:_degen, src:'engine · '+rw.method+' · '+_alabel+' · '+rw.n_strikes+' strikes · coherence breaks CW '+(rw.cross.length?rw.cross.join(', '):'none')+(rw.covered?'':' · \u26A0 window not fully covered')};
  }

  let renderer,scene,cam,diskGroup,planet,pHalo,stemGroup,dipGroup,diskLines=[],diskRiders=[],dipMeshes=[];
  const LINEC=[0xffffff,0xd9463b,0xe8b53a,0x3f9d6b], baseR=[2.0,2.7,3.4,4.1];
  let HS=1.5, BRI=0.72, zoom=1, rotX=-0.62, rotY=0;
  const angOf=idx=>(CW[idx]+1)/2*Math.PI*2;
  function diskPt(li,idx){const R=baseR[li];return new THREE.Vector3(R*Math.cos(angOf(idx)),arrs[li][idx]*HS,R*Math.sin(angOf(idx)));}
  function foldColor(v){const c=new THREE.Color();const cool=new THREE.Color(0x6fd3ff),mid=new THREE.Color(0xf6f2e9),warm=new THREE.Color(0xffc24d);if(v<0)c.copy(cool).lerp(mid,1+v);else c.copy(mid).lerp(warm,Math.min(v,1));return c;}
  function applyCam(){const d=16/zoom;cam.position.set(d*Math.sin(rotY)*Math.cos(rotX),d*Math.sin(rotX)+5,d*Math.cos(rotY)*Math.cos(rotX));cam.lookAt(0,0,0);}
  function psize(){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h||!renderer)return;renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
  window.__polarResize=psize;

  function initScene(){
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    scene=new THREE.Scene(); scene.add(new THREE.AmbientLight(0xffffff,0.95));
    cam=new THREE.PerspectiveCamera(52,1,0.1,1500);
    const STAR=600,sgg=new THREE.BufferGeometry(),sp=new Float32Array(STAR*3);
    for(let i=0;i<STAR;i++){sp[i*3]=(Math.random()*2-1)*42;sp[i*3+1]=(Math.random()*2-1)*24;sp[i*3+2]=(Math.random()*2-1)*30-12;}
    sgg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sgg,new THREE.PointsMaterial({color:0xbfb9a8,size:0.08,transparent:true,opacity:0.4})));
    diskGroup=new THREE.Group(); scene.add(diskGroup);
    const disk=new THREE.Mesh(new THREE.CircleGeometry(4.5,90),new THREE.MeshBasicMaterial({color:0x141210,transparent:true,opacity:0.4,side:THREE.DoubleSide}));disk.rotation.x=-Math.PI/2;diskGroup.add(disk);
    for(const rr of baseR){const seg=[];for(let j=0;j<=90;j++){const t=j/90*Math.PI*2;seg.push(new THREE.Vector3(rr*Math.cos(t),0,rr*Math.sin(t)));}diskGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(seg),new THREE.LineBasicMaterial({color:0x2a2620})));}
    diskGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.5,24,24),new THREE.MeshBasicMaterial({color:0xffe9b0,transparent:true,opacity:0.5,blending:THREE.AdditiveBlending})));
    stemGroup=new THREE.Group(); diskGroup.add(stemGroup);
    dipGroup=new THREE.Group(); diskGroup.add(dipGroup);
    planet=new THREE.Mesh(new THREE.SphereGeometry(0.2,24,24),new THREE.MeshBasicMaterial({color:0xfff4d8}));
    pHalo=new THREE.Mesh(new THREE.SphereGeometry(0.34,24,24),new THREE.MeshBasicMaterial({color:0xfff4d8,transparent:true,opacity:0.3,blending:THREE.AdditiveBlending,depthWrite:false}));
    diskGroup.add(planet,pHalo); applyCam();
  }
  function rebuildGeom(){
    diskLines.forEach(l=>{diskGroup.remove(l);l.geometry.dispose();l.material.dispose();}); diskLines=[];
    diskRiders.forEach(r=>{diskGroup.remove(r);r.geometry.dispose();r.material.dispose();}); diskRiders=[];
    while(stemGroup.children.length){const c=stemGroup.children.pop();c.geometry.dispose();c.material.dispose();}
    while(dipGroup.children.length){const c=dipGroup.children.pop();c.geometry.dispose();c.material.dispose();} dipMeshes=[];
    LINEC.forEach((col,li)=>{const pts=[];for(let m=0;m<M;m+=2)pts.push(diskPt(li,m));const ln=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0.35+BRI*0.55}));diskGroup.add(ln);diskLines.push(ln);});
    LINEC.forEach(col=>{const m=new THREE.Mesh(new THREE.SphereGeometry(0.12,14,14),new THREE.MeshBasicMaterial({color:col}));diskGroup.add(m);diskRiders.push(m);});
    for(let m=0;m<M;m+=40){const a=angOf(m),R=baseR[3];stemGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(R*Math.cos(a),0,R*Math.sin(a)),new THREE.Vector3(R*Math.cos(a),P[m]*HS,R*Math.sin(a))]),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.12})));}
    [dipIdx,...zc].forEach((idx,n)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(n===0?0.16:0.1,14,14),new THREE.MeshBasicMaterial({color:0x6fd3ff}));m.position.copy(diskPt(0,idx));m.userData.idx=idx;dipGroup.add(m);dipMeshes.push(m);});
  }
  function readAt(hi){ hi=Math.max(0,Math.min(M-1,hi|0));
    els.cw.textContent=fmt(CW[hi]); els.t.textContent=fmt0(sessT(CW[hi])); els.clk.textContent=clockOf(CW[hi]);
    els.p.textContent=fmt(P[hi]);els.c.textContent=fmt(C[hi]);els.g.textContent=fmt(G[hi]);els.e.textContent=fmt(E[hi]);
    let best=1e9,bi=dipIdx;for(const zi of zc){const d=Math.abs(CW[zi]-CW[hi]);if(d<best){best=d;bi=zi;}}{const d=Math.abs(CW[dipIdx]-CW[hi]);if(d<best){best=d;bi=dipIdx;}}
    els.z.textContent='CW '+fmt(CW[bi])+(best<0.01?'  (IN IT)':'  \u0394 '+best.toFixed(4)); }
  function update(headF){
    if(!ready) return; const hi=Math.min(Math.floor(headF),M-1);
    const hp=diskPt(3,hi); planet.position.copy(hp); pHalo.position.copy(hp);
    planet.material.color.copy(foldColor(P[hi])); pHalo.material.color.copy(foldColor(P[hi]));
    diskRiders.forEach((m,li)=>m.position.copy(diskPt(li,hi)));
    readAt(hi);
  }
  // ===== 2-D SOP wave field (same data as the disk, flattened onto the CW axis) =====
  const C2=['#ffffff','#d9463b','#e8b53a','#3f9d6b'];   // product, curvature, gradient, envelope
  function fit2d(){ if(!cv2) return; const w=cv2.clientWidth,h=cv2.clientHeight; if(!w||!h) return;
    const dpr=Math.min(devicePixelRatio||1,2); const W=Math.round(w*dpr),H=Math.round(h*dpr);
    if(cv2.width!==W||cv2.height!==H){cv2.width=W;cv2.height=H;} }
  function draw2d(){
    if(!ctx2||!cv2) return; fit2d();
    const w=cv2.clientWidth,h=cv2.clientHeight; if(!w||!h) return;
    const dpr=Math.min(devicePixelRatio||1,2); ctx2.setTransform(dpr,0,0,dpr,0,0); ctx2.clearRect(0,0,w,h);
    ctx2.fillStyle='#07090d'; ctx2.fillRect(0,0,w,h);
    if(!ready){ ctx2.fillStyle='#8f8c82'; ctx2.font='12px monospace'; ctx2.textAlign='left'; ctx2.fillText('load a session chain + anchor',16,26); return; }
    const padL=34,padR=12,padT=18,padB=22, x0=padL,x1=w-padR,y0=padT,y1=h-padB;
    const YMIN=-1.1,YMAX=1.1;
    const xAt=cw=>x0+(cw+1)/2*(x1-x0), yAt=v=>y0+(YMAX-v)/(YMAX-YMIN)*(y1-y0), xIdx=i=>xAt(CW[i]);
    ctx2.fillStyle='#0b0f14'; ctx2.fillRect(x0,y0,x1-x0,y1-y0);
    // grid + labels
    ctx2.lineWidth=0.5; ctx2.font='9px monospace'; ctx2.fillStyle='#a6a299';
    ctx2.strokeStyle='rgba(255,255,255,0.05)'; ctx2.textAlign='center';
    for(let t=-10;t<=10;t++){ const X=xAt(t/10); ctx2.beginPath(); ctx2.moveTo(X,y0); ctx2.lineTo(X,y1); ctx2.stroke();
      if(t%2===0) ctx2.fillText((t/10).toFixed(1),X,y1+12); }
    ctx2.textAlign='right';
    for(let yy=-1;yy<=1;yy+=0.5){ const Y=yAt(yy); ctx2.beginPath(); ctx2.moveTo(x0,Y); ctx2.lineTo(x1,Y); ctx2.stroke(); ctx2.fillText(yy.toFixed(1),x0-4,Y+3); }
    ctx2.strokeStyle='rgba(232,227,214,0.7)'; const yz=yAt(0); ctx2.beginPath(); ctx2.moveTo(x0,yz); ctx2.lineTo(x1,yz); ctx2.stroke();
    ctx2.strokeStyle='rgba(255,255,255,0.08)'; ctx2.strokeRect(x0,y0,x1-x0,y1-y0);
    // curves (envelope -> gradient -> curvature -> product on top)
    const order=[[E,C2[3],1.3],[G,C2[2],1.3],[C,C2[1],1.3],[P,C2[0],1.9]];
    for(const [a,col,lw] of order){ ctx2.strokeStyle=col; ctx2.lineWidth=lw; ctx2.beginPath();
      for(let i=0;i<M;i+=2){ const X=xIdx(i),Y=yAt(Math.max(YMIN,Math.min(YMAX,a[i]))); i?ctx2.lineTo(X,Y):ctx2.moveTo(X,Y); } ctx2.stroke(); }
    // coherence dips: dashed cyan verticals + dots on the product line
    ctx2.setLineDash([3,3]); ctx2.strokeStyle='rgba(111,211,255,0.5)'; ctx2.lineWidth=1;
    zc.forEach(zi=>{ const X=xIdx(zi); ctx2.beginPath(); ctx2.moveTo(X,y0); ctx2.lineTo(X,y1); ctx2.stroke(); }); ctx2.setLineDash([]);
    zc.forEach(zi=>{ ctx2.fillStyle='#6fd3ff'; ctx2.beginPath(); ctx2.arc(xIdx(zi),yAt(P[zi]),2.6,0,7); ctx2.fill(); });
    { ctx2.strokeStyle='#6fd3ff'; ctx2.lineWidth=1.5; ctx2.beginPath(); ctx2.arc(xIdx(dipIdx),yAt(P[dipIdx]),5,0,7); ctx2.stroke(); }  // deepest fold
    // playhead (scrub/now)
    const hi=Math.max(0,Math.min(M-1,headF|0)); ctx2.strokeStyle='rgba(255,244,216,0.4)'; ctx2.lineWidth=1; ctx2.beginPath(); ctx2.moveTo(xIdx(hi),y0); ctx2.lineTo(xIdx(hi),y1); ctx2.stroke();
    // active marker = hover (trace) else playhead
    const act=(hover2d!=null)?hover2d:hi, Xa=xIdx(act);
    if(hover2d!=null){ ctx2.strokeStyle='rgba(255,255,255,0.85)'; ctx2.lineWidth=1; ctx2.beginPath(); ctx2.moveTo(Xa,y0); ctx2.lineTo(Xa,y1); ctx2.stroke(); }
    order.forEach(([a,col])=>{ const Y=yAt(Math.max(YMIN,Math.min(YMAX,a[act]))); ctx2.fillStyle=col; ctx2.beginPath(); ctx2.arc(Xa,Y,3,0,7); ctx2.fill(); ctx2.strokeStyle='rgba(0,0,0,0.5)'; ctx2.lineWidth=0.5; ctx2.stroke(); });
    ctx2.fillStyle='rgba(214,210,198,0.8)'; ctx2.font='10px monospace'; ctx2.textAlign='right'; ctx2.fillText('SOP fold field \u00b7 product \u00d7 curvature \u00d7 gradient',x1,11);
    readAt(act);
  }
  function setZoom(mult){zoom=Math.max(0.3,Math.min(4,zoom*mult));applyCam();}
  $('pzin').onclick=()=>setZoom(1.2); $('pzout').onclick=()=>setZoom(0.83);
  canvas.addEventListener('wheel',e=>{e.preventDefault();setZoom(e.deltaY>0?0.92:1.08);},{passive:false});
  let dragging=false,pxm=0,pym=0; const ray=new THREE.Raycaster();
  canvas.addEventListener('pointerdown',e=>{dragging=true;pxm=e.clientX;pym=e.clientY;});
  addEventListener('pointerup',()=>dragging=false);
  addEventListener('pointermove',e=>{ if(pmode!=='disk') return; if(!ready||!cam) return; const r=canvas.getBoundingClientRect(); if(!r.width){tip.style.display='none';return;} const mx=e.clientX-r.left,my=e.clientY-r.top;
    if(dragging){rotY+=(e.clientX-pxm)*0.01;rotX=Math.max(-1.45,Math.min(1.45,rotX+(e.clientY-pym)*0.01));pxm=e.clientX;pym=e.clientY;applyCam();tip.style.display='none';return;}
    if(mx<0||my<0||mx>r.width||my>r.height){tip.style.display='none';return;}
    const ndc=new THREE.Vector2((mx/r.width)*2-1,-(my/r.height)*2+1);ray.setFromCamera(ndc,cam);
    const hits=ray.intersectObjects(dipMeshes,false);
    if(hits.length){const idx=hits[0].object.userData.idx,cw=CW[idx],win=0.06,lo=Math.max(-1,cw-win),hiw=Math.min(1,cw+win);
      tip.innerHTML='<b>Coherence dip</b><br>CW '+fmt(cw)+' &middot; session-t '+fmt0(sessT(cw))+'<br>clock &asymp; '+clockOf(cw)+'<br>window: '+clockOf(lo)+' &rarr; '+clockOf(hiw)+'<span class="warn">framework-defined window — candidate to lock &amp; score, not a validated price-collapse window.</span>';
      tip.style.display='block';tip.style.left=Math.min(mx+14,r.width-250)+'px';tip.style.top=(my+12)+'px';
    } else tip.style.display='none'; });

  const playBtn=$('pPlay'),scrub=$('pScrub'),snap=$('pSnap'),spd=$('pSpd'),hsR=$('pHs'),bri=$('pBri');
  let playing=false,headF=0,live=true;   // live = planet rides the real session clock (nowCW), advancing through the session
  function setLiveBadge(){ if(snap) snap.classList.toggle('on',live); }
  playBtn.onclick=function(){ if(live){ live=false; playing=false; } else { playing=!playing; } this.textContent=(playing||live)?'\u23F8':'\u25B6'; setLiveBadge(); };
  scrub.addEventListener('input',()=>{ live=false; playing=false; playBtn.textContent='\u25B6'; headF=(+scrub.value)/1000*(M-1); setLiveBadge(); });
  snap.onclick=()=>{ live=true; playing=false; playBtn.textContent='\u23F8'; setLiveBadge(); };   // re-engage live session tracking
  setLiveBadge();
  hsR.addEventListener('input',()=>{HS=(+hsR.value)/10; if(ready) rebuildGeom();});
  bri.addEventListener('input',()=>{BRI=(+bri.value)/100;diskLines.forEach(ln=>ln.material.opacity=0.35+BRI*0.55);});

  // ---- Polar Disk / TSC / Headline toggle ----
  const bDisk=$('pVdisk'), b2d=$('pV2d'), bHead=$('pVhead'), bPanel=$('pVpanels'), bPG=$('pVpgxc'), bTN=$('pVtensor'), bLT=$('pVlatent'), bCxg=$('pVcxg'), pzoomEl=canvas.parentElement.querySelector('.pzoom'), headView=$('pHeadView'), panelView=$('pPanelView'), pgView=$('pPGxCView'), tnView=$('pTensorView'), ltView=$('pLatentView'), cxgView=$('pCxGView');
  const _psec=canvas.closest('.tabsec'); const diskCtls=_psec?[_psec.querySelector('.preadout'),_psec.querySelector('.ptimebar'),_psec.querySelector('.pctl'),_psec.querySelector('footer')]:[];
  let pmode='head';   // disk | tsc | head | panels | pgxc | tensor | latent | cxg
  function setPMode(m){ pmode=m; mode2d=(m==='tsc'); hover2d=null; tip.style.display='none';
    const B={disk:bDisk,tsc:b2d,head:bHead,panels:bPanel,pgxc:bPG,tensor:bTN,latent:bLT,cxg:bCxg};
    for(const k in B){ if(B[k]) B[k].classList.toggle('on',m===k); }
    { const _sel=document.getElementById('pViewSel'); if(_sel&&_sel.value!==m)_sel.value=m; }
    canvas.style.display=(m==='disk')?'block':'none';
    if(cv2)cv2.style.display=(m==='tsc')?'block':'none';
    if(headView)headView.style.display=(m==='head')?'flex':'none';
    if(panelView)panelView.style.display=(m==='panels')?'flex':'none';
    if(pgView)pgView.style.display=(m==='pgxc')?'flex':'none';
    if(tnView)tnView.style.display=(m==='tensor')?'flex':'none';
    if(ltView)ltView.style.display=(m==='latent')?'flex':'none';
    if(cxgView)cxgView.style.display=(m==='cxg')?'flex':'none';
    if(pzoomEl)pzoomEl.style.display=(m==='disk')?'':'none';
    diskCtls.forEach(el=>{ if(el) el.style.display=(m==='disk')?'':'none'; });   // readout/scrubber/sliders/legend are disk-only
    if(m==='disk') psize(); else if(m==='tsc') draw2d(); else if(window.__sopResize) window.__sopResize(); }
  if(bDisk)bDisk.addEventListener('click',()=>setPMode('disk'));
  if(b2d)b2d.addEventListener('click',()=>setPMode('tsc'));
  if(bHead)bHead.addEventListener('click',()=>setPMode('head'));
  if(bPanel)bPanel.addEventListener('click',()=>setPMode('panels'));
  if(bPG)bPG.addEventListener('click',()=>setPMode('pgxc'));
  if(bTN)bTN.addEventListener('click',()=>setPMode('tensor'));
  if(bLT)bLT.addEventListener('click',()=>setPMode('latent'));
  if(bCxg)bCxg.addEventListener('click',()=>setPMode('cxg'));
  try{setPMode('head');}catch(_e){}
  { const pvSel=document.getElementById('pViewSel'); if(pvSel)pvSel.addEventListener('change',()=>setPMode(pvSel.value)); }
  // trace cursor on the 2-D graph: free-move along CW, snap to nearest dip to pinpoint it
  if(cv2){
    cv2.addEventListener('mousemove',e=>{ if(!ready||!mode2d) return; const r=cv2.getBoundingClientRect(); const w=r.width;
      const padL=34,padR=12,x0=padL,x1=w-padR; const mx=e.clientX-r.left;
      let cw=Math.max(-1,Math.min(1,(mx-x0)/(x1-x0)*2-1)); let idx=Math.round((cw+1)/2*(M-1));
      let snapZ=null,bestpx=11; for(const zi of [dipIdx,...zc]){ const d=Math.abs((x0+(CW[zi]+1)/2*(x1-x0))-mx); if(d<bestpx){bestpx=d;snapZ=zi;} }
      if(snapZ!=null) idx=snapZ; hover2d=Math.max(0,Math.min(M-1,idx));
      if(snapZ!=null){ const cwv=CW[snapZ],win=0.06,lo=Math.max(-1,cwv-win),hiw=Math.min(1,cwv+win);
        tip.innerHTML='<b>Coherence dip</b><br>CW '+fmt(cwv)+' &middot; session-t '+fmt0(sessT(cwv))+'<br>clock &asymp; '+clockOf(cwv)+'<br>window: '+clockOf(lo)+' &rarr; '+clockOf(hiw)+'<span class="warn">framework-defined window &mdash; candidate to lock &amp; score, not a validated price-collapse window.</span>';
        tip.style.display='block'; tip.style.left=Math.min(mx+14,w-250)+'px'; tip.style.top=((e.clientY-r.top)+12)+'px';
      } else tip.style.display='none'; });
    cv2.addEventListener('mouseleave',()=>{ hover2d=null; tip.style.display='none'; });
  }

  let _lastCsv=null;
  // Per-instrument data is owned centrally by the header hub (window.__q*). This tab is a render target.
  window.__polarClear=function(){ _lastCsv=null; ready=false; lastRW=null; if(diskGroup)diskGroup.visible=false;
    $('pFn').textContent='no session loaded'; els.src.textContent='no session loaded'; els.src.style.color='#8f8c82'; showAnchorPrompt(null); emitSop(); };
  window.__polarSetAnchor=function(v){ $('pAnchor').value=(v==null?'':v); if(_lastCsv!=null) runEngine(); };
  // ---- engine-exact SOP panel data for the SOP Field tab (golden 'SOP Folding' sheet formulas) ----
  function emitSop(){ window.dispatchEvent(new CustomEvent('quan:sop')); }
  window.__sopData=function(){ const rw=lastRW; if(!ready||!rw) return null;
    const g=rw.sopG,c=rw.sopC,J=rw.fold,n=g.length, pair=[],tension=[],pcurv=[],gc=[],cg=[];
    for(let i=0;i<n;i++){ pair.push(Math.round(i*0.1*1e10)/1e10);
      const Jn=J[i],Jx=(i+1<n?J[i+1]:0); tension.push(Jn+Jx); pcurv.push(Jx-Jn);   // K=J+next, L=Jnext-J
      gc.push(c[i]!==0?g[i]/c[i]:0); cg.push(g[i]!==0?c[i]/g[i]:0); }                 // H=SOPG/SOPC, I=SOPC/SOPG
    // three latent paths — quan_paths._latent_paths, Euler dt=0.1 (brief's render_latent_paths)
    const Q=new Array(n).fill(0),P=new Array(n).fill(0),R=new Array(n).fill(0);
    for(let i=1;i<n;i++){ if(i<3) Q[i]=Q[i-1]+g[i-1]*0.1; else { const r=(c[i-1]!==0)?g[i-1]/c[i-1]:0; Q[i]=Q[i-1]+r*0.1; }
      P[i]=P[i-1]+c[i-1]*0.1; R[i]=R[i-1]+P[i-1]*0.1; }
    // workbook SOP-Folding latent cols feeding the Tensor Surface: O(col15), Q(col17). L=pcurv, H=gc.
    const Owb=new Array(n).fill(0), Qwb=new Array(n).fill(0);
    Qwb[0]=g[0]; if(n>1) Qwb[1]=Qwb[0]+g[0]*0.1; for(let i=2;i<n;i++) Qwb[i]=Qwb[i-1]+gc[i-1]*0.1;
    Owb[0]=0; if(n>1) Owb[1]=0; for(let i=2;i<n;i++) Owb[i]=Owb[i-1]-pcurv[i-1];
    return {pair,sopG:g,sopC:c,product:J,tension,pcurv,gc,cg,
      cw:rw.cw,pg:rw.cc,pc:rw.cd,                                 // PGxC: 21-cell pressure gradient/curvature
      latent:{Q,P,R},                                            // three latent paths
      tensor:{O:Owb,Q:Qwb,chrono:pair.slice()},                  // Book Tensor surface inputs (|O|·exp(-(off-Q)^2))
      atm:rw.atm_strike,n_strikes:rw.n_strikes,covered:rw.covered,cross:rw.cross}; };
  function showAnchorPrompt(msg){ const el=$('pAnchorPrompt'); if(!el) return;
    if(msg){ const m=$('pAnchorPromptMsg'); if(m) m.textContent=msg; el.style.display='flex'; } else el.style.display='none'; }
  function runEngine(){ if(_lastCsv==null){ showAnchorPrompt(null); lastRW=null; lastRipn=null; emitSop(); window.dispatchEvent(new CustomEvent('quan:ripn')); return; } const anchor=parseFloat($('pAnchor').value);
    const _sel=_ripnSel[_ripnKey()];
    const res=compute(_lastCsv, anchor, (_sel==null?null:_sel));
    if(res.err){ els.src.textContent=res.err; els.src.style.color='#e07a6a'; showAnchorPrompt(res.err); ready=false; lastRW=null; lastRipn=null; emitSop(); window.dispatchEvent(new CustomEvent('quan:ripn')); return; }
    els.src.style.color='#6f675a'; els.src.textContent=res.src;
    showAnchorPrompt(res.degenerate ? "This expiry's ATM open interest is empty \u2014 pressure field can't resolve. Toggle to the other expiry (Daily/EOM), or load an EOD/settlement chain." : null);
    ready=true; if(scene) rebuildGeom(); psize(); headF=0; scrub.value=0; emitSop(); window.dispatchEvent(new CustomEvent('quan:ripn')); }
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
    const fz=(v,d)=>(v==null||!isFinite(v))?'\u2014':(+v).toFixed(d);
    const fAP=v=>{ if(v==null||!isFinite(v)) return '\u2014'; const a=Math.abs(v); return (v<0?'\u2212':'')+(a>=1e6?(a/1e6).toFixed(1)+'M':a>=1e3?(a/1e3).toFixed(0)+'k':a.toFixed(0)); };
    function render(){
      const p=$r('ripnPanel'); if(!p) return; const head=$r('ripnHead'), tbl=$r('ripnTbl');
      const d=window.__ripnData&&window.__ripnData();
      if(!d||!d.rows||!d.rows.length){ if(head)head.textContent='No chain loaded \u2014 the RIPN column appears once the engine has a chain + anchor.'; if(tbl)tbl.innerHTML=''; return; }
      const auto=d.auto, used=d.used;
      head.innerHTML='anchor <b style="color:var(--cream)">'+(d.anchor_strike!=null?(+d.anchor_strike).toFixed(0):'\u2014')+'</b> \u00b7 '
        +(d.manual?'<span style="color:#e8b53a">handshake</span>':'<span style="color:#6fd3ff">auto</span>')
        +' \u00b7 row '+used+(auto>=0&&auto!==used?' \u00b7 auto was '+auto:'')+' \u00b7 '+d.n+' strikes';
      let h='<thead><tr>'+['#','strike','RIPN','AP','tuning'].map(x=>'<th style="position:sticky;top:0;background:#26262d;text-align:right;padding:3px 7px;color:#8f8c82;font-weight:600;font-size:9.5px;border-bottom:0.5px solid #3a3a42">'+x+'</th>').join('')+'</tr></thead><tbody>';
      for(const r of d.rows){ const idx=r[0],strike=r[1],ripn=r[2],ap=r[3],tun=r[4];
        const isAuto=idx===auto, isUsed=idx===used, anchorRipn=(ripn===0||ripn===1);
        const mark=isUsed?'<span style="color:#e8b53a">\u25b8</span> ':(isAuto?'<span style="color:#6fd3ff">\u00b7</span> ':'');
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
  window.__polarLoadChain=function(text,name){ $('pFn').textContent=name; _lastCsv=text; if(diskGroup)diskGroup.visible=true; runEngine(); };
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
  window.__polarBoot=function(){ if(booted) return; booted=true; initScene(); psize(); if(ready) rebuildGeom();
    (function loop(){requestAnimationFrame(loop);
      if(ready){
        if(live){ const cw=nowCW(); headF=(cw+1)/2*(M-1); scrub.value=Math.floor((cw+1)/2*1000); }
        else if(playing){ headF+=(+spd.value)*0.55; if(headF>=M-1)headF=0; scrub.value=Math.floor(headF/(M-1)*1000); }
      }
      if(pmode==='tsc'){ draw2d(); }
      else if(pmode==='disk' && ready){ update(headF);
        const tms=performance.now()*0.005,pulse=1+0.28*Math.sin(tms); planet.scale.setScalar(pulse); pHalo.scale.setScalar(1+0.5*Math.sin(tms+0.5)); }
      if(pmode==='disk' && renderer&&scene&&cam) renderer.render(scene,cam);
    })(); };
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
  const head=$('sopHead'), grid=$('sopGrid'); if(!head||!grid) return;
  const hctx=head.getContext('2d'), gctx=grid.getContext('2d');
  const pgcv=$('sopPG'), tncv=$('sopTensor'), ltcv=$('sopLatent'), famcv=$('sopFam');
  const pgctx=pgcv&&pgcv.getContext('2d'), tnctx=tncv&&tncv.getContext('2d'), ltctx=ltcv&&ltcv.getContext('2d'), famctx=famcv&&famcv.getContext('2d');
  const hPG={t:null}, hLT={t:null}, hTN={i:null}; let _tnMap=null, famState='curv';
  const CURV_TITLES=['Pairs Multiplied','Pairs Divided','PM/PD','PD/PM','Sum of Pairs Curvature','Sum of Pairs','PM/PD Curvature','Sum/Difference','Sum*Diff','S/D Curvature','Dual Phase','Sum/ Sum Diff','Difference In Pairs Left to Right','Sum of Pairs/Pairs Multiplied','DIPLTR/PD','SOPPM/DIPLTRPD(SDD)','DIPLTRPD/SOPPM','SOPPM/DIPLTR(SMD)','DIPLTR/PD Tension','Pressure Curvature'];
  const GRAD_TITLES=['Pairs Multiplied','Pairs Divided','PM/PD','PD/PM','Sum of Pairs Curvature','Sum of Pairs','PM/PD Curvature','Sum/Difference','Sum*Diff','S/D Curvature','Dual Phase','Sum/ Sum Diff','Difference In Pairs Left to Right','Sum of Pairs/Pairs Multiplied','DIPLTR/PD','SOPPM/DIPLTRPD(SDD)','DIPLTRPD/SOPPM','SOPPM/DIPLTR(SMD)','DIPLTR/PD Tension','Pressure Gradient','Pairs Multiplied Gradient','PM Curvature'];
  const BG='#07090d',PLOT='#0b0f14',FG='#c7cdd7',GRID='rgba(255,255,255,0.06)',FRAME='rgba(255,255,255,0.10)',ZERO='rgba(255,255,255,0.72)',CYAN='#6fd3ff';
  const WHITE='#ffffff',RED='#d9463b',GOLD='#e8b53a',TEAL='#3f9d6b';
  let hoverT=null;
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
    if(!d){ hctx.fillStyle='#6f675a'; hctx.font='12px monospace'; hctx.textAlign='left'; hctx.fillText('load a session chain + anchor (set on any chain tab) \u2014 the engine computes the SOP field',16,26); return; }
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
    hctx.fillStyle=FG; hctx.font='12px monospace'; hctx.textAlign='left'; hctx.fillText('SOP wave field (headline) \u2014 product = fold/coherence wave',x0,18);
    hctx.font='9px monospace'; hctx.fillStyle='#8f8c82'; hctx.textAlign='center'; hctx.fillText('chronometer watch  (0 ATM \u2192 1 expiry arc)',(x0+x1)/2,h-6);
    // legend lower-left
    hctx.textAlign='left'; hctx.font='9px monospace'; let ly=y1-4-lines.length*11;
    lines.forEach(ln=>{ hctx.strokeStyle=ln.c; hctx.lineWidth=2; hctx.beginPath(); hctx.moveTo(x0+6,ly); hctx.lineTo(x0+22,ly); hctx.stroke(); hctx.fillStyle=FG; hctx.fillText(ln.lab,x0+27,ly+3); ly+=11; });
    // hover crosshair
    if(hoverT!=null){ const t=hoverT, X=xAt(t);
      hctx.strokeStyle='rgba(255,255,255,0.7)'; hctx.lineWidth=1; hctx.beginPath(); hctx.moveTo(X,y0); hctx.lineTo(X,y1); hctx.stroke();
      lines.forEach(ln=>{ const Y=yAt(crEval(ln.d,t)); hctx.fillStyle=ln.c; hctx.beginPath(); hctx.arc(X,Y,3,0,7); hctx.fill(); });
      let nb=null,bd=1; breaks.forEach(i=>{const dd=Math.abs(i/10-t); if(dd<bd){bd=dd;nb=i;}}); const isBrk=(nb!=null&&bd<=0.025);
      const txt=['t '+t.toFixed(2)+' \u00b7 '+clockT(t)+(isBrk?'  \u25c6 coherence break':(nb!=null?'  \u00b7 break @ '+(nb/10).toFixed(1):'')),
        'product '+fmt(crEval(d.product,t))+'   tension '+fmt(crEval(d.tension,t)),
        'gradient '+fmt(crEval(d.sopG,t))+'   curvature '+fmt(crEval(d.sopC,t))];
      hctx.font='9px monospace'; let bw=0; txt.forEach(s=>bw=Math.max(bw,hctx.measureText(s).width)); bw+=12;
      let bx=Math.min(X+10,x1-bw), by=y0+6; if(bx<x0)bx=x0;
      hctx.fillStyle='rgba(18,18,22,0.94)'; hctx.strokeStyle='#4c4c54'; hctx.lineWidth=1; hctx.fillRect(bx,by,bw,txt.length*12+6); hctx.strokeRect(bx,by,bw,txt.length*12+6);
      hctx.textAlign='left'; txt.forEach((s,k)=>{ hctx.fillStyle=k===0?(isBrk?CYAN:FG):FG; hctx.fillText(s,bx+6,by+13+k*12); });
    }
    // source note
    hctx.font='9px monospace'; hctx.fillStyle='#8f8c82'; hctx.textAlign='right';
    hctx.fillText('ATM '+(d.atm!=null?Math.round(d.atm):'\u2014')+' \u00b7 '+d.n_strikes+' strikes \u00b7 breaks '+(breaks.length?breaks.map(i=>(i/10).toFixed(1)).join(', '):'none')+(d.covered?'':' \u00b7 \u26a0 not fully covered'), x1, 18);
  }
  // ---------- panel grid ----------
  function miniPanel(x0,y0,w,h,lns,title){
    const ix0=x0+30,iy0=y0+16,ix1=x0+w-8,iy1=y0+h-16;
    const [ylo,yhi]=range(lns);
    const xAt=t=>ix0+t*(ix1-ix0), yAt=v=>iy1-(v-ylo)/(yhi-ylo)*(iy1-iy0);
    gctx.fillStyle=PLOT; gctx.fillRect(ix0,iy0,ix1-ix0,iy1-iy0);
    gctx.fillStyle='#a6a299'; gctx.font='8px monospace';
    gctx.strokeStyle='rgba(255,255,255,0.08)'; gctx.lineWidth=1; gctx.strokeRect(ix0,iy0,ix1-ix0,iy1-iy0);
    gctx.textAlign='right'; for(let k=0;k<=2;k++){ const v=ylo+(yhi-ylo)*k/2, Y=yAt(v); gctx.fillText(v.toFixed(Math.abs(v)>=100?0:1),ix0-3,Y+3); }
    if(ylo<0&&yhi>0){ gctx.strokeStyle=ZERO; gctx.lineWidth=0.6; const Y=yAt(0); gctx.beginPath(); gctx.moveTo(ix0,Y); gctx.lineTo(ix1,Y); gctx.stroke(); }
    gctx.textAlign='center'; for(let t=0;t<=10;t+=5){ gctx.fillStyle='#a6a299'; gctx.fillText((t/10).toFixed(1),xAt(t/10),iy1+11); }
    for(const ln of lns){ gctx.strokeStyle=ln.c; gctx.lineWidth=1.3; gctx.beginPath();
      ln.d.forEach((v,i)=>{ const X=xAt(i/10),Y=yAt(v); i?gctx.lineTo(X,Y):gctx.moveTo(X,Y); }); gctx.stroke();
      gctx.fillStyle=ln.c; ln.d.forEach((v,i)=>{ gctx.beginPath(); gctx.arc(xAt(i/10),yAt(v),1.8,0,7); gctx.fill(); }); }
    gctx.fillStyle=FG; gctx.font='8.5px monospace'; gctx.textAlign='left'; gctx.fillText(title,ix0,y0+10);
    if(lns.length>1){ gctx.textAlign='right'; let lx=ix1; lns.slice().reverse().forEach(ln=>{ const t=ln.lab||''; gctx.fillStyle=ln.c; gctx.fillText(t,lx,y0+10); lx-=gctx.measureText(t).width+12; }); }
  }
  function drawGrid(){
    const f=fit(grid,gctx); if(!f) return; const {w,h}=f;
    gctx.fillStyle=BG; gctx.fillRect(0,0,w,h);
    const d=window.__sopData&&window.__sopData();
    gctx.fillStyle=FG; gctx.font='10px monospace'; gctx.textAlign='left'; gctx.fillText('SOP Folding \u2014 full panel set  (shared chronometer x-axis)',12,14);
    if(!d){ gctx.fillStyle='#6f675a'; gctx.font='11px monospace'; gctx.fillText('(panels populate once a chain + anchor are loaded)',12,34); return; }
    const panels=[
      [[{d:d.product,c:WHITE}],'product (fold/coherence)'],
      [[{d:d.tension,c:TEAL}],'Product Tension (J+next)'],
      [[{d:d.pcurv,c:RED}],'Product Curvature'],
      [[{d:d.gc,c:CYAN}],'SOPG / SOPC (ratio)'],
      [[{d:d.cg,c:CYAN}],'SOPC / SOPG (inverse)'],
      [[{d:d.sopG,c:GOLD,lab:'SOPG'},{d:d.sopC,c:RED,lab:'SOPC'}],'SOPG & SOPC (raw factors)'] ];
    const cols=3,rows=2, top=20, pw=(w-12*2)/cols, ph=(h-top-8)/rows;
    panels.forEach((p,i)=>{ const cx=i%cols, cy=(i/cols)|0; miniPanel(12+cx*pw, top+cy*ph, pw-8, ph-6, p[0], p[1]); });
  }
  // ---------- generic full-axis (-1..+1) smoothed line chart (PGxC, Latent) ----------
  function axisFit(cv,ctx){ const w=cv.clientWidth,h=cv.clientHeight; if(!w||!h) return null;
    const dpr=Math.min(devicePixelRatio||1,2); const W=Math.round(w*dpr),H=Math.round(h*dpr);
    if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H;} ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h); return {w,h}; }
  function drawAxisGraph(cv,ctx,hov,title,xlabel,lines,foot){
    const f=axisFit(cv,ctx); if(!f) return; const {w,h}=f;
    ctx.fillStyle=BG; ctx.fillRect(0,0,w,h);
    if(!lines||!lines.length){ ctx.fillStyle='#8f8c82'; ctx.font='12px monospace'; ctx.textAlign='left'; ctx.fillText('load a session chain + anchor',16,26); return; }
    const padL=42,padR=14,padT=28,padB=30, x0=padL,x1=w-padR,y0=padT,y1=h-padB;
    let ylo=Infinity,yhi=-Infinity; for(const ln of lines) for(const v of ln.y) if(isFinite(v)){ if(v<ylo)ylo=v; if(v>yhi)yhi=v; }
    if(!isFinite(ylo)){ylo=-1;yhi=1;} if(ylo===yhi){ylo-=1;yhi+=1;} const pdd=(yhi-ylo)*0.12; ylo-=pdd; yhi+=pdd;
    const xAt=t=>x0+(t+1)/2*(x1-x0), yAt=v=>y1-(v-ylo)/(yhi-ylo)*(y1-y0);
    ctx.fillStyle=PLOT; ctx.fillRect(x0,y0,x1-x0,y1-y0);
    ctx.lineWidth=0.5; ctx.font='9px monospace'; ctx.fillStyle='#a6a299'; ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.textAlign='center';
    for(let t=-10;t<=10;t++){ const X=xAt(t/10); ctx.beginPath(); ctx.moveTo(X,y0); ctx.lineTo(X,y1); ctx.stroke(); if(t%2===0) ctx.fillText((t/10).toFixed(1),X,y1+13); }
    ctx.textAlign='right'; for(let k=0;k<=4;k++){ const v=ylo+(yhi-ylo)*k/4, Y=yAt(v); ctx.beginPath(); ctx.moveTo(x0,Y); ctx.lineTo(x1,Y); ctx.stroke(); ctx.fillText(v.toFixed(Math.abs(v)>=100?0:1),x0-4,Y+3); }
    if(ylo<0&&yhi>0){ ctx.strokeStyle=ZERO; ctx.lineWidth=0.8; const Y=yAt(0); ctx.beginPath(); ctx.moveTo(x0,Y); ctx.lineTo(x1,Y); ctx.stroke(); }
    ctx.strokeStyle=FRAME; ctx.lineWidth=1; ctx.strokeRect(x0,y0,x1-x0,y1-y0);
    for(const ln of lines){ const yy=ln.y, xx=ln.x, m=yy.length; ctx.strokeStyle=ln.c; ctx.lineWidth=ln.lw||1.5; ctx.beginPath();
      for(let i=0;i<m-1;i++){ const a=yy[Math.max(i-1,0)],b=yy[i],cc2=yy[i+1],dd=yy[Math.min(i+2,m-1)];
        const xa=xx[Math.max(i-1,0)],xb=xx[i],xc=xx[i+1],xd=xx[Math.min(i+2,m-1)];
        for(let s=0;s<=18;s++){ const tt=s/18; const X=xAt(cr(xa,xb,xc,xd,tt)), Y=yAt(cr(a,b,cc2,dd,tt)); (i===0&&s===0)?ctx.moveTo(X,Y):ctx.lineTo(X,Y); } }
      ctx.stroke(); }
    ctx.fillStyle=FG; ctx.font='12px monospace'; ctx.textAlign='left'; ctx.fillText(title,x0,18);
    ctx.font='9px monospace'; ctx.fillStyle='#8f8c82'; ctx.textAlign='center'; ctx.fillText(xlabel,(x0+x1)/2,h-6);
    if(foot){ ctx.textAlign='right'; ctx.fillStyle='#8f8c82'; ctx.font='9px monospace'; ctx.fillText(foot,x1,18); }
    ctx.textAlign='left'; ctx.font='9px monospace'; let ly=y1-4-lines.length*11;
    lines.forEach(ln=>{ ctx.strokeStyle=ln.c; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x0+6,ly); ctx.lineTo(x0+22,ly); ctx.stroke(); ctx.fillStyle=FG; ctx.fillText(ln.lab,x0+27,ly+3); ly+=11; });
    if(hov.t!=null){ const t=hov.t, X=xAt(t), p=(t+1)/2;
      ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(X,y0); ctx.lineTo(X,y1); ctx.stroke();
      const txt=['t '+t.toFixed(2)+' \u00b7 '+clockT((t+1)/2)];
      lines.forEach(ln=>{ const val=crEval(ln.y,p), Y=yAt(val); ctx.fillStyle=ln.c; ctx.beginPath(); ctx.arc(X,Y,3,0,7); ctx.fill(); txt.push(ln.lab+' '+fmt(val)); });
      ctx.font='9px monospace'; let bw=0; txt.forEach(s=>bw=Math.max(bw,ctx.measureText(s).width)); bw+=12;
      let bx=Math.min(X+10,x1-bw),by=y0+6; if(bx<x0)bx=x0;
      ctx.fillStyle='rgba(18,18,22,0.94)'; ctx.strokeStyle='#4c4c54'; ctx.lineWidth=1; ctx.fillRect(bx,by,bw,txt.length*12+6); ctx.strokeRect(bx,by,bw,txt.length*12+6);
      ctx.textAlign='left'; ctx.fillStyle=FG; txt.forEach((s,k)=>{ ctx.fillText(s,bx+6,by+13+k*12); }); }
  }
  function drawPGxC(){ const d=window.__sopData&&window.__sopData(); let lines=null;
    if(d){ const cw=Array.from(d.cw), pg=Array.from(d.pg), pc=Array.from(d.pc), prod=pg.map((v,i)=>v*pc[i]);
      lines=[{x:cw,y:pg,c:GOLD,lw:1.6,lab:'pressure gradient (CC)'},{x:cw,y:pc,c:RED,lw:1.6,lab:'pressure curvature (CD)'},{x:cw,y:prod,c:WHITE,lw:2.0,lab:'PG\u00d7C (product)'}]; }
    drawAxisGraph(pgcv,pgctx,hPG,'PG\u00d7C \u2014 pressure gradient \u00d7 curvature (smoothed)','chronometer watch  (\u22121 below ATM \u00b7 0 ATM \u00b7 +1 above)',lines,d?(d.n_strikes+' strikes'):''); }
  function drawLatent(){ const d=window.__sopData&&window.__sopData(); let lines=null,foot='';
    if(d){ const Q=d.latent.Q,Pp=d.latent.P,R=d.latent.R,nn=Q.length,xs=[]; for(let i=0;i<nn;i++) xs.push(-1+2*i/(nn-1||1));
      lines=[{x:xs,y:Q,c:CYAN,lw:1.6,lab:'Q \u00b7 SOPG-latent'},{x:xs,y:Pp,c:GOLD,lw:1.6,lab:'P \u00b7 SOPc-latent'},{x:xs,y:R,c:TEAL,lw:1.6,lab:'R \u00b7 SOPC-latent'}];
      const nets=[Q[nn-1]-Q[0],Pp[nn-1]-Pp[0],R[nn-1]-R[0]], ups=nets.filter(v=>v>0).length; foot='majority '+(ups>=2?'UP':'DOWN')+' '+Math.max(ups,3-ups)+'/3'; }
    drawAxisGraph(ltcv,ltctx,hLT,'Three latent paths (P/Q/R) \u2014 independent trajectories','chronometer watch (\u22121 .. +1)',lines,foot); }
  // ---------- Book Tensor surface: |O|\u00b7exp(-(offset-Q)^2) per chronoT row ----------
  function drawTensor(){ if(!tncv||!tnctx) return; const f=axisFit(tncv,tnctx); if(!f) return; const {w,h}=f; const ctx=tnctx;
    ctx.fillStyle=BG; ctx.fillRect(0,0,w,h);
    ctx.fillStyle=FG; ctx.font='12px monospace'; ctx.textAlign='left'; ctx.fillText('Book Tensor surface \u2014 |O|\u00b7exp(\u2212(offset\u2212Q)\u00b2) per chronoT',12,18);
    const d=window.__sopData&&window.__sopData();
    if(!d){ ctx.fillStyle='#8f8c82'; ctx.font='11px monospace'; ctx.fillText('load a session chain + anchor',12,38); _tnMap=null; return; }
    const O=d.tensor.O, Qc=d.tensor.Q, chrono=d.tensor.chrono, n=O.length;
    const offs=[]; for(let k=0;k<201;k++) offs.push(-50+0.5*k);
    const TS=(i,o)=>Math.abs(O[i])*Math.exp(-Math.pow(o-Qc[i],2));
    let peaks=[],asyms=[],active=[];
    for(let i=0;i<n;i++){ let s=0,mx=-1,mxo=0,left=0,right=0; for(const o of offs){ const v=TS(i,o); s+=v; if(v>mx){mx=v;mxo=o;} if(o<0)left+=v; else if(o>0)right+=v; }
      if(s>1e-9){ peaks.push(mxo); asyms.push((right-left)/((right+left)||1)); active.push(i); } }
    const migr=peaks.length?Math.max.apply(null,peaks)-Math.min.apply(null,peaks):0;
    const masym=asyms.length?asyms.reduce((a,b)=>a+b,0)/asyms.length:0;
    const geom=(peaks.length&&Math.abs(peaks.reduce((a,b)=>a+b,0)/peaks.length)<5&&migr<10)?'COMPRESSION':'TRAJECTORY';
    const dir=masym>0.05?'UP':masym<-0.05?'DOWN':'NEUTRAL';
    const padL=42,padR=14,padT=36,padB=32, x0=padL,x1=w-padR,y0=padT,y1=h-padB;
    let qlo=active.length?Math.min.apply(null,active.map(i=>Qc[i])):-3, qhi=active.length?Math.max.apply(null,active.map(i=>Qc[i])):3;
    const xmin=Math.max(-50,qlo-4), xmax=Math.min(50,qhi+4);
    const amax=Math.max(1,Math.max.apply(null,active.map(i=>Math.abs(O[i])).concat([1])));
    const xAt=o=>x0+(o-xmin)/((xmax-xmin)||1)*(x1-x0), yAt=v=>y1-(v/amax)*(y1-y0)*0.92;
    ctx.fillStyle=PLOT; ctx.fillRect(x0,y0,x1-x0,y1-y0);
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=0.5; ctx.fillStyle='#a6a299'; ctx.font='9px monospace'; ctx.textAlign='center';
    for(let k=0;k<=6;k++){ const o=xmin+(xmax-xmin)*k/6, X=xAt(o); ctx.beginPath(); ctx.moveTo(X,y0); ctx.lineTo(X,y1); ctx.stroke(); ctx.fillText(o.toFixed(1),X,y1+13); }
    ctx.strokeStyle=FRAME; ctx.lineWidth=1; ctx.strokeRect(x0,y0,x1-x0,y1-y0);
    const SAMP=120, last=active.length?active[active.length-1]:-1;
    active.forEach(i=>{ const br=0.4+0.6*(n>1?i/(n-1):1), col='rgba('+Math.round(255*br)+','+Math.round(255*br)+','+Math.round(240*br)+',0.9)';
      ctx.strokeStyle=col; ctx.lineWidth=(i===last)?1.8:1.0; ctx.beginPath();
      for(let s=0;s<=SAMP;s++){ const o=xmin+(xmax-xmin)*s/SAMP, X=xAt(o), Y=yAt(TS(i,o)); s?ctx.lineTo(X,Y):ctx.moveTo(X,Y); } ctx.stroke();
      ctx.fillStyle=col; ctx.beginPath(); ctx.arc(xAt(Qc[i]),yAt(Math.abs(O[i])),2,0,7); ctx.fill(); });
    if(hTN.i!=null && active.indexOf(hTN.i)>=0){ const i=hTN.i; ctx.strokeStyle=CYAN; ctx.lineWidth=2; ctx.beginPath();
      for(let s=0;s<=SAMP;s++){ const o=xmin+(xmax-xmin)*s/SAMP,X=xAt(o),Y=yAt(TS(i,o)); s?ctx.lineTo(X,Y):ctx.moveTo(X,Y);} ctx.stroke();
      const txt=['chronoT '+chrono[i].toFixed(1)+' \u00b7 '+clockT(chrono[i]),'|O| '+fmt(Math.abs(O[i]))+'   peak @ '+Qc[i].toFixed(2)];
      ctx.font='9px monospace'; let bw=0; txt.forEach(s=>bw=Math.max(bw,ctx.measureText(s).width)); bw+=12;
      let bx=x0+8,by=y0+6; ctx.fillStyle='rgba(18,18,22,0.94)'; ctx.strokeStyle='#4c4c54'; ctx.lineWidth=1; ctx.fillRect(bx,by,bw,txt.length*12+6); ctx.strokeRect(bx,by,bw,txt.length*12+6);
      ctx.textAlign='left'; ctx.fillStyle=FG; txt.forEach((s,k)=>ctx.fillText(s,bx+6,by+13+k*12)); }
    ctx.fillStyle='#8f8c82'; ctx.font='9px monospace'; ctx.textAlign='center'; ctx.fillText('offset (strike-distance proxy)',(x0+x1)/2,h-6);
    ctx.textAlign='right'; ctx.fillText('geometry '+geom+' \u00b7 direction '+dir+' \u00b7 peak migration '+migr.toFixed(2)+' \u00b7 mean asym '+masym.toFixed(3),x1,18);
    ctx.textAlign='left'; ctx.fillStyle=FG; ctx.fillText('rows: chronoT 0 (dim) \u2192 1 (bright) \u00b7 dot = peak |O| at offset Q',x0,y0-6);
    _tnMap={x0,x1,xmin,xmax,active,Qc};
  }
  // ---------- TSC Curvature/Gradient family DAG (ports the workbook TSC(Curvature)/TSC(Gradient) sheets) ----------
  function tscFamily(B){
    const cell=i=>(i>=0&&i<B.length&&isFinite(B[i]))?B[i]:0; const NP=11, D=[],E=[],K=[],O=[];
    for(let p=0;p<NP;p++){ if(p===0){ const c=cell(10); D.push(c);E.push(c);K.push(c);O.push(c); }
      else { D.push(cell(10-p)*cell(10+p)); const den=cell(10+p); E.push(den!==0?cell(10-p)/den:0);
        K.push(cell(p-1)+cell(21-p)); O.push(cell(p-1)-cell(21-p)); } }
    const div=(a,b)=>(b!==0&&isFinite(b))?a/b:0, diff=a=>a.map((v,p)=>(p+1<a.length?a[p+1]:0)-v), tens=a=>a.map((v,p)=>v+(p+1<a.length?a[p+1]:0));
    const F=D.map((d,p)=>div(d,E[p])), G=diff(F), H=diff(G), I=E.map((e,p)=>div(e,D[p])), J=D.map((d,p)=>d*E[p]);
    const Lg=diff(K), M=diff(Lg), N=tens(K), P=tens(O);
    const R=K.map((k,p)=>div(k,D[p])), S=O.map((o,p)=>div(o,E[p])), T=tens(S);
    const U=R.map((r,p)=>div(r,S[p])), V=S.map((s,p)=>div(s,R[p])), W=tens(V), X=R.map((r,p)=>r*S[p]);
    const Y=K.map((k,p)=>div(k,O[p])), Z=diff(Y), AA=diff(Z);
    const AC=O.map((o,p)=>div(o,K[p])), AK=K.map((k,p)=>k*O[p]), AL=K.map((k,p)=>div(k,Y[p]));
    const Cp=[]; for(let p=0;p<NP;p++) Cp.push(Math.round(p*0.1*1e6)/1e6);
    const AM=K.map((k,p)=>{ const On=(p+1<NP?O[p+1]:0), Cn=(p+1<NP?Cp[p+1]:Cp[p]+0.1); return div(div(k-O[p],k+On), div(Cn-Cp[p],Cp[p]+Cn)); });
    return {pair:Cp,'Pairs Multiplied':D,'Pairs Divided':E,'PM/PD':F,'PM/PD Gradient':G,'PM/PD Curvature':H,'PD/PM':I,'PM*PD':J,
      'Sum of Pairs':K,'Sum of Pairs Gradient':Lg,'Sum of Pairs Curvature':M,'Sum of Pairs Tension':N,
      'Difference In Pairs Left to Right':O,'DIPLTR Tension':P,'Sum of Pairs/Pairs Multiplied':R,'DIPLTR/PD':S,'DIPLTR/PD Tension':T,
      'SOPPM/DIPLTRPD(SDD)':U,'DIPLTRPD/SOPPM':V,'DIPLTRPD/SOPPM Tension':W,'SOPPM/DIPLTR(SMD)':X,
      'Sum/Difference':Y,'S/D Gradient':Z,'S/D Curvature':AA,'Difference/Sum':AC,'Sum*Diff':AK,'Sum/ Sum Diff':AL,'Dual Phase':AM,
      'Pressure Curvature':B.slice(0,NP),'Pressure Gradient':B.slice(0,NP),'Pairs Multiplied Gradient':diff(D),'PM Curvature':diff(diff(D))};
  }
  function famMini(ctx,x,y,w,h,ys,title){
    const ix0=x+30,iy0=y+14,ix1=x+w-6,iy1=y+h-12;
    let lo=Infinity,hi=-Infinity; for(const v of ys) if(isFinite(v)){ if(v<lo)lo=v; if(v>hi)hi=v; }
    if(!isFinite(lo)){lo=-1;hi=1;} if(lo===hi){lo-=1;hi+=1;} const pd=(hi-lo)*0.12; lo-=pd; hi+=pd;
    const m=ys.length, xa=i=>ix0+(m>1?i/(m-1):0)*(ix1-ix0), ya=v=>iy1-(v-lo)/(hi-lo)*(iy1-iy0);
    ctx.fillStyle=PLOT; ctx.fillRect(ix0,iy0,ix1-ix0,iy1-iy0);
    ctx.fillStyle='#a6a299'; ctx.font='7px monospace'; ctx.textAlign='right';
    for(let k=0;k<=2;k++){ const v=lo+(hi-lo)*k/2,Y=ya(v); ctx.fillText(Math.abs(v)>=100?v.toFixed(0):v.toFixed(1),ix0-2,Y+2.5); }
    if(lo<0&&hi>0){ ctx.strokeStyle=ZERO; ctx.lineWidth=0.5; const Y=ya(0); ctx.beginPath(); ctx.moveTo(ix0,Y); ctx.lineTo(ix1,Y); ctx.stroke(); }
    ctx.strokeStyle=FRAME; ctx.lineWidth=1; ctx.strokeRect(ix0,iy0,ix1-ix0,iy1-iy0);
    ctx.strokeStyle=CYAN; ctx.lineWidth=1.2; ctx.beginPath(); ys.forEach((v,i)=>{ const X=xa(i),Y=ya(v); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); }); ctx.stroke();
    ctx.fillStyle=CYAN; ys.forEach((v,i)=>{ ctx.beginPath(); ctx.arc(xa(i),ya(v),1.4,0,7); ctx.fill(); });
    ctx.fillStyle=FG; ctx.font='8px monospace'; ctx.textAlign='left'; ctx.fillText(title.length>32?title.slice(0,31)+'\u2026':title,ix0,y+10);
  }
  function drawFamilies(){
    if(!famcv||!famctx) return; const cont=famcv.parentElement; const W=cont.clientWidth; if(!W) return; const ctx=famctx;
    const titles=(famState==='grad')?GRAD_TITLES:CURV_TITLES, cols=4, n=titles.length, rows=Math.ceil(n/cols), top=24, panelH=128, pad=8;
    const H=top+rows*panelH+pad, dpr=Math.min(devicePixelRatio||1,2), Wp=Math.round(W*dpr), Hp=Math.round(H*dpr);
    if(famcv.width!==Wp||famcv.height!==Hp){ famcv.width=Wp; famcv.height=Hp; } famcv.style.width=W+'px'; famcv.style.height=H+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H); ctx.fillStyle='#07090d'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle=FG; ctx.font='10px monospace'; ctx.textAlign='left';
    ctx.fillText('Time State Compass \u2014 '+(famState==='grad'?'Gradient':'Curvature')+' family  ('+n+' charts, shared chronometer axis 0\u20131)',10,15);
    const d=window.__sopData&&window.__sopData();
    if(!d){ ctx.fillStyle='#8f8c82'; ctx.font='11px monospace'; ctx.fillText('load a session chain + anchor',10,36); return; }
    const B=(famState==='grad')?d.pg:d.pc, fam=tscFamily(B), pw=(W-pad*2)/cols;
    titles.forEach((t,i)=>{ const cx=i%cols, cy=(i/cols)|0; famMini(ctx, pad+cx*pw, top+cy*panelH, pw-6, panelH-8, fam[t]||[], t); });
  }
  function _cxgFit(cv){ if(!cv) return null; const c=cv.getContext('2d'); const w=cv.clientWidth||cv.parentNode.clientWidth||620, h=cv.clientHeight||cv.parentNode.clientHeight||260; if(!w||!h) return null; const dpr=Math.min(devicePixelRatio||1,2); cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); c.setTransform(dpr,0,0,dpr,0,0); return {c,w,h}; }
  function drawCXG(){ if(!window.QuanCXG) return; const d=window.__sopData&&window.__sopData(); const rip=(window.__ripnCfg?window.__ripnCfg():null); const P = d ? window.QuanCXG.panelsFromPayload({cwAxis:Array.from(d.cw),pressureGradient:Array.from(d.pg),pressureCurvature:Array.from(d.pc),sopG:Array.from(d.sopG),sopC:Array.from(d.sopC),fold:Array.from(d.product),crossings_t:[],crossings_cw:[]}) : null; const pf=_cxgFit($('cxgPressure')); if(pf){ if(P) window.QuanCXG.drawAxisGraph(pf.c,pf.w,pf.h,Object.assign({ripn:rip},P.pressure)); else { pf.c.fillStyle='#07090d'; pf.c.fillRect(0,0,pf.w,pf.h); pf.c.fillStyle='#c7cdd7'; pf.c.font='11px monospace'; pf.c.fillText('load a session chain + anchor',16,24);} } const ff=_cxgFit($('cxgFold')); if(ff){ if(P) window.QuanCXG.drawMiniGrid(ff.c,ff.w,ff.h,P.fold.panels,rip); else { ff.c.fillStyle='#07090d'; ff.c.fillRect(0,0,ff.w,ff.h);} } }
  function redraw(){ drawHead(); drawGrid(); drawPGxC(); drawLatent(); drawTensor(); drawFamilies(); drawCXG(); }
  window.addEventListener('quan:ripn-tune', function(){ if($('tabPolar')&&$('tabPolar').classList.contains('on')) redraw(); });
  document.querySelectorAll('.cxgsubhead').forEach(function(hd){ if(hd.__b) return; hd.__b=1; hd.addEventListener('click',function(){ const sub=hd.parentNode; sub.classList.toggle('collapsed'); sub.classList.toggle('open',!sub.classList.contains('collapsed')); setTimeout(drawCXG,0); }); });
  window.addEventListener('quan:sop',redraw);
  window.addEventListener('resize',()=>{ if($('tabPolar')&&$('tabPolar').classList.contains('on')) redraw(); });
  window.__sopResize=redraw;
  // headline hover trace
  head.addEventListener('mousemove',e=>{ const d=window.__sopData&&window.__sopData(); if(!d){hoverT=null;return;}
    const r=head.getBoundingClientRect(); const padL=42,padR=14,x0=padL,x1=r.width-padR;
    hoverT=Math.max(0,Math.min(1,(e.clientX-r.left-x0)/(x1-x0))); drawHead(); });
  head.addEventListener('mouseleave',()=>{ hoverT=null; drawHead(); });
  function axisHover(cv,hov,drawFn){ if(!cv) return;
    cv.addEventListener('mousemove',e=>{ if(!(window.__sopData&&window.__sopData())){hov.t=null;return;} const r=cv.getBoundingClientRect(); const x0=42,x1=r.width-14;
      hov.t=Math.max(-1,Math.min(1,(e.clientX-r.left-x0)/((x1-x0)||1)*2-1)); drawFn(); });
    cv.addEventListener('mouseleave',()=>{ hov.t=null; drawFn(); }); }
  axisHover(pgcv,hPG,drawPGxC); axisHover(ltcv,hLT,drawLatent);
  if(tncv){ tncv.addEventListener('mousemove',e=>{ if(!_tnMap){return;} const r=tncv.getBoundingClientRect();
      const o=_tnMap.xmin+(e.clientX-r.left-_tnMap.x0)/((_tnMap.x1-_tnMap.x0)||1)*(_tnMap.xmax-_tnMap.xmin);
      let best=null,bd=1e9; _tnMap.active.forEach(i=>{ const dd=Math.abs(_tnMap.Qc[i]-o); if(dd<bd){bd=dd;best=i;} }); hTN.i=best; drawTensor(); });
    tncv.addEventListener('mouseleave',()=>{ hTN.i=null; drawTensor(); }); }
  const fCurv=$('famCurv'), fGrad=$('famGrad');
  if(fCurv)fCurv.addEventListener('click',()=>{ famState='curv'; fCurv.classList.add('on'); if(fGrad)fGrad.classList.remove('on'); drawFamilies(); });
  if(fGrad)fGrad.addEventListener('click',()=>{ famState='grad'; fGrad.classList.add('on'); if(fCurv)fCurv.classList.remove('on'); drawFamilies(); });
})();