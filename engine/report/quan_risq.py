"""
quan_risq.py — the five-dimension Risq framework + Risq Ratio, layered on top of the
already-validated scorecard / per-strike / realization / relativistic modules.

Doctrine source: the Qu'an reference manual's "RISQ — A Derivative Risk Framework"
(see Quan Brain One/wiki/analytics/risq-framework.md). This module introduces no new
raw-data plumbing — every input is already computed elsewhere in this engine; it is a
synthesis layer, not a new observable.

  R_F (Field Risk)      = log(1+Jerk) * (1/max(|Mass|,0.01))                    veto        >4.0
  R_T (Temporal Risk)    = |CW_position| * |DR3| * (1+|DIPLTR_residual|)         caution     >0.6   closure  >0.8
  R_I (Information Risk) = (1/max(|Conductance|,1e-6)) * log(1+ZC_count)         degraded    >2.0   compromised >4.0
  R_C (Coherence Risk)   = |DIDK/DITK-1| + |DIDS/DITS-1| + |DR3K/(DIDK/DITK)-1|   stress      >1.5   break    >3.0
  R_W (Inertia Risk)     = max(|II|,0.01) / max(|TI|,0.01)                       warning     >3.0   lock     >6.0

  Risq Ratio = [|A|*|Force|*|Conductance|] / [max(R_F,0.1)*max(R_T,0.1)*max(R_C,0.1)*max(R_W,0.1)]
    Tier 1 >15 (full alloc) | Tier 2 8-15 (A+B) | Tier 3 4-8 (A only) | Tier 4 1-4 (observe) | Veto <1

Scope decisions (engineering judgment, not doctrine-specified — documented so a future
pass can revisit them):
  - The source's Risq is a live intraday tool tracking a position against a moving CW
    clock. This engine computes a session SNAPSHOT, so Risq is reported for the
    TOP-SCORED PDSL/DSC candidate only (the single most actionable level), not per-strike.
  - CW_position uses the LAST covered CW value from the realization fold (the most
    session-complete read available from a snapshot), not a live intraday clock position.
  - Conductance is used as the engine's own continuous DB35 value rather than being
    bucketed into the doctrine's four discrete condFactor tiers (1.10/1.00/0.50/0.35) —
    that discretization isn't specified precisely enough in the source to port faithfully,
    so the underlying continuous signal is kept instead of inventing thresholds.
"""
import numpy as np
import quan_scorecard as SC
import quan_perstrike as PS
import quan_realization as RZ
import quan_relativistic as RV


def _r(v, nd=4):
    try:
        return round(float(v), nd) if v is not None and np.isfinite(v) else None
    except Exception:
        return None


