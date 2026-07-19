(function(){
  var instEl=document.getElementById('instA'), dateEl=document.getElementById('dayDate');
  var rInst=document.getElementById('rptInst'), rDate=document.getElementById('rptDate'),
      rClass=document.getElementById('rptClass'), rSub=document.getElementById('rptSub'), rBody=document.getElementById('rptBody');
  // golden-ref SNAPSHOT SUMMARY field set, grouped for the brief
  var GROUPS=[
   ['Structural Field Read (live)', [['ATM (\u0394\u22480.50)','atm'],['Net GEX (\u03b3\u00d7OI)','netgexraw'],['Gamma-Wall Cluster','gwall'],['Put Shelf','putshelf'],['Deep OI Shelf','oishelf'],['CL lobe (PC/PG)','clstate'],['CM lobe (PG/PC)','cmstate'],['Breach-C watch (CT)','breachc']]],
   ['Field Classification', [['Field Type','fieldType'],['Surface Intensity','intensity'],['Cascade Grade','cascadeGrade'],['Skew Convergence','skewConv'],['Trigger Pull TP','tp'],['CDS (Composite)','cds'],['CDS Interpretation','cdsi']]],
   ['Session Breach Clock \u2014 points of interest', [['Coherence-break ZC','zc'],['9th-order intersections','poly9'],['Tension intersections (CL\u00d7CM)','tensx'],['CL coherence-break (CT)','breachc'],['ZC count','zcn']]],
   ['Three-Phase Skewness Cascade', [['Intent DIDS','dids'],['Transaction DITS','dits'],['Realization DR3S','dr3s']]],
   ['Three-Phase Kurtosis', [['Intent DIDK','didk'],['Transaction DITK','ditk'],['Realization DR3K','dr3k']]],
   ['Jarque-Bera', [['Intent','jbI'],['Transaction','jbT'],['Realization','jbR']]],
   ['Chronometric Speeds', [['Speed of Intent SoI','soi'],['Chronometric Speed Cs','cs'],['Speed of Transaction SoT','sot'],['Speed of Realization SoR','sor'],['Lorentz \u03b3_T','lorentz'],['Tachyonic Flag TII','tii']]],
   ['Greeks Exposure', [['Net DDE','netdde'],['Dollar DDE ($)','dollardde'],['Net GEX ($)','netgex'],['Net Vega ($)','netvega'],['Net Theta ($)','nettheta'],['Net Vanna','netvanna']]],
   ['IV Surface', [['ATM IV (\u0394\u22480.5)','atmiv'],['25\u0394 Risk Reversal','rr25'],['25\u0394 Butterfly','bf25'],['Smile Slope d\u03c3/dK','smile'],['Vol-of-vol','volvol'],['Weighted Avg IV','wavgiv']]],
   ['Risk Engine', [['VaR 95% \u0394','var95'],['VaR 99% \u0394','var99'],['CF VaR 99% \u0394','cfvar99'],['CF vs Normal 99%','cfspread'],['Stress F+5% P&L','stresup'],['Stress F-5% P&L','stresdn']]],
   ['Risq \u2014 Structural Risk (top PDSL/DSC)', [['Field Risk \u211b_F','risqF'],['Temporal Risk \u211b_T','risqT'],['Information Risk \u211b_I','risqI'],['Coherence Risk \u211b_C','risqC'],['Inertia Risk \u211b_\u03a9','risqW'],['Risq Ratio \u211b\u2093','risqRatio'],['Risq Tier','risqTier']]],
   ['Information Field', [['Shannon Entropy H','shannon'],['Max Entropy','hmax'],['Normalized H','hnorm'],['Corr(DID,DIT)','corrIT'],['Corr(DID,DR3)','corrIR'],['Dominant Coupling','domcoup']]],
   ['Context', [['Forward Price F','fwd'],['Days to Expiry T','dte'],['Risk-Free r','rfr'],['Active Strikes (IV)','activestk'],['Parity Quality','parity'],['Half-Kelly f*/2','halfkelly']]]
  ];
  function curInst(){ return (instEl&&instEl.value)||''; }
  function curDate(){ return (dateEl&&dateEl.value)||''; }
  var briefCache={}, _engHooked=false;
  var liveOn=false, liveTimer=null;
  var EARLY_CLOSE_FRAC=19/23; // CME early closes land ~13:00 ET vs. the normal 17:00 ET close (19h into the 23h session), see __sessionKind
  function sessFrac(){
    try{
      var d=window.__sessionDateNow?window.__sessionDateNow():null;
      var kind=(d&&window.__effectiveSessionKind)?window.__effectiveSessionKind(d):'full';
      if(kind==='closed') return 0; // no session is running today (weekend/holiday) -> no intraday decay to apply
      var raw=(window.__sessionT?Number(window.__sessionT()):0)||0;
      if(kind==='early') raw=Math.min(1,raw/EARLY_CLOSE_FRAC); // today's session fully elapses at the early-close hour, not 17:00
      return raw;
    }catch(_){ return 0; }
  }
  function curT(cell,date,ddays){ var base=(ddays!=null&&ddays>0)?ddays:1.0; if(!liveOn) return base; return Math.max(base-(sessFrac()*0.958),0.02); }
  function chainFor(inst,d){ try{ var r=window.__qStore&&window.__qStore[inst]; if(!r) return null;
    if(r.det&&r.det[d]&&r.det[d].chain) return r.det[d].chain;
    if(!r.sess) return null; var cell=r.sess[d]; if(!cell) return null; var ex=cell.exp||{};
    var bk=(cell.active&&ex[cell.active]&&ex[cell.active].chain)?cell.active:null;
    if(!bk){ for(var k in ex){ if(ex[k]&&ex[k].chain){ bk=k; break; } } }
    var e=bk&&ex[bk]; return (e&&e.chain)||null; }catch(_){ return null; } }
  function _cellExp(inst,d){ try{ var r=window.__qStore&&window.__qStore[inst]; if(!r) return null;
    if(r.det&&r.det[d]&&r.det[d].chain) return {chain:r.det[d].chain,greeks:r.det[d].greeks||null,fn:r.det[d].fn||r.det[d].gfn||null};
    if(!r.sess) return null; var cell=r.sess[d]; if(!cell) return null; var ex=cell.exp||{};
    var bk=(cell.active&&ex[cell.active]&&ex[cell.active].chain)?cell.active:null;
    if(!bk){ for(var k in ex){ if(ex[k]&&ex[k].chain){ bk=k; break; } } }
    var e=bk&&ex[bk]; if(!e) return null; return {chain:e.chain||null,greeks:e.greeks||null,fn:e.fn||e.gfn||bk||null}; }catch(_){ return null; } }
  function parseExpDays(fn,sessDate){ try{ if(!fn) return null;
    var m=String(fn).match(/exp[-_]?(\d{2})[-_](\d{2})[-_](\d{2,4})/i); if(!m) return null;
    var mo=+m[1],da=+m[2],yr=+m[3]; if(yr<100) yr+=2000;
    var exp=new Date(yr,mo-1,da); var sd=sessDate?new Date(sessDate):new Date();
    return Math.round((exp-sd)/86400000); }catch(_){ return null; } }
  function _m(v){ if(v==null||v===''||isNaN(v)) return null; var a=Math.abs(v),s=v<0?'\u2212':'';
    if(a>=1e9)return s+'$'+(a/1e9).toFixed(2)+'B'; if(a>=1e6)return s+'$'+(a/1e6).toFixed(1)+'M';
    if(a>=1e3)return s+'$'+(a/1e3).toFixed(0)+'k'; return s+'$'+a.toFixed(0); }
  function _n(v,d){ if(v==null||v===''||isNaN(v)) return null; return Number(v).toFixed(d==null?2:d).replace('-','\u2212'); }
  function _i(v){ if(v==null||v===''||isNaN(v)) return null; return Math.round(Number(v)).toLocaleString('en-US').replace('-','\u2212'); }
  function _px(v){ if(v==null||v===''||isNaN(v)) return null; var n=Number(v); var t=n.toFixed(6).replace(/\.?0+$/,''); var neg=t.charAt(0)==='-'; if(neg)t=t.slice(1); var p=t.split('.'); p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,','); return (neg?'\u2212':'')+p.join('.'); }
  function _esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function mapBrief(b,inst,date,anchor){
    var d={};
    // ---- producer projection (ownership-clean): methodology + semantics live in producer operators ----
    var _P=(window.__projection?window.__projection(b):null)||{};
    var _PT={}; (_P.taxonomy||[]).forEach(function(f){ if(f&&f.dimension)_PT[f.dimension]=f; });
    var _PK=_P.kelly||null;
    d.fieldType=b.fieldType||'\u2014';
    d.bias=[b.bias&&String(b.bias).replace(/_/g,' '),b.tier,b.regime&&String(b.regime).replace(/_/g,' ')].filter(Boolean).join(' \u00b7 ');
    d.cds=_n(b.cds,3); d.tp=_n(b.tp,3);
    d.cdsi=[b.bias&&String(b.bias).replace(/_/g,' '),b.direction&&('dir '+b.direction)].filter(Boolean).join(' \u00b7 ')||'\u2014';
    d.dids=_n(b.dids,3); d.dits=_n(b.dits,3); d.dr3s=_n(b.dr3s,3);
    d.didk=_n(b.didk,2); d.ditk=_n(b.ditk,2); d.dr3k=_n(b.dr3k,2);
    d.jbI=_i(b.jbI); d.jbT=_i(b.jbT); d.jbR=_i(b.jbR);
    d.soi=_n(b.soi,2); d.sot=_n(b.sot,2); d.sor=_n(b.sor,4); d.cs=_n(b.cs,2);
    d.lorentz=_n(b.lorentz,4); d.tii=b.tii?(b.tii==='TIMELIKE'?'TIMELIKE (sub-luminal)':String(b.tii)):'\u2014';
    d.netdde=_i(b.netdde); d.dollardde=_m(b.dollardde); d.netgex=_m(b.netgex); d.netgexraw=_m(b.signedgex);
    var an=(anchor!=null&&anchor!=='')?Number(anchor):null;
    d.atm=an!=null?_px(an):null;
    d.gwall=(b.gwalls&&b.gwalls.length)?b.gwalls.slice(0,5).map(_px).join(' / '):null;
    d.putshelf=b.sfloor!=null?_px(b.sfloor):null;
    d.shannon=_n(b.shannon,3); d.hmax=_n(b.hmax,3); d.hnorm=_n(b.hnorm,3);
    d.corrIT=_n(b.corrIT,3); d.corrIR=_n(b.corrIR,3); d.domcoup=b.domcoup||null;
    d.netvega=_m(b.netvega); d.nettheta=_m(b.nettheta); d.netvanna=(b.netvanna==null?'\u2014 n/a':_m(b.netvanna));
    d.atmiv=(b.atmiv==null?null:_n(b.atmiv,2)+'%'); d.wavgiv=(b.wavgiv==null?null:_n(b.wavgiv,2)+'%');
    d.rr25=(b.rr25==null?null:_n(b.rr25,2)+'%'); d.bf25=(b.bf25==null?null:_n(b.bf25,2)+'%');
    d.smile=(b.smile==null?null:_n(b.smile,4)+' /K'); d.volvol=(b.volvol==null?null:_n(b.volvol,2)+'%');
    d.activestk=b.activestk!=null?_i(b.activestk):null;
    d.var95=_m(b.var95); d.var99=_m(b.var99);
    d.cfvar99=_m(b.cfvar99); d.cfspread=_m(b.cfspread);
    d.stresup=_m(b.stresup); d.stresdn=_m(b.stresdn);
    d.fwd=(b.fwd==null?null:_px(b.fwd)); d.dte=liveOn?(_n(b.tUsed,2)+' d \u00b7 live'):(b.dteDays==null?(b.dte==null?null:_n(b.dte,1)+' d'):(b.dteDays+' d')); d.rfr=(b.rfr==null?null:_n(b.rfr,2)+'%');
    d.halfkelly=(_PK&&_PK.description)?_PK.description:(b.halfkelly||null);
    d.parity=(b.parity==null?null:b.parity+(b.paritypct==null?'':' ('+_n(b.paritypct*100,1)+'% within $0.01)')); d.oishelf=b.oishelf||null;
    d.clstate=b.clstate||null; d.cmstate=b.cmstate||null; d.breachc=b.breachc||null;
    // ---- Risq (five-dimension structural risk, computed for the top-scored PDSL/DSC) ----
    var _rq=b.risq||null;
    if(_rq&&_rq.ok){
      var _rd=_rq.dims||{};
      d.risqF=_n(_rd.R_F,3); d.risqT=_n(_rd.R_T,3); d.risqI=_n(_rd.R_I,3); d.risqC=_n(_rd.R_C,3); d.risqW=_n(_rd.R_W,3);
      d.risqRatio=_n(_rq.ratio,2);
      d.risqTier=(_rq.risq_tier||'—')+((_rq.flags&&_rq.flags.length)?(' — '+_rq.flags.join('; ')):'')+' · @ '+_px(_rq.strike)+' ('+_esc(_rq.kind)+')';
    } else { d.risqF=d.risqT=d.risqI=d.risqC=d.risqW=d.risqRatio=null; d.risqTier=(_rq&&_rq.note)||null; }
    // ---- Deep Strike Scorecard (PDSL/DSC candidates, ranked) ----
    var _pdsl=b.pdsl||[];
    if(_pdsl.length){
      var _pt='<table class="rpt-mini"><tr><th>Strike</th><th>Kind</th><th>Score</th><th>Tier</th><th>Gradient</th><th>Mass</th><th>DR3</th></tr>';
      _pdsl.forEach(function(p){ _pt+='<tr><td>'+_px(p.strike)+'</td><td>'+_esc(p.kind)+'</td><td>'+(p.score!=null?p.score:'—')+'/10</td><td>T'+(p.tier!=null?p.tier:'—')+'</td><td>'+_esc(p.gradient||'')+'</td><td>'+(p.mass!=null?_n(p.mass,2):'—')+'</td><td>'+(p.dr3!=null?_n(p.dr3,3):'—')+'</td></tr>'; });
      d.pdslHtml=_pt+'</table>';
    } else { d.pdslHtml=null; }
    // ---- Fibonacci Strike Architecture (PDSL-to-PDSL, not swing-high-to-low) ----
    var _fb=b.fib||null;
    if(_fb&&_fb.ok){
      var _ft='<div class="rk" style="margin-bottom:4px">AL '+_px(_fb.AL.strike)+' (mass '+_n(_fb.AL.mass,2)+') ↔ AH '+_px(_fb.AH.strike)+' (mass '+_n(_fb.AH.mass,2)+') · range '+_n(_fb.f_range,0)+' · price frac '+_n(_fb.price_frac,3)+'</div><table class="rpt-mini"><tr><th>Ratio</th><th>Price</th><th>Role</th></tr>';
      (_fb.fib||[]).forEach(function(r){ _ft+='<tr><td>'+_n(r.ratio,3)+'</td><td>'+_px(r.price)+'</td><td>'+_esc(r.role)+'</td></tr>'; });
      d.fibHtml=_ft+'</table>';
    } else { d.fibHtml=(_fb&&_fb.note)?('<div class="rk">'+_esc(_fb.note)+'</div>'):null; }
    // ---- breach-clock crossings (session points of interest, mapped to clock times) ----
    d.zc=b.zc_t||null; d.poly9=b.p9_t||null; d.tensx=b.tx_t||null; d.zcn=(b.zc_n!=null?_i(b.zc_n):null);
    // ---- taxonomy from producer projection (classification + semantics owned by producer operators) ----
    var _PTskew=_PT['skew_convergence']||{}, _PTint=_PT['kurtosis_intensity']||{}, _PTgr=_PT['cascade_grade']||{}, _PTwv=_PT['wave_type']||{};
    d.skewConv=_PTskew.label||null; d.intensity=_PTint.label||null; d.cascadeGrade=_PTgr.label||null;
    d.taxonomy=[b.fieldType||null, d.intensity?(d.intensity+' SURFACE'):null].filter(Boolean).join(' \u00b7 ');
    d.taxoGrade=[d.cascadeGrade?(d.cascadeGrade+' CASCADE'):null, d.skewConv].filter(Boolean).join(' \u00b7 ');
    var _fw3=isFinite(Number(b.dr3s))?Number(b.dr3s):null;
    d.taxoInterp=[
      _PTint.description&&('<b>Surface intensity '+_PTint.label+'.</b> '+_PTint.description+'.'),
      _PTgr.description&&('<b>Cascade grade '+_PTgr.label+'.</b> '+_PTgr.description+'.'),
      _PTskew.description&&('<b>Skewness '+_PTskew.label+'.</b> '+_PTskew.description+'. Realization DR3S '+(_fw3==null?'?':_n(_fw3,2))+' is the flip-watch \u2014 the conflict resolves when it converges toward the intent/transaction sign.'),
      _PTwv.description&&('<b>Wave-type '+_esc(b.wave||'?')+'.</b> '+_PTwv.description+'.')
    ].filter(Boolean).join(' ');
    var bk='';
    bk+='<b>Field read.</b> '+_esc(d.taxonomy||b.fieldType||'')+' \u2014 CDS '+(d.cds||'?')+', '+_esc((b.bias||'').replace(/_/g,' '))+(b.tier?(' (tier '+_esc(b.tier)+')'):'')+(d.taxoGrade?(' \u00b7 '+_esc(d.taxoGrade)):'')+'.';
    if(d.taxoInterp) bk+='<br><br><b>Cascade taxonomy.</b> '+d.taxoInterp;
    var _bc=[]; if(d.zc)_bc.push('coherence-break ZC at '+d.zc); if(d.poly9)_bc.push('9th-order intersections at '+d.poly9); if(d.tensx)_bc.push('CL\u00d7CM tension intersections at '+d.tensx);
    if(_bc.length) bk+='<br><br><b>Session breach clock (points of interest).</b> '+_bc.join('; ')+'. These are the session times where the realization field changes coherence \u2014 watch-times for structural inflection, not directional signals.';
    if(b.action) bk+='<br><br><b>Framework action.</b> '+_esc(b.action);
    if(b.flipimm&&b.flipdir) bk+='<br><br><b>Flip-watch.</b> '+_esc(b.flipdir);
    bk+='<br><br><b>Execution (structural \u2014 direction paper-only).</b><ul>';
    if(d.gwall) bk+='<li><b>Gamma-wall reaction band:</b> '+d.gwall+' \u2014 highest-confidence magnitude nodes.</li>';
    var lv=[]; if(b.sfloor!=null)lv.push('floor '+_px(b.sfloor)); if(b.sceil!=null)lv.push('ceiling '+_px(b.sceil)); if(b.target!=null)lv.push('target '+_px(b.target)); if(b.dceil!=null)lv.push('dyn-ceiling '+_px(b.dceil));
    if(lv.length) bk+='<li><b>Levels:</b> '+lv.join(' \u00b7 ')+'.</li>';
    bk+='<li>Field-type and magnitude carry; any directional lean stays <b>paper-only</b> until 50+ logged trades.</li></ul>';
    d.__proj=_P;
    d.breakdown=bk;
    return d;
  }
  function eomExpiryDays(date){
    // EOM contracts expire on the real last TRADING day of the month, not whatever date happens to be in the active file's name
    try{
      if(!date || !window.__lastTradingDayOfMonth) return null;
      var dp=date.split('-'); var y=+dp[0], mo=+dp[1]-1;
      var lastTD=window.__lastTradingDayOfMonth(y,mo);
      if(lastTD<=date){ var nm=mo+1,ny=y; if(nm>11){ nm=0; ny++; } lastTD=window.__lastTradingDayOfMonth(ny,nm); }
      var exp=new Date(lastTD+'T00:00:00Z'), sd=new Date(date+'T00:00:00Z');
      return Math.round((exp-sd)/86400000);
    }catch(_){ return null; }
  }
  function pullBrief(inst,date){
    var cell=_cellExp(inst,date); if(!cell||!cell.chain||!window.__engBrief) return null;
    var anchor=(document.getElementById('gAnchor')||{}).value||null;
    var isEOM=false; try{ var _r=window.__qStore&&window.__qStore[inst]; var _sc=_r&&_r.sess&&_r.sess[date]; isEOM=!!(_sc&&_sc.active==='EOM'); }catch(_e){}
    var ddays=isEOM?(eomExpiryDays(date)!=null?eomExpiryDays(date):parseExpDays(cell.fn,date)):parseExpDays(cell.fn,date);
    var T=curT(cell,date,ddays);
    var key=inst+'|'+date+'|'+anchor+'|'+T;
    if(briefCache[key]!==undefined) return briefCache[key];
    // ---- pipeline observability: this cache-miss path is where a valid dataset
    // either produces a brief or silently fails; report the outcome explicitly ----
    var pipe=window.__qPipe?window.__qPipe.run('brief',{instrument:inst,session:date,exp:cell.fn||null}):null;
    var raw=null, engErr=null; try{ raw=window.__engBrief(cell.chain, cell.greeks||'', anchor, T); }catch(e){ raw=null; engErr=e; }
    if(pipe){
      if(engErr) pipe.stage('Brief Report').fail('engine threw: '+String(engErr&&engErr.message||engErr), {stack:engErr&&engErr.stack});
      else if(!raw) pipe.stage('Brief Report').fail('engine returned no brief object (null) for a loaded chain');
      else pipe.stage('Brief Report').ok({anchor:anchor,T:T});
    }
    if(raw){ if(ddays!=null) raw.dteDays=ddays; raw.tUsed=T; }
    var _d=raw?mapBrief(raw,inst,date,anchor):null; if(_d) _d.__raw=raw;
    briefCache[key]=_d;
    return briefCache[key];
  }
  function card(label,val){ var v=(val==null||val==='')?'<span class="rdash">\u2014</span>':String(val);
    return '<div class="rcard"><div class="rk">'+label+'</div><div class="rv">'+v+'</div></div>'; }
  function render(){
    var inst=curInst(), date=curDate();
    if(rInst)rInst.textContent=inst||'\u2014';
    if(rDate)rDate.textContent=date||'\u2014';
    if(!window.__engBrief){ try{ if(window.__qEnsureEngine) window.__qEnsureEngine(); }catch(_){} if(!_engHooked && window.__engReady){ _engHooked=true; window.__engReady.then(function(){ briefCache={}; try{render();}catch(_){} }); } }
    var data=null;
    try{ data=(window.__reportData?window.__reportData(inst,date):null); }catch(_){ data=null; }
    var live=!!data;
    var notReady=!window.__engBrief, noChain=!chainFor(inst,date);
    if(rClass){ rClass.textContent=live?(data.taxonomy||data.fieldType||'\u2014'):(notReady?'ENGINE BOOTING':'AWAITING BRIEF DATA'); rClass.classList.toggle('rwait',!live); }
    if(rSub) rSub.textContent=live?([data.taxoGrade,data.bias].filter(Boolean).join(' \u2014 ')||data.bias||''):(notReady?'Engine booting \u2014 brief metrics will populate once ready.':(noChain?('No chain loaded for '+(inst||'?')+' \u00b7 '+(date||'?')+'. Upload this instrument\u2019s chain.'):'No brief computed.'));
    var html='';
    for(var i=0;i<GROUPS.length;i++){ var g=GROUPS[i];
      html+='<div class="rgroup"><div class="rgt">'+g[0]+'</div><div class="rcards">';
      for(var j=0;j<g[1].length;j++){ var f=g[1][j]; html+=card(f[0], live?data[f[1]]:null); }
      html+='</div></div>';
    }
    if(live&&data.pdslHtml){ html+='<div class="rptBreakdown"><div class="rgt">Deep Strike Scorecard — PDSL / DSC candidates</div>'+data.pdslHtml+'</div>'; }
    if(live&&data.fibHtml){ html+='<div class="rptBreakdown"><div class="rgt">Fibonacci Strike Architecture</div>'+data.fibHtml+'</div>'; }
    if(live&&data.breakdown){ html+='<div class="rptBreakdown"><div class="rgt">Analysis &amp; Execution Breakdown</div>'+data.breakdown+'</div>'; }
    if(rBody) rBody.innerHTML=html;
  }
  window.__reportData=function(inst,date){ return pullBrief(inst,date); };
  window.__reportRender=render;
  window.addEventListener('quan:instr',render);
  window.addEventListener('quan:date',render);
  window.addEventListener('quan:cell',function(){ briefCache={}; try{render();}catch(_){} });
  function _M(v){ if(v==null) return '\u2014'; var a=Math.abs(v), s=v<0?'\u2212':'';
    if(a>=1e9) return s+'$'+(a/1e9).toFixed(2)+'B';
    if(a>=1e6) return s+'$'+(a/1e6).toFixed(1)+'M';
    if(a>=1e3) return s+'$'+(a/1e3).toFixed(0)+'k';
    return s+'$'+a.toFixed(0); }
  function _grp(t){ var p=(''+t).split('.'); p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,','); return p.join('.'); }
  function _N(v,d){ if(v==null) return '\u2014'; d=(d==null?2:d); var t=Number(v).toFixed(d); var neg=t.charAt(0)==='-'; if(neg)t=t.slice(1); return (neg?'\u2212':'')+_grp(t); }
  function _I(v){ if(v==null) return '\u2014'; var t=Number(v).toFixed(0); var neg=t.charAt(0)==='-'; if(neg)t=t.slice(1); return (neg?'\u2212':'')+_grp(t); }
  function _P(v,d){ if(v==null) return '\u2014'; d=(d==null?2:d); return Number(v).toFixed(d).replace('-','\u2212')+'%'; }
  function _expOf(fn){ if(!fn) return ''; var m=(''+fn).match(/exp[-_]?(\d{2})[-_](\d{2})[-_]\d{2,4}/i); return m?(m[1]+'/'+m[2]):''; }
  function buildPrintBrief(){
    var doc=document.getElementById('rptPrintDoc'); if(!doc) return false;
    var inst=curInst(), date=curDate(), data=null;
    try{ data=window.__reportData?window.__reportData(inst,date):null; }catch(_){ data=null; }
    var b=data?data.__raw:null;
    var anchor=Number((document.getElementById('gAnchor')||{}).value||0)||null;
    var _mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], nd=new Date(), pz=function(n){return (n<10?'0':'')+n;};
    var gen=_mn[nd.getMonth()]+' '+pz(nd.getDate())+', '+nd.getFullYear()+' '+pz(nd.getHours())+':'+pz(nd.getMinutes());
    if(!b){ doc.innerHTML='<div class="pg"><div class="hd"><div><span class="inf">&#8734;</span> <span class="bname">THE QU\u2019AN</span><div class="bsub">Chronometric Field Brief \u2014 Full Engine Pull</div></div><div class="meta"><b>'+(inst||'\u2014')+' &middot; Session '+(date||'\u2014')+'</b><br>Generated '+gen+'</div></div><div class="bd">No brief data \u2014 load a chain for '+(inst||'?')+' \u00b7 '+(date||'?')+' first, then export.</div></div>'; return true; }
    var cell=null; try{ cell=_cellExp(inst,date); }catch(_){}
    var chExp=cell?_expOf(cell.fn):'', gkExp=cell?_expOf(cell.gfn||cell.gkt):'';
    var gw=(b.gwalls||[]).slice(0,5).map(function(x){return _px(x);}).join(' / ');
    var rep=function(s){ return (s==null?'':(''+s)).replace(/_/g,' '); };
    var hk=(data&&data.halfkelly!=null)?data.halfkelly:(b.halfkelly==null?'\u2014':b.halfkelly);
    var par=b.parity ? (b.parity+(b.paritypct!=null?(' ('+_N(b.paritypct*100,1)+'% within $0.01)'):'')) : '\u2014';
    var h=`<div class="pg">
<div class="hd"><div><span class="inf">&#8734;</span> <span class="bname">THE QU\u2019AN</span><div class="bsub">Chronometric Field Brief &mdash; Full Engine Pull</div></div>
<div class="meta"><b>${inst} &middot; Session ${date}</b><br>Generated ${gen}<br>Anchor ${_N(anchor,2)}${chExp?(' &middot; Chain exp '+chExp):''}${gkExp?(' &middot; Greeks exp '+gkExp):''}</div></div>
<div class="class">${data.taxonomy||b.fieldType} &middot; ${rep(b.bias)}</div>
<div class="classsub">${data.taxoGrade?(data.taxoGrade+' &middot; '):''}${rep(b.regime)} &middot; CDS ${_N(b.cds,3)} (tier ${b.tier}) &middot; TP ${_N(b.tp,3)} &middot; ${b.tii}. <b>Direction is the framework read and remains paper-only.</b></div>

<h2>I. Field Classification</h2>
<table><tr><td class="k">Field Type</td><td class="num">${b.fieldType}</td><td class="k">Regime</td><td class="num">${rep(b.regime)}</td><td class="k">Direction</td><td class="num">${b.direction}</td></tr>
<tr><td class="k">Surface Intensity</td><td class="num">${data.intensity||'\u2014'}</td><td class="k">Cascade Grade</td><td class="num">${data.cascadeGrade||'\u2014'}</td><td class="k">Skew Convergence</td><td class="num">${data.skewConv||'\u2014'}</td></tr>
<tr><td class="k">CDS</td><td class="num">${_N(b.cds,3)}</td><td class="k">BIAS / tier</td><td class="num">${rep(b.bias)} / ${b.tier}</td><td class="k">Trigger Pull TP</td><td class="num">${_N(b.tp,3)}</td></tr></table>

<h2>II. Three-Phase Cascade &amp; Jarque-Bera</h2>
<table><tr><th></th><th>Intent</th><th>Transaction</th><th>Realization</th></tr>
<tr><td class="k">Skewness</td><td class="num">${_N(b.dids,3)}</td><td class="num">${_N(b.dits,3)}</td><td class="num">${_N(b.dr3s,3)}</td></tr>
<tr><td class="k">Ex-Kurtosis</td><td class="num">${_N(b.didk,2)}</td><td class="num">${_N(b.ditk,2)}</td><td class="num">${_N(b.dr3k,2)}</td></tr>
<tr><td class="k">Jarque-Bera</td><td class="num">${_I(b.jbI)}</td><td class="num">${_I(b.jbT)}</td><td class="num">${_I(b.jbR)}</td></tr></table>
<div class="bd"><b>Breakdown.</b> ${data.taxoInterp||'All three phases reject normality (high JB) &mdash; the CDS signal is statistically real.'}</div>

<h2>III. Chronometric Speeds &amp; Relativistic</h2>
<table><tr><td class="k">Speed of Intent</td><td class="num">${_N(b.soi,2)}</td><td class="k">Speed of Transaction</td><td class="num">${_N(b.sot,2)}</td><td class="k">Speed of Realization</td><td class="num">${_N(b.sor,4)}</td></tr>
<tr><td class="k">Chronometric Cs</td><td class="num">${_N(b.cs,2)}</td><td class="k">Lorentz &gamma;_T</td><td class="num">${_N(b.lorentz,4)}</td><td class="k">Spacetime</td><td class="num">${b.tii}</td></tr>
<tr><td class="k">WSF I / T / R</td><td class="num" colspan="5">${_N(b.wsfI,3)} / ${_N(b.wsfT,3)} / ${_N(b.wsfR,3)}</td></tr></table>
<div class="bd"><b>Breakdown.</b> Intent leads (SoI ${_N(b.soi,1)}) while realization is near-static (SoR ${_N(b.sor,4)}). Lorentz &gamma;_T ${_N(b.lorentz,4)}&asymp;1 with a ${b.tii} separation &mdash; sub-luminal/causal, no tachyonic break.</div>

<h2>IV. Greeks Exposure</h2>
<table><tr><td class="k">Net Delta (ct)</td><td class="num">${_I(b.netdde)}</td><td class="k">Dollar DDE</td><td class="num">${_M(b.dollardde)}</td><td class="k">GEX (gross)</td><td class="num">${_M(b.netgex)}</td></tr>
<tr><td class="k">Signed GEX</td><td class="num">${_M(b.signedgex)}</td><td class="k">Net Vega</td><td class="num">${_M(b.netvega)}</td><td class="k">Net Theta</td><td class="num">${_M(b.nettheta)}</td></tr>
<tr><td class="k">Net Vanna</td><td class="num">${_M(b.netvanna)}</td><td class="k">Delta pressure</td><td class="num" colspan="3">${rep(b.gdir)}</td></tr></table>
<div class="bd"><b>Breakdown.</b> Net delta ${_I(b.netdde)} (${_M(b.dollardde)}) &mdash; ${rep(b.gdir).toLowerCase()}. Net Vega ${_M(b.netvega)} and Net Theta ${_M(b.nettheta)} are taken from the broker greeks; delta/GEX are the engine's Black-Scholes read from the chain.</div>

<h2>V. IV Surface <span style="font-size:7pt;color:#848484">(broker greeks)</span></h2>
<table><tr><td class="k">ATM IV (&Delta;&approx;0.5)</td><td class="num">${_P(b.atmiv)}</td><td class="k">Weighted-Avg IV</td><td class="num">${_P(b.wavgiv)}</td><td class="k">Active strikes</td><td class="num">${_I(b.activestk)}</td></tr>
<tr><td class="k">25&Delta; Risk Reversal</td><td class="num">${_P(b.rr25)}</td><td class="k">25&Delta; Butterfly</td><td class="num">${_P(b.bf25)}</td><td class="k">Vol-of-vol</td><td class="num">${_P(b.volvol)}</td></tr></table>
<div class="bd"><b>Breakdown.</b> ATM IV ${_P(b.atmiv,1)} (IV_Mid = (callIV+putIV)/2); 25&Delta; risk-reversal ${_P(b.rr25,1)} = IV_25C &minus; IV_75C (Book convention: &gt;0 = call-side richer). 25&Delta; butterfly ${_P(b.bf25,1)} convexity. Smile slope ${_N(b.smile,4)} d&sigma;/dK per strike-pt (OLS over IV_Mid).</div>

<h2>VI. Risk Engine <span style="font-size:7pt;color:#848484">(golden Book Risk Engine sheet &mdash; exact formulas)</span></h2>
<table><tr><td class="k">VaR 95% (&Delta;-normal)</td><td class="num">${_M(b.var95)}</td><td class="k">VaR 99%</td><td class="num">${_M(b.var99)}</td><td class="k">CF VaR 99%</td><td class="num">${_M(b.cfvar99)}</td></tr>
<tr><td class="k">Stress F+5% P&amp;L</td><td class="num">${_M(b.stresup)}</td><td class="k">Stress F&minus;5% P&amp;L</td><td class="num">${_M(b.stresdn)}</td><td class="k">CF vs Normal</td><td class="num">${_M(b.cfspread)}</td></tr></table>
<div class="flag"><b>Golden Book formulas.</b> Delta VaR = |DDE$|&middot;Z/100 (Z = 1.645 / 2.326). CF VaR applies the Cornish-Fisher z-adjustment using the Realization-cascade skew (DR3S) and <b>excess</b> kurtosis (DR3K, used directly &mdash; the engine's KURT already returns excess, so the Book's literal &minus;3 would double-subtract). Stress P&amp;L = DDE$&middot;&Delta;F + 0.5&middot;GEX&middot;&Delta;F&sup2;. Vega terms are zero (the Book's net-vega summary cell is unpopulated).</div>

<h2>VII. Information Field</h2>
<table><tr><td class="k">Shannon Entropy H</td><td class="num">${_N(b.shannon,3)}</td><td class="k">Max Entropy</td><td class="num">${_N(b.hmax,3)}</td><td class="k">Normalized H</td><td class="num">${_N(b.hnorm,3)}</td></tr>
<tr><td class="k">Corr(DID,DIT)</td><td class="num">${_N(b.corrIT,3)}</td><td class="k">Corr(DID,DR3)</td><td class="num">${_N(b.corrIR,3)}</td><td class="k">Dominant Coupling</td><td class="num">${b.domcoup||'&mdash;'}</td></tr></table>
<div class="bd"><b>Breakdown.</b> H ${_N(b.hnorm,3)} normalized &mdash; the premium field is highly dispersed (near-max entropy). Intent and transaction are strongly coupled (&rho; ${_N(b.corrIT,2)}); realization decouples (&rho; ${_N(b.corrIR,2)}).</div>

<h2>VIII. Spatial Levels &amp; Wave-Type</h2>
<table><tr><td class="k">Structural floor / ceiling</td><td class="num">${_px(b.sfloor)} / ${_px(b.sceil)}</td><td class="k">Dynamic floor / ceiling</td><td class="num">${_px(b.dfloor)} / ${_px(b.dceil)}</td></tr>
<tr><td class="k">Target</td><td class="num">${_N(b.target,2)}</td><td class="k">Gamma-wall cluster</td><td class="num">${gw}</td></tr></table>
<div class="bd"><b>Wave-type:</b> ${b.wave} &mdash; ${b.epath}.</div>
<div class="flag"><b>Flip-watch.</b> ${b.flipdir}</div>

<h2>IX. Session Breach Clock <span style="font-size:7pt;color:#848484">(points of interest &mdash; coherence-break times)</span></h2>
<table><tr><td class="k">Coherence-break ZC</td><td class="num">${data.zc||'\u2014'}</td><td class="k">ZC count (wave-type)</td><td class="num">${data.zcn||'\u2014'}</td></tr>
<tr><td class="k">9th-order intersections</td><td class="num">${data.poly9||'\u2014'}</td><td class="k">CL coherence-break (CT)</td><td class="num">${data.breachc||'\u2014'}</td></tr>
<tr><td class="k">Tension intersections (CL&times;CM)</td><td class="num" colspan="3">${data.tensx||'\u2014'}</td></tr></table>
<div class="bd">These are the session clock-times where the realization field changes coherence &mdash; <b>watch-times for structural inflection, not directional signals</b>. The ZC count sets the wave-type character (${rep(b.wave)}); a high count produces the DESTRUCTIVE / FRACTURED arc. Map each time to the session arc (18:00 ET open &rarr; 17:00 ET close) as a point to re-read the field.</div>

<h2>X. Execution Breakdown <span style="font-size:7pt;color:#848484">(structural &mdash; direction paper-only)</span></h2>
<div class="exec"><ul>
<li><b>Gamma-wall reaction band:</b> <span class="lvl">${gw}</span> &mdash; highest-confidence magnitude nodes.</li>
<li><b>Levels:</b> floor <span class="lvl">${_px(b.sfloor)}</span> &middot; ceiling <span class="lvl">${_px(b.sceil)}</span> &middot; target <span class="lvl">${_px(b.target)}</span> &middot; dynamic ceiling <span class="lvl">${_px(b.dceil)}</span>.</li>
<li><b>Framework action:</b> ${b.action}</li>
<li>Field-type and magnitude carry; the directional lean stays <b>paper-only</b> until 50+ logged trades.</li>
</ul><div class="disc">Magnitude is the edge. Levels are engine-computed reference structure, not trade signals.</div></div>

<h2>XI. Context &amp; Methodology</h2>
<table><tr><td class="k">Forward F</td><td class="num">${_px(b.fwd)}</td><td class="k">Risk-Free r</td><td class="num">${_P(b.rfr)}</td><td class="k">Active strikes (IV)</td><td class="num">${_I(b.activestk)}</td></tr>
<tr><td class="k">Parity quality</td><td class="num">${par}</td><td class="k">Deep-OI shelf</td><td class="num">${b.oishelf||'&mdash;'}</td><td class="k">Half-Kelly f*/2</td><td class="num">${hk}</td></tr></table>
<div class="bd">&bull; <b>Source:</b> a live pull of the embedded engine &mdash; <i>quan_analyze.analyze()</i> + <i>quan_information</i> on the chain, broker greeks for IV/vega/theta. Same computation the dashboard now displays.</div>
</div>`;
    doc.innerHTML=h; return true;
  }
  var _xb=document.getElementById('rptExport'); if(_xb) _xb.addEventListener('click',function(){ try{ buildPrintBrief(); setTimeout(function(){ try{window.print();}catch(_){} }, 40); }catch(_){ try{window.print();}catch(__){} } });
  function setLive(on){ liveOn=on; var _lb=document.getElementById('rptLive'); if(_lb){ _lb.classList.toggle('rptbtn-on',on); _lb.textContent=on?'\u27f3 Live \u00b7 on':'\u27f3 Live'; } if(liveTimer){ clearInterval(liveTimer); liveTimer=null; } if(on){ liveTimer=setInterval(function(){ briefCache={}; try{render();}catch(_){} }, 60000); } briefCache={}; try{render();}catch(_){} }
  var _lbtn=document.getElementById('rptLive'); if(_lbtn) _lbtn.addEventListener('click',function(){ setLive(!liveOn); });
  try{ render(); }catch(_){}
})();