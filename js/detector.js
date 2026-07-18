/* Qu'an Breach tension closure — validated vs LibreOffice (max err ~1e-12) */
// Qu'an Breach tension closure (CI / CL / CM) computed from a raw Barchart side-by-side chain CSV.
// Pure-JS port of the Book-sheet closure, validated cell-for-cell vs LibreOffice recalc (max err ~1e-12).
(function(global){
  function num(s){ if(s==null) return null; s=String(s).trim().replace(/^"|"$/g,'').replace(/,/g,'');
    if(s===''||s==='N/A'||s==='n/a'||s==='--') return null; var v=parseFloat(s); return isFinite(v)?v:null; }

  // Barchart side-by-side chain. Delegates to the shared header-driven ingestion
  // layer (js/barchart-parse.js) when present; otherwise uses the legacy fixed
  // positional layout: Type,Last,Volume,"Open Int","Daily Premium",Strike,Type,Last,Volume,"Open Int","Daily Premium"
  function parseChain(text, ctx){
    if(typeof QuanBarchart!=='undefined' && QuanBarchart.parseChain) return QuanBarchart.parseChain(text, ctx);
    var lines=text.replace(/\r/g,'').split('\n').filter(function(l){return l.trim()!=='';});
    function splitCSV(line){ var out=[],cur='',q=false;
      for(var i=0;i<line.length;i++){var ch=line[i];
        if(ch==='"'){q=!q;} else if(ch===','&&!q){out.push(cur);cur='';} else cur+=ch;}
      out.push(cur); return out; }
    var rows=[];
    for(var i=1;i<lines.length;i++){ var v=splitCSV(lines[i]); if(v.length<11) continue;
      var k=num(v[5]); if(k==null) continue;
      rows.push({k:k, cprem:num(v[4]), pprem:num(v[10]), coi:num(v[3]), poi:num(v[9]), cvol:num(v[2]), pvol:num(v[8])}); }
    rows.sort(function(a,b){return a.k-b.k;});
    return rows;
  }

  function _stats(xs){ var a=xs.filter(function(x){return x!=null;}); var n=a.length;
    var m=0; for(var i=0;i<n;i++) m+=a[i]; m/=n;
    var ss=0; for(i=0;i<n;i++){var d=a[i]-m; ss+=d*d;} var s=Math.sqrt(ss/(n-1));
    return {a:a,n:n,m:m,s:s}; }
  function excelSkew(xs){ var t=_stats(xs); if(t.n<3||t.s===0) return null;
    var c=t.n/((t.n-1)*(t.n-2)), sum=0; for(var i=0;i<t.n;i++){var z=(t.a[i]-t.m)/t.s; sum+=z*z*z;} return c*sum; }
  function excelKurt(xs){ var t=_stats(xs); if(t.n<4||t.s===0) return null; var n=t.n;
    var A=n*(n+1)/((n-1)*(n-2)*(n-3)), B=3*(n-1)*(n-1)/((n-2)*(n-3)), sum=0;
    for(var i=0;i<n;i++){var z=(t.a[i]-t.m)/t.s; sum+=z*z*z*z;} return A*sum-B; }
  function div(a,b){ return (a!=null&&b!=null&&b!==0)?a/b:null; }
  function dphase(a1,a2,b1,b2){ // ((a2-a1)/(a1+a2))/((b2-b1)/(b1+b2)), IFERROR->0
    var s1=a1+a2, s2=b1+b2; if(s1===0||s2===0) return 0;
    var top=(a2-a1)/s1, bot=(b2-b1)/s2; if(bot===0) return 0; return top/bot; }

  // returns {CI:[21], CL:[21], CM:[21]}
  function computeTension(rows){
    var n=rows.length, i, w;
    var O=[],AO=[],L=[],AS=[],AV=[],AX=[];
    for(i=0;i<n;i++){ var r=rows[i];
      var o=(r.poi||0)-(r.coi||0), ao=(r.pprem||0)-(r.cprem||0), l=(r.pvol||0)-(r.cvol||0);
      O.push(o);AO.push(ao);L.push(l);
      AS.push(o!==0?ao/o:null);
      AV.push(l!==0?ao/l:null); }
    for(i=0;i<n;i++){ AX.push((AS[i]!=null&&AV[i]!=null&&AV[i]!==0)?AS[i]/AV[i]:null); }
    var DE2=excelKurt(AS),DE3=excelKurt(AV),DE7=excelKurt(AX);
    var DE14=excelSkew(AS),DE15=excelSkew(AV),DE17=excelSkew(AX);
    var DE37=div(DE2,DE14),DE38=div(DE3,DE15),DE39=div(DE7,DE17);
    var DI29=div(DE7,div(DE2,DE3)),DI30=div(DE17,div(DE14,DE15));
    var DI31=div(DI29,DI30),DI37=div(DE37,DE38),DI38=div(DI37,DE39);
    var gain=(DI37!=null&&DI38!=null&&DI31!=null)?((DI37-DI38)*DI31):null;
    var BO=AS.map(function(a){return (gain!=null&&a!=null)?gain*Math.abs(a):null;});
    var nums=BO.filter(function(x){return x!=null;});
    var bmin=Math.min.apply(null,nums), bmax=Math.max.apply(null,nums), rng=bmax-bmin;
    var BP=BO.map(function(x){return x!=null?(rng?(x-bmin)/rng:null):null;});
    var BY=[]; for(i=0;i<n;i++) BY.push((i+1<n&&BP[i]!=null&&BP[i+1]!=null)?(BP[i+1]-BP[i]):null);
    function byi(idx){return (idx>=0&&idx<n)?BY[idx]:null;}
    var step=[]; for(w=0;w<20;w++) step.push(0.1); step.push(-1.0);
    var CJ=[]; for(w=0;w<21;w++){var a=byi(14+w),b=byi(13+w); CJ.push((a!=null&&b!=null)?(a-b)/step[w]:0);}
    var CK=[]; for(w=0;w<21;w++){var cjn=(w+1<21)?CJ[w+1]:0; CK.push((cjn-CJ[w])/step[w]);}
    var CU=[],CV=[];
    for(w=0;w<21;w++){ if(w<20){CU.push(dphase(CJ[w],CJ[w+1],CK[w],CK[w+1])); CV.push(dphase(CK[w],CK[w+1],CJ[w],CJ[w+1]));}
                       else {CU.push(0);CV.push(0);} }
    var CL=[],CM=[]; for(w=0;w<21;w++){ CL.push((w+1<21)?CU[w]+CU[w+1]:0); CM.push((w+1<21)?CV[w]+CV[w+1]:0); }
    [1,2,3,4,19,20].forEach(function(z){CL[z]=0;});            // Book literal-zero rows on CL
    var CI=[]; for(w=0;w<21;w++) CI.push(Math.round((-1+0.1*w)*1e10)/1e10);
    return {CI:CI, CL:CL, CM:CM};
  }
  // Breach detector primitive: cross CL vs CM along the watch axis (matches BD master findBreaches)
  function findBreaches(CI,CL,CM){ var out=[];
    for(var i=0;i<CI.length-1;i++){ var d1=CM[i]-CL[i], d2=CM[i+1]-CL[i+1];
      if((d1<=0&&d2>0)||(d1>0&&d2<=0)){ var t=-d1/(d2-d1); out.push({cw:CI[i]+t*(CI[i+1]-CI[i]), val:CL[i]+t*(CL[i+1]-CL[i])}); } }
    return out.sort(function(a,b){return a.cw-b.cw;}); }

  global.QuanTension={parseChain:parseChain, computeTension:computeTension, findBreaches:findBreaches};
})(typeof window!=='undefined'?window:globalThis);


