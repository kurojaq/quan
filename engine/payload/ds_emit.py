"""Prototype Deep Strike / Risq payload emitter — runs the baseline engine on the
EXPIRED contract, ATM-centered at the just-closed session's close. Produces the
DS keys the Pine Risq readout consumes. Scalar reductions marked (DEF) are defined
here and should be reconciled to Quanyun's exact v2 formulas."""
import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
import quan_unified as U, quan_engine as E, quan_perstrike as PS, quan_relativistic as RV, quan_engine as EN

def _f(x, n=2):
    try:
        if x is None or (isinstance(x,float) and (np.isnan(x) or np.isinf(x))): return "0"
        return str(round(float(x), n))
    except: return "0"

def ds_emit(chain, greeks, anchor, band=650, maxK=14):
    u = U.run_unified(chain, anchor=anchor, greeks_csv=greeks)
    casc = u["cascade"]; rz = u["realization"]
    fr = E.ingest_chain(chain)
    d = PS.per_strike(fr)
    d = d.assign(strike=fr.strike.values)
    # ---- FIELD: strike:mass:force:speed:lag:jerk:kurt:skew:lr:a:dr3 (AD/AF/AH/AJ/AM/W/X/T/AL/AT) ----
    oi = (fr.callOI.fillna(0)+fr.putOI.fillna(0)).values
    pop = d[oi >= 10].copy()   # OI floor: drop 1-lot noise that blows up chained ratios
    pop = pop[(pop.strike >= anchor-band) & (pop.strike <= anchor+band)]
    import numpy as _np
    for c in ["AD","AF","AH","AJ","AM","AL","AT"]:
        pop[c] = pop[c].replace([_np.inf,-_np.inf], _np.nan).clip(-9999, 9999)
    pop["massabs"] = pop["AD"].abs()
    pop = pop.sort_values("massabs", ascending=False).head(maxK).sort_values("strike")
    field = ",".join(
        f"{int(r.strike)}:{_f(r.AD)}:{_f(r.AF)}:{_f(r.AH)}:{_f(r.AJ)}:{_f(r.AM)}:{_f(r.W)}:{_f(r.X)}:{_f(r['T'])}:{_f(r.AL)}:{_f(r.AT)}"
        for _,r in pop.iterrows())
    # ---- OBS: didk:ditk:dr3k:dids:dits:dr3s:liqk:liqs:liqavg ----
    Tcol = d["T"].replace([np.inf,-np.inf],np.nan).dropna()
    liqk = Tcol.kurt(); liqs = Tcol.skew(); liqavg = Tcol.mean()
    obs = ":".join(_f(x) for x in [casc["DIDK"],casc["DITK"],casc["DR3K"],
                                   casc["DIDS"],casc["DITS"],casc["DR3S"], liqk, liqs, liqavg])
    # ---- REL: ii:ti:ri  = Iks:Tks:Rks ----
    g = RV.compute_relativistic(fr, casc["CDS"])
    rel = ":".join(_f(x) for x in [g["Iks"], g["Tks"], g["Rks"]])
    # ---- scalar reductions: EB0/latent/ZC reconciled to golden_reference (Book SOP Folding); dipltr & sop-net remain DEF (no canonical scalar cell) ----
    dip = list(rz["DIPLTRc"]); n=len(dip)
    dipltr = sum(v*(i-(n-1)/2) for i,v in enumerate(dip))          # (DEF) handedness-weighted net
    sopG=list(rz["sopG"]); sopC=list(rz["sopC"])
    sopg=float(np.nansum(sopG)); sopc=float(np.nansum(sopC))       # (DEF) net fold — no canonical scalar cell; sign carries handedness
    # latent = running path per golden_reference SOP Folding: Q (SOPG_Latent Path = ∫SOPG, single),
    # R (SOPC_Latent Path = ∫P, P=∫SOPC, double). Emit the path endpoint (accumulated latent). Verified
    # against the 06/16 Book cells (R[1]=-0.6755, R[2]=-1.418).
    def _intp(v, seed0=False):                                    # running integral, step 0.1; seed=v[0] (Q/P) or 0 (R)
        if not len(v): return [0.0]
        out=[0.0 if seed0 else float(v[0])]
        for i in range(1,len(v)): out.append(out[-1]+float(v[i-1])*0.1)
        return out
    latG=_intp(sopG)[-1]                                          # Q  : ∫ SOPG
    latC=_intp(_intp(sopC), seed0=True)[-1]                       # R  : ∫ P,  P = ∫ SOPC
    eb0 = round(float(rz["entropyNorm"]), 3)                      # Information-Field entropy, normalized [0,1] (Book V24/lnN); conviction bands <0.33 / <0.67
    # ZC per golden_reference SOP Folding S/T: cumulative sign-flips of SOPG*SOPC; a zero CURRENT cell never counts
    J=np.asarray(sopG,dtype=float)*np.asarray(sopC,dtype=float)
    zc=int(sum(1 for i in range(1,len(J)) if J[i]!=0 and np.sign(J[i])!=np.sign(J[i-1])))
    sop = ":".join(_f(x) for x in [sopg, sopc, latG, latC])
    # ---- SNAP (expired contract OI + IV) ----
    # IV resolution mirrors golden_reference "Greeks & IV Surface"!F (IV_Mid):
    #   both call+put IV -> mean ; else whichever exists ; else ATM fallback.
    # ATM fallback = resolved IV of the strike nearest the anchor (golden_reference $AC$2 analogue;
    #   switch the marked line to np.nanmedian for a distribution-based fallback instead).
    # >>> HTML PORT CONTRACT: this _resolve_iv + atm_iv block is the canonical SNAP-IV logic.
    #     The Pyodide-in-dashboard build must reuse it verbatim when emitting SNAP from __qStore
    #     greeks. Two facts that broke the old code: load_greeks_csv() is ROW-indexed (strike is a
    #     COLUMN, not the index) and the IV columns are cIV/pIV (not callIV).
    gf = None
    try:
        import quan_greeks as GK; gf = GK.load_greeks_csv(greeks)
    except: pass

    def _resolve_iv(strike):
        if gf is None or not len(gf): return np.nan
        gr = gf[gf.strike == strike]                 # match by STRIKE COLUMN (row-indexed frame)
        if not len(gr): return np.nan
        cI = gr.cIV.iloc[0]; pI = gr.pIV.iloc[0]      # columns are cIV / pIV
        if not np.isnan(cI) and not np.isnan(pI): return (cI + pI) / 2.0
        if not np.isnan(cI): return cI
        if not np.isnan(pI): return pI
        return np.nan

    # vendor IV is percent-with-% (e.g. 46.9); quan_greeks._num strips % WITHOUT dividing. Canonical
    # convention is DECIMAL (golden_reference IV_Mid 0.15, greeks_from_chain). Detect by magnitude and
    # rescale once, so this stays correct whether a future export is percent or already decimal.
    _samp = [v for v in (_resolve_iv(int(s)) for s in (gf.strike if (gf is not None and len(gf)) else [])) if not np.isnan(v)]
    iv_scale = 0.01 if (_samp and np.median(_samp) > 2.5) else 1.0

    atm_iv = 0.0
    if gf is not None and len(gf):
        atm_k = int(gf.strike.iloc[(gf.strike - anchor).abs().values.argmin()])
        a = _resolve_iv(atm_k)                        # <- nearest-anchor ATM IV (swap to median if preferred)
        if np.isnan(a): a = float(np.median(_samp)) if _samp else 0.0
        atm_iv = float(a) * iv_scale

    snaps=[]
    for _,r in pop.iterrows():
        k=int(r.strike); row=fr[fr.strike==k]
        c=row.callOI.fillna(0).iloc[0] if len(row) else 0
        p=row.putOI.fillna(0).iloc[0] if len(row) else 0
        iv = _resolve_iv(k)
        sig = (float(iv) * iv_scale) if not np.isnan(iv) else atm_iv
        snaps.append(f"{k}:{int(c)}:{int(p)}:{_f(sig, 3)}")
    snap=",".join(snaps)
    parts=[f"FIELD={field}",f"OBS={obs}",f"REL={rel}",f"DIPLTR={_f(dipltr)}",
           f"SOP={sop}",f"ZC={zc}",f"EB0={eb0}",f"SNAP={snap}"]
    return "|".join(parts)

if __name__=="__main__":
    import sys
    print(ds_emit(sys.argv[1], sys.argv[2], float(sys.argv[3])))
