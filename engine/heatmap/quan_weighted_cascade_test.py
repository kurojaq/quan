#!/usr/bin/env python3
"""
quan_weighted_cascade_test.py — EXPERIMENT (does NOT touch verified CDS).

Idea (Spence): factor each strike's pressure/gravity mass into the cascade BEFORE the skews.
The verified cascade skews AP/AR/AT weighting every strike equally. This variant weights each
strike by |AO| = |(putPrem-callPrem)*(putLatest-callLatest)| (the Book-verified brick mass), so
heavy bricks dominate the skew, then applies the SAME CDS sign rules.

Verdicts that matter:
  (1) PERMABULL CHECK: raw DITS is structurally negative every session (NQ baseline). Does
      mass-weighting make weighted-DITS two-sided?
  (2) HEAD-TO-HEAD: does the weighted-cascade vote beat PG alone — or just match it (= re-deriving
      the geometric signal through a longer pipe)?
"""
import sys, os, csv
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_engine import ingest_chain, excel_skew
import quan_pine_export as PX
from quan_com_backtest import parse_footer_ts
from quan_dir_backtest import gather, next_open_close, pg_vote, FLAT

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"


def wskew(x, w):
    x = np.asarray(x, float); w = np.asarray(w, float)
    m = np.isfinite(x) & np.isfinite(w) & (w > 0)
    x, w = x[m], w[m]
    if len(x) < 3 or w.sum() == 0:
        return float("nan")
    mu = np.sum(w * x) / np.sum(w)
    var = np.sum(w * (x - mu) ** 2) / np.sum(w)
    if var <= 0:
        return float("nan")
    return (np.sum(w * (x - mu) ** 3) / np.sum(w)) / var ** 1.5


def weighted_cascade(fr):
    AN = fr["putPrem"].fillna(0) - fr["callPrem"].fillna(0)
    O = fr["putOI"].fillna(0) - fr["callOI"].fillna(0)
    L = fr["putVol"].fillna(0) - fr["callVol"].fillna(0)
    AP = AN / O.replace(0, np.nan)
    AR = AN / L.replace(0, np.nan)
    AT = AP / AR.replace(0, np.nan)
    Klat = fr["putLatest"].fillna(0) - fr["callLatest"].fillna(0)
    w = (AN * Klat).abs()                                   # |AO| brick mass
    DIDS_w, DITS_w, DR3S_w = wskew(AP, w), wskew(AR, w), wskew(AT, w)
    cds_w = ((1 if DIDS_w < 0 else -1) + (1 if DITS_w < 0 else -1) + (1 if DR3S_w > 0 else -1)) / 3.0
    return dict(cds_w=cds_w, DIDS_w=DIDS_w, DITS_w=DITS_w, DR3S_w=DR3S_w,
                DITS_raw=excel_skew(AR), DIDS_raw=excel_skew(AP))


def main():
    pdf = pd.read_csv(PRICE)
    rows = []
    for d, f in gather().items():
        t0 = parse_footer_ts(f)
        oc = next_open_close(pdf, t0) if t0 else None
        if not oc:
            continue
        anchor, close = oc
        fr = ingest_chain(f)
        wc = weighted_cascade(fr)
        pgv, _, _ = pg_vote(f, anchor)
        try:
            pl = dict(kv.split("=", 1) for kv in PX.export_snapshot(f, anchor).split("|") if "=" in kv)
            gvote = pl.get("BIAS_VOTE", "")
        except Exception:
            gvote = ""
        move = close - anchor
        realized = "PUSH" if abs(move) / anchor < FLAT else ("BULL" if move > 0 else "BEAR")
        cwv = "BULL" if wc["cds_w"] > 0 else ("BEAR" if wc["cds_w"] < 0 else "PUSH")
        rows.append(dict(date=d, anchor=round(anchor, 1), realized=realized,
                         cds_w=wc["cds_w"], DITS_w=round(wc["DITS_w"], 3), DITS_raw=round(wc["DITS_raw"], 3),
                         CW_vote=cwv, PG_vote=pgv, G_vote=gvote,
                         CW_hit="" if realized == "PUSH" else int(cwv == realized),
                         PG_hit="" if realized == "PUSH" else int(pgv == realized),
                         G_hit="" if realized == "PUSH" else int(gvote == realized)))

    out = "/mnt/user-data/outputs/quan_weighted_cascade.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

    def rate(key):
        h = [r[key] for r in rows if r[key] in (0, 1)]
        return f"{sum(h)}/{len(h)} = {sum(h)/len(h):.0%}" if h else "—"

    print("=" * 70)
    print("(1) PERMABULL CHECK — does mass-weighting make DITS two-sided?")
    rawneg = sum(1 for r in rows if r["DITS_raw"] < 0); n = len(rows)
    wneg = sum(1 for r in rows if r["DITS_w"] < 0)
    print(f"    raw  DITS negative: {rawneg}/{n}  (the permabull baseline)")
    print(f"    wtd  DITS negative: {wneg}/{n}  -> {'STILL one-sided' if wneg in (0,n) else 'now TWO-SIDED'}")
    cwvotes = pd.Series([r["CW_vote"] for r in rows]).value_counts().to_dict()
    print(f"    weighted-cascade vote split: {cwvotes}")
    print("\n(2) HEAD-TO-HEAD hit rates (PUSH excluded):")
    print(f"    weighted-cascade : {rate('CW_hit')}")
    print(f"    pressure-gravity : {rate('PG_hit')}")
    print(f"    G (wall-geom)    : {rate('G_hit')}")
    # does CW add anything beyond PG? agreement + who's right on disagreements
    both = [r for r in rows if r["CW_vote"] and r["PG_vote"]]
    agree = sum(1 for r in both if r["CW_vote"] == r["PG_vote"])
    print(f"\n    CW vs PG agreement: {agree}/{len(both)} = {agree/len(both):.0%}")
    dis = [r for r in both if r["CW_vote"] != r["PG_vote"] and r["realized"] != "PUSH"]
    if dis:
        cw_r = sum(r["CW_hit"] for r in dis if r["CW_hit"] in (0, 1))
        pg_r = sum(r["PG_hit"] for r in dis if r["PG_hit"] in (0, 1))
        print(f"    on {len(dis)} disagreements: CW right {cw_r}, PG right {pg_r}")
    else:
        print("    CW and PG never disagree -> CW is re-deriving PG, adds nothing")
    print(f"\nwrote -> {out}")


if __name__ == "__main__":
    main()
