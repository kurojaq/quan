#!/usr/bin/env python3
"""
quan_netoi_vote.py — test the directional construct the framework DEFINES but G never uses:
NetOI = PutOI - CallOI structural tiers (Coefficient_Reference: floorStrong +150 = attractor/floor,
ceilingStrong -150 = repulsor/ceiling). This is the real 'put minus call' object.

Pre-registered votes (stated before scoring):
  V1 NetOI-dominant : dominant |NetOI| strike near spot -> BULL if NetOI>0 (attractor/floor),
                      BEAR if NetOI<0 (repulsor/ceiling).
  V2 tier (>=150)   : same, restricted to strikes with |NetOI|>=150 (ATT-X / REP-X). fallback V1.
  V3 net-balance    : sign of sum(NetOI) near spot (overall put vs call OI dominance).
Scored basis A (next-open -> next-close) and B1 (EOD -> +1d), vs majority-vote base rate.
"""
import sys, csv
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_engine import ingest_chain
from quan_com_backtest import parse_footer_ts
from quan_dir_backtest import gather, FLAT

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"
BAND = 0.025   # +/-2.5% near-spot structural neighborhood


def bar_close_at(pdf, t):
    a = pdf["time"].astype("int64").values
    return float(pdf["close"].values[int(np.argmin(np.abs(a - t)))])


def next_session(pdf, t0):
    a = pdf["time"].astype("int64").values
    idx = np.where((a > t0) & (a <= t0 + 86400))[0]
    if len(idx) == 0:
        return None
    return float(pdf["open"].values[idx[0]]), float(pdf["close"].values[idx[-1]])


def netoi_votes(chain, anchor):
    fr = ingest_chain(chain)
    K = fr["strike"].astype(float).to_numpy()
    net = (fr["putOI"].fillna(0) - fr["callOI"].fillna(0)).to_numpy(float)
    m = (K >= anchor * (1 - BAND)) & (K <= anchor * (1 + BAND))
    K, net = K[m], net[m]
    if len(K) == 0:
        return None
    i = int(np.argmax(np.abs(net)))
    v1 = "BULL" if net[i] > 0 else ("BEAR" if net[i] < 0 else "NEUTRAL")
    tier = np.abs(net) >= 150
    if tier.any():
        Kt, nt = K[tier], net[tier]
        j = int(np.argmax(np.abs(nt)))
        v2 = "BULL" if nt[j] > 0 else "BEAR"
    else:
        v2 = v1
    s = net.sum()
    v3 = "BULL" if s > 0 else ("BEAR" if s < 0 else "NEUTRAL")
    return v1, v2, v3


def main():
    pdf = pd.read_csv(PRICE)
    rows = []
    for d, f in gather().items():
        t0 = parse_footer_ts(f)
        ns = next_session(pdf, t0) if t0 else None
        if not ns:
            continue
        o, c = ns
        vt = netoi_votes(f, o)
        if not vt:
            continue
        v1, v2, v3 = vt
        eod = bar_close_at(pdf, t0); c1 = bar_close_at(pdf, t0 + 86400)
        rA = "PUSH" if abs(c - o) / o < FLAT else ("BULL" if c > o else "BEAR")
        r1 = "PUSH" if abs(c1 - eod) / eod < FLAT else ("BULL" if c1 > eod else "BEAR")
        rows.append(dict(date=d, V1=v1, V2=v2, V3=v3, rA=rA, r1=r1))

    out = "/mnt/user-data/outputs/quan_netoi_vote.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

    from collections import Counter

    def score(votekey, realkey, label):
        pairs = [(r[votekey], r[realkey]) for r in rows if r[realkey] in ("BULL", "BEAR") and r[votekey] in ("BULL", "BEAR")]
        if not pairs:
            print(f"  {label:24s} —"); return
        hit = sum(1 for v, rr in pairs if v == rr); n = len(pairs)
        reals = [rr for _, rr in pairs]; up = reals.count("BULL")
        base = max(up, n - up) / n
        split = dict(Counter(v for v, _ in pairs))
        print(f"  {label:24s} {hit}/{n} = {hit/n:>4.0%}   base {base:>4.0%}   edge {hit/n-base:+.0%}   votes {split}")

    print("=" * 72)
    print("NetOI structural vote (PutOI - CallOI attractor/repulsor), vs base rate:\n")
    print(" basis A — next-open -> next-close:")
    score("V1", "rA", "V1 NetOI-dominant"); score("V2", "rA", "V2 tier >=150"); score("V3", "rA", "V3 net-balance")
    print("\n basis B1 — EOD -> +1d close:")
    score("V1", "r1", "V1 NetOI-dominant"); score("V2", "r1", "V2 tier >=150"); score("V3", "r1", "V3 net-balance")
    print(f"\nwrote -> {out}")


if __name__ == "__main__":
    main()
