(function(){
  const tab=document.getElementById('pdTab'), panel=document.getElementById('pdPanel'),
        x=document.getElementById('pdClose'), chev=document.getElementById('pdChev'),
        sync=document.getElementById('pdSync'), statusEl=document.getElementById('pdStatus'),
        errEl=document.getElementById('pdErr'), outEl=document.getElementById('pdOut'),
        copyB=document.getElementById('pdCopy'), dlB=document.getElementById('pdDl'),
        regenB=document.getElementById('pdRegen'), flagsEl=document.getElementById('pdFlags');
  const chainFileEl=document.getElementById('pdChainFile'), chainSrcEl=document.getElementById('pdChainSrc'), chainClearB=document.getElementById('pdChainClear');
  let pdUploadChain=null;
  function updChainSrc(){ if(!chainSrcEl) return; const a=(window.__qActiveChain&&window.__qActiveChain())||null;
    const gk=(a&&a.greeks)?('warehouse'+((a&&a.gfn)?(' '+a.gfn):'')):'solve';
    chainSrcEl.textContent=(pdUploadChain?('upload: '+pdUploadChain.name):'using active chain')+' \u00b7 greeks: '+gk; }
  if(!tab||!panel) return;
  let open=false, dt=0, booting=false, ready=false, drift=false, py=null, runner=null, D=null, lastDate='';
  function decB64(b){ return new TextDecoder().decode(Uint8Array.from(atob(b), c=>c.charCodeAt(0))); }
  function setSync(t){ if(sync) sync.textContent=t||''; }
  function setStatus(t){ if(statusEl) statusEl.textContent=t||''; }
  function setErr(t){ if(errEl) errEl.textContent=t||''; }
  function hashTag(){ return (drift?'\u26A0 DRIFT \u2014 ':'verified \u00b7 ')+'#'+(D?D.ENGINE_HASH:''); }
  function loadScript(src){ return new Promise(function(res,rej){ var s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=function(){ rej(new Error('could not load '+src+' (offline or blocked)')); }; document.head.appendChild(s); }); }
  async function ensureEngine(){
    if(ready) return true;
    if(booting) return false;
    booting=true; setErr('');
    try{
      setStatus('loading python\u2026 (first time, a few seconds)');
      if(typeof loadPyodide!=='function'){ await loadScript('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js'); }
      if(typeof loadPyodide!=='function') throw new Error('pyodide.js loaded but loadPyodide is undefined');
      py = await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'});
      setStatus('loading numpy + pandas\u2026');
      await py.loadPackage(['numpy','pandas']);
      setStatus('mounting engine\u2026');
      const manifest = await (await fetch('engine/report/manifest.json')).json();
      D = {ENGINE_HASH:manifest.ENGINE_HASH, REF_B64:manifest.REF_B64, REF_ANCHOR:manifest.REF_ANCHOR, REF_EXPECTED:manifest.REF_EXPECTED};
      try{ py.FS.mkdir('/eng'); }catch(_){}
      for(const name of manifest.MODULES){ const src = await (await fetch('engine/report/'+name+'.py')).text(); py.FS.writeFile('/eng/'+name+'.py', src); }
      py.runPython("import sys\nif '/eng' not in sys.path: sys.path.insert(0,'/eng')");
      runner = py.pyimport('quan_payload_runner');
      setStatus('self-test\u2026');
      const got = String(runner.run(decB64(D.REF_B64), D.REF_ANCHOR)).trim();
      drift = (got !== String(D.REF_EXPECTED).trim());
      ready=true; booting=false; setStatus(hashTag());
      try{ window.__engBrief=function(txt,gtxt,anchor,T){ try{ if(window.QuanInstrumentAdapter){try{var _sel=(typeof curInst==='function')?curInst():(window.curInst?window.curInst():null); txt=window.QuanInstrumentAdapter.bindParser(txt,{selected:_sel}).text; if(gtxt)gtxt=window.QuanInstrumentAdapter.bindParser(gtxt,{selected:_sel}).text;}catch(_na){}} py.globals.set('_brf_text',txt); py.globals.set('_brf_gtext',gtxt||''); py.globals.set('_brf_inst',(typeof curInst==='function'?curInst():'')||''); py.globals.set('_brf_anchor',(anchor==null||anchor==='')?null:Number(anchor)); py.globals.set('_brf_T',(T==null)?1.0:Number(T)); var js=py.runPython(`import json,tempfile,os,math
import numpy as np, quan_analyze as QA, quan_engine as E, quan_greeks as GK, quan_information as INFO, quan_blackscholes as BS, quan_realization as R, quan_relativistic as RV
_p=os.path.join(tempfile.gettempdir(),'_brf.csv'); open(_p,'w').write(_brf_text)
_F=float(_brf_anchor) if _brf_anchor not in (None,'') else None
_Td=float(_brf_T) if _brf_T not in (None,'') else 1.0
_A=QA.analyze(_p, anchor=_F, T_days=_Td, instrument=(_brf_inst if ('_brf_inst' in dir() and _brf_inst) else None))
_sig=_A.get('signal') or {}; _c=_sig.get('cascade') or {}; _fld=_A.get('field') or {}; _reg=_fld.get('regime') or {}
_gk=_A.get('greeks') or {}; _spc=_fld.get('spacetime') or {}; _spd=_fld.get('speeds') or {}; _wsf=_fld.get('WSF') or {}
_pc=(_sig.get('significance') or {}).get('per_component') or {}; _lv=(_A.get('spatial') or {}).get('levels') or {}
_wt=(_A.get('dynamic') or {}).get('wave_type') or {}; _fw=(_A.get('dynamic') or {}).get('flip_watch') or {}; _syn=_A.get('synthesis') or {}
_gw=[w[0] for w in (_gk.get('gamma_walls') or []) if isinstance(w,(list,tuple)) and len(w)]
_o={'fieldType':_reg.get('field_type'),'regime':_reg.get('regime'),'direction':_reg.get('direction'),'cds':_sig.get('CDS'),'bias':_sig.get('BIAS'),'tier':_sig.get('tier'),'tp':_c.get('TP'),'pp':_c.get('PP'),'dids':_c.get('DIDS'),'dits':_c.get('DITS'),'dr3s':_c.get('DR3S'),'didk':_c.get('DIDK'),'ditk':_c.get('DITK'),'dr3k':_c.get('DR3K'),'jbI':(_pc.get('intent') or {}).get('JB'),'jbT':(_pc.get('transaction') or {}).get('JB'),'jbR':(_pc.get('realization') or {}).get('JB'),'soi':_spd.get('I'),'sot':_spd.get('T'),'sor':_spd.get('R'),'cs':_fld.get('Cs'),'lorentz':_spc.get('gamma_T'),'tii':_spc.get('SC'),'netdde':_gk.get('netDelta'),'dollardde':_gk.get('dollarDelta'),'netgex':_gk.get('gex'),'signedgex':_gk.get('signed_gex_total'),'gdir':_gk.get('direction'),'wsfI':_wsf.get('I'),'wsfT':_wsf.get('T'),'wsfR':_wsf.get('R'),'sfloor':_lv.get('SFLOOR'),'sceil':_lv.get('SCEIL'),'dfloor':_lv.get('DFLOOR'),'dceil':_lv.get('DCEIL'),'target':_lv.get('TARGET'),'gwalls':_gw,'wave':_wt.get('wave'),'epath':_wt.get('expected_path'),'flipimm':_fw.get('flip_imminent'),'flipdir':_fw.get('directive'),'action':_reg.get('action'),'honest':_syn.get('honest_note'),'fwd':_F,'dte':_Td,'rfr':4.5,'halfkelly':'paper-only (edge unproven)'}
_fr=E.ingest_chain(_p)
try:
    # GOLDEN BOOK Half-Kelly (Relativistic Fields B57 = f*/2): b=|FE/ES|, p=(1+CDS)/2, f*=(b*p-q)/b
    _RV=RV.compute_relativistic(_fr, _o.get('cds') or 0.0)
    _hk=_RV.get('Kelly_half'); _kf=_RV.get('Kelly_f')
    if _hk is not None and _hk==_hk:
        _o['halfkelly']=float(_hk); _o['kellyf']=float(_kf) if _kf==_kf else None
except Exception as _ek: _o['_kellyerr']=str(_ek)
try:
    _inf=INFO.compute_information_field(_fr)
    _o['shannon']=_inf.get('H_shannon'); _o['hmax']=_inf.get('H_max'); _o['hnorm']=_inf.get('H_norm')
    _o['corrIT']=_inf.get('rho_IT'); _o['corrIR']=_inf.get('rho_IR')
    _rr={'DID-DIT':_inf.get('rho_IT'),'DID-DR3':_inf.get('rho_IR'),'DIT-DR3':_inf.get('rho_TR')}
    _dm=max(((k,abs(v)) for k,v in _rr.items() if v is not None), key=lambda x:x[1], default=(None,None))
    _o['domcoup']=(_dm[0]+' ('+format(_rr[_dm[0]],'.2f')+')') if _dm[0] else None
except Exception as _e: _o['_inferr']=str(_e)
# greeks-file IV/vega/theta/vanna (reliable broker greeks)
_mult=20.0; _r=0.045
if _brf_gtext not in (None,''):
    try:
        _gpp=os.path.join(tempfile.gettempdir(),'_brfg.csv'); open(_gpp,'w').write(_brf_gtext)
        _g=GK.load_greeks_csv(_gpp)
        _m=_fr[['strike','callOI','putOI']].merge(_g,on='strike',how='inner')
        _cOI=_m['callOI'].fillna(0).to_numpy(float); _pOI=_m['putOI'].fillna(0).to_numpy(float); _OI=_cOI+_pOI
        def _C(n): return _m[n].to_numpy(float) if n in _m else np.full(len(_m),np.nan)
        _sk=_m['strike'].to_numpy(float); _civ=_C('cIV'); _piv=_C('pIV'); _cD=_C('cDelta'); _pD=_C('pDelta')
        _o['netvega']=float(np.nansum(_C('cVega')*_cOI+_C('pVega')*_pOI))*_mult
        _o['nettheta']=float(np.nansum(_C('cTheta')*_cOI+_C('pTheta')*_pOI))*_mult
        # GOLDEN BOOK Greeks&IV: IV_Mid=(callIV+putIV)/2 drives all surface metrics (AF9-AF17)
        _ivm=np.nanmean(np.vstack([_civ,_piv]),axis=0); _vmask=_ivm>0
        def _seld(_d): _a=np.where(_vmask,np.abs(_cD-_d),np.inf); return int(np.argmin(_a))
        _i50=_seld(0.5); _i25=_seld(0.25); _i75=_seld(0.75)
        _atm=float(_ivm[_i50]); _iv25=float(_ivm[_i25]); _iv75=float(_ivm[_i75])
        _o['atmiv']=_atm                                              # AF12 ATM IV (Δ≈0.5)
        _o['rr25']=_iv25-_iv75                                        # AF15 25Δ RR = IV_25C-IV_75C
        _o['bf25']=(_iv25+_iv75)/2-_atm                              # AF16 25Δ Fly
        _o['wavgiv']=float(np.nansum((_ivm*_OI)[_vmask])/(np.nansum(_OI[_vmask]) or 1))  # AF10 OI-wgt IV_Mid
        _o['volvol']=float(np.nanstd(_ivm[_vmask],ddof=1))           # AF11 sample STDEV IV_Mid
        _o['activestk']=int(np.nansum(_vmask))                       # AF9 active strikes
        _o['smile']=float(np.polyfit(_sk[_vmask],_ivm[_vmask],1)[0]) if _vmask.sum()>3 else None  # AF17 OLS SLOPE dσ/dK
        # GOLDEN BOOK Net Vanna: Book per-strike S2 vanna = -φ(d1)(d1-σ√T)/σ, OI-weighted * mult
        # (Book's own S949 summary cell is #REF!-broken; this is the portfolio-consistent value)
        _ivd=_ivm/100.0; _tT=_Td/365.0
        with np.errstate(all='ignore'):
            _d1=(np.log(_F/_sk)+(_ivd**2/2.0)*_tT)/(_ivd*math.sqrt(_tT))
            _vanna=-(np.exp(-_d1*_d1/2.0)/math.sqrt(2*math.pi))*(_d1-_ivd*math.sqrt(_tT))/_ivd
        _o['netvanna']=float(np.nansum((_vanna*_OI)[_vmask]))*_mult*_F   # DOLLAR VANNA = ∂(DollarDelta)/∂σ = Σvanna·OI·Mult·F (engine dollarizes 1st-order-in-S greeks ×Mult×F, exactly like Dollar Delta)
        # parity quality
        _cl=_C('cLatest') if 'cLatest' in _m else None
    except Exception as _e2:
        import traceback; _o['_gkerr']=traceback.format_exc()[-200:]
# risk: GOLDEN BOOK Risk Engine sheet — B (Delta VaR), B_CF (Cornish-Fisher), C (Stress)
try:
    _dD=_gk.get('dollarDelta') or 0.0; _gex=_gk.get('gex') or 0.0
    _S=_o.get('dr3s'); _K=_o.get('dr3k')
    _S=float(_S) if _S is not None else 0.0; _K=float(_K) if _K is not None else 0.0
    _Kx=_K   # CORRECT: DR3K is already EXCESS kurtosis (engine excel_kurt returns excess); use directly. Book's literal -3 double-subtracts (DR3K is not raw kurtosis)
    # B — Delta VaR = |DDE_$|*Z/100  (Book C14/C15)
    _o['var95']=abs(_dD)*1.645/100.0; _o['var99']=abs(_dD)*2.326/100.0
    # B_CF — z_CF(99%) from Realization moments; CF Delta VaR (Book E35/F35)
    _z=2.326
    _zcf=_z+(_z*_z-1)/6.0*_S+(_z**3-3*_z)/24.0*_Kx-(2*_z**3-5*_z)/36.0*_S*_S
    _o['cfvar99']=abs(_dD)*_zcf/100.0; _o['cfz99']=_zcf
    _o['cfspread']=_o['cfvar99']-_o['var99']   # Book F37 = CF DeltaVaR99 - DeltaVaR99
    # parity quality + deep-OI shelf (from chain frame)
    try:
        _fsk=_fr['strike'].to_numpy(float); _toi=(_fr['callOI'].fillna(0)+_fr['putOI'].fillna(0)).to_numpy(float)
        # GOLDEN BOOK parity QC (AF41/AF42/AF43): W=call-put-(F-K)e^-rT; %within $0.01; quality flag
        if 'callLatest' in _fr and 'putLatest' in _fr:
            _cll=_fr['callLatest'].to_numpy(float); _pll=_fr['putLatest'].to_numpy(float)
            _disc=math.exp(-_r*(_Td/365.0)); _W=_cll-_pll-(_F-_fsk)*_disc; _vw=np.isfinite(_W)
            _nout=int(np.sum((np.abs(_W)>0.01)&_vw)); _act=_o.get('activestk') or int(_vw.sum())
            _pw=(1.0-_nout/_act) if _act else float('nan')
            _o['paritypct']=_pw
            _o['parity']=('HIGH' if _pw>0.95 else ('MODERATE' if _pw>0.8 else 'LOW'))
        _bl=_fsk<_F
        if _bl.any():
            _bi=int(np.nanargmax(np.where(_bl,_toi,np.nan))); _o['oishelf']=('%d (OI %d)'%(int(_fsk[_bi]),int(_toi[_bi])))
    except Exception as _ep: _o['_pqerr']=str(_ep)
    # C — Stress Total P&L = DDE_$*dF + 0.5*GEX*dF^2 (+Vega P&L=0; Book H22/H26)
    _o['stresup']=_dD*0.05+0.5*_gex*(0.05**2)
    _o['stresdn']=_dD*(-0.05)+0.5*_gex*(0.05**2)
except Exception as _e3: _o['_rkerr']=str(_e3)

# realization-wave tension lobes + coherence-break clock (engine: realization_waves)
try:
    _W=R.realization_waves(_fr, None)
    if _W:
        _cw=np.array(_W['cwAxis'],float); _cl=np.array(_W['tensionCL'],float); _cm=np.array(_W['tensionCM'],float)
        if len(_cl):
            _ci=int(np.nanargmax(np.abs(_cl))); _mi=int(np.nanargmax(np.abs(_cm)))
            _o['clstate']=('%+.1f (cw %.2f)'%(_cl[_ci],_cw[_ci]))
            _o['cmstate']=('%+.1f (cw %.2f)'%(_cm[_mi],_cw[_mi]))
            def _cwc(_c):
                _t=int(round(64800+abs(_c)*82800)); _t=((_t%86400)+86400)%86400; return '%02d:%02d'%(_t//3600,(_t%3600)//60)
            def _zc(_y):
                _x=[]
                for _j in range(1,len(_y)):
                    if np.isfinite(_y[_j-1]) and np.isfinite(_y[_j]) and _y[_j-1]!=0 and _y[_j]!=0 and (_y[_j-1]<0)!=(_y[_j]<0): _x.append((_cw[_j-1]+_cw[_j])/2)
                return _x
            def _times(_lst):
                _out=[]
                for _z in _lst:
                    _s=_cwc(_z)
                    if _s not in _out: _out.append(_s)
                return _out
            # Breach-C — CL tension zero-crossings (coherence breaks on the realization lobe)
            _brkc=_times(_zc(_cl)); _o['breachc']=(' \u00b7 '.join(_brkc[:4])) if _brkc else None
            # ZC — SOP-product zero-crossings (the wave-type coherence breaks)
            _zcf=[float(_z) for _z in (_W.get('crossings_cw') or [])]
            _zct=_times(_zcf); _o['zc_t']=(' \u00b7 '.join(_zct[:6])) if _zct else None
            _o['zc_n']=int(_W.get('totalZC') or len(_zcf))
            # 9th-order intersections — degree-9 fit of the CL tension, real roots inside the open window
            try:
                _msk=np.isfinite(_cl)
                if int(_msk.sum())>=11:
                    _co=np.polyfit(_cw[_msk],_cl[_msk],9); _rr=np.roots(_co)
                    _p9=sorted(set(round(float(_r.real),3) for _r in _rr if abs(_r.imag)<1e-6 and -0.999<=_r.real<=0.999))
                    _p9t=_times(_p9); _o['p9_t']=(' \u00b7 '.join(_p9t[:6])) if _p9t else None
                    # structured (cw, clock time, direction) per root, for chart-tab vertical markers: green=crossing up, red=crossing down
                    _dco=np.polyder(_co)
                    _o['p9']=[{'cw':_r,'time':_cwc(_r),'dir':('up' if np.polyval(_dco,_r)>0 else 'down')} for _r in _p9]
            except Exception: _o['p9_t']=None; _o['p9']=None
            # Tension intersections — where the CL and CM lobes cross
            _txt=_times(_zc(_cl-_cm)); _o['tx_t']=(' \u00b7 '.join(_txt[:6])) if _txt else None
except Exception as _ew: _o['_twerr']=str(_ew)

json.dumps(_o)`); return JSON.parse(js); }catch(e){ console.warn('engBrief',e); return null; } };
      window.__projection=function(payloadObj){ try{ py.globals.set('_proj_pl', JSON.stringify(payloadObj||{})); var _pj=py.runPython(`import json
import quan_taxonomy_store as _TS, quan_projection as _PJ
from quan_store_reader import StoreReader as _SR
_pl=json.loads(_proj_pl); _frag=_TS.build_fragment(_pl); _proj=_PJ.build_projection(_SR(_frag), _pl)
json.dumps(_proj)`); return JSON.parse(_pj); }catch(e){ console.warn('projection',e); return null; } };
      if(window.__engReadyResolve) window.__engReadyResolve(); }catch(_e){ console.warn('engBrief expose(main)',_e); }
      return true;
    }catch(e){ booting=false; setStatus('engine failed to start'); setErr(String(e&&e.message||e)); return false; }
  }
  try{ window.__qEnsureEngine=window.__qEnsureEngine||ensureEngine; }catch(_qee){}
  function flagsFrom(line){
    function g(k){ var m=line.match(new RegExp("[|^]"+k+"=([^|]*)")); return m?m[1]:""; }
    var items=[];
    var mrw=+g("MRW"); if(mrw && mrw<8000) items.push("MRW collapsed ("+mrw+") \u2014 corridor/ladders unreliable (thin-OI / short-DTE)");
    if(g("FLADDER")==="" || g("CLADDER")==="") items.push("empty ladder \u2014 price may be outside the wall stack, or gate too tight");
    if(g("EXEC").indexOf("GO")===0) items.push("EXEC "+g("EXEC")+" \u2014 directional layer is the unproven one (paper discipline)");
    return items.length ? ("\u26A0 "+items.join("<br>\u26A0 ")) : "";
  }
  async function compute(){
    if(window.__pgNativeMode) return;
    const a=(window.__qActiveChain && window.__qActiveChain())||null;
    const chain=(typeof __qnorm==='function'?__qnorm:(function(x){return x;}))((pdUploadChain&&pdUploadChain.text)?pdUploadChain.text:(a&&a.chain));
    const anchor=a&&a.anchor;
    const greeks=(a&&a.greeks)||null;   // warehouse greeks for the active inst/date/expiry (else engine solves)
    if(!chain){ setSync('load a chain or upload one'); return; }
    if(!(parseFloat(anchor)>0)){ setSync('set an anchor'); return; }
    const csrc=pdUploadChain?('upload:'+pdUploadChain.name):((a&&a.inst)+' \u00b7 '+(a&&a.date)+' \u00b7 '+(a&&a.expiry));
    const surv=(a&&a.survivors&&a.survivors.length)?a.survivors:null;
    setSync((drift?'\u26A0 DRIFT \u00b7 ':'')+'\u21b3 '+csrc+' \u00b7 '+anchor+' \u00b7 gk:'+(greeks?(((a&&a.gfn))||'warehouse'):'solve')+(surv?(' \u00b7 surv:'+surv.length):''));
    lastDate=(a&&a.date)||'';
    try{ if(!window.__qEnsureEngine) window.__qEnsureEngine=ensureEngine; }catch(_){} const okEng=await ensureEngine(); if(!okEng) return;
    setStatus(hashTag()+' \u00b7 computing\u2026');
    try{
      const line=String(runner.run(chain, String(anchor), greeks, surv||undefined)).trim();
      outEl.value=line; copyB.disabled=false; dlB.disabled=false;
      flagsEl.innerHTML=flagsFrom(line); setStatus(hashTag()); setErr('');
    }catch(e){ setErr(String(e&&e.message||e)); setStatus(hashTag()+' \u00b7 error'); }
  }
  function setOpen(o){ open=o;
    panel.classList.toggle('open',o); tab.classList.toggle('open',o);
    panel.setAttribute('aria-hidden', o?'false':'true');
    if(chev) chev.innerHTML = o ? '&#9654;' : '&#9664;';
    if(o){ updChainSrc(); compute(); }
  }
  tab.addEventListener('click',function(){ setOpen(!open); });
  if(x) x.addEventListener('click',function(){ setOpen(false); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&open) setOpen(false); });
  if(regenB) regenB.addEventListener('click',compute);
  if(chainFileEl){ chainFileEl.addEventListener('change',function(ev){ var f=ev.target.files&&ev.target.files[0]; if(!f) return;
    var rd=new FileReader(); rd.onload=function(){ pdUploadChain={name:f.name,text:String(rd.result||'')}; updChainSrc(); compute(); }; rd.readAsText(f); }); }
  if(chainClearB){ chainClearB.addEventListener('click',function(){ pdUploadChain=null; if(chainFileEl)chainFileEl.value=''; updChainSrc(); compute(); }); }
  if(copyB) copyB.addEventListener('click',function(){ try{ navigator.clipboard.writeText(outEl.value); copyB.textContent='Copied \u2713'; setTimeout(function(){copyB.textContent='Copy line';},1200);}catch(_){ outEl.select(); try{document.execCommand('copy');}catch(__){} } });
  if(dlB) dlB.addEventListener('click',function(){ var d=(lastDate||'').replace(/-/g,'')||'payload'; var u=URL.createObjectURL(new Blob([outEl.value],{type:'text/plain'})); var aa=document.createElement('a'); aa.href=u; aa.download='quan_payload_'+d+'.txt'; aa.click(); });
  window.addEventListener('quan:cell',function(){ if(!open) return; clearTimeout(dt); dt=setTimeout(compute,350); });
})();