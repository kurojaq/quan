"""
quan_unified.py — the connected Qu'an stack in ONE call.

Pipeline (all framework-verified this session):
  raw chain
    -> cascade            (compute_cascade: DIDS/DITS/DR3S, CDS bias, K, S, ICF, PP)
    -> temporal globals   (quan_temporal.temporal_globals: K,S,ICF,Tempo,TPS,C(f),TMR,PT)
    -> realization fold   (quan_realization.realization_waves: CC/CD, SOPG/SOPC, fold J, ZC, DIPLTR)
    -> tensor surface     (quan_tensor_field.tensor_surface: |O|*exp(-(x-Q)^2), Velocity, Jerk)  [fold-driven]
    -> conductance gate   (quan_temporal.conductance_chain: CR/CS/CT/CU on the CW axis)
  All hang off the SOP fold hub. Greeks are NOT in this pipeline (framework uses them only for ATM/IV);
  a Greeks gamma-wall overlay can be attached as an explicit EXTENSION, flagged separately.
"""
import numpy as np
import quan_realization as R
import quan_temporal as T
import quan_tensor_field as TF
import quan_greeks as GK
from quan_engine import ingest_chain, compute_cascade, bias_tier, compute_levels


def run_unified(csv_path, anchor=None, greeks_csv=None, multiplier=20.0):
    fr = ingest_chain(csv_path)
    if anchor is None:
        anchor = float(fr["strike"].median())
    cas = compute_cascade(fr)
    glob = T.temporal_globals(fr)
    rw = R.realization_waves(fr, anchor)
    lv = compute_levels(fr, anchor=anchor, cds=cas["CDS"], bias=cas.get("BIAS"))
    # tensor surface from the fold
    ts = TF.tensor_surface(rw["sopG"], rw["sopC"])
    # conductance gate
    cc = np.array(rw["pressureGradient"]); cd = np.array(rw["pressureCurvature"]); cw = np.array(rw["cwAxis"])
    cond = T.conductance_chain(cc, cd, cw, glob["PT"])
    CT = np.array(cond["CT"])
    conductive_t = [round((cw[k] + 1) / 2, 2) for k in range(len(cw)) if CT[k] > 0]
    # greeks layer (optional — needs a vendor greeks CSV)
    greeks = None
    if greeks_csv:
        try:
            gk = GK.load_greeks_csv(greeks_csv)
            greeks = GK.greeks_layer(fr, gk, anchor, multiplier=multiplier)
        except Exception as e:
            greeks = {"error": str(e)}
    # directional agreement: cascade CDS sign vs Greeks net-delta-pressure
    agree = None
    if greeks and "direction" in greeks:
        cas_bull = cas["CDS"] > 0
        grk_bull = greeks["direction"] == "BULLISH_DELTA_PRESSURE"
        agree = "AGREE" if (cas_bull == grk_bull) else "CONFLICT"
    return dict(anchor=anchor,
                cascade=cas,
                globals={k: glob[k] for k in ("K", "S", "ICF", "Cs", "Tempo", "TPS", "Cf", "TMR", "PT", "Rd_exact")},
                realization=dict(totalZC=rw["totalZC"], crossings_t=rw["crossings_t"],
                                 entropyNorm=rw["entropyNorm"], fold=rw["fold"],
                                 DIPLTRc=rw["curvature_DIPLTR"], sopG=rw["sopG"], sopC=rw["sopC"]),
                tensor=dict(peak_offset=ts["peak_offset"], ridge=ts["ridge"], O=ts["O"], Q=ts["Q"],
                            surface=ts["surface"], velocity=ts["velocity"], jerk=ts["jerk"]),
                conductance=dict(CT=cond["CT"], CS=cond["CS"], CR=cond["CR"],
                                 conductive_count=int((CT > 0).sum()), conductive_t=conductive_t),
                greeks=greeks, direction_agreement=agree,
                levels=lv)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, "engine")
    csv = sys.argv[1]; anchor = float(sys.argv[2]) if len(sys.argv) > 2 else None
    greeks_csv = sys.argv[3] if len(sys.argv) > 3 else None
    u = run_unified(csv, anchor, greeks_csv=greeks_csv)
    c = u["cascade"]; g = u["globals"]; rz = u["realization"]; tn = u["tensor"]; cd = u["conductance"]
    print(f"anchor: {u['anchor']}")
    print(f"CASCADE: {c['BIAS']} CDS={c['CDS']:+.2f}  PP={c['PP']:+.2f}  K={c['K']:.2f} S={c['S']:.2f} ICF={c['ICF']:.2f}")
    print(f"GLOBALS: Cs={g['Cs']:.2f} Tempo={g['Tempo']:.3f} TPS={g['TPS']:.5f} PT={g['PT']:.3e} Rd_exact={g['Rd_exact']}")
    print(f"FOLD: totalZC={rz['totalZC']} entropyNorm={rz['entropyNorm']} crossings_t={rz['crossings_t']}")
    print(f"TENSOR: peak field offset = {tn['peak_offset']} strikes from anchor; ridge max = {round(max(tn['ridge']),2)}")
    print(f"CONDUCTANCE: CT>0 in {cd['conductive_count']}/21; conductive windows t={cd['conductive_t']}")
    if u["greeks"] and "direction" in u["greeks"]:
        gr = u["greeks"]
        print(f"GREEKS: NetDealerDelta={gr['netDelta']:,.0f} -> {gr['direction']}; GEX={gr['gex']:,.0f}")
        print(f"        gamma walls: {[(s, f'{v:,.0f}') for s,v in gr['gamma_walls']]}")
        print(f"DIRECTION AGREEMENT (cascade vs greeks): {u['direction_agreement']}")
    print(f"LEVELS: SFLOOR {u['levels']['SFLOOR']} DFLOOR {u['levels']['DFLOOR']} ATM {u['anchor']} DCEIL {u['levels']['DCEIL']} SCEIL {u['levels']['SCEIL']} TARGET {u['levels']['TARGET']}")
