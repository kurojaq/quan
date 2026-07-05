"""
quan_brief_graphs — render the prediction graphs (Time State Compass: SOPG×SOPC / product tension).

Matches the Excel "Time State Compass" smoothed-line charts: multiple wave series overlaid on the
-1..+1 chronometer axis, SMOOTH spline-interpolated (Excel's smoothed line style), action on the
right half. These ARE the graphs the wave-type read is derived from.

Series plotted (all from quan_realization output, no new math):
  - product  = SOPG x SOPC over the 21-cell axis  (the sharp diving "fold" curve = coherence signal)
  - gradient = pressure gradient (CC)
  - curvature= pressure curvature (CD)
  - envelope = smooth low-order trend through the product (the green/yellow envelope in the charts)
Zero-crossings of the product = the Book's coherence-break detector.
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

_BG = "#0e1117"; _FG = "#c9d1d9"; _GRID = "#1c2330"
_WHITE = "#f0f0f0"; _RED = "#e2554e"; _GOLD = "#d6a533"; _PURPLE = "#9a7bd0"; _GREEN = "#4caf72"
_AMB = "#d29922"; _ACC = "#58a6ff"


def _smooth(x, y, n=300):
    """Smooth spline interpolation (Excel smoothed-line look). Falls back to linear if scipy absent."""
    x = np.asarray(x, float); y = np.asarray(y, float)
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    if len(x) < 4:
        return x, y
    xs = np.linspace(x.min(), x.max(), n)
    try:
        from scipy.interpolate import make_interp_spline
        k = 3 if len(x) > 3 else 2
        ys = make_interp_spline(x, y, k=k)(xs)
        return xs, ys
    except Exception:
        return xs, np.interp(xs, x, y)


def _style(ax):
    ax.set_facecolor(_BG)
    for s in ax.spines.values(): s.set_color(_GRID)
    ax.tick_params(colors=_FG, labelsize=8)
    ax.grid(True, color=_GRID, lw=0.5, alpha=0.5)
    ax.axhline(0, color=_FG, lw=0.8, alpha=0.6)
    ax.axvline(0, color=_FG, lw=0.8, alpha=0.4)


def render_fold_graphs(rw, out_prefix, anchor=None):
    """rw = quan_realization.realization_waves output. Writes PNGs, returns list of paths."""
    if not rw:
        return []
    paths = []
    cw = np.array(rw["cwAxis"], float)
    pg = np.array(rw["pressureGradient"], float)
    pc = np.array(rw["pressureCurvature"], float)
    product = pg * pc                              # SOPG x SOPC — the diving coherence curve

    # FULL -1..+1 axis (2026-06-02): now that the fold window is ATM-centered, the left half is real
    # DOWNSIDE-strike pressure structure (not 'the past'), so show ALL of it. chronoT 0 = ATM; left =
    # strikes below ATM, right = strikes above. Left half greyed lightly to mark the ATM divide, not cropped.
    rmask = np.ones(len(cw), dtype=bool)
    cwR, pgR, pcR, prodR = cw[rmask], pg[rmask], pc[rmask], product[rmask]

    # ---- 1) Time State Compass: SOPG×SOPC product tension (the headline wave) ----
    fig, ax = plt.subplots(figsize=(7.6, 3.4), dpi=120)
    fig.patch.set_facecolor(_BG); _style(ax)
    # smooth overlays — product (white, sharp), curvature (red), gradient (gold)
    xs, ys = _smooth(cwR, prodR);  ax.plot(xs, ys, color=_WHITE, lw=2.0, label="SOPG×SOPC (product)")
    xs, yg = _smooth(cwR, pcR);    ax.plot(xs, yg, color=_RED, lw=1.4, alpha=0.9, label="curvature (CD)")
    xs, yp = _smooth(cwR, pgR*20); ax.plot(xs, yp, color=_GOLD, lw=1.4, alpha=0.9, label="gradient (CC, ×20)")
    # smooth low-order envelope through the product (green)
    if np.isfinite(prodR).sum() >= 4:
        coef = np.polyfit(cwR, prodR, 3); xe = np.linspace(cwR.min(), cwR.max(), 300)
        ax.plot(xe, np.polyval(coef, xe), color=_GREEN, lw=1.6, alpha=0.8, label="envelope")
    ax.scatter(cwR, prodR, color=_WHITE, s=14, zorder=5, edgecolor=_BG, lw=0.5)
    # grey out the inactive left/past half to match the Excel convention
    ax.axvspan(-1.02, 0.0, color="#161b22", alpha=0.28, zorder=0)   # mark the below-ATM half lightly
    ax.axvline(0.0, color=_WHITE, lw=0.8, alpha=0.5, zorder=1)        # ATM divide
    ax.set_title(f"Time State Compass — SOPG×SOPC product tension   (coherence breaks = {rw['totalZC']})",
                 color=_FG, fontsize=10)
    ax.set_xlabel("chronometer watch  (-1 = below ATM  |  0 = ATM  |  +1 = above ATM)", color=_FG, fontsize=8)
    ax.set_xlim(-1.02, 1.02)
    ax.legend(facecolor=_BG, edgecolor=_GRID, labelcolor=_FG, fontsize=7, loc="lower left")
    p = out_prefix + "_compass.png"; fig.tight_layout(); fig.savefig(p, facecolor=_BG); plt.close(fig)
    paths.append(p)

    # ---- 2) Gradient & curvature waves (smooth, the two factors) — right half ----
    fig, ax = plt.subplots(figsize=(7.6, 3.0), dpi=120)
    fig.patch.set_facecolor(_BG); _style(ax)
    xs, yg = _smooth(cwR, pgR); ax.plot(xs, yg, color=_PURPLE, lw=1.8, label="pressure gradient (CC)")
    ax.scatter(cwR, pgR, color=_PURPLE, s=12, zorder=5)
    ax2 = ax.twinx(); ax2.tick_params(colors=_GOLD, labelsize=8)
    xs, yc = _smooth(cwR, pcR); ax2.plot(xs, yc, color=_GOLD, lw=1.8, label="pressure curvature (CD)")
    ax2.scatter(cwR, pcR, color=_GOLD, s=12, zorder=5)
    ax.set_title("Pressure gradient (purple) & curvature (gold) — smoothed waves",
                 color=_FG, fontsize=10)
    ax.set_xlabel("chronometer watch  (-1 below ATM | 0 ATM | +1 above ATM)", color=_FG, fontsize=8); ax.set_xlim(-1.02, 1.02)
    ax.axvline(0.0, color=_WHITE, lw=0.7, alpha=0.4)
    p = out_prefix + "_waves.png"; fig.tight_layout(); fig.savefig(p, facecolor=_BG); plt.close(fig)
    paths.append(p)

    return paths


def render_tensor_graphs(st, out_prefix):
    """
    st = quan_tensor.extract() output (the real Book Tensor Surface / Jerk / asymmetry, recalc'd).
    Renders amplitude |O|, surface jerk, and asymmetry by chronoT. Returns list of paths.
    HONEST: the tensor pins peaks at offset 0 (peak_migration small) and tends to read COMPRESSION
    across most sessions — so it is NOT a proven discriminator. Shown as context, labeled as such.
    """
    if not st or not st.get("rows"):
        return []
    rows = st["rows"]
    chrono = [r["chronoT"] for r in rows]
    amp = [r["ampO"] for r in rows]; jerk = [r["jerk"] for r in rows]; asym = [r["asym"] for r in rows]
    fig, axes = plt.subplots(1, 3, figsize=(12.5, 3.4), dpi=120)
    fig.patch.set_facecolor(_BG)
    series = [("Tensor Surface — amplitude |O|", amp, _ACC),
              ("Surface Jerk — instability", jerk, _RED),
              ("Asymmetry (left/right lean)", asym, _GOLD)]
    for ax, (t, y, c) in zip(axes, series):
        ax.set_facecolor(_BG)
        for s in ax.spines.values(): s.set_color(_GRID)
        ax.tick_params(colors=_FG, labelsize=7); ax.grid(True, color=_GRID, lw=0.4, alpha=0.5)
        ax.axhline(0, color=_FG, lw=0.7, alpha=0.5); ax.axvline(0, color=_FG, lw=0.7, alpha=0.4)
        ax.plot(chrono, y, color=c, marker="o", ms=4, lw=1.6)
        ax.set_title(t, color=_FG, fontsize=9); ax.set_xlabel("chronoT", color=_FG, fontsize=7)
    fig.suptitle(f"Book Tensor Surface — geometry: {st.get('geometry')}  direction: {st.get('direction')}  "
                 f"(peak migration {st.get('peak_migration')})", color=_FG, fontsize=10, y=1.03)
    p = out_prefix + "_tensor.png"; fig.tight_layout(); fig.savefig(p, facecolor=_BG, bbox_inches="tight")
    plt.close(fig)
    return [p]


def render_latent_paths(paths, out_prefix):
    """
    paths = {"Q":[...], "P":[...], "R":[...]} the three Euler-integrated SOP latent trajectories.
    The framework's own projected paths — the 'hidden path' is where the three INDEPENDENT
    trajectories converge. Plotted over the chronometer axis.
    """
    if not paths or not paths.get("Q"):
        return []
    n = len(paths["Q"])
    x = np.linspace(-1, 1, n)
    fig, ax = plt.subplots(figsize=(7.6, 3.4), dpi=120)
    fig.patch.set_facecolor(_BG); _style(ax)
    cols = {"Q": _ACC, "P": _GOLD, "R": _GREEN}
    names = {"Q": "Q · SOPG-latent", "P": "P · SOPc-latent", "R": "R · SOPC-latent"}
    for k in ("Q", "P", "R"):
        xs, ys = _smooth(x, np.array(paths[k], float))
        ax.plot(xs, ys, color=cols[k], lw=1.8, label=names[k])
        ax.scatter(x, paths[k], color=cols[k], s=9, zorder=5)
    # net-drift arrows / direction summary
    nets = {k: paths[k][-1] - paths[k][0] for k in ("Q", "P", "R")}
    ups = sum(1 for v in nets.values() if v > 0)
    verdict = "UP" if ups >= 2 else "DOWN"
    ax.set_title(f"Three latent paths (P/Q/R) — independent trajectories   "
                 f"[majority {verdict} {max(ups,3-ups)}/3]", color=_FG, fontsize=10)
    ax.set_xlabel("chronometer watch (−1 .. +1)", color=_FG, fontsize=8)
    ax.legend(facecolor=_BG, edgecolor=_GRID, labelcolor=_FG, fontsize=7, loc="best")
    p = out_prefix + "_latent.png"; fig.tight_layout(); fig.savefig(p, facecolor=_BG); plt.close(fig)
    return [p]


def render_pressure_gravity(pp, out_prefix):
    """
    pp = quan_pressure_path.pressure_path output. Spatial map by STRIKE:
    pressure ranges (where pressure accumulates) → gravitational points (where it releases to).
    """
    if not pp:
        return []
    anchor = pp.get("anchor")
    pr = pp.get("pressure_ranges", {})
    grav = pp.get("gravitational_points", {})
    fig, ax = plt.subplots(figsize=(8.0, 3.6), dpi=120)
    fig.patch.set_facecolor(_BG); _style(ax)
    # pressure ranges as upward bars (magnitude), by strike
    bands = [("intent_DID", _ACC, "intent |DID|"), ("transaction_DIT", _GOLD, "transaction |DIT|")]
    for col, c, lab in bands:
        pts = pr.get(col, [])
        if pts:
            xs = [s for s, _ in pts]; ys = [abs(v) for _, v in pts]
            ax.scatter(xs, ys, color=c, s=40, label=lab, zorder=4)
            for s, v in pts:
                ax.vlines(s, 0, abs(v), color=c, lw=1.0, alpha=0.5)
    # gravitational points as vertical lines (watermarks + gamma)
    ymax = ax.get_ylim()[1] or 1
    for s, T, sgn in grav.get("watermarks", [])[:6]:
        ax.axvline(s, color=_RED, lw=1.2, ls="--", alpha=0.6)
        ax.text(s, ymax*0.92, f"WM {int(s)}", color=_RED, fontsize=6.5, rotation=90, va="top")
    for s, g in grav.get("gamma_walls", [])[:3]:
        ax.axvline(s, color=_PURPLE, lw=1.4, ls=":", alpha=0.7)
    if anchor:
        ax.axvline(anchor, color=_WHITE, lw=1.0, alpha=0.7)
        ax.text(anchor, ymax*0.98, "anchor", color=_WHITE, fontsize=7, rotation=90, va="top")
    # constrain x to the strike band actually in play (anchor ± span), not 0..30000
    span_strikes = []
    for col, _, _ in bands:
        span_strikes += [s for s, _ in pr.get(col, [])]
    span_strikes += [s for s, _, _ in grav.get("watermarks", [])[:6]]
    span_strikes += [s for s, _ in grav.get("gamma_walls", [])[:3]]
    if anchor: span_strikes.append(anchor)
    if span_strikes:
        lo, hi = min(span_strikes), max(span_strikes)
        pad = max((hi - lo) * 0.08, 25)
        ax.set_xlim(lo - pad, hi + pad)
    path = pp.get("path") or {}
    ax.set_title(f"Pressure → gravity (by strike)   "
                 f"[{path.get('reading','')[:70]}]", color=_FG, fontsize=9)
    ax.set_xlabel("strike", color=_FG, fontsize=8); ax.set_ylabel("pressure |PG|", color=_FG, fontsize=8)
    ax.legend(facecolor=_BG, edgecolor=_GRID, labelcolor=_FG, fontsize=7, loc="upper left")
    p = out_prefix + "_pressure_gravity.png"; fig.tight_layout(); fig.savefig(p, facecolor=_BG); plt.close(fig)
    return [p]
