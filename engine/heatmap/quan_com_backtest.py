#!/usr/bin/env python3
"""
quan_com_backtest.py — score the six CENTER-OF-MASS candidates against a real price series.
(Separate from quan_backtest.py, which is the state-flip ignition model.)

Because the chains are EOD snapshots (~4:31pm CDT), this is a FORWARD test:
  anchor   = the chain's parity-implied spot (its EOD price)
  pins     = the six centers of mass from that chain
  outcome  = where price goes over the next +N sessions (from the price bars)
This matches the April backtest's +1d/+2d/+3d horizon. (The live tool anchors at the
session OPEN and scores same-session — a different, complementary framing.)

  gapclosed_Nd = (close_Nd - anchor) / (pin - anchor)
  touched_Nd   = (low over [t0, t0+Nd] <= pin <= high over [t0, t0+Nd])
"""
import sys, os, re, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, "/home/claude/QE/QuanEngine_Standalone/engine")
from quan_engine import ingest_chain
from quan_log_session import compute_candidates, CANDIDATES

CDT_OFFSET = 5 * 3600  # CDT = UTC-5 (May/DST)


def derive_anchor(csv_path):
    """Parity-implied spot: strike + callLatest - putLatest, median over the chain."""
    fr = ingest_chain(csv_path)
    m = fr.dropna(subset=["callLatest", "putLatest"]).copy()
    est = (m["strike"] + m["callLatest"] - m["putLatest"]).astype(float)
    return float(np.median(est)), fr


def parse_footer_ts(csv_path):
    """Pull 'as of MM-DD-YYYY HH:MMpm CDT' from the Barchart footer -> UTC epoch."""
    txt = open(csv_path, errors="ignore").read()
    m = re.search(r"as of (\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)\s*CDT", txt)
    if not m:
        return None
    mo, da, yr, hh, mm, ap = m.groups()
    hh = int(hh) % 12 + (12 if ap == "pm" else 0)
    local = dt.datetime(int(yr), int(mo), int(da), hh, int(mm), tzinfo=dt.timezone.utc)
    return int(local.timestamp()) + CDT_OFFSET  # treat parsed as CDT wall clock -> UTC


def score_forward(price_df, t0, anchor, pins, horizons_days=(1, 2, 3)):
    t = price_df["time"].astype("int64").values
    hi = price_df["high"].values; lo = price_df["low"].values; cl = price_df["close"].values
    i0 = int(np.argmin(np.abs(t - t0)))
    out = {"anchor_barclose": float(cl[i0]), "t0": int(t[i0])}
    for nd in horizons_days:
        tN = t0 + nd * 86400
        iN = int(np.argmin(np.abs(t - tN)))
        if iN <= i0:
            continue
        win_hi = float(hi[i0:iN + 1].max()); win_lo = float(lo[i0:iN + 1].min())
        cN = float(cl[iN])
        out[f"close_{nd}d"] = cN; out[f"hi_{nd}d"] = win_hi; out[f"lo_{nd}d"] = win_lo
        for c in CANDIDATES:
            pin = pins[c]
            if pin != pin:
                continue
            gc = (cN - anchor) / (pin - anchor) if abs(pin - anchor) > 1e-9 else float("nan")
            out[f"gc_{c}_{nd}d"] = gc
            out[f"tch_{c}_{nd}d"] = int(win_lo <= pin <= win_hi)
    return out


def run_one(chain_csv, price_csv, T_days=1.0):
    anchor, fr = derive_anchor(chain_csv)
    cands, total_mass, read = compute_candidates(chain_csv, anchor, T_days)
    pins = {c: cands[c][0] for c in CANDIDATES}
    t0 = parse_footer_ts(chain_csv)
    pdf = pd.read_csv(price_csv)
    res = score_forward(pdf, t0, anchor, pins) if t0 else {}
    return anchor, pins, read, res, t0


if __name__ == "__main__":
    chain = sys.argv[1]; price = sys.argv[2]
    anchor, pins, read, res, t0 = run_one(chain, price)
    print(f"chain: {os.path.basename(chain)}")
    print(f"footer t0 (UTC): {dt.datetime.utcfromtimestamp(t0) if t0 else 'NOT FOUND'}")
    print(f"parity anchor: {anchor:.2f}   | price-bar close at t0: {res.get('anchor_barclose','?')}")
    print(f"read: bias={read['bias']} cds={read['cds']} regime={read['regime']}")
    print("pins:", {c: round(pins[c], 1) if pins[c] == pins[c] else 'na' for c in CANDIDATES})
    for nd in (1, 2, 3):
        if f"close_{nd}d" not in res:
            continue
        print(f"\n+{nd}d: close={res[f'close_{nd}d']:.1f}  range[{res[f'lo_{nd}d']:.0f},{res[f'hi_{nd}d']:.0f}]")
        for c in CANDIDATES:
            k = f"gc_{c}_{nd}d"
            if k in res:
                print(f"   {c:10s} gapclosed={res[k]:+.3f}  touched={res[f'tch_{c}_{nd}d']}")
