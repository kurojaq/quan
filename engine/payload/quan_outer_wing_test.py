#!/usr/bin/env python3
"""
quan_outer_wing_test.py — partner's outer-area (far-OTM) puts-calls theory, all three readings,
ledgered. OUTER = strikes 2.5%-10% from anchor (the wings; near band already tested separately).
NetOI = putOI - callOI.

  L  level     : dominant |NetOI| outer strike as a magnet — does next session touch it,
                 vs the SAME-distance strike on the opposite side (distance-controlled null)?
  D1 direction : sign of summed outer NetOI (puts-dominant=BULL) vs realized, vs base rate.
  D2 direction : dominant outer strike side (heavy wing above=BULL) vs realized.
  C  cascade-on-outer : CDS sign-vote computed over ONLY the outer strikes (the input-swap) vs realized;
                 also reports outer-DITS sign (is the permabull pin still there in the wings?).
"""
import sys, csv
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_engine import ingest_chain, excel_skew
from quan_com_backtest import parse_footer_ts
from quan_dir_backtest import gather, FLAT

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"
LO, HI = 0.025, 0.10


def next_session(pdf, t0):
    a = pdf["time"].astype("int64").values
    idx = np.where((a > t0) & (a <= t0 + 86400))[0]
    if len(idx) < 5:
        return None
    o = float(pdf["open"].values[idx[0]]); c = float(pdf["close"].values[idx[-1]])
    h = float(pdf["high"].values[idx].max()); l = float(pdf["low"].values[idx].min())
    return o, h, l, c


def touched(level, anchor, hi, lo):
    return (hi >= level) if level > anchor else (lo <= level)


def main():
    pdf = pd.read_csv(PRICE)
    rows = []
    for d, f in gather().items():
        t0 = parse_footer_ts(f)
        ns = next_session(pdf, t0) if t0 else None
        if not ns:
            continue
        o, h, l, c = ns
        fr = ingest_chain(f)
        K = fr["strike"].astype(float).to_numpy()
        net = (fr["putOI"].fillna(0) - fr["callOI"].fillna(0)).to_numpy(float)
        dist = np.abs(K - o) / o
        om = (dist > LO) & (dist <= HI)
        if om.sum() < 4:
            continue
        Ko, neto = K[om], net[om]
        # L: dominant outer strike + matched-opposite control
        i = int(np.argmax(np.abs(neto))); Kd = Ko[i]
        Km = 2 * o - Kd
        jm = int(np.argmin(np.abs(K - Km))); Kmm = K[jm]
        td = int(touched(Kd, o, h, l)); to = int(touched(Kmm, o, h, l))
        # D1: summed outer NetOI sign
        s = neto.sum(); d1 = "BULL" if s > 0 else "BEAR"
        # D2: dominant outer side
        d2 = "BULL" if Kd > o else "BEAR"
        # C: cascade over outer strikes only
        sub = fr[om].copy()
        AN = sub["putPrem"].fillna(0) - sub["callPrem"].fillna(0)
        O = sub["putOI"].fillna(0) - sub["callOI"].fillna(0)
        L_ = sub["putVol"].fillna(0) - sub["callVol"].fillna(0)
        AP = AN / O.replace(0, np.nan); AR = AN / L_.replace(0, np.nan); AT = AP / AR.replace(0, np.nan)
        dids, dits, dr3s = excel_skew(AP), excel_skew(AR), excel_skew(AT)
        cds = ((1 if dids < 0 else -1) + (1 if dits < 0 else -1) + (1 if dr3s > 0 else -1)) / 3.0
        cvote = "BULL" if cds > 0 else ("BEAR" if cds < 0 else "PUSH")
        realized = "PUSH" if abs(c - o) / o < FLAT else ("BULL" if c > o else "BEAR")
        rows.append(dict(date=d, anchor=round(o, 1), Kdom=round(Kd, 0), dom_side=d2,
                         touch_dom=td, touch_opp=to, D1=d1, D2=d2, Cvote=cvote,
                         dits_outer=round(dits, 2), realized=realized))

    out = "/mnt/user-data/outputs/quan_outer_wing.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

    from collections import Counter
    n = len(rows)

    def dir_score(key, label):
        pr = [(r[key], r["realized"]) for r in rows if r["realized"] in ("BULL", "BEAR") and r[key] in ("BULL", "BEAR")]
        hit = sum(1 for v, rr in pr if v == rr); m = len(pr)
        up = sum(1 for _, rr in pr if rr == "BULL"); base = max(up, m - up) / m
        print(f"  {label:26s} {hit}/{m} = {hit/m:>4.0%}   base {base:>4.0%}   edge {hit/m-base:+.0%}   votes {dict(Counter(v for v,_ in pr))}")

    print("=" * 72)
    print(f"OUTER-WING (2.5-10% OTM) puts-calls — all three readings  (n={n})\n")
    print(" L  level (magnet):")
    td_rate = np.mean([r["touch_dom"] for r in rows]); to_rate = np.mean([r["touch_opp"] for r in rows])
    print(f"    dominant outer strike touched: {td_rate:.0%}   |   same-distance opposite strike: {to_rate:.0%}")
    print(f"    -> {'magnet edge' if td_rate-to_rate>0.10 else 'no magnet edge (heavy wing touched ~ as often as the matched control)'}")
    print("\n D  direction:")
    dir_score("D1", "D1 summed-outer-NetOI"); dir_score("D2", "D2 dominant-wing-side")
    print("\n C  cascade-on-outer (input swap):")
    dir_score("Cvote", "C  CDS over outer only")
    dneg = sum(1 for r in rows if r["dits_outer"] < 0)
    print(f"    outer-DITS negative: {dneg}/{n}  -> {'still permabull-pinned in the wings' if dneg in (0,n) else 'two-sided in the wings'}")
    print(f"\nwrote -> {out}")


if __name__ == "__main__":
    main()
