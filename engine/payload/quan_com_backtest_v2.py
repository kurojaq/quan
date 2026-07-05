#!/usr/bin/env python3
"""
quan_com_backtest_v2.py — the FAIR, CONDITIONED capture test (#2).

Fixes over the quick run:
  - zerogamma: proper zero-GEX-by-spot (net dealer gamma crosses zero, scanning low->high),
    not the tautological dominance-flip-nearest-anchor.
  - comoi: near-ATM-windowed OI centroid (+/-2.5% of anchor), so deep-OTM put OI can't drag it.
  - anchor = the NEXT session's OPEN; score that session's move (open->close, high/low) — the
    locked anchor-at-open framing.
  - regime conditioned on TRAILING directionality (prior session), known before the scored
    window — NOT the scored window's own move (that would be circular).
  - mass-scaling control: do high gamma-concentration sessions capture more than diffuse ones.

Honest: conditioning shrinks n hard (20 -> single digits per bucket). Descriptive only.
"""
import sys, os, re, glob, csv, math, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_engine import ingest_chain
import quan_greeks as GK
from quan_com_backtest import parse_footer_ts
from quan_log_session import compute_candidates, CANDIDATES

PRICE = "/mnt/project/CME_MINI_NQ1_10_412e5.csv"
DEGEN = 0.001       # |pin-anchor| < 0.1% of price -> gapclosed degenerate
ATM_W = 0.025       # near-ATM window for comoi (+/-2.5%)


