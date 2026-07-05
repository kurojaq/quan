"""
quan_heatmap_bridge.py — single entry for the Deep Strike heatmap.
Chain CSV (+ anchor) -> per-strike engine field table as JSON, using the
canonical ingest_chain + per_strike path. No reimplementation; pure pass-through.

Full Book-sheet (A:BP) surface: every column here is either a direct
per_strike() output (already validated against the golden reference) or a
trivial ratio/difference/sign-flip built ONLY from those validated outputs.
Two Book columns are intentionally omitted as pure duplicates: BG (=AT,
already exposed as dpremT) and BI (=AW, already exposed as invdist).
"""
import json, numpy as np, pandas as pd
import quan_engine, quan_perstrike

# heatmap field  ->  per_strike column letter  (posture + Book-derived ratios handled separately below)
_MAP = {'kurt':'W','skew':'X','icf':'Y','mass':'AD','force':'AF','speed':'AH',
        'lag':'AJ','accel':'AL','jerk':'AM','netprem':'AN','dpremT':'AO',
        'invdist':'AP','invtxn':'AR','riskreal':'AT',
        # order-flow block (Excel K,L,M,N,O,P,Q,R,S,T)
        'netlatest':'K','nettx':'L','pcroi':'M','pcrvol':'N','netoi':'O',
        'netoipcr':'P','netvolpcr':'Q','txeff':'R','intenteff':'S','liqratio':'T',
        # dealer-time cascade (Excel BH,BJ,BK,BL,BM,BN,BO,BP)
        'dealrt':'AW','diddt':'AY','dtdid':'AZ','dtdit':'BA','realizinvt':'BB',
        'dtgrad':'BC','ditcurv':'BD','dtnorm':'BE'}

def _num(x):
    if x is None: return None
    try:
        f=float(x)
        return None if (np.isnan(f) or np.isinf(f)) else f
    except Exception:
        return None

def _flip(series):
    """+1/-1 on a sign change vs. the previous strike, else 0 (Excel's 'State Flip' columns AY/BA/BC)."""
    sign=np.sign(series)
    prev=sign.shift(1)
    changed=(sign!=prev)&(sign!=0)&(~prev.isna())&(prev!=0)
    return pd.Series(np.where(changed, sign, 0.0), index=series.index)

def run(csv_text, anchor=None):
    import tempfile, os
    p=os.path.join(tempfile.gettempdir(),'_hm_chain.csv')
    open(p,'w').write(csv_text)
    f=quan_engine.ingest_chain(p)
    ps=quan_perstrike.per_strike(f)
    # posture = AN/(O-L)  (verified 508/508 vs baked)  == Excel AU "Dealer Posture Ratio"
    net_posture = ps['O']-ps['L']                                   # Excel P  "Net Posture"
    posture = ps['AN']/net_posture.replace(0,np.nan)                # Excel AU "Dealer Posture Ratio"
    solidity = 1/ps['T'].replace(0,np.nan)                          # Excel V  "Solidity Ratio"
    pdpt = posture/ps['AO'].replace(0,np.nan)                       # Excel AV
    pdptdid = pdpt/ps['AP'].replace(0,np.nan)                       # Excel AX
    pintent = posture/ps['AP'].replace(0,np.nan)                    # Excel BD
    ptxn = posture/ps['AR'].replace(0,np.nan)                       # Excel BE
    prisk = posture/ps['AT'].replace(0,np.nan)                      # Excel BF
    didflip = _flip(ps['AP'])                                       # Excel AY
    txnflip = _flip(ps['AR'])                                       # Excel BA
    riskflip = _flip(ps['AT'])                                      # Excel BC
    kurt_grad = ps['W'].shift(-1)-ps['W']                           # Excel Y  "Strike Kurt Gradient"
    kurt_curv = kurt_grad.shift(-1)-kurt_grad                       # Excel Z  "Strike Kurt Curvature"
    skew_grad = ps['X'].shift(-1)-ps['X']                           # Excel AB "Strike Skew Gradient"
    skew_curv = skew_grad.shift(-1)-skew_grad                       # Excel AC "Strike Skew Curvature"
    out=[]
    for i in range(len(ps)):
        row={'k':_num(ps['strike'].iloc[i])}
        for fld,col in _MAP.items():
            row[fld]=_num(ps[col].iloc[i])
        row['posture']=_num(posture.iloc[i])
        row['netpost']=_num(net_posture.iloc[i])
        row['solidity']=_num(solidity.iloc[i])
        row['pdpt']=_num(pdpt.iloc[i])
        row['pdptdid']=_num(pdptdid.iloc[i])
        row['pintent']=_num(pintent.iloc[i])
        row['ptxn']=_num(ptxn.iloc[i])
        row['prisk']=_num(prisk.iloc[i])
        row['didflip']=_num(didflip.iloc[i])
        row['txnflip']=_num(txnflip.iloc[i])
        row['riskflip']=_num(riskflip.iloc[i])
        # raw inputs the heatmap also wants (for greeks/surface client-side)
        row['coi']=_num(f.callOI.iloc[i]);  row['poi']=_num(f.putOI.iloc[i])
        row['cvol']=_num(f.callVol.iloc[i]); row['pvol']=_num(f.putVol.iloc[i])
        row['cprem']=_num(f.callPrem.iloc[i]); row['pprem']=_num(f.putPrem.iloc[i])
        row['clatest']=_num(f.callLatest.iloc[i]); row['platest']=_num(f.putLatest.iloc[i])
        row['kurtgrad']=_num(kurt_grad.iloc[i]); row['kurtcurv']=_num(kurt_curv.iloc[i])
        row['skewgrad']=_num(skew_grad.iloc[i]); row['skewcurv']=_num(skew_curv.iloc[i])
        out.append(row)
    return json.dumps({'rows':out,'n':len(out)})
