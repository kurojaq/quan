#!/usr/bin/env python3
"""
quan_embeds.py — per-date 3D embed data for the dashboard (SOP Layers + Field Program).

One connected pipeline: realization_waves -> SOP fold (J = SOPG*SOPC) per expiry ->
  - SOP Layers : each expiry's fold as a discrete plane (curtain mesh) at its DTE
  - Field Program : those fold curves interpolated into a continuous surface across the DTE horizon

Curve source is the engine's canonical SOP fold (the documented J=SOPG*SOPC in quan_tensor_field),
NOT the original baked blob's lost transform. Levels (walls, target ladder, anchor) come from
quan_pine_export.export_snapshot. Geometry (44-pt planes, 60x55 surface, curtain triangulation,
break markers) reproduces the dashboard's embed schema exactly.
"""
import os, json
import numpy as np
from scipy.interpolate import make_interp_spline
from quan_engine import ingest_chain
import quan_realization as R
import quan_pine_export as PX

_ED = os.path.dirname(os.path.abspath(__file__))
COLORS = ["#f5b942", "#9b6dff", "#39d3ff", "#5fd08a", "#f1605d"]  # weekly, monthly, eom, ...

def _coherence_breaks(xs, ys):
    sgn = lambda y: 0 if y == 0 else (1 if y > 0 else -1)
    out, n = [], len(ys)
    for i in range(n):
        x, y = xs[i], ys[i]; s = sgn(y)
        if s == 0:
            l = sgn(ys[i-1]) if i > 0 else 0
            r = sgn(ys[i+1]) if i < n-1 else 0
            if l or r: out.append(round(float(x), 4))
        if i < n-1:
            y1 = ys[i+1]; s1 = sgn(y1)
            if s and s1 and s != s1:
                out.append(round(float(x + (xs[i+1]-x)*(-y)/(y1-y)), 4))
    seen = []; [seen.append(v) for v in out if v not in seen]
    return seen

def _fold_curve(chain, anchor, n=44):
    """Resample the engine SOP fold (11 pts, 0->1) to n points on the chronometer axis.
    Fold is gated to +/-8, identical to the dashboard's Folded 'Fold' tab, so cross-expiry
    planes stay on one readable scale (raw SOPG*SOPC can spike to hundreds on long-dated chains)."""
    fr = ingest_chain(chain); w = R.realization_waves(fr, anchor)
    fold = [max(-8.0, min(8.0, float(v))) for v in w["fold"]]
    x0 = np.linspace(0, 1, len(fold)); xs = np.linspace(0, 1, n)
    p = make_interp_spline(x0, fold, k=3)(xs) if len(fold) >= 4 else np.interp(xs, x0, fold)
    p = np.clip(p, -8.0, 8.0)
    return xs, p

def _curtain(x, p, dte):
    mx, mz = [], []
    for i in range(len(x)):
        mx += [float(x[i]), float(x[i])]; mz += [0.0, round(float(p[i]), 6)]
    my = [dte] * len(mx)
    I, J, K = [], [], []
    for s in range(len(x) - 1):
        a = 2 * s
        I += [a, a + 2]; J += [a + 2, a + 3]; K += [a + 1, a + 1]
    return mx, my, mz, I, J, K

def _levels(chain, anchor):
    seg = dict(s.split("=", 1) for s in PX.export_snapshot(chain, anchor).split("|") if "=" in s)
    walls = [float(x) for x in seg.get("GWALLS", "").split(",") if x.strip()]
    tlad = [float(t.split(":")[0]) for t in seg.get("TLADDER", "").split(",") if t.strip()]
    return walls, tlad

def build(expiries, level_chain, anchor):
    """
    expiries: list of (name, dte, chain_csv, anchor) ordered front->back.
    level_chain/anchor: chain+anchor used for walls/target-ladder (the front/session chain).
    Returns {"sl": <SOP Layers data>, "fp": <Field Program data>}.
    """
    curves = []  # (name, dte, color, x44, p44)
    for idx, (name, dte, chain, anc) in enumerate(expiries):
        x, p = _fold_curve(chain, anc, n=44)
        curves.append((name, int(dte), COLORS[idx % len(COLORS)], x, p))

    # ---- SOP Layers (discrete planes) ----
    layers, all_p = [], []
    for name, dte, col, x, p in curves:
        mx, my, mz, I, J, K = _curtain(x, p, dte)
        layers.append({"name": name, "dte": dte, "col": col,
                       "x": [round(float(v), 6) for v in x], "p": [round(float(v), 6) for v in p],
                       "mx": [round(float(v), 6) for v in mx], "my": my,
                       "mz": mz, "i": I, "j": J, "k": K,
                       "breaks": _coherence_breaks(list(x), list(p))})
        all_p += list(p)
    sl = {"layers": layers,
          "zmin": round(float(min(all_p)), 3) if all_p else -1.0,
          "zmax": round(float(max(max(all_p), 0.3)), 3) if all_p else 0.3}

    # ---- Field Program (continuous surface across DTE) ----
    gx = np.linspace(0, 1, 60)
    dtes = [c[1] for c in curves]
    # resample each fold curve to the 60-pt chronometer grid
    cols60 = []
    for _, _, _, x, p in curves:
        cols60.append(make_interp_spline(x, p, k=3)(gx) if len(x) >= 4 else np.interp(gx, x, p))
    cols60 = np.array(cols60)  # (n_exp, 60)
    dmin, dmax = (min(dtes), max(dtes)) if dtes else (1, 25)
    if dmin == dmax: dmax = dmin + 1
    gy = np.linspace(dmin, dmax, 55)
    Z = np.zeros((55, 60))
    for xi in range(60):
        Z[:, xi] = np.interp(gy, dtes, cols60[:, xi]) if len(dtes) > 1 else cols60[0, xi]
    walls, tlad = _levels(level_chain, anchor)
    fp = {"pred": {"x": [round(float(v), 6) for v in gx], "y": [round(float(v), 6) for v in gy],
                   "z": [[round(float(v), 6) for v in row] for row in Z],
                   "anchor": round(float(anchor), 2),
                   "zmin": round(float(Z.min()), 3), "zmax": round(float(Z.max()), 3),
                   "walls": walls, "tladder": tlad},
          "breaks": curves[0][4] is not None and _coherence_breaks(list(curves[0][3]), list(curves[0][4]))}
    return {"sl": sl, "fp": fp}

def render_sl(sl_data):
    return open(os.path.join(_ED, "embed_sl_shell.html")).read().replace("__SLDATA__", json.dumps(sl_data, separators=(",", ":")))

def render_fp(fp_data):
    return open(os.path.join(_ED, "embed_fp_shell.html")).read().replace("__FPDATA__", json.dumps(fp_data, separators=(",", ":")))