def compute_risq(frame, anchor, cds, cascade, realization_dir="NEUTRAL"):
    """frame: ingested chain. anchor: forward price. cds: CDS score (0..1 win-prob proxy
    for the Risq Ratio's numerator context — informational only here).
    cascade: dict with DIDK/DITK/DR3K/DIDS/DITS keys — pass the values already computed
    upstream (e.g. quan_analyze's signal.cascade) to avoid recomputing excel_skew/kurt.
    Returns {'ok': False, 'note': ...} if no PDSL/DSC candidate exists this session."""
    try:
        card = SC.scorecard(frame, realization_dir=realization_dir, anchor=anchor)
    except Exception as e:
        return dict(ok=False, note="scorecard failed: %s" % e)
    if not card:
        return dict(ok=False, note="no PDSL/DSC candidate this session")
    top = card[0]  # SC.scorecard() already sorts by -score
    strike = top["strike"]

    # Jerk isn't in the scorecard block — pull it from the extended per-strike layer.
    jerk = None
    try:
        ps = PS.per_strike(frame)
        prow = ps.iloc[(ps["strike"] - strike).abs().idxmin()]
        jerk = float(prow["AM"]) if np.isfinite(prow["AM"]) else None
    except Exception:
        pass
    mass = top.get("mass")
    R_F = (np.log1p(jerk) * (1.0 / max(abs(mass), 0.01))) if (jerk is not None and mass is not None) else None

    dr3 = top.get("dr3")

    # DIPLTR residual + CW position + ZC count from the realization fold.
    dip_residual = cw_position = zc_count = None
    try:
        rw = RZ.realization_waves(frame, anchor)
    except Exception:
        rw = None
    if rw:
        dip = rw.get("gradient_DIPLTR") or []
        if dip:
            dip_residual = float(dip[-1])       # outermost fold pair = the residual carried into the next session
        cw_axis = rw.get("cwAxis") or []
        if cw_axis:
            cw_position = float(cw_axis[-1])    # session-complete snapshot read (see module docstring)
        zc_count = rw.get("totalZC")
    R_T = (abs(cw_position) * abs(dr3) * (1.0 + abs(dip_residual or 0.0))
           if (cw_position is not None and dr3 is not None) else None)

    # Conductance + II/TI from the relativistic block (already computed elsewhere for Kelly;
    # recomputed here since this module must stand alone as a manifest entry).
    try:
        rv = RV.compute_relativistic(frame, cds or 0.0)
    except Exception:
        rv = {}
    conductance = rv.get("Conductance")
    ii, ti = rv.get("II"), rv.get("TI")
    R_I = None
    if conductance is not None and np.isfinite(conductance) and zc_count is not None:
        cf = conductance if abs(conductance) > 1e-6 else 1e-6
        R_I = (1.0 / abs(cf)) * np.log1p(zc_count)
    R_W = (max(abs(ii), 0.01) / max(abs(ti), 0.01)
           if (ii is not None and ti is not None and np.isfinite(ii) and np.isfinite(ti)) else None)

    # Coherence Risk from the already-computed cascade moments.
    R_C = None
    didk, ditk, dr3k = cascade.get("DIDK"), cascade.get("DITK"), cascade.get("DR3K")
    dids, dits = cascade.get("DIDS"), cascade.get("DITS")
    try:
        if None not in (didk, ditk, dr3k, dids, dits) and ditk and dits:
            idr = didk / ditk
            R_C = (abs(idr - 1) + abs(dids / dits - 1) + abs(dr3k / idr - 1)) if idr else None
    except Exception:
        R_C = None

    flags = []
    if R_F is not None and R_F > 4.0: flags.append("FIELD VETO (R_F>4.0)")
    if R_T is not None and R_T > 0.8: flags.append("TEMPORAL CLOSURE (R_T>0.8)")
    elif R_T is not None and R_T > 0.6: flags.append("TEMPORAL CAUTION (R_T>0.6)")
    if R_I is not None and R_I > 4.0: flags.append("INFORMATION COMPROMISED (R_I>4.0)")
    elif R_I is not None and R_I > 2.0: flags.append("INFORMATION DEGRADED (R_I>2.0)")
    if R_C is not None and R_C > 3.0: flags.append("COHERENCE BREAK (R_C>3.0)")
    elif R_C is not None and R_C > 1.5: flags.append("COHERENCE STRESS (R_C>1.5)")
    if R_W is not None and R_W > 6.0: flags.append("INERTIA LOCK (R_W>6.0)")
    elif R_W is not None and R_W > 3.0: flags.append("INERTIA WARNING (R_W>3.0)")

    # Risq Ratio — needs |A| and |Force| at the top strike (not carried on the scorecard row).
    A = force = ratio = None
    tier = None
    try:
        blk = SC.observable_scan(SC.per_strike_block(frame))
        brow = blk.iloc[(blk["strike"] - strike).abs().idxmin()]
        A = float(brow["P"]) if np.isfinite(brow["P"]) else None
        force = float(brow["Force"]) if np.isfinite(brow["Force"]) else None
    except Exception:
        pass
    dims_ok = all(v is not None for v in (R_F, R_T, R_C, R_W))
    if dims_ok and None not in (A, force, conductance) and all(np.isfinite(v) for v in (A, force, conductance)):
        denom = max(R_F, 0.1) * max(R_T, 0.1) * max(R_C, 0.1) * max(R_W, 0.1)
        if denom:
            ratio = (abs(A) * abs(force) * abs(conductance)) / denom
            tier = ("TIER_1" if ratio > 15 else "TIER_2" if ratio > 8 else
                     "TIER_3" if ratio > 4 else "TIER_4" if ratio > 1 else "VETO")

    return dict(
        ok=True, strike=strike, kind=top.get("kind"), score=top.get("score"), score_tier=top.get("tier"),
        dims=dict(R_F=_r(R_F), R_T=_r(R_T), R_I=_r(R_I), R_C=_r(R_C), R_W=_r(R_W)),
        flags=flags, ratio=_r(ratio), risq_tier=tier,
        inputs=dict(jerk=_r(jerk), mass=_r(mass), dr3=_r(dr3), cw=_r(cw_position),
                    dipltr_residual=_r(dip_residual), zc_count=zc_count,
                    conductance=_r(conductance), ii=_r(ii), ti=_r(ti), A=_r(A), force=_r(force)),
    )


if __name__ == "__main__":
    import sys
    sys.path.insert(0, "/mnt/user-data/outputs")
    from quan_engine import ingest_chain, compute_cascade
    fr = ingest_chain(sys.argv[1]); anchor = float(sys.argv[2])
    casc = compute_cascade(fr)
    r = compute_risq(fr, anchor, casc.get("CDS") or 0.0,
                      dict(DIDK=casc.get("DIDK"), DITK=casc.get("DITK"), DR3K=casc.get("DR3K"),
                           DIDS=casc.get("DIDS"), DITS=casc.get("DITS")))
    import json
    print(json.dumps(r, indent=2, default=str))
