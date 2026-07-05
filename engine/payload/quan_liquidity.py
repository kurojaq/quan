"""
quan_liquidity — per-strike liquidity-state profile.

GROUNDING (framework-faithful; sources: Master_Formula_Reference Book_Strike_Level + Book col T/U/W):
  PRIMARY (canonical) — T-watermark:
    Liquidity Ratio T = A/B = (NetOI/PCR_OI) / (NetVol/PCR_Vol)   [Book col T2, per-strike]
    Framework defines EXACTLY ONE threshold: Watermark = 20.
      |T| >= 20  => WATERMARK (dealers stuck): OI imbalance vastly exceeds flow imbalance,
                    so parked inventory cannot be cleared by the flow.
    Sign of T (from the formula, not invented):
      T > 0  => OI_parked  (net-OI side dominates — inventory sitting)
      T < 0  => flow_churn (flow side dominates the sign — churning against the OI)
    Solidity U = 1/T is the framework's explicit complement (high U = fluid/churn, NOT stuck);
    it is the reciprocal of T and adds nothing beyond the watermark, so it is NOT surfaced.

  SECONDARY (relative overlay) — W (Strike Kurt):
    W = Kurtosis across the per-strike liquidity family [L,M,N,O,P,Q,R,S,T]   [Book col W2,
    "Per-strike, NOT distribution-wide"]. Measures how anomalous a strike is across ALL
    liquidity dimensions at once (vs T, which is extreme in the ratio alone). The framework
    defines W as a per-strike statistic but gives it NO threshold — so W is usable only as a
    WITHIN-SESSION relative ranking, never an absolute flag. Surfaced as an optional overlay,
    explicitly labeled relative. Empirically W and the T-watermark pick largely DIFFERENT
    strikes (near-zero overlap) — they are complementary, not redundant.

NOT INCLUDED (deliberately): invented quantile bands (fluid/sticky/etc.). The framework names
no such cutoffs; earlier prototype bands were dropped as non-canonical and low-value.
"""
import numpy as np
import pandas as pd

WATERMARK = 20.0   # canonical: Book_Strike_Level T2 "Watermark threshold = 20"


def liquidity_profile(per_strike_frame, w_overlay=False):
    """
    per_strike_frame: output of quan_perstrike.per_strike (needs 'strike','T'; 'W' for overlay).
    Returns the canonical per-strike liquidity profile (T-watermark, sign-aware, cluster).
    If w_overlay=True, attaches the SECONDARY relative W (Strike Kurt) ranking — no threshold,
    within-session only.
    """
    d = per_strike_frame
    if "T" not in d.columns or "strike" not in d.columns:
        return {"error": "frame missing 'T' or 'strike'"}

    T = d["T"].replace([np.inf, -np.inf], np.nan)
    valid = d.loc[T.notna(), ["strike"]].copy()
    valid["T"] = T[T.notna()].values
    valid["absT"] = valid["T"].abs()

    # ---- canonical: watermark at |T| >= 20, sign-aware ----
    valid["watermark"] = valid["absT"] >= WATERMARK
    valid["sign"] = np.where(valid["T"] > 0, "OI_parked",
                      np.where(valid["T"] < 0, "flow_churn", "flat"))
    valid["state"] = np.where(valid["watermark"], "WATERMARK", "fluid")

    wm = valid[valid["watermark"]].sort_values("absT", ascending=False)
    # sign skew of the watermark set (the 05/15 fingerprint: one-sided => directional flip)
    n_par = int((wm["sign"] == "OI_parked").sum())
    n_chu = int((wm["sign"] == "flow_churn").sum())
    sign_lean = ("balanced" if n_par == n_chu else
                 ("OI_parked" if n_par > n_chu else "flow_churn"))

    profile = {
        "n_strikes": int(len(valid)),
        "n_watermarks": int(valid["watermark"].sum()),
        "absT_median": float(valid["absT"].median()) if len(valid) else float("nan"),
        "watermark_sign_lean": sign_lean,        # one-sided lean = directional structural signal
        "watermark_sign_split": {"OI_parked": n_par, "flow_churn": n_chu},
        "watermark_strikes": [
            {"strike": float(r.strike), "T": round(float(r.T), 2), "sign": r.sign}
            for r in wm.itertuples()
        ],
        "watermark_cluster": _cluster_flag(valid),
    }

    if w_overlay and "W" in d.columns:
        profile["W_relative_overlay"] = _w_overlay(d, valid)

    profile["_per_strike"] = valid[["strike", "T", "absT", "sign", "state", "watermark"]]
    return profile


def _cluster_flag(valid):
    """
    Structural summary (grounded, not a band): watermark count + spatial adjacency + spread.
    A cluster of adjacent stuck strikes is a stronger structural signal than isolated ones.
    No threshold asserted as canonical — descriptive only.
    """
    wm = valid[valid["watermark"]].sort_values("strike")
    n = len(wm)
    if n < 2:
        return {"count": int(n), "adjacent_pairs": 0, "spread": None}
    ks = wm["strike"].to_numpy()
    allk = np.sort(valid["strike"].unique())
    step = np.median(np.diff(allk)) if len(allk) > 1 else np.nan
    adj = int(np.sum(np.isclose(np.diff(ks), step))) if step == step else 0
    return {"count": int(n), "adjacent_pairs": adj, "spread": float(ks.max() - ks.min())}


def _w_overlay(d, valid):
    """
    SECONDARY, RELATIVE. W (Strike Kurt across L-T) top-decile within this session.
    No canonical threshold exists for W, so this is a within-session ranking ONLY — it does
    not assert an absolute 'stuck' state. Complements (does not replace) the T-watermark.
    """
    W = d["W"].replace([np.inf, -np.inf], np.nan)
    Wv = W.dropna()
    if len(Wv) < 5:
        return {"note": "too few strikes for W ranking"}
    cut = float(Wv.quantile(.90))
    hi = d.loc[W >= cut, ["strike"]].copy()
    hi["W"] = W[W >= cut].values
    hi = hi.sort_values("W", ascending=False)
    return {
        "W_range": [round(float(Wv.min()), 2), round(float(Wv.max()), 2)],
        "W_median": round(float(Wv.median()), 2),
        "top_decile_cut": round(cut, 2),
        "top_anomalous_strikes": [
            {"strike": float(r.strike), "W": round(float(r.W), 2)} for r in hi.head(8).itertuples()
        ],
        "note": "WITHIN-SESSION relative ranking; W has NO canonical threshold — not an absolute flag",
    }
