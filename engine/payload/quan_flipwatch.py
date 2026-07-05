"""
quan_flipwatch.py — Tier-2 IMMINENT-FLIP detector.

A near-zero cascade axis sitting on its sign boundary + coherence breaks clustered early = the framework
flagging a field POISED TO FLIP. The morning snapshot reads one regime; the flip resolves intraday and only
a recompute catches it. Diagnosed from 05/15 (part 69): DR3S=-0.30 (knife edge, ~35x smaller than DIDS) + all
5 fold coherence-breaks clustered pre-midpoint -> DR3S crossing zero would upgrade CDS BIAS->STRONG. We missed
it by not recomputing.

Detector (framework signals only, no outcome-fitting):
  MARGINAL AXIS : any of DIDS/DITS/DR3S whose |skew| is small relative to the cascade scale AND near its sign
                  boundary, such that a small move flips its sign-test -> flips CDS.
  EARLY BREAKS  : fold coherence-breaks (zeroCrosses) clustered in the first half of the CW axis (open side).
Output: a flip-watch flag + which axis is marginal + what CDS becomes if it crosses + a recompute directive.
This is Tier-2: it does NOT change the static regime; it says "this field needs intraday recomputes."
"""
import numpy as np
import quan_realization as R

def _cds(dids, dits, dr3s):
    return ((1 if dids < 0 else -1) + (1 if dits < 0 else -1) + (1 if dr3s > 0 else -1)) / 3.0

def flip_watch(cascade, realization=None, frame=None):
    """cascade: compute_cascade output. realization: realization_waves output (or pass frame to compute)."""
    dids = cascade.get("DIDS", 0.0); dits = cascade.get("DITS", 0.0); dr3s = cascade.get("DR3S", 0.0)
    cds_now = cascade.get("CDS", _cds(dids, dits, dr3s))
    scale = max(abs(dids), abs(dits), abs(dr3s), 1e-9)

    # marginal axis: |skew| small vs the cascade scale (near its sign boundary)
    axes = {"DIDS(intent)": dids, "DITS(transaction)": dits, "DR3S(realization)": dr3s}
    marginal = []
    for name, v in axes.items():
        rel = abs(v) / scale
        if rel < 0.10:                      # an axis < 10% of the dominant = near its flip line
            flipped = dict(axes)
            key = name.split("(")[0]
            # what CDS becomes if THIS axis crosses zero (sign flip)
            f = {"DIDS": dids, "DITS": dits, "DR3S": dr3s}; f[key] = -f[key]
            cds_if = _cds(f["DIDS"], f["DITS"], f["DR3S"])
            marginal.append(dict(axis=name, value=round(v, 3), rel_size=round(rel, 3),
                                 cds_if_crosses=cds_if, upgrades=(abs(cds_if) > abs(cds_now))))

    # early coherence-break cluster
    early_cluster = False; breaks_at = []
    rw = realization if realization is not None else (R.realization_waves(frame, 0) if frame is not None else None)
    if rw:
        cw = rw.get("cwAxis", []); zc = rw.get("zeroCrosses", [])
        breaks_at = [round(cw[i], 2) for i in range(min(len(cw), len(zc))) if zc[i] == 1]
        if breaks_at:
            frac_early = sum(1 for b in breaks_at if b < 0) / len(breaks_at)   # CW<0 = open side
            early_cluster = (frac_early >= 0.6) and (len(breaks_at) >= 3)

    flip_imminent = bool(marginal) and (early_cluster or any(m["upgrades"] for m in marginal))
    directive = None
    if flip_imminent:
        up = [m for m in marginal if m["upgrades"]]
        tgt = up[0] if up else marginal[0]
        directive = (f"FLIP-WATCH: {tgt['axis']} is marginal ({tgt['value']}, {tgt['rel_size']:.0%} of scale) "
                     f"and on its sign line; if it crosses, CDS -> {tgt['cds_if_crosses']:+.2f}"
                     f"{' (UPGRADE)' if tgt['upgrades'] else ''}. "
                     f"Coherence breaks {'clustered early' if early_cluster else 'present'}"
                     f" ({breaks_at}). RECOMPUTE intraday — do not trust the morning snapshot.")
    return dict(flip_imminent=flip_imminent, marginal_axes=marginal, early_break_cluster=early_cluster,
                breaks_at=breaks_at, cds_now=cds_now, directive=directive,
                note="Tier-2 imminent-flip flag (marginal cascade axis + early coherence breaks). Framework "
                     "signals only; does not change the static regime — says 'recompute intraday'.")
