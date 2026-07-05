#!/usr/bin/env python3
"""
quan_g_reconcile.py — why did G come back 53% here vs ~78% before? Score G's directional
vote under several defensible bases on the same sessions, each against its OWN base rate
(the naive "always vote the majority side" hit rate). If G beats base rate under some basis,
that's where its edge lives; if it matches base rate everywhere, the 78% was in-sample/curated.

Bases:
  A  vote@next-open   -> next-session close vs open      (intraday of next session)
  B1 vote@EOD-snap    -> +1d EOD close vs EOD            (close-to-close, incl. overnight)
  B2 vote@EOD-snap    -> +2d EOD
  B3 vote@EOD-snap    -> +3d EOD
"""
import sys, os, glob, csv
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
import quan_pine_export as PX
from quan_com_backtest import parse_footer_ts
from quan_dir_backtest import gather, FLAT

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"


def bar_at(pdf, t_target, field):
    t = pdf["time"].astype("int64").values
    i = int(np.argmin(np.abs(t - t_target)))
    return float(pdf[field].values[i]), int(t[i])


def next_session(pdf, t0):
    t = pdf["time"].astype("int64").values
    idx = np.where((t > t0) & (t <= t0 + 86400))[0]
    if len(idx) == 0:
        return None
    return float(pdf["open"].values[idx[0]]), float(pdf["close"].values[idx[-1]])


def gvote(chain, anchor):
    try:
        pl = dict(kv.split("=", 1) for kv in PX.export_snapshot(chain, anchor).split("|") if "=" in kv)
        return pl.get("BIAS_VOTE", "")
    except Exception:
        return ""


def main():
    pdf = pd.read_csv(PRICE)
    rows = []
    for d, f in gather().items():
        t0 = parse_footer_ts(f)
        if not t0:
            continue
        eod, _ = bar_at(pdf, t0, "close")
        ns = next_session(pdf, t0)
        c1, _ = bar_at(pdf, t0 + 86400, "close")
        c2, _ = bar_at(pdf, t0 + 2 * 86400, "close")
        c3, _ = bar_at(pdf, t0 + 3 * 86400, "close")
        v_eod = gvote(f, eod)
        v_open = gvote(f, ns[0]) if ns else ""
        row = {"date": d, "eod": round(eod, 1), "G@eod": v_eod, "G@open": v_open}
        # realized signs
        def sgn(a, b):
            return "PUSH" if abs(b - a) / a < FLAT else ("BULL" if b > a else "BEAR")
        rA = sgn(ns[0], ns[1]) if ns else "PUSH"
        r1, r2, r3 = sgn(eod, c1), sgn(eod, c2), sgn(eod, c3)
        row.update(rA=rA, r1=r1, r2=r2, r3=r3,
                   A="" if rA == "PUSH" else int(v_open == rA),
                   B1="" if r1 == "PUSH" else int(v_eod == r1),
                   B2="" if r2 == "PUSH" else int(v_eod == r2),
                   B3="" if r3 == "PUSH" else int(v_eod == r3))
        rows.append(row)

    out = "/mnt/user-data/outputs/quan_g_reconcile.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

    def report(hitkey, realkey, label):
        hits = [r[hitkey] for r in rows if r[hitkey] in (0, 1)]
        reals = [r[realkey] for r in rows if r[realkey] in ("BULL", "BEAR")]
        if not hits:
            print(f"  {label:34s} —"); return
        n = len(hits); hr = sum(hits) / n
        up = sum(1 for x in reals if x == "BULL"); base = max(up, len(reals) - up) / len(reals)
        edge = hr - base
        print(f"  {label:34s} G {sum(hits)}/{n} = {hr:>4.0%}   base(majority) {base:>4.0%}   edge {edge:+.0%}")

    print("=" * 74)
    print("G hit rate by scoring basis, vs the naive majority-vote base rate on that basis:")
    report("A", "rA", "A  next-open -> next-close")
    report("B1", "r1", "B1 EOD -> +1d close")
    report("B2", "r2", "B2 EOD -> +2d close")
    report("B3", "r3", "B3 EOD -> +3d close")
    # vote direction split + how often eod/open votes differ
    from collections import Counter
    print(f"\nG vote split @eod: {dict(Counter(r['G@eod'] for r in rows))}")
    flips = sum(1 for r in rows if r["G@eod"] and r["G@open"] and r["G@eod"] != r["G@open"])
    print(f"vote changed between EOD-anchor and next-open-anchor: {flips}/{len(rows)} sessions")
    print(f"\nwrote -> {out}")


if __name__ == "__main__":
    main()
