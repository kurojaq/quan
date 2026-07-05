#!/usr/bin/env python3
"""
quan_score_session.py  —  POST-SESSION scorer for the capture-radius study.

After the session closes, fills the outcome columns for the most recent unscored
row (or a specified date): for each of the six center-of-mass candidates, the
anchor-based gap-closed fraction and whether price touched the pin.

  gapclosed = (close - anchor) / (pin - anchor)     ~1 drawn to pin, 0 no pull, <0 pushed away
  touched   = (low <= pin <= high)                  did price reach the pin at all this session

Then prints running tallies across all scored rows so you can watch which center
of mass is actually pulling price as the sample grows.

Usage:
  python3 quan_score_session.py <ledger.csv> <high> <low> <close> [date]
"""
import sys, os, csv
import numpy as np

CANDIDATES = ["comg", "peakg", "watermark", "maxpain", "zerogamma", "comoi"]


def _f(x):
    try:
        return float(x)
    except Exception:
        return float("nan")


def score(ledger, high, low, close, date=None):
    if not os.path.exists(ledger):
        print("no ledger:", ledger); return
    with open(ledger) as fh:
        rows = list(csv.DictReader(fh))
        fields = rows[0].keys() if rows else []
    # pick the target row: matching date, else the most recent unscored
    target = None
    if date:
        for r in rows:
            if r["date"] == date:
                target = r; break
    else:
        for r in reversed(rows):
            if r.get("scored", "0") != "1":
                target = r; break
    if target is None:
        print("no matching/unscored row to score"); return

    anchor = _f(target["anchor"])
    target["high"] = f"{high:.2f}"; target["low"] = f"{low:.2f}"; target["close"] = f"{close:.2f}"
    target["scored"] = "1"
    for c in CANDIDATES:
        pin = _f(target.get(f"pin_{c}", ""))
        if np.isnan(pin):
            target[f"gapclosed_{c}"] = ""; target[f"touched_{c}"] = ""
            continue
        gc = (close - anchor) / (pin - anchor) if abs(pin - anchor) > 1e-9 else float("nan")
        target[f"gapclosed_{c}"] = "" if np.isnan(gc) else f"{gc:.3f}"
        target[f"touched_{c}"] = "1" if (low <= pin <= high) else "0"

    with open(ledger, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(fields))
        w.writeheader(); w.writerows(rows)
    print(f"scored {target['date']}: H {high:.2f} / L {low:.2f} / C {close:.2f}\n")

    # running tallies across scored rows
    scored = [r for r in rows if r.get("scored") == "1"]
    print(f"running tallies over {len(scored)} scored session(s):")
    print(f"  {'candidate':10s} {'mean gapClosed':>14} {'touch rate':>11} {'pull>0 rate':>11}")
    for c in CANDIDATES:
        gcs = [_f(r.get(f"gapclosed_{c}", "")) for r in scored]
        gcs = [g for g in gcs if not np.isnan(g)]
        tch = [r.get(f"touched_{c}", "") for r in scored if r.get(f"touched_{c}", "") in ("0", "1")]
        if not gcs:
            print(f"  {c:10s} {'—':>14} {'—':>11} {'—':>11}"); continue
        mean_gc = float(np.mean(gcs))
        touch_rate = (sum(1 for t in tch if t == "1") / len(tch)) if tch else float("nan")
        pull_rate = sum(1 for g in gcs if g > 0) / len(gcs)
        tr = "—" if np.isnan(touch_rate) else f"{touch_rate:.0%}"
        print(f"  {c:10s} {mean_gc:>14.3f} {tr:>11} {pull_rate:>10.0%}")
    print("\n(n is small — treat as descriptive only until the sample is real; logs misses as faithfully as hits.)")


if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("usage: python3 quan_score_session.py <ledger.csv> <high> <low> <close> [date]"); sys.exit(1)
    led = sys.argv[1]; hi = float(sys.argv[2]); lo = float(sys.argv[3]); cl = float(sys.argv[4])
    dt = sys.argv[5] if len(sys.argv) > 5 else None
    score(led, hi, lo, cl, dt)
