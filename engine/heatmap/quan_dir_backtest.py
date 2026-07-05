#!/usr/bin/env python3
"""
quan_dir_backtest.py — DIRECTIONAL ledger (#1): G vs pressure-gravity, scored against
realized next-session direction. Seeds the forward ledger with the 20 April/May sessions,
labeled IN-SAMPLE (G was partly built on this stretch — baseline, not evidence). Forward
sessions (6/4+) append as BLIND rows via the same compute, and those are the real test.

Candidates (pre-registered, frozen — no shopping):
  G   = wall-geometry vote (BIAS_VOTE: dominant Γ-wall vs spot), BULL/BEAR
  PG  = pressure-gravity vote = side of spot holding the heaviest brick
        (max |AO|, AO = (putPrem-callPrem)*(putLatest-callLatest), Book-verified mass)

Scoring: hit = vote sign matches sign(next-session close - open). |move|<0.1% = PUSH (no call).
Reported overall AND gate-filtered (gate GO only = regime COHERENT_DIRECTIONAL).
"""
import sys, os, re, glob, csv, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_engine import ingest_chain
import quan_pine_export as PX
from quan_com_backtest import parse_footer_ts

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"
BLIND_CUTOFF = "2026-06-04"   # sessions on/after this are the blind forward test
FLAT = 0.001                  # |move| below this fraction = PUSH


def snap_date(fn):
    m = re.search(r"(\d{8})(?:_\d+)?\.csv$", fn)
    return f"{m.group(1)[4:8]}-{m.group(1)[0:2]}-{m.group(1)[2:4]}" if m else None


def gather():
    files = glob.glob("/mnt/project/*options*idebyside*.csv")
    bad = ("znm26", "50strikes", "volatilitygreeks", "near-the-money", "stacked")
    cand = {}
    for f in files:
        b = os.path.basename(f).lower()
        if any(x in b for x in bad):
            continue
        d = snap_date(b)
        if not d:
            continue
        sc = ("intraday" in b) * 2 + ("showall" in b) - ("_1." in b)
        if d not in cand or sc > cand[d][0]:
            cand[d] = (sc, f)
    return {d: v[1] for d, v in sorted(cand.items())}


def next_open_close(pdf, t0):
    t = pdf["time"].astype("int64").values
    idx = np.where((t > t0) & (t <= t0 + 86400))[0]
    if len(idx) == 0:
        return None
    return float(pdf["open"].values[idx[0]]), float(pdf["close"].values[idx[-1]])


def pg_vote(chain, anchor):
    """Heaviest-brick side. AO = (pP-cP)*(pLt-cLt); max|AO| within +/-5% of spot."""
    fr = ingest_chain(chain)
    cP = fr.callPrem.fillna(0); pP = fr.putPrem.fillna(0)
    cLt = fr.callLatest.fillna(0); pLt = fr.putLatest.fillna(0)
    AO = (pP - cP) * (pLt - cLt)
    band = (fr.strike >= anchor * 0.95) & (fr.strike <= anchor * 1.05)
    sub = AO[band].abs()
    if sub.sum() == 0 or len(sub) == 0:
        return "", float("nan"), float("nan")
    hb = fr.strike[sub.idxmax()]
    return ("BULL" if hb > anchor else "BEAR"), float(hb), float(sub.max())


def main():
    pdf = pd.read_csv(PRICE)
    rows = []
    for d, f in gather().items():
        t0 = parse_footer_ts(f)
        if not t0:
            continue
        oc = next_open_close(pdf, t0)
        if not oc:
            continue
        anchor, close = oc
        try:
            payload = PX.export_snapshot(f, anchor)
            pd_ = dict(kv.split("=", 1) for kv in payload.split("|") if "=" in kv)
        except Exception:
            pd_ = {}
        gvote = pd_.get("BIAS_VOTE", "")
        regime = pd_.get("REGIME", "")
        pgv, hb, hbmass = pg_vote(f, anchor)
        move = close - anchor
        realized = "PUSH" if abs(move) / anchor < FLAT else ("BULL" if move > 0 else "BEAR")
        gate = "GO" if "COHERENT_DIRECTIONAL" in regime else "STAND"
        sample = "BLIND" if d >= BLIND_CUTOFF else "in-sample"
        row = {"date": d, "sample": sample, "anchor": round(anchor, 1), "close": round(close, 1),
               "move": round(move, 1), "realized": realized, "gate": gate, "regime": regime,
               "G_vote": gvote, "PG_vote": pgv, "PG_brick": round(hb, 0) if hb == hb else "",
               "G_hit": "" if realized == "PUSH" else int(gvote == realized),
               "PG_hit": "" if realized == "PUSH" else int(pgv == realized),
               "agree": int(gvote == pgv) if (gvote and pgv) else ""}
        rows.append(row)

    out = "/mnt/user-data/outputs/quan_dir_ledger.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

    def rate(subset, key):
        hits = [r[key] for r in subset if r[key] in (0, 1)]
        return (sum(hits), len(hits), sum(hits) / len(hits)) if hits else (0, 0, float("nan"))

    def show(subset, label):
        gh = rate(subset, "G_hit"); ph = rate(subset, "PG_hit")
        gg = f"{gh[0]}/{gh[1]} = {gh[2]:.0%}" if gh[1] else "—"
        pp = f"{ph[0]}/{ph[1]} = {ph[2]:.0%}" if ph[1] else "—"
        print(f"  {label:28s}  G {gg:>14}   PG {pp:>14}")

    insample = [r for r in rows if r["sample"] == "in-sample"]
    blind = [r for r in rows if r["sample"] == "BLIND"]
    go = [r for r in insample if r["gate"] == "GO"]
    print("=" * 72)
    print(f"seeded {len(rows)} rows  ({len(insample)} in-sample, {len(blind)} blind)\n")
    print("directional hit rates (PUSH = near-flat days excluded):")
    show(insample, "IN-SAMPLE (all)")
    show(go, "  in-sample, gate=GO only")
    show([r for r in insample if r["gate"] == "STAND"], "  in-sample, gate=STAND only")
    if blind:
        show(blind, "BLIND (forward)")
    ag = [r for r in insample if r["agree"] in (0, 1)]
    agree_n = sum(r["agree"] for r in ag)
    print(f"\nG vs PG agreement (in-sample): {agree_n}/{len(ag)} = {agree_n/len(ag):.0%}" if ag else "")
    # on disagreements, who's right?
    dis = [r for r in insample if r["agree"] == 0 and r["realized"] != "PUSH"]
    if dis:
        gw = sum(r["G_hit"] for r in dis if r["G_hit"] in (0, 1))
        pw = sum(r["PG_hit"] for r in dis if r["PG_hit"] in (0, 1))
        print(f"on {len(dis)} disagreements: G right {gw}, PG right {pw}")
    print(f"\ngate distribution: " +
          ", ".join(f"{k}={v}" for k, v in
                    pd.Series([r['gate'] for r in rows]).value_counts().items()))
    print(f"wrote -> {out}")


if __name__ == "__main__":
    main()
