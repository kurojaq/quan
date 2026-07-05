#!/usr/bin/env python3
"""
quan_com_batch.py — run the six-center-of-mass forward backtest across all chains.
Anchor = actual NQ bar close at the chain's footer timestamp. Horizons +1/2/3d.
gapclosed degenerate-flagged when |pin-anchor| < 0.1% of price. April=reference
(formulas tuned there), May=primary out-of-sample.
"""
import sys, os, re, glob, csv, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_com_backtest import parse_footer_ts, score_forward, CANDIDATES
from quan_log_session import compute_candidates

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"
DEGEN_FRAC = 0.001  # |pin-anchor| below this fraction of price -> gapclosed degenerate


def snap_date(fn):
    m = re.search(r"(\d{8})(?:_\d+)?\.csv$", fn)
    if not m:
        return None
    s = m.group(1)
    return f"{s[4:8]}-{s[0:2]}-{s[2:4]}"  # MMDDYYYY -> YYYY-MM-DD


def gather_chains():
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
        score = (("intraday" in b) * 2) + (("showall" in b) * 1) - (("_1." in b) * 1)
        if d not in cand or score > cand[d][0]:
            cand[d] = (score, f)
    return {d: v[1] for d, v in sorted(cand.items())}


def main():
    pdf = pd.read_csv(PRICE)
    chains = gather_chains()
    print(f"selected {len(chains)} sessions:")
    rows = []
    for d, f in chains.items():
        t0 = parse_footer_ts(f)
        if not t0:
            print(f"  {d}  SKIP (no footer ts)"); continue
        t = pdf["time"].astype("int64").values
        i0 = int(np.argmin(np.abs(t - t0)))
        anchor = float(pdf["close"].values[i0])
        cands, total_mass, read = compute_candidates(f, anchor, 1.0)
        pins = {c: cands[c][0] for c in CANDIDATES}
        res = score_forward(pdf, t0, anchor, pins)
        period = "APR(ref)" if d < "2026-05-01" else ("MAY(primary)" if d < "2026-06-01" else "JUN")
        row = {"date": d, "period": period, "anchor": round(anchor, 1),
               "bias": read["bias"], "cds": read["cds"]}
        for c in CANDIDATES:
            pin = pins[c]
            row[f"pin_{c}"] = round(pin, 1) if pin == pin else ""
            row[f"D_{c}"] = round(pin - anchor, 1) if pin == pin else ""
            degen = (pin == pin) and abs(pin - anchor) < DEGEN_FRAC * anchor
            for nd in (1, 2, 3):
                gk = f"gc_{c}_{nd}d"; tk = f"tch_{c}_{nd}d"
                row[f"gapclosed_{c}_{nd}d"] = ("" if degen else round(res.get(gk, float("nan")), 3)) if gk in res else ""
                row[f"touched_{c}_{nd}d"] = res.get(tk, "") if tk in res else ""
        rows.append(row)
        print(f"  {d} {period:12s} anchor={anchor:>8.1f}  pins=" +
              " ".join(f"{c[:4]}:{pins[c]:.0f}" if pins[c]==pins[c] else f"{c[:4]}:na" for c in CANDIDATES))

    out = "/mnt/user-data/outputs/quan_com_backtest_results.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

    # ---- summary tallies per candidate per horizon, split by period ----
    def fnum(x):
        try: return float(x)
        except: return float("nan")
    print("\n" + "=" * 78)
    for period in ("MAY(primary)", "APR(ref)"):
        prs = [r for r in rows if r["period"] == period]
        if not prs: continue
        print(f"\n### {period}   (n={len(prs)} sessions)")
        print(f"{'cand':10s} {'horizon':7s} {'n':>3} {'meanGap(wins.)':>14} {'pull>0':>7} {'touch':>6}")
        for c in CANDIDATES:
            for nd in (1, 2, 3):
                gcs = [fnum(r.get(f"gapclosed_{c}_{nd}d","")) for r in prs]
                gcs = [g for g in gcs if g == g]
                tch = [r.get(f"touched_{c}_{nd}d","") for r in prs if r.get(f"touched_{c}_{nd}d","") in (0,1,"0","1")]
                if not gcs:
                    print(f"{c:10s} +{nd}d     {'-':>3} {'(degenerate)':>14}"); continue
                wins = [max(-3, min(3, g)) for g in gcs]   # winsorize for the mean
                mg = float(np.mean(wins))
                pull = sum(1 for g in gcs if g > 0)/len(gcs)
                tr = (sum(1 for x in tch if str(x)=="1")/len(tch)) if tch else float("nan")
                trs = "-" if tr!=tr else f"{tr:.0%}"
                print(f"{c:10s} +{nd}d     {len(gcs):>3} {mg:>14.3f} {pull:>6.0%} {trs:>6}")
    print(f"\nwrote per-session detail -> {out}")


if __name__ == "__main__":
    main()
