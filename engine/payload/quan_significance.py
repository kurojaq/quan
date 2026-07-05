"""
quan_significance.py — Jarque-Bera normality tests on the DID/DIT/DR3 distributions.

Book formula (CX74-76): JB = (n/6)·(skew² + excess_kurt²/4), excess_kurt = KURT()-3.
NOTE on n: the live Book uses COUNTA(col) over the full sheet range (counts blanks) -> inflated n -> larger
absolute JB. We use FINITE n (actual data points). This changes the JB MAGNITUDE but NOT the verdict: JB is a
significance test vs chi-square(df=2) critical 5.99 (95%) / 9.21 (99%). With these skew/kurt magnitudes JB is
always hugely significant either way. We therefore use JB as (a) a significance flag (is the signal real, not
noise) and (b) a RELATIVE strength read across I/T/R (which component's non-normality dominates). Documented
deviation from exact-Book-match; the conclusion is convention-invariant.

NOTE on excess kurtosis: Excel KURT() and our excel_kurt both return EXCESS already (~0 for normal). Standard JB
wants excess kurtosis in the formula, so we use excel_kurt directly (NOT excel_kurt-3, which would double-subtract).
The Book writes (CX2-3) treating CX2 as raw; since our value is already excess, statistically-correct = use it as-is.
"""
import numpy as np
from quan_engine import excel_kurt, excel_skew
import quan_perstrike as PS

CHI2_95, CHI2_99 = 5.991, 9.210   # chi-square df=2 critical values

def _jb(x):
    x = np.asarray(x, float); x = x[np.isfinite(x)]; n = x.size
    if n < 8:
        return dict(JB=float("nan"), n=n, skew=float("nan"), exkurt=float("nan"), significant=False)
    S = excel_skew(x); Kex = excel_kurt(x)          # excel_kurt already returns EXCESS kurtosis
    JB = (n / 6.0) * (S ** 2 + (Kex ** 2) / 4.0)
    return dict(JB=JB, n=n, skew=S, exkurt=Kex, significant=(JB > CHI2_95))

def significance(frame):
    ps = PS.per_strike(frame)
    out = {}
    for name, col in [("intent", "AP"), ("transaction", "AR"), ("realization", "AT")]:
        x = ps[col].replace([np.inf, -np.inf], np.nan).dropna().to_numpy()
        out[name] = _jb(x)
    # relative dominance: which component's non-normality is strongest
    jbs = {k: v["JB"] for k, v in out.items() if v["JB"] == v["JB"]}
    dominant = max(jbs, key=jbs.get) if jbs else None
    all_sig = all(v["significant"] for v in out.values())
    return dict(per_component=out, dominant=dominant, all_significant=all_sig,
                note="all 3 significant => CDS signals are statistically real (not noise)" if all_sig
                else "one or more components NOT significant => treat that signal with caution")
