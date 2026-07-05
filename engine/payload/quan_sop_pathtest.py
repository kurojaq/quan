#!/usr/bin/env python3
"""
quan_sop_pathtest.py — does the SOP fold (SOPG*SOPC) shape describe the session's realized
price PATH better than chance? The SOP curve lives on a 21-pt strike-space axis (per-strike
pressure fold, no ATM centering). The framework implicitly claims that shape templates how the
NEXT session unfolds in time. Test that claim directly and defeat the post-hoc-curve trap:

  For each session i: corr( SOP_i , realized_path_i )  = same-session shape match.
  Null: corr( SOP_i , realized_path_j ) for j != i      = cross-session match.
  If the SOP shape genuinely templates THE session, same-session |corr| beats cross-session.
  If smooth curves just resemble any path, same ~ cross. Orientation-free (|corr|), + permutation p.
"""
import sys, csv
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_engine import ingest_chain
import quan_realization as R
from quan_com_backtest import parse_footer_ts
from quan_dir_backtest import gather

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"


def sop_curve(chain, anchor):
    fr = ingest_chain(chain)
    rw = R.realization_waves(fr, anchor)
    if rw is None:
        return None
    g = np.asarray(rw["sopG"], float); c = np.asarray(rw["sopC"], float)
    J = g * c
    J = np.nan_to_num(J, nan=0.0)
    return J if np.std(J) > 0 else None


def session_path(pdf, t0, n):
    a = pdf["time"].astype("int64").values
    idx = np.where((a > t0) & (a <= t0 + 86400))[0]
    if len(idx) < 5:
        return None
    cl = pdf["close"].values[idx].astype(float)
    # resample to n points over the session
    xs = np.linspace(0, 1, len(cl)); xt = np.linspace(0, 1, n)
    p = np.interp(xt, xs, cl)
    return p if np.std(p) > 0 else None


def acorr(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return abs(float((a * b).sum() / d)) if d > 0 else 0.0


def main():
    pdf = pd.read_csv(PRICE)
    sops, paths, dates = [], [], []
    for d, f in gather().items():
        t0 = parse_footer_ts(f)
        if not t0:
            continue
        J = sop_curve(f, 0.0)
        if J is None:
            continue
        p = session_path(pdf, t0, len(J))
        if p is None:
            continue
        sops.append(J); paths.append(p); dates.append(d)
    n = len(sops)

    same = np.array([acorr(sops[i], paths[i]) for i in range(n)])
    cross = np.array([acorr(sops[i], paths[j]) for i in range(n) for j in range(n) if i != j])

    obs = same.mean()
    rng = np.random.default_rng(0)
    perm = []
    for _ in range(5000):
        perm.append(np.mean([acorr(sops[i], paths[rng.integers(n)]) for i in range(n)]))
    perm = np.array(perm)
    p_val = float((perm >= obs).mean())

    out = "/mnt/user-data/outputs/quan_sop_pathtest.csv"
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["date", "same_session_abs_corr"])
        for d, s in zip(dates, same):
            w.writerow([d, round(float(s), 3)])

    print("=" * 70)
    print(f"SOP fold shape vs session price-path — same-session vs null  (n={n})\n")
    print(f"  mean SAME-session |corr|:  {same.mean():.3f}")
    print(f"  mean CROSS-session |corr|: {cross.mean():.3f}  (the null — any curve vs any path)")
    print(f"  permutation p (same beats random pairing): {p_val:.3f}")
    verdict = ("SAME beats null (p<0.05) — SOP shape templates the session" if p_val < 0.05
               else "SAME does NOT beat null — the shape match is what any smooth curve gives")
    print(f"\n  verdict: {verdict}")
    print(f"\n  per-session same |corr|: {', '.join(f'{d}:{s:.2f}' for d, s in zip(dates, same))}")
    print(f"\nwrote -> {out}")


if __name__ == "__main__":
    main()