def _npdf(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def zero_gex_level(fr, anchor, T_years, r=0.037):
    """Net dealer GEX(S) = Σ gamma(S,K,σ_K)·(callOI−putOI); first low→high zero crossing."""
    gf = GK.greeks_from_chain(fr, anchor, multiplier=20.0, T_days=max(T_years * 365, 0.5))
    m = gf.merge(fr[["strike", "callOI", "putOI"]], on="strike", how="inner")
    m["callOI"] = m["callOI"].fillna(0.0); m["putOI"] = m["putOI"].fillna(0.0)
    band = m[(m["strike"] >= anchor * 0.9) & (m["strike"] <= anchor * 1.1)]
    K = band["strike"].to_numpy(float); cO = band["callOI"].to_numpy(float)
    pO = band["putOI"].to_numpy(float); sg = band["cIV"].to_numpy(float)
    ok = np.isfinite(sg) & (sg > 0) & (K > 0)
    K, cO, pO, sg = K[ok], cO[ok], pO[ok], sg[ok]
    if len(K) < 3:
        return float("nan")
    T = max(T_years, 0.5 / 365.0)
    grid = np.linspace(anchor * 0.95, anchor * 1.05, 201)
    vals = []
    for S in grid:
        d1 = (np.log(S / K) + 0.5 * sg * sg * T) / (sg * np.sqrt(T))
        gam = np.exp(-r * T) * np.exp(-0.5 * d1 * d1) / np.sqrt(2 * np.pi) / (S * sg * np.sqrt(T))
        vals.append(float(np.sum(gam * (cO - pO))))
    vals = np.array(vals)
    for i in range(len(vals) - 1):                      # first low->high sign flip (short→long gamma)
        if vals[i] < 0 <= vals[i + 1]:
            t = abs(vals[i]) / (abs(vals[i]) + abs(vals[i + 1]) + 1e-12)
            return float(grid[i] + t * (grid[i + 1] - grid[i]))
    return float("nan")


def comoi_window(fr, anchor):
    """Near-ATM OI centroid: Σ(K·OI)/Σ OI over |K-anchor| <= 2.5%."""
    f = fr.copy()
    f["callOI"] = f["callOI"].fillna(0.0); f["putOI"] = f["putOI"].fillna(0.0)
    f["tot"] = f["callOI"] + f["putOI"]
    w = f[(f["strike"] >= anchor * (1 - ATM_W)) & (f["strike"] <= anchor * (1 + ATM_W))]
    s = w["tot"].sum()
    if s <= 0:
        return float("nan"), 0.0
    return float((w["strike"] * w["tot"]).sum() / s), float(s)


def session_window(pdf, t0, lookback=False):
    """Return (open, high, low, close) for next session (t0, t0+24h], or prior if lookback."""
    t = pdf["time"].astype("int64").values
    if lookback:
        mask = (t > t0 - 86400) & (t <= t0)
    else:
        mask = (t > t0) & (t <= t0 + 86400)
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return None
    o = float(pdf["open"].values[idx[0]]); c = float(pdf["close"].values[idx[-1]])
    h = float(pdf["high"].values[idx].max()); l = float(pdf["low"].values[idx].min())
    return o, h, l, c


def snap_date(fn):
    m = re.search(r"(\d{8})(?:_\d+)?\.csv$", fn)
    return f"{m.group(1)[4:8]}-{m.group(1)[0:2]}-{m.group(1)[2:4]}" if m else None


def exp_date(fn):
    m = re.search(r"exp[_]?(\d{2})_(\d{2})_(\d{2})", fn)
    return dt.date(2000 + int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else None


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


def main():
    pdf = pd.read_csv(PRICE)
    rows = []
    for d, f in gather().items():
        t0 = parse_footer_ts(f)
        if not t0:
            continue
        nxt = session_window(pdf, t0); prev = session_window(pdf, t0, lookback=True)
        if not nxt:
            continue
        anchor = nxt[0]                                   # next session OPEN
        o, hi, lo, cl = nxt
        cands, gsum, read = compute_candidates(f, anchor, 1.0)
        fr = ingest_chain(f)
        ed = exp_date(os.path.basename(f).lower())
        scored = dt.date(*map(int, d.split("-"))) + dt.timedelta(days=1)
        dte = (ed - scored).days if ed else None
        T_years = max((dte if dte is not None else 1), 0.5) / 365.0
        # repaired candidates
        zg = zero_gex_level(fr, anchor, T_years)
        cmoi, cmoi_mass = comoi_window(fr, anchor)
        pins = {c: cands[c][0] for c in CANDIDATES}
        pins["zerogamma"] = zg; pins["comoi"] = cmoi
        # session gamma concentration (mass-scaling control variable)
        peak_share = (cands["peakg"][1] / gsum) if gsum > 0 else float("nan")
        # trailing directionality (pre-window regime)
        tdir = float("nan")
        if prev:
            po, ph, pl, pc = prev
            tdir = abs(pc - po) / (ph - pl) if (ph - pl) > 0 else float("nan")
        row = {"date": d, "scored": str(scored), "dte": dte, "anchor": round(anchor, 1),
               "close": round(cl, 1), "hi": round(hi, 1), "lo": round(lo, 1),
               "peak_share": round(peak_share, 3), "trail_dir": round(tdir, 3) if tdir == tdir else ""}
        for c in CANDIDATES:
            pin = pins[c]
            row[f"pin_{c}"] = round(pin, 1) if pin == pin else ""
            if pin != pin or abs(pin - anchor) < DEGEN * anchor:
                row[f"gc_{c}"] = ""; row[f"tch_{c}"] = ""
            else:
                row[f"gc_{c}"] = round((cl - anchor) / (pin - anchor), 3)
                row[f"tch_{c}"] = int(lo <= pin <= hi)
        rows.append(row)

    out = "/mnt/user-data/outputs/quan_com_backtest_v2.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

    # median splits (sample-relative, honest for small n)
    dirs = sorted(r["trail_dir"] for r in rows if r["trail_dir"] != "")
    dmed = dirs[len(dirs) // 2] if dirs else 0.5
    shares = sorted(r["peak_share"] for r in rows if r["peak_share"] == r["peak_share"])
    smed = shares[len(shares) // 2] if shares else 0.5

    def bucket_stats(subset, label):
        print(f"\n### {label}  (n={len(subset)})")
        if not subset:
            print("  (empty)"); return
        print(f"  {'cand':10s} {'n':>3} {'meanGap':>8} {'pull>0':>7} {'touch':>6}")
        for c in CANDIDATES:
            gcs = [r[f"gc_{c}"] for r in subset if r.get(f"gc_{c}", "") != ""]
            tch = [r[f"tch_{c}"] for r in subset if r.get(f"tch_{c}", "") != ""]
            if not gcs:
                print(f"  {c:10s} {'-':>3} {'(degen)':>8}"); continue
            wins = [max(-3, min(3, g)) for g in gcs]
            print(f"  {c:10s} {len(gcs):>3} {np.mean(wins):>8.2f} "
                  f"{sum(g>0 for g in gcs)/len(gcs):>6.0%} "
                  f"{(sum(tch)/len(tch)) if tch else float('nan'):>6.0%}")

    rng = [r for r in rows if r["trail_dir"] != "" and r["trail_dir"] <= dmed]
    trend = [r for r in rows if r["trail_dir"] != "" and r["trail_dir"] > dmed]
    exp = [r for r in rows if r["dte"] is not None and 0 <= r["dte"] <= 1]
    fav = [r for r in rows if r in rng and r in exp]
    print("=" * 70)
    print(f"trailing-dir median={dmed:.3f} (<= = range)   peak-share median={smed:.3f}")
    bucket_stats(rows, "ALL")
    bucket_stats(rng, f"RANGE (trail_dir<= {dmed:.2f})")
    bucket_stats(exp, "INTO-EXPIRY (DTE<=1)")
    bucket_stats(fav, "FAVORABLE (range AND into-expiry)")

    # mass-scaling control: high vs low gamma concentration
    hi_c = [r for r in rows if r["peak_share"] == r["peak_share"] and r["peak_share"] > smed]
    lo_c = [r for r in rows if r["peak_share"] == r["peak_share"] and r["peak_share"] <= smed]
    print("\n--- MASS-SCALING CONTROL (does heavier/peaked field capture more?) ---")
    bucket_stats(hi_c, "HIGH gamma-concentration (heavy pin)")
    bucket_stats(lo_c, "LOW gamma-concentration (diffuse)")
    print(f"\nwrote detail -> {out}")


if __name__ == "__main__":
    main()