const BAKED_PRICE={};  /* demo price dataset removed — back dates now show only uploaded data */
(function(){
  const $=id=>document.getElementById(id);
  const canvas=$('chart'), ctx=canvas.getContext('2d'), dotTip=$('dotTip');
  const overlay=$('overlay'), octx=overlay.getContext('2d');
  const instA=$('instA'), fnA=$('fnA'), priceToggle=$('priceToggle'), fitToggle=$('fitToggle'),
        dayDate=$('dayDate'), alignCount=$('alignCount'), alignList=$('alignList'),
        legend=$('legend'), chartTitle=$('chartTitle'), sessTEl=$('sessT');
  const vis={A1:true,A2:true}, fvis={A1:true,A2:true};

  const COL_X='Chronometer Watch', COL_M='PG/PC Dual Phase Tension', COL_S='PC/PG Dual Phase Tension';
  const WH_KEY='quan_intermarket_warehouse_v2', SEL_KEY='quan_intermarket_sel_v2';
  // ---- full CME Group instrument set (CME+CBOT+NYMEX+COMEX), grouped by asset class ----
  // Sourced from js/instrument-registry.js (the single instrument table shared with
  // the ingest worker, heatmap, and auto-pull); the literal below is only a
  // fallback for embeds that load detector.js without the registry.
  const INSTRUMENT_GROUPS=(window.QuanInstruments&&window.QuanInstruments.groups())||[
    ['Equity Index',[['ES','ES'],['MES','MES'],['NQ','NQ'],['MNQ','MNQ'],['YM','YM'],['MYM','MYM'],['RTY','RTY'],['M2K','M2K']]],
    ['Rates',[['ZT','ZT'],['ZF','ZF'],['ZN','ZN'],['ZB','ZB'],['UB','UB'],['SR3','SR3']]],
    ['FX',[['6E','6E'],['6B','6B'],['6J','6J'],['6A','6A'],['6C','6C'],['6S','6S'],['6N','6N']]],
    ['Metals',[['GC','GC'],['MGC','MGC'],['SI','SI'],['SIL','SIL'],['HG','HG'],['PL','PL'],['PA','PA']]],
    ['Energy',[['CL','CL'],['QM','QM'],['NG','NG'],['RB','RB'],['HO','HO'],['BZ','BZ']]],
    ['Ags',[['ZC','ZC'],['ZW','ZW'],['ZS','ZS'],['ZM','ZM'],['ZL','ZL'],['KE','KE'],['ZO','ZO'],['ZR','ZR']]],
    ['Livestock',[['LE','LE'],['GF','GF'],['HE','HE']]],
    ['Dairy',[['DC','DC']]],
    ['Crypto',[['BTC','BTC'],['MBT','MBT'],['ETH','ETH']]]
  ];
  const INSTRUMENTS=[].concat.apply([],INSTRUMENT_GROUPS.map(g=>g[1]));

  let warehouse={}, date='', aInst='NQ';
  let A={rows:[],price:[],priorPrice:[],breaches:[]};
  let highlight=null, rafId=null, t0=0, screenPts=[];
  let viewLo=-1, viewHi=1, yScale=1, yPan=0, GEO=null, cursor=null, drag=null; // drag retained as no-op

  const mem={};
  const KV={
    async get(k){
      try{ if(window.storage){ const r=await window.storage.get(k,false); return r&&r.value?JSON.parse(r.value):(k in mem?mem[k]:null); } }catch(e){}
      try{ const s=localStorage.getItem(k); if(s!=null) return JSON.parse(s); }catch(e){}
      return (k in mem)?mem[k]:null;
    },
    async set(k,v){ mem[k]=v;
      try{ if(window.storage){ await window.storage.set(k,JSON.stringify(v),false); return; } }catch(e){}
      try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){}
    }
  };
  function todayISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  const saveSel=()=>KV.set(SEL_KEY,{date,aInst});
  const saveWh=()=>KV.set(WH_KEY,warehouse);
  function entry(inst,make){ const w=warehouse[date]||(warehouse[date]={}); if(make&&!w[inst]) w[inst]={rows:[],price:[]}; return w[inst]; }

  const _etFmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit'});
  const _etClock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function sessionDate(tSec){ const P={}; for(const p of _etFmt.formatToParts(new Date(tSec*1000))) P[p.type]=p.value;
    let h=+P.hour; if(h>=24)h-=24; const dt=new Date(Date.UTC(+P.year,(+P.month)-1,+P.day)); if(h>=18) dt.setUTCDate(dt.getUTCDate()+1); return dt.toISOString().slice(0,10); }
  function sessionFrac(tSec){ const P={}; for(const p of _etClock.formatToParts(new Date(tSec*1000))) P[p.type]=p.value;
    let h=+P.hour; if(h>=24)h-=24; const sod=h*3600+(+P.minute)*60+(+P.second); let el=(h>=18)?(sod-64800):(sod+21600); let pt=el/82800; pt=pt<0?0:(pt>1?1:pt);
    return window.__sessFrac?window.__sessFrac(pt,sessionDate(tSec)):pt; }
  function sessionT(){ const P={}; for(const p of _etClock.formatToParts(new Date())) P[p.type]=p.value;
    let h=+P.hour; if(h>=24)h-=24; const sod=h*3600+(+P.minute)*60+(+P.second); let el=(h>=18)?(sod-64800):(sod+21600); let pt=el/82800; pt=pt<0?0:(pt>1?1:pt);
    return window.__sessFrac?window.__sessFrac(pt,sessionDate(Date.now()/1000)):pt; }
  try{ window.__sessionT=sessionT; window.__sessionDateNow=function(){ return sessionDate(Date.now()/1000); }; }catch(_st){}
  function tickT(){ sessTEl.textContent=sessionT().toFixed(4); }
  function cwClock(cw){ const t=__cwToSec(cw); return String(Math.floor(t/3600)).padStart(2,'0')+':'+String(Math.floor((t%3600)/60)).padStart(2,'0'); }
  // ---- canonical session-position -> ET instant, single source of truth reused by every tab's clock display (see clockT()) ----
  // dateStr (optional) lets a caller resolve against the manual Full/Early/Closed override (js/session-calendar.js); omitted = plain full-session math
  function __cwToSec(cw,dateStr){ if(window.__sessCwSec) return window.__sessCwSec(cw,dateStr!=null?dateStr:date); let t=Math.round(64800+Math.abs(cw)*82800); return ((t%86400)+86400)%86400; }
  try{ window.__cwToSec=__cwToSec; window.__cwClock=cwClock; }catch(_cwc){}

  // ---- shared US market holiday / early-close calendar (CME-style), generated so it doesn't need hand-updating per year ----
  (function(){
    function nthWeekday(y,mo,wd,n){ if(n>0){ var d=new Date(Date.UTC(y,mo,1)); var off=(wd-d.getUTCDay()+7)%7; return new Date(Date.UTC(y,mo,1+off+(n-1)*7)); }
      var d2=new Date(Date.UTC(y,mo+1,0)); var off2=(d2.getUTCDay()-wd+7)%7; return new Date(Date.UTC(y,mo,d2.getUTCDate()-off2)); }
    function easter(y){ var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),
        g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,
        m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;
      return new Date(Date.UTC(y,mo-1,da)); }
    function observedFixed(y,mo,da){ var d=new Date(Date.UTC(y,mo,da)),wd=d.getUTCDay();
      if(wd===6) d.setUTCDate(d.getUTCDate()-1); else if(wd===0) d.setUTCDate(d.getUTCDate()+1); return d; }
    function iso(d){ return d.toISOString().slice(0,10); }
    function buildHolidays(y0,y1){ var m={};
      for(var y=y0;y<=y1;y++){
        m[iso(observedFixed(y,0,1))]='full';           // New Year's Day
        m[iso(nthWeekday(y,0,1,3))]='full';             // MLK Day (3rd Mon Jan)
        m[iso(nthWeekday(y,1,1,3))]='full';             // Presidents Day (3rd Mon Feb)
        var gf=easter(y); gf=new Date(Date.UTC(gf.getUTCFullYear(),gf.getUTCMonth(),gf.getUTCDate()-2));
        m[iso(gf)]='full';                              // Good Friday
        m[iso(nthWeekday(y,4,1,-1))]='full';            // Memorial Day (last Mon May)
        m[iso(observedFixed(y,5,19))]='full';           // Juneteenth
        m[iso(observedFixed(y,6,4))]='full';            // Independence Day
        m[iso(nthWeekday(y,8,1,1))]='full';             // Labor Day (1st Mon Sept)
        var thx=nthWeekday(y,10,4,4); m[iso(thx)]='full'; // Thanksgiving (4th Thu Nov)
        m[iso(new Date(Date.UTC(thx.getUTCFullYear(),thx.getUTCMonth(),thx.getUTCDate()+1)))]='early'; // day after
        m[iso(observedFixed(y,11,25))]='full';          // Christmas
        var xe=new Date(Date.UTC(y,11,24)); if(xe.getUTCDay()!==0&&xe.getUTCDay()!==6) m[iso(xe)]='early'; // Christmas Eve
      }
      return m; }
    var curY=new Date().getUTCFullYear();
    var MARKET_HOLIDAYS=buildHolidays(curY-3,curY+6);
    function sessionKind(dateStr){ if(!dateStr) return 'closed'; var d=new Date(dateStr+'T00:00:00Z'); var wd=d.getUTCDay();
      if(wd===0||wd===6) return 'closed'; var h=MARKET_HOLIDAYS[dateStr]; if(h==='full') return 'closed'; if(h==='early') return 'early'; return 'full'; }
    function isTradingDay(dateStr){ return sessionKind(dateStr)!=='closed'; }
    try{
      window.__marketHolidays=MARKET_HOLIDAYS;
      window.__sessionKind=sessionKind;
      window.__isTradingDay=isTradingDay;
      window.__lastTradingDayOfMonth=function(y,mo){ var d=new Date(Date.UTC(y,mo+1,0));
        while(!isTradingDay(iso(d))) d.setUTCDate(d.getUTCDate()-1); return iso(d); };
    }catch(_hol){}
  })();

  function parseCSV(text, ctx){ text=(typeof __qnorm==='function')?__qnorm(text):text; const lines=text.trim().split('\n'); const head=lines[0].replace(/^\ufeff/,'').split(',').map(h=>h.trim());
    const ix=head.indexOf(COL_X),im=head.indexOf(COL_M),is=head.indexOf(COL_S); const out=[];
    if(ix<0 && typeof QuanTension!=='undefined' && /strike/i.test(head.join(',')) && /^"?type"?$/i.test(head[0]||'')){
      // raw Barchart options chain -> compute Chronometer Watch + dual-phase tension from the reference closure
      var pipe=window.__qPipe?window.__qPipe.run('detector',ctx):null;
      try{
        var chainRows=QuanTension.parseChain(text, ctx);
        if(pipe) (pipe.stage('CSV Parsing'))[(chainRows&&chainRows.length)?'ok':'fail']((chainRows&&chainRows.length)?{strikes:chainRows.length}:'0 strikes parsed from raw Barchart chain', {strikes:(chainRows||[]).length});
        if(window.__qPipe) window.__qPipe.validateChain(chainRows, ['k','coi','poi','cprem','pprem'], ctx);
        const _er=(window.__engTensionRows?window.__engTensionRows(text):null);
        if(_er&&_er.length){ for(const _row of _er) out.push(_row); if(pipe) pipe.stage('Breach Tension (engine)').ok({rows:_er.length}); return out; }
        const t=QuanTension.computeTension(chainRows);
        for(let w=0;w<t.CI.length;w++) out.push([t.CI[w],t.CL[w],t.CM[w]]);
        if(pipe){ var _nz=out.filter(function(r){return (r[1]||r[2]);}).length;
          if(!out.length) pipe.stage('Breach Tension (closure)').fail('tension closure produced 0 rows');
          else if(!_nz) pipe.stage('Breach Tension (closure)').warn('closure returned all-zero CL/CM \u2014 the fixed 21-row watch grid may not fit this chain shape (check strike count / ATM window)', {rows:out.length});
          else pipe.stage('Breach Tension (closure)').ok({rows:out.length}); }
        return out;
      }
      catch(e){ if(pipe) pipe.stage('Breach Tension').fail('tension compute threw: '+String(e&&e.message||e), {stack:e&&e.stack}); else console.warn('Qu\'an tension compute failed:',e); return []; }
    }
    for(let i=1;i<lines.length;i++){ const v=lines[i].split(','); const cw=parseFloat(v[ix]),m=parseFloat(v[im]),s=parseFloat(v[is]);
      if(!isNaN(cw)&&!isNaN(m)&&!isNaN(s)) out.push([cw,m,s]); } return out; }
  function findBreaches(rows){ const out=[];
    for(let i=0;i<rows.length-1;i++){ const [c1,m1,s1]=rows[i],[c2,m2,s2]=rows[i+1]; const d1=s1-m1,d2=s2-m2;
      if((d1<=0&&d2>0)||(d1>0&&d2<=0)){ const t=-d1/(d2-d1); out.push({cw:c1+t*(c2-c1),val:m1+t*(m2-m1)}); } }
    return out.sort((a,b)=>a.cw-b.cw); }
  function onCSV(file, inst, fnEl){ const r=new FileReader();
    r.onload=ev=>{ const _d=(dayDate&&dayDate.value)||date; const rows=parseCSV(ev.target.result,{inst:inst,date:_d});
      if(!rows.length){ if(window.__qPipe) window.__qPipe.log('Detector Ingest','fail','parser returned 0 usable rows from '+file.name,{inst:inst,date:_d}); return; }
      const rc=window.__qRec?window.__qRec(inst):null;
      if(rc){ date=(dayDate&&dayDate.value)||date; rc.det=rc.det||{}; rc.det[date]={rows}; if(window.__qPersist)window.__qPersist(inst); }
      if(window.__detHydrate){ window.__detHydrate(); } else { entry(inst,true).rows=rows; show(); } };
    r.readAsText(file); fnEl.textContent=file.name; }
  window.__engReady=window.__engReady||new Promise(function(r){window.__engReadyResolve=r;});$('fileA').addEventListener('change',e=>{ if(e.target.files[0]) onCSV(e.target.files[0],aInst,fnA); });
  priceToggle.addEventListener('change',draw);
  fitToggle.addEventListener('change',()=>{ buildLegend(); draw(); });
  $('fitOrder').addEventListener('input',()=>{ $('fitOrderV').textContent=$('fitOrder').value; buildLegend(); if(fitToggle.checked)draw(); });
  dayDate.addEventListener('change',()=>{ date=dayDate.value||todayISO(); saveSel(); show(); window.dispatchEvent(new CustomEvent('quan:date',{detail:date})); });

  function fillInst(sel,val){ sel.innerHTML=INSTRUMENT_GROUPS.map(g=>'<optgroup label="'+g[0]+'">'+g[1].map(p=>'<option value="'+p[0]+'">'+p[1]+'</option>').join('')+'</optgroup>').join(''); sel.value=val; }
  instA.addEventListener('change',()=>{ aInst=instA.value; saveSel(); buildLegend(); show(); window.dispatchEvent(new CustomEvent('quan:instr',{detail:aInst})); });

  function buildLegend(){
    legend.innerHTML=
      '<span class="ltog'+(vis.A1?'':' off')+'" data-k="A1" title="click: show/hide curve"><span class=\'sw\' style="border-top-color:var(--a1)"></span>'+aInst+' PG/PC'+' <span class="ftog '+(fvis.A1?'on':'off')+'" data-fit="A1" title="show/hide this curve\'s fit ladder">\u0192</span></span>'+
      '<span class="ltog'+(vis.A2?'':' off')+'" data-k="A2" title="click: show/hide curve"><span class=\'sw\' style="border-top-color:var(--a2)"></span>'+aInst+' PC/PG'+' <span class="ftog '+(fvis.A2?'on':'off')+'" data-fit="A2" title="show/hide this curve\'s fit ladder">\u0192</span></span>'+
      '<span><span class="dot" style="background:var(--breach)"></span>'+aInst+' breach</span>'+
      '<span><span class="sw" style="border-top-color:var(--price)"></span>'+aInst+' price (norm.)</span>';
    if(typeof fitToggle!=='undefined' && fitToggle.checked){ let mo=fitMaxO(),s=''; for(let d=1;d<=mo;d++) s+='<span><span class="sw" style="border-top-color:'+FITC[d]+'"></span>P'+d+'</span>'; legend.innerHTML+=s; }
  }
  legend.addEventListener('click',e=>{
    const ft=e.target.closest('.ftog'); if(ft){ const k=ft.dataset.fit; fvis[k]=!fvis[k]; buildLegend(); draw(); return; }
    const lt=e.target.closest('.ltog'); if(lt){ const k=lt.dataset.k; vis[k]=!vis[k]; buildLegend(); draw(); } });

  function priorDateWithPrice(d,inst){ const ks=Object.keys(warehouse).filter(k=>k<d && warehouse[k][inst] && warehouse[k][inst].price && warehouse[k][inst].price.length).sort(); return ks.length?ks[ks.length-1]:null; }
  var __memo={}; var __initBlank=true; function __curEng(){ return window.__ENGHASH||''; }
  function __rawChainAt(inst,d){ try{ var r=window.__qStore&&window.__qStore[inst]; if(!r) return null; if(r.det&&r.det[d]&&r.det[d].chain) return r.det[d].chain; if(!r.sess) return null; var cell=r.sess[d]; if(!cell) return null; var ex=cell.exp||{}; var b=(cell.active&&ex[cell.active]&&ex[cell.active].chain)?cell.active:null; if(!b){ for(var k in ex){ if(ex[k]&&ex[k].chain){ b=k; break; } } } var e=b&&ex[b]; return (e&&e.chain)||null; }catch(_){ return null; } }
  function __rowsFor(inst,d){ if(!d) return null; var key=inst+'|'+d+'|'+__curEng(); if(__memo[key]) return __memo[key]; var txt=__rawChainAt(inst,d); if(!txt||!window.__engTensionRows) return null; var rows=null; try{ rows=window.__engTensionRows(txt); }catch(_){ rows=null; } if(rows&&rows.length){ __memo[key]=rows; try{ (warehouse[d]||(warehouse[d]={}))[inst]=Object.assign({},(warehouse[d]&&warehouse[d][inst])||{},{rows:rows}); }catch(_){} } return rows; }
  window.__qMigrate=function(){ try{ show(); }catch(_){} };
  if(window.__engReady){ window.__engReady.then(function(){ try{ window.__qMigrate(); }catch(_e){} }); }
  function show(){
    date=(dayDate&&dayDate.value)||date;   /* key off the live picker, same date everything else uses */
    const eA=warehouse[date]&&warehouse[date][aInst];
    A.rows=__initBlank?[]:(eA&&eA.rows?eA.rows:[]); A.price=eA&&eA.price?eA.price:[]; A.breaches=findBreaches(A.rows);
    const pd=priorDateWithPrice(date,aInst); A.priorPrice=pd?warehouse[pd][aInst].price:[];
    fnA.textContent=A.rows.length?'stored':'none';
    chartTitle.textContent=aInst+' · '+(date||'');
    draw();
    try{ if(window.__breachRefresh) requestAnimationFrame(function(){ try{ window.__breachRefresh(); }catch(_e){} }); }catch(_b){}
  }

  let W=0,H=0; const PAD_L=48,PAD_R=24,PAD_T=26,PAD_B=36;
  function sizeCanvas(){ const dpr=window.devicePixelRatio||1; const w=canvas.clientWidth,h=canvas.clientHeight; if(!w||!h) return;
    canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr); ctx.setTransform(dpr,0,0,dpr,0,0); W=w; H=h;
    let keep=null; if(overlay.width){ try{ keep=octx.getImageData(0,0,overlay.width,overlay.height); }catch(e){} }
    overlay.width=Math.round(w*dpr); overlay.height=Math.round(h*dpr); octx.setTransform(dpr,0,0,dpr,0,0);
    if(keep && keep.width===overlay.width){ octx.save(); octx.setTransform(1,0,0,1,0,0); octx.putImageData(keep,0,0); octx.restore(); }
    draw(); __initBlank=false; try{ if(window.__breachRefresh) requestAnimationFrame(function(){ try{ window.__breachRefresh(); }catch(_e){} }); }catch(_b){} }
  window.__breachData=function(){ var rA=(__rowsFor(aInst,date))||((A&&A.rows)||[]); return {rowsA:rA, inst:aInst, date:date}; };
  new ResizeObserver(sizeCanvas).observe(canvas);
  window.__detResize=sizeCanvas;

  function extentOf(rows){ if(!rows.length) return [-1,1]; let lo=Infinity,hi=-Infinity;
    for(const r of rows){ if(r[1]<lo)lo=r[1]; if(r[2]<lo)lo=r[2]; if(r[1]>hi)hi=r[1]; if(r[2]>hi)hi=r[2]; }
    if(lo===hi){lo-=1;hi+=1;} const p=(hi-lo)*0.08; return [lo-p,hi+p]; }
  function fmt(v){ const a=Math.abs(v); if(a>=1000)return(v/1000).toFixed(1)+'k'; if(a>=10)return v.toFixed(0); return v.toFixed(2); }
  function smooth(pts){ if(pts.length<2) return; ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=0;i<pts.length-1;i++){ const p0=pts[i-1]||pts[i],p1=pts[i],p2=pts[i+1],p3=pts[i+2]||p2;
      ctx.bezierCurveTo(p1.x+(p2.x-p0.x)/6,p1.y+(p2.y-p0.y)/6,p2.x-(p3.x-p1.x)/6,p2.y-(p3.y-p1.y)/6,p2.x,p2.y); } }
  function startPulse(h){ highlight=h; t0=performance.now(); if(!rafId) rafId=requestAnimationFrame(loop); }
  function stopPulse(){ highlight=null; if(rafId){cancelAnimationFrame(rafId);rafId=null;} draw(); }
  function loop(now){ draw(now); rafId=requestAnimationFrame(loop); }

  function draw(now){
    if(!W||!H) return; now=(typeof now==='number')?now:0;
    ctx.clearRect(0,0,W,H); ctx.fillStyle='#07090d'; ctx.fillRect(0,0,W,H);
    const pW=W-PAD_L-PAD_R, pH=H-PAD_T-PAD_B;
    const exA=extentOf(A.rows);
    function zext(ex){ const c=(ex[0]+ex[1])/2 - yPan*(ex[1]-ex[0]); const h=(ex[1]-ex[0])/2/yScale; return [c-h,c+h]; }
    const zA=zext(exA);
    const mapX=cw=>PAD_L+((cw-viewLo)/(viewHi-viewLo))*pW;
    const invX=px=>viewLo+((px-PAD_L)/pW)*(viewHi-viewLo);
    GEO={pW,pH,mapX,invX};
    const mYA=v=>PAD_T+(1-(v-zA[0])/(zA[1]-zA[0]))*pH;
    const clampY=y=>Math.max(PAD_T,Math.min(PAD_T+pH,y));
    const cx=mapX(0);
    const baseY=clampY(mYA(0));

    ctx.fillStyle='#0b0f14'; ctx.fillRect(PAD_L,PAD_T,pW,pH);

    const ti0=Math.ceil(viewLo*10-1e-9), ti1=Math.floor(viewHi*10+1e-9);
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=0.5;
    for(let i=ti0;i<=ti1;i++){ const x=mapX(i/10); ctx.beginPath(); ctx.moveTo(x,PAD_T); ctx.lineTo(x,PAD_T+pH); ctx.stroke(); }

    ctx.strokeStyle='rgba(232,227,214,0.80)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(PAD_L,baseY); ctx.lineTo(PAD_L+pW,baseY); ctx.stroke();
    if(cx>=PAD_L&&cx<=PAD_L+pW){ ctx.beginPath(); ctx.moveTo(cx,PAD_T); ctx.lineTo(cx,PAD_T+pH); ctx.stroke(); }

    ctx.fillStyle='#a6a299'; ctx.font='10px -apple-system,Segoe UI,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
    for(let i=ti0;i<=ti1;i++){ const v=i/10,x=mapX(v),maj=(i%2===0);
      ctx.strokeStyle='rgba(232,227,214,'+(maj?0.65:0.4)+')'; ctx.lineWidth=maj?1:0.5;
      ctx.beginPath(); ctx.moveTo(x,baseY-(maj?5:3)); ctx.lineTo(x,baseY+(maj?5:3)); ctx.stroke();
      ctx.fillText(v.toFixed(1).replace('-0.0','0.0'),x,baseY+7); }

    function yLabels(ex,side,color){ ctx.textBaseline='middle'; ctx.fillStyle=color; ctx.font='9px SF Mono,Menlo,monospace';
      for(let i=0;i<=4;i++){ const val=ex[0]+(i/4)*(ex[1]-ex[0]), y=PAD_T+(1-i/4)*pH;
        ctx.strokeStyle='rgba(232,227,214,0.30)'; ctx.lineWidth=0.5;
        if(side==='L'){ ctx.textAlign='right'; ctx.beginPath();ctx.moveTo(PAD_L-4,y);ctx.lineTo(PAD_L,y);ctx.stroke(); ctx.fillText(fmt(val),PAD_L-7,y); }
        else { ctx.textAlign='left'; ctx.beginPath();ctx.moveTo(PAD_L+pW,y);ctx.lineTo(PAD_L+pW+4,y);ctx.stroke(); ctx.fillText(fmt(val),PAD_L+pW+7,y); } } }
    yLabels(zA,'L','#a6a299');

    ctx.save(); ctx.beginPath(); ctx.rect(PAD_L,PAD_T,pW,pH); ctx.clip();

    if(priceToggle.checked && (A.price.length>1 || A.priorPrice.length>1)) drawPrice(A.priorPrice, A.price, mapX, pH);

    const ra=fitToggle.checked?0.26:1;
    if(A.rows.length){ if(vis.A1)drawCurve(A.rows,1,'#d36b9b',[],mapX,mYA,ra); if(vis.A2)drawCurve(A.rows,2,'#5aa0d8',[],mapX,mYA,ra);
      if(fitToggle.checked){ if(fvis.A1)drawFit(A.rows,1,'#d36b9b',mapX,mYA,[]); if(fvis.A2)drawFit(A.rows,2,'#5aa0d8',mapX,mYA,[2,3]); } }

    screenPts=[];
    A.breaches.forEach(bp=>{ const x=mapX(bp.cw),y=mYA(bp.val); drawDot(x,y, highlight&&highlight.cw===bp.cw, now); screenPts.push({x,y,cw:bp.cw,lab:aInst}); });

    if(cursor && !drag){ const mx=cursor.x,my=cursor.y;
      if(mx>=PAD_L&&mx<=PAD_L+pW&&my>=PAD_T&&my<=PAD_T+pH){ const cw=invX(mx);
        const guide=(cwv,a)=>{ const gx=mapX(cwv); if(gx<PAD_L-1||gx>PAD_L+pW+1) return;
          ctx.strokeStyle='rgba(232,227,214,'+a+')'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
          ctx.beginPath(); ctx.moveTo(gx,PAD_T); ctx.lineTo(gx,PAD_T+pH); ctx.stroke(); ctx.setLineDash([]);
          const mk=(rows,idx,mY,color)=>{ const v=interpAt(rows,idx,cwv); if(v==null)return; ctx.fillStyle=color; ctx.beginPath(); ctx.arc(gx,mY(v),3.4,0,Math.PI*2); ctx.fill(); };
          const mkFit=(rows,idx,mY)=>{ if(rows.length<8||cwv<rows[0][0]||cwv>rows[rows.length-1][0])return; const src=rows.map(r=>[r[0],r[idx]]), mo=fitMaxO(); for(let deg=1;deg<=mo;deg++){ if(rows.length<deg+1)break; const c=polyfit(src,deg); ctx.strokeStyle=FITC[deg]||'#fff'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.arc(gx,mY(polyval(c,cwv)),3.2,0,Math.PI*2); ctx.stroke(); } };
          if(A.rows.length){ if(vis.A1)mk(A.rows,1,mYA,'#d36b9b'); if(vis.A2)mk(A.rows,2,mYA,'#5aa0d8'); if(fitToggle.checked){ if(fvis.A1)mkFit(A.rows,1,mYA); if(fvis.A2)mkFit(A.rows,2,mYA); } }
          const lab=cwClock(cwv)+' ET'; ctx.font='11px SF Mono,Menlo,monospace'; const tw=ctx.measureText(lab).width+14;
          const lx=Math.max(PAD_L,Math.min(PAD_L+pW-tw,gx-tw/2));
          ctx.fillStyle='rgba(18,18,22,0.94)'; ctx.fillRect(lx,PAD_T+2,tw,18); ctx.strokeStyle='#4c4c54'; ctx.lineWidth=0.5; ctx.strokeRect(lx,PAD_T+2,tw,18);
          ctx.fillStyle='#7fd1e0'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(lab,lx+tw/2,PAD_T+11); };
        guide(cw,0.5);
        if(Math.abs(cw)>0.012) guide(-cw,0.3);
      } }
    ctx.restore();
    updateList();
  }
  function interpAt(rows,idx,cw){ if(!rows.length||cw<rows[0][0]||cw>rows[rows.length-1][0]) return null;
    for(let i=0;i<rows.length-1;i++){ const a=rows[i],b=rows[i+1]; if(cw>=a[0]&&cw<=b[0]){ const t=(b[0]===a[0])?0:(cw-a[0])/(b[0]-a[0]); return a[idx]+t*(b[idx]-a[idx]); } } return rows[rows.length-1][idx]; }
  function drawPrice(prior,cur,mapX,pH){ let lo=Infinity,hi=-Infinity;
    for(const r of prior){ if(r[1]<lo)lo=r[1]; if(r[1]>hi)hi=r[1]; }
    for(const r of cur){ if(r[1]<lo)lo=r[1]; if(r[1]>hi)hi=r[1]; }
    if(!isFinite(lo)) return; if(hi===lo){hi+=1;lo-=1;} const pad=(hi-lo)*0.06; lo-=pad; hi+=pad;
    const py=c=>PAD_T+(1-(c-lo)/(hi-lo))*pH;
    ctx.save(); ctx.strokeStyle='#9a9aa0'; ctx.lineWidth=1.4; ctx.lineJoin='round';
    // prior session -> left half (sessionFrac-1 maps open=-1 .. close=0), dimmer
    ctx.globalAlpha=0.5; ctx.beginPath();
    for(let i=0;i<prior.length;i++){ const x=mapX(sessionFrac(prior[i][0])-1),y=py(prior[i][1]); i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.stroke();
    // current session -> right half (sessionFrac maps open=0 .. close=+1)
    ctx.globalAlpha=0.85; ctx.beginPath();
    for(let i=0;i<cur.length;i++){ const x=mapX(sessionFrac(cur[i][0])),y=py(cur[i][1]); i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.stroke();
    ctx.restore(); }
  function drawCurve(rows,idx,stroke,dash,mapX,mapY,alpha){ const pts=rows.map(r=>({x:mapX(r[0]),y:mapY(r[idx])}));
    ctx.save(); ctx.globalAlpha=(alpha==null?1:alpha); ctx.strokeStyle=stroke; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.setLineDash(dash); ctx.shadowColor=stroke; ctx.shadowBlur=4; ctx.beginPath(); smooth(pts); ctx.stroke(); ctx.restore(); }
  function polyfit(pts,deg){ const n=deg+1; const ps=new Array(2*deg+1).fill(0), b=new Array(n).fill(0);
    for(const [x,y] of pts){ let xp=1; const xs=[]; for(let p=0;p<=2*deg;p++){xs.push(xp);xp*=x;}
      for(let p=0;p<=2*deg;p++) ps[p]+=xs[p]; for(let j=0;j<n;j++) b[j]+=y*xs[j]; }
    const A=Array.from({length:n},(_,j)=>Array.from({length:n},(_,k)=>ps[j+k]));
    for(let i=0;i<n;i++){ let piv=i; for(let r=i+1;r<n;r++) if(Math.abs(A[r][i])>Math.abs(A[piv][i])) piv=r;
      [A[i],A[piv]]=[A[piv],A[i]]; [b[i],b[piv]]=[b[piv],b[i]]; const d=A[i][i]; if(Math.abs(d)<1e-12) continue;
      for(let r=0;r<n;r++){ if(r===i) continue; const f=A[r][i]/d; for(let c=i;c<n;c++) A[r][c]-=f*A[i][c]; b[r]-=f*b[i]; } }
    const c=new Array(n); for(let i=0;i<n;i++) c[i]=Math.abs(A[i][i])<1e-12?0:b[i]/A[i][i]; return c; }
  function polyval(c,x){ let y=0,xp=1; for(let i=0;i<c.length;i++){y+=c[i]*xp;xp*=x;} return y; }
  const FITC={1:'#e8b53a',2:'#6fd3ff',3:'#c9a0ff',4:'#f06a6a',5:'#5fcf8f',6:'#ff9a4d',7:'#9fb0ff',8:'#ff7fd0',9:'#d4c47a'};
  function fitMaxO(){ const e=$('fitOrder'); return e?Math.max(1,Math.min(9,(+e.value)||6)):6; }
  // degree -> color (FITC, labelled P1..P9 in the legend), series -> dash; width tapers with degree
  function drawFit(rows,idx,seriesColor,mapX,mapY,dash){ if(rows.length<8) return;
    const c0=rows[0][0], c1=rows[rows.length-1][0], N=160, maxO=fitMaxO(), src=rows.map(r=>[r[0],r[idx]]);
    ctx.save(); ctx.lineJoin='round'; ctx.setLineDash(dash||[]);
    for(let deg=1;deg<=maxO;deg++){ if(rows.length<deg+1) break; const c=polyfit(src,deg);
      ctx.strokeStyle=FITC[deg]||seriesColor; ctx.lineWidth=Math.max(1.0,2.4-(deg-1)*0.15); ctx.shadowColor=FITC[deg]||seriesColor; ctx.shadowBlur=3;
      ctx.beginPath();
      for(let i=0;i<=N;i++){ const xv=c0+(c1-c0)*i/N, X=mapX(xv), Y=mapY(polyval(c,xv)); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); }
      ctx.stroke(); }
    ctx.restore(); }
  function drawDot(x,y,hl,now){ if(hl){ const ph=((now-t0)%900)/900; ctx.strokeStyle='rgba(232,92,92,'+(0.85*(1-ph)).toFixed(3)+')'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,5.5+ph*16,0,Math.PI*2); ctx.stroke(); }
    ctx.save(); ctx.shadowColor='#e85c5c'; ctx.shadowBlur=hl?16:10; ctx.fillStyle='#e85c5c'; ctx.beginPath(); ctx.arc(x,y,hl?5.5:4.5,0,Math.PI*2); ctx.fill(); ctx.restore(); }
  function showTip(p){ dotTip.innerHTML='<b>'+cwClock(p.cw)+' ET</b> &middot; '+p.lab+' &middot; CW '+p.cw.toFixed(3); dotTip.style.left=p.x+'px'; dotTip.style.top=p.y+'px'; dotTip.style.display='block'; }
  function resetView(){ viewLo=-1; viewHi=1; yScale=1; yPan=0; draw(); }
  canvas.addEventListener('mousemove',e=>{ const r=canvas.getBoundingClientRect(); const mx=e.clientX-r.left,my=e.clientY-r.top;
    cursor={x:mx,y:my};
    let hit=null,best=12; for(const p of screenPts){ const d=Math.hypot(mx-p.x,my-p.y); if(d<best){best=d;hit=p;} }
    if(hit){ canvas.style.cursor='pointer'; if(!highlight||highlight.cw!==hit.cw) startPulse({cw:hit.cw}); showTip(hit); }
    else { canvas.style.cursor='crosshair'; dotTip.style.display='none'; if(highlight) stopPulse(); else draw(); } });
  canvas.addEventListener('mouseleave',()=>{ dotTip.style.display='none'; canvas.style.cursor='default'; cursor=null; if(highlight) stopPulse(); else draw(); });
  canvas.addEventListener('dblclick',resetView);
  canvas.addEventListener('wheel',e=>{ if(!GEO) return; e.preventDefault(); const r=canvas.getBoundingClientRect(); const mx=e.clientX-r.left;
    if(e.shiftKey){ const f=e.deltaY<0?1.12:1/1.12; yScale=Math.max(0.5,Math.min(10,yScale*f)); }
    else { const cw=GEO.invX(mx); const cur=viewHi-viewLo; let w=cur*(e.deltaY<0?0.85:1/0.85); w=Math.max(0.04,Math.min(2,w));
      let lo=cw-(cw-viewLo)*(w/cur), hi=lo+w; if(w>=2-1e-9){lo=-1;hi=1;} if(lo<-1){lo=-1;hi=lo+w;} if(hi>1){hi=1;lo=hi-w;} viewLo=lo; viewHi=hi; }
    draw(); }, {passive:false});
  if(window.__wireZoomPan) window.__wireZoomPan(canvas,{
    getViewLo:()=>viewLo, setViewLo:v=>viewLo=v, getViewHi:()=>viewHi, setViewHi:v=>viewHi=v,
    invX:px=>GEO?GEO.invX(px):0, panY:(dy,ph)=>yPan-=dy/ph
  }, draw, {wireWheel:false, wireReset:false});   // wheel-zoom + dblclick-reset already wired above; this only adds drag-to-pan
  $('resetView').addEventListener('click',resetView);

  let drawing=false, lastPt=null;
  const chartwrap=canvas.parentElement; let tbN=0;
  function clearDraw(){ octx.save(); octx.setTransform(1,0,0,1,0,0); octx.clearRect(0,0,overlay.width,overlay.height); octx.restore();
    chartwrap.querySelectorAll('.textbox').forEach(b=>b.remove()); }
  function addTextBox(){ const b=document.createElement('div'); b.className='textbox';
    const off=20+(tbN++%6)*22; b.style.left=off+'px'; b.style.top=off+'px';
    const head=document.createElement('div'); head.className='tb-head';
    const x=document.createElement('span'); x.className='tb-x'; x.innerHTML='&#10006;'; x.title='Delete note'; x.addEventListener('click',()=>b.remove());
    head.appendChild(x);
    const ta=document.createElement('textarea'); ta.placeholder='note\u2026';
    b.appendChild(head); b.appendChild(ta); chartwrap.appendChild(b);
    head.addEventListener('pointerdown',e=>{ if(e.target===x) return; e.preventDefault();
      const wr=chartwrap.getBoundingClientRect(), bx=b.getBoundingClientRect(); const ox=e.clientX-bx.left, oy=e.clientY-bx.top;
      try{head.setPointerCapture(e.pointerId);}catch(_){}
      const mv=ev=>{ let nx=ev.clientX-wr.left-ox, ny=ev.clientY-wr.top-oy;
        nx=Math.max(0,Math.min(wr.width-b.offsetWidth,nx)); ny=Math.max(0,Math.min(wr.height-b.offsetHeight,ny));
        b.style.left=nx+'px'; b.style.top=ny+'px'; };
      const up=()=>{ head.removeEventListener('pointermove',mv); head.removeEventListener('pointerup',up); };
      head.addEventListener('pointermove',mv); head.addEventListener('pointerup',up); });
    setTimeout(()=>ta.focus(),0); }
  $('textBox').addEventListener('click',addTextBox);
  let tool=null, snap=null, startPt=null;
  function setTool(t){ tool=(tool===t)?null:t;
    $('drawToggle').classList.toggle('on',tool==='free');
    $('lineTool').classList.toggle('on',tool==='line');
    $('arrowTool').classList.toggle('on',tool==='arrow');
    overlay.classList.toggle('drawmode',tool!=null); drawing=false;
    if(tool){ cursor=null; dotTip.style.display='none'; if(highlight) stopPulse(); else draw(); } }
  $('drawToggle').addEventListener('click',()=>setTool('free'));
  $('lineTool').addEventListener('click',()=>setTool('line'));
  $('arrowTool').addEventListener('click',()=>setTool('arrow'));
  $('clearDraw').addEventListener('click',clearDraw);
  function pen(){ octx.strokeStyle='#ffe14d'; octx.lineWidth=2.4; octx.lineCap='round'; octx.lineJoin='round'; }
  function arrowHead(x1,y1,x2,y2){ const a=Math.atan2(y2-y1,x2-x1), len=12, sp=Math.PI/7;
    octx.beginPath(); octx.moveTo(x2,y2); octx.lineTo(x2-len*Math.cos(a-sp),y2-len*Math.sin(a-sp));
    octx.moveTo(x2,y2); octx.lineTo(x2-len*Math.cos(a+sp),y2-len*Math.sin(a+sp)); octx.stroke(); }
  overlay.addEventListener('pointerdown',e=>{ if(!tool) return; drawing=true; const r=overlay.getBoundingClientRect(); const p={x:e.clientX-r.left,y:e.clientY-r.top};
    lastPt=p; startPt=p; if(tool!=='free'){ try{ snap=octx.getImageData(0,0,overlay.width,overlay.height); }catch(_){ snap=null; } }
    try{overlay.setPointerCapture(e.pointerId);}catch(_){} });
  overlay.addEventListener('pointermove',e=>{ if(!tool||!drawing) return; const r=overlay.getBoundingClientRect(); const p={x:e.clientX-r.left,y:e.clientY-r.top}; pen();
    if(tool==='free'){ octx.beginPath(); octx.moveTo(lastPt.x,lastPt.y); octx.lineTo(p.x,p.y); octx.stroke(); lastPt=p; }
    else { if(snap){ octx.save(); octx.setTransform(1,0,0,1,0,0); octx.putImageData(snap,0,0); octx.restore(); }
      octx.beginPath(); octx.moveTo(startPt.x,startPt.y); octx.lineTo(p.x,p.y); octx.stroke();
      if(tool==='arrow') arrowHead(startPt.x,startPt.y,p.x,p.y); } });
  overlay.addEventListener('pointerup',()=>{ drawing=false; snap=null; });
  overlay.addEventListener('pointerleave',()=>{ drawing=false; snap=null; });
  overlay.addEventListener('wheel',e=>{ e.preventDefault(); },{passive:false});

  function updateList(){ alignCount.textContent=A.rows.length?A.breaches.length:'\u2014';
    if(!A.rows.length){ alignList.innerHTML='<span class="empty">&mdash; load a chain to find breach crossings</span>'; return; }
    if(!A.breaches.length){ alignList.innerHTML='<span class="empty">no breach crossings found</span>'; return; }
    alignList.innerHTML=A.breaches.map(bp=>'<span class="chip">'+cwClock(bp.cw)+' ET &middot; '+aInst+' '+bp.val.toFixed(3)+'</span>').join(''); }

  // central store (__qStore[inst].det) is the persisted source of truth; warehouse is a derived in-memory cache
  function rebuildWarehouse(){ warehouse={};
    const S=window.__qStore||{};
    for(const inst in S){ const det=S[inst]&&S[inst].det; if(!det) continue;
      for(const d in det){ (warehouse[d]||(warehouse[d]={}))[inst]={rows:(det[d]&&det[d].rows)||[],price:[]}; } }
    for(const d in BAKED_PRICE){ const wd=warehouse[d]||(warehouse[d]={});
      if(!wd.NQ) wd.NQ={rows:[],price:BAKED_PRICE[d]}; else if(!wd.NQ.price||!wd.NQ.price.length) wd.NQ.price=BAKED_PRICE[d]; } }
  window.__detLegacy=()=>KV.get(WH_KEY);          // read-only: migration source for the hub (no longer written)
  window.__detHydrate=function(){ rebuildWarehouse(); show(); };

  (async function init(){
    fillInst(instA,'NQ');
    rebuildWarehouse();
    const sel=await KV.get(SEL_KEY)||{};
    date=sel.date||todayISO();
    aInst=(sel.aInst&&INSTRUMENTS.some(p=>p[0]===sel.aInst))?sel.aInst:'NQ';
    instA.value=aInst; dayDate.value=date;
    buildLegend(); tickT(); setInterval(tickT,250); show(); sizeCanvas();
    window.dispatchEvent(new CustomEvent('quan:instr',{detail:aInst}));   // sync hub to restored instrument
    window.dispatchEvent(new CustomEvent('quan:date',{detail:date}));     // sync hub to restored date
  })();
})();