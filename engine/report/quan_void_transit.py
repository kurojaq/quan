#!/usr/bin/env python3
"""
quan_void_transit.py — #3, the one non-directional lead. Hypothesis: price moves MORE
(accelerates) when spot sits in a low-gamma void vs pinned at a heavy gamma wall.

void_score = 1 - (local |GEX| within +/-0.4% of anchor) / (total |GEX|)   [high = anchor in a gap]
outcome    = realized next-session range (high-low)/anchor   [magnitude, direction-agnostic]
test       = Spearman corr(void_score, range) + one-sided permutation p (shuffle ranges).
Magnitude test -> the bull-trend confound that sank the directional signals doesn't bite here.
"""
import sys, os, glob
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_engine import ingest_chain
import quan_greeks as GK
from quan_com_backtest import parse_footer_ts
from quan_dir_backtest import gather

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"
WBAND = 0.004   # +/-0.4% local band around anchor


def next_session(pdf, t0):
    t = pdf["time"].astype("int64").values
    idx = np.where((t > t0) & (t <= t0 + 86400))[0]
    if len(idx) == 0:
        return None
    o = float(pdf["open"].values[idx[0]]); c = float(pdf["close"].values[idx[-1]])
    h = float(pdf["high"].values[idx].max()); l = float(pdf["low"].values[idx].min())
    return o, h, l, c


def void_score(chain, anchor):
    fr = ingest_chain(chain)
    gf = GK.greeks_from_chain(fr, anchor, multiplier=20.0, T_days=1.0)
    g = GK.greeks_layer(fr, gf, anchor, multiplier=20.0)
    if not g or "strikes" not in g:
        return float("nan")
    K = np.array(g["strikes"], float); gx = np.abs(np.array(g["gex_perstrike"], float))
    tot = gx.sum()
    if tot <= 0:
        return float("nan")
    local = gx[(K >= anchor * (1 - WBAND)) & (K <= anchor * (1 + WBAND))].sum()
    return 1.0 - local / tot     # high => anchor sits in a gamma gap (void)


def spearman(x, y):
    rx = np.array(pd.Series(x).rank().values, float); ry = np.array(pd.Series(y).rank().values, float)
    rx = rx - rx.mean(); ry = ry - ry.mean()
    d = np.sqrt((rx ** 2).sum() * (ry ** 2).sum())
    return float((rx * ry).sum() / d) if d > 0 else float("nan")


def main():
    pdf = pd.read_csv(PRICE)
    vs, rng, mv, dates = [], [], [], []
    for d, f in gather().items():
        t0 = parse_footer_ts(f)
        ns = next_session(pdf, t0) if t0 else None
        if not ns:
            continue
        o, h, l, c = ns
        v = void_score(f, o)
        if v != v:
            continue
        vs.append(v); rng.append((h - l) / o); mv.append(abs(c - o) / o); dates.append(d)
    vs = np.array(vs); rng = np.array(rng); mv = np.array(mv)
    n = len(vs)

    corr_r = spearman(vs, rng); corr_m = spearman(vs, mv)
    rng_obs = corr_r
    rng_perm = np.array([spearman(vs, np.random.permutation(rng)) for _ in range(5000)])
    p_r = float((rng_perm >= rng_obs).mean())          # one-sided: void -> MORE range
    mv_perm = np.array([spearman(vs, np.random.permutation(mv)) for _ in range(5000)])
    p_m = float((mv_perm >= corr_m).mean())

    med = np.median(vs)
    void_half = rng[vs > med]; wall_half = rng[vs <= med]

    print("=" * 70)
    print(f"void-transit: does spot-in-a-gamma-void predict a bigger next-session move?  (n={n})")
    print(f"\n  Spearman corr(void_score, range): {corr_r:+.3f}   one-sided perm p = {p_r:.3f}")
    print(f"  Spearman corr(void_score, |move|): {corr_m:+.3f}   one-sided perm p = {p_m:.3f}")
    print(f"\n  median-split range:  VOID half {np.median(void_half):.4%}   WALL half {np.median(wall_half):.4%}"
          f"   (ratio {np.median(void_half)/np.median(wall_half):.2f}x)")
    verdict = ("beats the null (p<0.05) — void-transit holds on this sample" if p_r < 0.05
               else "does NOT beat the null on this sample")
    print(f"\n  verdict: {verdict}")
    # show the rows sorted by void score
    order = np.argsort(-vs)
    print("\n  session         void_score   range")
    for i in order:
        print(f"  {dates[i]}      {vs[i]:.3f}     {rng[i]:.3%}")


if __name__ == "__main__":
    main()
