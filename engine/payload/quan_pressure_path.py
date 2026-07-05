"""
quan_pressure_path — the pressure→release→gravity path model (within-session).

Framework thesis (all Book quantities, no invention):
  Pressure ACCUMULATES in the largest pressure ranges, the Surface Jerk marks WHERE/WHEN it
  RELEASES, and the release flows toward the GRAVITATIONAL POINTS (dealer-pinned levels).
  Modulated by dealer positioning (DID/intent), transaction (DIT), realization (DR3), and time.

Sources (verified Book columns):
  - Pressure ranges : BH/BJ/BL = Raw Intent/Transaction/Realization Pressure Gradient
                      = scaling × |DID| / |DIT| / |DR3|  (per strike, in quan_perstrike)
  - Release timing  : SURFACE JERK = Δ²(Tensor Surface) per chronoT  (the REAL jerk lens — bounded;
                      NOT the AM Strike Jerk = Lag/Speed, which is a reciprocal-ladder ratio that
                      blows up by design and is NOT a release magnitude. Verified 2026-06-01.)
  - Gravity points  : watermarks (|T|≥20, stuck dealer inventory) + gamma walls (max gamma OI)
  - Dealer triad    : DID (AP, intent), DIT (AR, transaction), DR3 (AT, realization)
  - Dealer time     : Dealer Premium Time (AO), Dealer Realized Time (AW)

WITHIN-SESSION read. Surface Jerk requires the Book recalc (slow); pressure/gravity/dealer are fast.
"""
import numpy as np


def _peaks(df, col, anchor, span, n=3):
    near = df[(df["strike"] >= anchor - span) & (df["strike"] <= anchor + span)].copy()
    # Gate to strikes with REAL liquidity — raw BH/BJ/BL blow up at thin far strikes where the
    # denominator (net OI/vol) goes near-zero. Require meaningful OI so the "largest pressure
    # range" reflects actual dealer positioning, not a divide-by-near-zero artifact. (Same lesson
    # as the AM jerk / liquidity watermark: magnitude alone is not signal without liquidity behind it.)
    if "O" in near.columns:
        oi_mag = near["O"].abs()
        floor = oi_mag.quantile(0.50) if len(oi_mag.dropna()) else 0
        near = near[oi_mag >= max(floor, 1.0)]
    s = near[["strike", col]].replace([np.inf, -np.inf], np.nan).dropna()
    if not len(s):
        return []
    s = s.reindex(s[col].abs().sort_values(ascending=False).index).head(n)
    return [(float(r.strike), round(float(getattr(r, col)), 2)) for r in s.itertuples()]


def pressure_path(per_strike_frame, liquidity, anchor, span=700,
                  gamma_walls=None, tensor_meta=None):
    """
    per_strike_frame : quan_perstrike.per_strike output (has BH/BJ/BL, AP/AR/AT, AO/AW)
    liquidity        : quan_liquidity.liquidity_profile output (watermarks = gravity)
    gamma_walls      : optional list of (strike, gamma) from quan_greeks
    tensor_meta      : optional quan_tensor.extract output (for Surface Jerk release timing)
    Returns the pressure→release→gravity map, within-session.
    """
    d = per_strike_frame.replace([np.inf, -np.inf], np.nan)

    # 1. LARGEST PRESSURE RANGES (where pressure accumulates) — by intent/trans/realiz
    pressure = {
        "intent_DID":      _peaks(d, "BH", anchor, span),
        "transaction_DIT": _peaks(d, "BJ", anchor, span),
        "realization_DR3": _peaks(d, "BL", anchor, span),
    }
    # the single dominant pressure strike (largest intent pressure near anchor)
    dom = pressure["intent_DID"][0] if pressure["intent_DID"] else None

    # 2. GRAVITATIONAL POINTS (where release flows TO) — watermarks + gamma walls
    wms = [w for w in (liquidity or {}).get("watermark_strikes", [])
           if anchor - span <= w["strike"] <= anchor + span]
    gravity = {
        "watermarks": [(w["strike"], w["T"], w["sign"]) for w in wms],
        "gamma_walls": [(float(k), float(v)) for k, v in (gamma_walls or [])
                        if anchor - span <= float(k) <= anchor + span][:5],
    }

    # 3. RELEASE TIMING (Surface Jerk Δ²Tensor — WHEN/where instability concentrates)
    release = None
    if tensor_meta and tensor_meta.get("rows"):
        rows = tensor_meta["rows"]
        # jerk by chronoT; peak jerk row = release timing within the session window
        jr = [(r["chronoT"], r.get("jerk", 0.0)) for r in rows if r.get("jerk")]
        if jr:
            jr_sorted = sorted(jr, key=lambda x: -abs(x[1]))
            release = {
                "peak_jerk_chronoT": jr_sorted[0][0],
                "peak_jerk_offset": tensor_meta.get("jerk_peak_offset"),
                "jerk_by_chronoT": [(c, round(j, 2)) for c, j in jr],
                "geometry": tensor_meta.get("geometry"),
                "direction": tensor_meta.get("direction"),
            }

    # 4. DEALER MODULATION at the dominant pressure strike (intent sign + dealer time)
    dealer = None
    if dom:
        row = d[d["strike"] == dom[0]]
        if len(row):
            r = row.iloc[0]
            did = r.get("AP"); dit = r.get("AR"); dr3 = r.get("AT")
            dealer = {
                "at_strike": dom[0],
                "DID_intent": round(float(did), 3) if did == did else None,
                "intent_lean": ("long_inventory" if (did == did and did > 0)
                                else "short_inventory" if (did == did and did < 0) else "flat"),
                "DIT_transaction": round(float(dit), 3) if dit == dit else None,
                "DR3_realization": round(float(dr3), 3) if dr3 == dr3 else None,
                "dealer_premium_time": round(float(r.get("AO")), 1) if r.get("AO") == r.get("AO") else None,
                "dealer_realized_time": round(float(r.get("AW")), 1) if r.get("AW") == r.get("AW") else None,
            }

    # 5. THE PATH: from dominant pressure strike → nearest gravitational point (release direction)
    path = None
    if dom and (gravity["watermarks"] or gravity["gamma_walls"]):
        gpts = [g[0] for g in gravity["watermarks"]] + [g[0] for g in gravity["gamma_walls"]]
        # nearest gravity point above and below the pressure strike
        above = min([g for g in gpts if g > dom[0]], default=None)
        below = max([g for g in gpts if g < dom[0]], default=None)
        # release direction biased by dealer intent + tensor direction (if available)
        bias = None
        if dealer and dealer["intent_lean"] != "flat":
            bias = "UP" if dealer["intent_lean"] == "long_inventory" else "DOWN"
        if release and release.get("direction") in ("UP", "DOWN"):
            bias = release["direction"] if bias is None else (bias if bias == release["direction"] else "SPLIT")
        path = {
            "pressure_origin": dom[0],
            "gravity_above": above,
            "gravity_below": below,
            "release_bias": bias,
            "reading": (f"Pressure peaks at {int(dom[0])}; nearest gravity {int(below) if below else '—'} "
                        f"below / {int(above) if above else '—'} above; release bias "
                        f"{bias or 'uncertain'}."),
        }

    return {
        "anchor": anchor,
        "pressure_ranges": pressure,
        "gravitational_points": gravity,
        "release_timing": release,
        "dealer_modulation": dealer,
        "path": path,
        "note": ("Within-session pressure→release→gravity map. Surface Jerk is the Δ²-tensor release "
                 "lens (NOT AM Lag/Speed). Read fresh from this session; log forward, do not gate (n small)."),
    }
