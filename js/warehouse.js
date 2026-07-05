/* Global header = warehouse: per (instrument, date) cell with anchor/lock (SHARED) + per-expiry chains.
   STORE[inst] = { det:{date->{rows}},  sess:{date->cell} }.
   cell = { anchor, locked, active, exp:{ Daily:{chain,fn,greeks,gfn,gkt}, EOM:{...} } }.
   Single global expiry toggle (Daily/EOM) drives BOTH SOP + Strike; anchor/lock are shared across expiries.
   Auto-classify on chain upload: filename 'weekly'->Daily, 'eom'->EOM, else-> keeps active bucket and flags it.
   Persistence: light meta key per instrument + one blob per (inst,date,expiry). */
(function(){
  const $=id=>document.getElementById(id);
  const gA=$('gAnchor'), gL=$('gLock'), gFile=$('gFile'), gFn=$('gFn');
  if(!gA||!gFile) return;
  let curInst=($('instA')&&$('instA').value)||'NQ';
  const gDate=()=>{ const d=$('dayDate'); return (d&&d.value)||''; };
  const BUCKETS=['Daily','EOM'];
  function classifyExp(name){ const f=(name||'').toLowerCase(); if(f.indexOf('weekly')>=0) return 'Daily'; if(f.indexOf('eom')>=0) return 'EOM'; return null; }

  // ---- KV: window.storage -> localStorage -> in-memory; set() reports success so we can warn on quota ----
  const _mem={};
  const KV={
    async get(k){ try{ if(window.storage){ const r=await window.storage.get(k,false); return r&&r.value?JSON.parse(r.value):(k in _mem?_mem[k]:null); } }catch(e){}
                  try{ const v=localStorage.getItem(k); if(v!=null) return JSON.parse(v); }catch(e){}
                  return (k in _mem)?_mem[k]:null; },
    async set(k,v){ _mem[k]=v; const j=JSON.stringify(v);
                    try{ if(window.storage){ await window.storage.set(k,j,false); return true; } }catch(e){}
                    try{ localStorage.setItem(k,j); return true; }catch(e){ return false; } }
  };
  const METAKEY=i=>'qhub:rec:'+i, BLOBKEY=(i,d,b)=>'qhub:blob:'+i+':'+d+':'+b, OLDBLOB=(i,d)=>'qhub:blob:'+i+':'+d, IDXKEY='qhub:idx';

  const STORE={};
  function rec(i){ return STORE[i]||(STORE[i]={det:null,sess:null}); }
  function newExp(){ return {chain:null,fn:null,greeks:null,gfn:null,gkt:null}; }
  function newCell(){ return {anchor:'',locked:false,active:'Daily',exp:{}}; }
  function expOf(cell,b,create){ cell.exp=cell.exp||{}; let e=cell.exp[b]; if(!e&&create) e=cell.exp[b]=newExp(); return e||newExp(); }
  function activeOf(cell){ return (cell&&BUCKETS.indexOf(cell.active)>=0)?cell.active:'Daily'; }
  window.__qStore=STORE; window.__qCurInst=()=>curInst; window.__qRec=rec;
  window.__qActiveChain=function(){ const r=STORE[curInst]; if(!r||!r.sess) return null; const d=gDate(); const cell=r.sess[d]; if(!cell) return null; const b=activeOf(cell), e=cell.exp&&cell.exp[b];
    var surv=[]; if(cell.exp){ var bi=BUCKETS.indexOf(b); for(var k in cell.exp){ if(BUCKETS.indexOf(k)>bi){ var ev=cell.exp[k]; if(ev&&ev.chain){ surv.push({expiry:k,chain:ev.chain,greeks:(ev.greeks||null)}); } } } }
    return {inst:curInst,date:d,expiry:b,anchor:cell.anchor,chain:(e&&e.chain)||null,fn:(e&&e.fn)||null,greeks:(e&&e.greeks)||null,gfn:(e&&e.gfn)||null,survivors:surv}; };

  // ---- ATM 21-cell OI fill for the density badge (lightweight chain scan) ----
  function splitCSV(line){ const o=[]; let c='',q=false; for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"')q=!q; else if(ch===','&&!q){o.push(c);c='';} else c+=ch; } o.push(c); return o; }
  function num(x){ if(x==null)return null; x=String(x).trim().replace(/s$/,''); if(x===''||x==='N/A')return null; const n=parseFloat(x.replace(/,/g,'')); return isNaN(n)?null:n; }
  function oiFill(text,anchor){ if(!text||!(anchor>0)) return null;
    const L=text.trim().split('\n'); const rows=[];
    for(let i=1;i<L.length;i++){ const v=splitCSV(L[i]); if(v.length<11)continue; const k=num(v[5]); if(k==null)continue;
      rows.push({k:k,has:(num(v[3])!=null||num(v[9])!=null)}); }
    if(!rows.length) return null; rows.sort((p,q2)=>p.k-q2.k);
    let atm=0,best=1e18; for(let i=0;i<rows.length;i++){ const dd=Math.abs(rows[i].k-anchor); if(dd<best){best=dd;atm=i;} }
    const lo=Math.max(0,atm-10), hi=Math.min(rows.length,atm+11); let f=0,t=0;
    for(let i=lo;i<hi;i++){ t++; if(rows[i].has)f++; } return {filled:f,total:t}; }

  // ---- persistence ----
  async function persistMeta(i){ const r=STORE[i]; if(!r) return true;
    const sm={}, sess=r.sess||{};
    for(const d in sess){ const s=sess[d]; const em={};
      for(const b in (s.exp||{})){ const e=s.exp[b]; em[b]={fn:e.fn||null,gfn:e.gfn||null,gkt:(e.gkt==null?null:e.gkt),hasChain:e.chain!=null,hasGreeks:e.greeks!=null}; }
      sm[d]={anchor:s.anchor,locked:!!s.locked,active:s.active||'Daily',exp:em}; }
    const ok=await KV.set(METAKEY(i),{v:2,det:r.det||null,sessMeta:sm,leg:r._leg||null});
    await KV.set(IDXKEY,Object.keys(STORE)); return ok; }
  window.__qPersist=persistMeta;   // Detector det writes route through meta
  async function persistBlob(i,d,b){ const r=STORE[i]; if(!r)return; const s=r.sess&&r.sess[d]; const e=s&&s.exp&&s.exp[b];
    if(e&&(e.chain!=null||e.greeks!=null)){ const ok=await KV.set(BLOBKEY(i,d,b),{chain:e.chain||null,greeks:e.greeks||null});
      if(!ok) console.warn('[qhub] storage full \u2014 '+i+' '+d+' '+b+' chain/greeks was NOT saved'); }
    await persistMeta(i); }

  // the (curInst, current date) cell. pre-per-date legacy folds in on first real date viewed.
  function curCell(create){ const r=rec(curInst); r.sess=r.sess||{}; const d=gDate();
    let s=r.sess[d];
    if(d && r._leg){ const L=r._leg; const fresh=!s; if(!s) s=r.sess[d]=newCell();
      if(fresh){ s.anchor=(L.anchor==null?'':L.anchor); s.locked=!!L.locked; }
      if(L.chain!=null){ const b=classifyExp(L.fn)||'Daily'; const e=expOf(s,b,true); if(e.chain==null){ e.chain=L.chain; e.fn=L.fn||e.fn; } s.active=b; }
      if(L.greeks!=null){ const b=activeOf(s); const e=expOf(s,b,true); if(e.greeks==null){ e.greeks=L.greeks; e.gfn=L.gfn||e.gfn; e.gkt=(L.gkt==null?e.gkt:L.gkt); } }
      r._leg=null; persistBlob(curInst,d,activeOf(s)); }
    if(!s && create){ s=r.sess[d]=newCell(); }
    return s||newCell(); }

  function pushAnchorToTabs(v){ if(window.__polarSetAnchor)window.__polarSetAnchor(v); if(window.__strikeSetAnchor)window.__strikeSetAnchor(v); if(window.__compassSetAnchor)window.__compassSetAnchor(v); }
  function loadChainToTabs(text,name){
    if(text){ if(window.__polarLoadChain)window.__polarLoadChain(text,name); if(window.__strikeLoadChain)window.__strikeLoadChain(text,name); if(window.__compassLoadChain)window.__compassLoadChain(text,name); }
    else { if(window.__polarClear)window.__polarClear(); if(window.__strikeClear)window.__strikeClear(); if(window.__compassClear)window.__compassClear(); } }
  function loadGreeksToTabs(text,name,gkt){
    if(text){ if(window.__strikeLoadGreeks)window.__strikeLoadGreeks(text,name,gkt); }
    else { if(window.__strikeClearGreeks)window.__strikeClearGreeks(); } }

  // ---- lock UI: gAnchor is the only live anchor; mirror disabled/visual to the hidden tab locks ----
  function applyLockUI(b){ gA.disabled=b;
    gL.classList.toggle('locked',b); gL.innerHTML=b?'&#128274;':'&#128275;';
    gL.title=b?'Anchor locked for this instrument+date \u2014 click to unlock':'Lock anchor for this instrument+date';
    [['pAnchor','pLock'],['skAnchor','skLock']].forEach(function(p){ const a=$(p[0]),l=$(p[1]);
      if(a) a.disabled=b; if(l){ l.classList.toggle('locked',b); l.innerHTML=b?'&#128274;':'&#128275;'; } }); }

  // ---- expiry selector render (active highlight + loaded dot + ATM-OI fill badge) ----
  function renderExpSel(){ const cell=curCell(false); const act=activeOf(cell); const a=parseFloat(cell.anchor);
    BUCKETS.forEach(function(b){ const btn=$('exp_'+b); if(!btn) return; const e=cell.exp&&cell.exp[b]; const loaded=!!(e&&e.chain);
      btn.classList.toggle('on', b===act);
      const dot=btn.querySelector('.expdot'); if(dot) dot.textContent=loaded?'\u25CF':'\u25CB';
      const oi=btn.querySelector('.expoi'); if(oi){ let t=''; if(loaded && a>0){ const f=oiFill(e.chain,a); if(f) t=f.filled+'/'+f.total; } oi.textContent=t; }
    }); }

  // load the active (instrument,date,expiry) cell fully into header + tabs (chain load recomputes at the anchor)
  function applyCell(){ const cell=curCell(false); const a=(cell.anchor==null?'':cell.anchor);
    gA.value=a; const pa=$('pAnchor'),sa=$('skAnchor'); if(pa)pa.value=a; if(sa)sa.value=a;
    applyLockUI(!!cell.locked);
    const b=activeOf(cell), e=cell.exp&&cell.exp[b];
    if(window.__upSyncFn){window.__upSyncFn();}else{gFn.textContent=(e&&e.fn)||'none';}
    loadChainToTabs(e&&e.chain,e&&e.fn);
    loadGreeksToTabs(e&&e.greeks,e&&e.gfn,e&&e.gkt);
    const note=$('expNote'); if(note) note.textContent='';
    renderExpSel(); window.dispatchEvent(new CustomEvent('quan:cell')); }

  // ---- hub entry points ----
  window.__qLoadChain=function(text,name){ const cell=curCell(true); const det=classifyExp(name); const b=det||activeOf(cell);
    cell.active=b; const e=expOf(cell,b,true); e.chain=text; e.fn=name;
    gFn.textContent=name||'none'; loadChainToTabs(text,name); loadGreeksToTabs(e.greeks,e.gfn,e.gkt);
    const note=$('expNote'); if(note) note.textContent = det ? '' : '\u26A0 type not recognized \u2014 filed under '+b;
    renderExpSel(); persistBlob(curInst,gDate(),b); window.dispatchEvent(new CustomEvent('quan:cell')); return {bucket:b,recognized:det!=null}; };
  window.__qLoadGreeks=function(text,name,gkt){ const cell=curCell(true); const b=activeOf(cell); const e=expOf(cell,b,true);
    e.greeks=text; e.gfn=name; e.gkt=gkt; loadGreeksToTabs(text,name,gkt); renderExpSel(); persistBlob(curInst,gDate(),b); };
  window.__qSetAnchor=function(v){ const cell=curCell(true); cell.anchor=v; if(gA.value!==v)gA.value=(v==null?'':v); pushAnchorToTabs(v); renderExpSel(); persistMeta(curInst); window.dispatchEvent(new CustomEvent('quan:cell')); };

  gFile.addEventListener('change',e=>{ const f=e.target.files[0]; if(!f)return; const rd=new FileReader();
    rd.onload=ev=>{ const kind=($('upKind')&&$('upKind').value)||'chain';
      if(kind==='greeks'){ if(window.__qLoadGreeks) window.__qLoadGreeks(ev.target.result,f.name,null); }
      else { window.__qLoadChain(ev.target.result,f.name); }
      if($('gFn')) $('gFn').textContent=f.name; gFile.value=''; if(window.__feedHeatmap)window.__feedHeatmap(true); };
    rd.readAsText(f); });
  function upSyncFn(){ try{ const kind=($('upKind')&&$('upKind').value)||'chain'; const cell=curCell(false); const b=activeOf(cell); const e=cell&&cell.exp&&cell.exp[b]; const nm=kind==='greeks'?(e&&e.gfn):(e&&e.fn); if($('gFn')) $('gFn').textContent=nm||'none'; }catch(_){} }
  window.__upSyncFn=upSyncFn;
  var __lastFed='';
  function feedHeatmap(force){ try{
    var __sh=document.getElementById('secHost'); if(__sh&&__sh.classList.contains('split')) return;
    var fr=document.getElementById('heatFrame'); if(!fr||!fr.contentWindow) return;
    var inst=curInst, date=gDate(); var cell=curCell(false); var b=cell?activeOf(cell):null; var e=(cell&&cell.exp)?cell.exp[b]:null;
    var anc=(cell&&cell.anchor!=null&&cell.anchor!=='')?parseFloat(cell.anchor):((typeof gA!=='undefined'&&gA)?parseFloat(gA.value):NaN);
    var ancVal=isFinite(anc)?anc:null;
    var key=inst+'|'+date+'|'+((e&&e.fn)||'')+'|'+((e&&e.gfn)||'')+'|'+(ancVal==null?'':ancVal); if(!force && key===__lastFed) return; __lastFed=key;
    fr.contentWindow.postMessage({type:'quanFeed',kind:'setView',inst:inst,date:date},'*');
    if(e&&e.chain) fr.contentWindow.postMessage({type:'quanFeed',kind:'chain',text:e.chain,name:e.fn||'',inst:inst,date:date,anchor:ancVal},'*');
    if(e&&e.greeks) fr.contentWindow.postMessage({type:'quanFeed',kind:'greeks',text:e.greeks,name:e.gfn||'',inst:inst,date:date,anchor:ancVal},'*');
  }catch(_){} }
  window.__feedHeatmap=feedHeatmap;
  function feedHeatmapTo(frameId, inst, force){ try{
    var fr=document.getElementById(frameId); if(!fr||!fr.contentWindow) return;
    var date=gDate();
    var save=curInst; curInst=inst; var cell; try{ cell=curCell(false); } finally{ curInst=save; }
    var b=cell?activeOf(cell):null; var e=(cell&&cell.exp)?cell.exp[b]:null;
    var anc=(cell&&cell.anchor!=null&&cell.anchor!=='')?parseFloat(cell.anchor):NaN; var ancVal=isFinite(anc)?anc:null;
    fr.contentWindow.postMessage({type:'quanFeed',kind:'setView',inst:inst,date:date},'*');
    if(e&&e.chain) fr.contentWindow.postMessage({type:'quanFeed',kind:'chain',text:e.chain,name:e.fn||'',inst:inst,date:date,anchor:ancVal},'*');
    if(e&&e.greeks) fr.contentWindow.postMessage({type:'quanFeed',kind:'greeks',text:e.greeks,name:e.gfn||'',inst:inst,date:date,anchor:ancVal},'*');
  }catch(_){} }
  window.__feedHeatmapTo=feedHeatmapTo;
  window.addEventListener('message',function(ev){ var d=ev&&ev.data||{}; if(!d||d.type!=='quanReady')return;
    var __sh=document.getElementById('secHost'), __inSplit=__sh&&__sh.classList.contains('split');
    if(__inSplit){
      var fA=document.getElementById('heatFrame'), fB=document.getElementById('heatFrameB');
      var sA=document.getElementById('spPaneA'), sB=document.getElementById('spPaneB'), iA=document.getElementById('spInstA'), iB=document.getElementById('spInstB');
      if(fA&&ev.source===fA.contentWindow){ if(sA&&sA.value==='heat'&&window.__feedHeatmapTo)window.__feedHeatmapTo('heatFrame', iA?iA.value:curInst, true); }
      else if(fB&&ev.source===fB.contentWindow){ if(sB&&sB.value==='heat'&&window.__feedHeatmapTo)window.__feedHeatmapTo('heatFrameB', iB?iB.value:curInst, true); }
    } else { __lastFed=''; feedHeatmap(true); }
  });
  window.addEventListener('quan:date',function(){ setTimeout(function(){feedHeatmap();},0); });
  window.addEventListener('quan:cell',function(){ setTimeout(function(){feedHeatmap();},0); });
  window.addEventListener('quan:instr',function(){ setTimeout(function(){feedHeatmap();},0); });
  if($('upKind')) $('upKind').addEventListener('change',upSyncFn);
  gA.addEventListener('change',()=>window.__qSetAnchor(gA.value));
  gL.addEventListener('click',()=>{ const cell=curCell(true); cell.locked=!cell.locked; applyLockUI(cell.locked); persistMeta(curInst); });
  BUCKETS.forEach(function(b){ const btn=$('exp_'+b); if(btn) btn.addEventListener('click',()=>{ const cell=curCell(true); cell.active=b; applyCell(); persistMeta(curInst); }); });

  // ---- instrument / date switches both just load the active cell ----
  window.addEventListener('quan:instr',e=>{ curInst=e.detail; applyCell(); });
  window.addEventListener('quan:date',()=>applyCell());

  // ---- hydrate (v2 exp format; migrate per-cell warehouse + pre-per-date), then apply ----
  (async function hydrate(){
    /* one-time purge: clear stored DETECTOR uploads (det) so they can be re-uploaded; instrument chains (sessMeta/blobs) left intact */
    try{ if(!(await KV.get('qhub:detpurge:v2'))){
      const _ix=await KV.get(IDXKEY);
      if(Array.isArray(_ix)){ for(const _i of _ix){ const _V=await KV.get(METAKEY(_i)); if(_V&&_V.det){ _V.det=null; await KV.set(METAKEY(_i),_V); } } }
      try{ localStorage.removeItem(WH_KEY); }catch(_w){}   /* nuke stale legacy warehouse that fed baked detector data */
      try{ await KV.set(WH_KEY,null); }catch(_w2){}
      await KV.set('qhub:detpurge:v2',1);
    } }catch(_pe){}
    const idx=await KV.get(IDXKEY);
    if(Array.isArray(idx)){ for(const i of idx){ const V=await KV.get(METAKEY(i)); if(!V) continue;
      const r=rec(i); r.det=V.det||null; r.sess={};
      if(V.v===2 && V.sessMeta){                                   // current expiry format
        r._leg=V.leg||null;
        for(const d in V.sessMeta){ const m=V.sessMeta[d]; const s=newCell();
          s.anchor=(m.anchor==null?'':m.anchor); s.locked=!!m.locked; s.active=(BUCKETS.indexOf(m.active)>=0?m.active:'Daily'); s.exp={};
          const em=m.exp||{};
          for(const b in em){ const me=em[b], e=newExp(); e.fn=me.fn||null; e.gfn=me.gfn||null; e.gkt=(me.gkt==null?null:me.gkt);
            if(me.hasChain||me.hasGreeks){ const blob=await KV.get(BLOBKEY(i,d,b)); if(blob){ e.chain=blob.chain||null; e.greeks=blob.greeks||null; } }
            s.exp[b]=e; }
          r.sess[d]=s; }
      } else if(V.sessMeta){                                       // per-cell warehouse format -> migrate into exp
        r._leg=V.leg||null;
        for(const d in V.sessMeta){ const m=V.sessMeta[d]; const s=newCell();
          s.anchor=(m.anchor==null?'':m.anchor); s.locked=!!m.locked;
          if(m.hasChain||m.hasGreeks){ const blob=await KV.get(OLDBLOB(i,d)); const b=classifyExp(m.fn)||'Daily'; const e=expOf(s,b,true);
            e.fn=m.fn||null; e.gfn=m.gfn||null; e.gkt=(m.gkt==null?null:m.gkt);
            if(blob){ e.chain=blob.chain||null; e.greeks=blob.greeks||null; } s.active=b; }
          r.sess[d]=s; }
        await persistMeta(i);
        for(const d in r.sess){ const s=r.sess[d]; for(const b in s.exp) await persistBlob(i,d,b); }
      } else {                                                     // pre-per-date legacy
        const os=V.sess||{};
        for(const d in os){ const e=os[d], s=newCell(); s.anchor=(e.anchor==null?'':e.anchor); s.locked=!!e.locked; r.sess[d]=s; }
        if(V.chain!=null||V.greeks!=null||(V.anchor!=null&&V.anchor!=='')||V.locked){
          r._leg={anchor:(V.anchor==null?'':V.anchor),locked:!!V.locked,chain:V.chain||null,fn:V.fn||null,greeks:V.greeks||null,gfn:V.gfn||null,gkt:(V.gkt==null?null:V.gkt)}; }
        await persistMeta(i);
      }
    } }
    const haveDet=Object.keys(STORE).some(i=>STORE[i]&&STORE[i].det&&Object.keys(STORE[i].det).length);
    /* legacy WH_KEY -> det migration REMOVED: re-injected stale demo warehouse into det whenever det was empty */
    applyCell();
    if(window.__detHydrate) window.__detHydrate();
  })();
})();