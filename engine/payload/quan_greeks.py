"""
quan_greeks.py — the Greeks layer (Black-76 dealer-basis aggregates), framework-canonical.

Pinned to Master_Formula_Reference -> Greeks_BlackScholes tab:
  I2  Net_Dlr_Delta = Δ_Put*Put_OI - Δ_Call*Call_OI        (dealer basis; SIGN = directional pressure)
  J2  Dollar_Delta  = Net_Dlr_Delta * Mult * F
  M2  GEX_contrib   = Γ * (Put_OI + Call_OI) * F^2 * Mult / 100   (gamma exposure -> walls / pin)
  R2  Charm = ∂Δ/∂day, S2 Vanna = ∂Δ/∂σ  (per-strike; summed for netCharm/netVanna)
Direction (framework AI3):
  Net_Dlr_Delta < 0  -> BULLISH DELTA PRESSURE (dealers short delta, must buy)
  Net_Dlr_Delta > 0  -> BEARISH DELTA PRESSURE (dealers long delta, must sell)

Uses an uploaded vendor Greeks CSV (per-strike Δ/Γ/Θ/Vega for call & put) joined to the chain OI by strike,
so no IV solve is needed. If only the chain is available, a Black-76 fallback can be added later.
"""
import numpy as np
import pandas as pd
import quan_blackscholes as BS


def _num(x):
    try:
        return float(str(x).replace(",", "").replace("%", "").rstrip("s"))
    except Exception:
        return np.nan


def load_greeks_csv(path):
    """Vendor side-by-side Greeks CSV: left cols = Call, right (.1) = Put. Returns per-strike frame."""
    g = pd.read_csv(path)
    out = pd.DataFrame({
        "strike":   g["Strike"].map(_num),
        "cDelta":   g["Delta"].map(_num),   "pDelta": g["Delta.1"].map(_num),
        "cGamma":   g["Gamma"].map(_num),   "pGamma": g["Gamma.1"].map(_num),
        "cTheta":   g["Theta"].map(_num),   "pTheta": g["Theta.1"].map(_num),
        "cVega":    g["Vega"].map(_num),    "pVega":  g["Vega.1"].map(_num),
        "cIV":      g["IV"].map(_num),      "pIV":    g["IV.1"].map(_num),
    }).dropna(subset=["strike"]).sort_values("strike").reset_index(drop=True)
    return out


def greeks_from_chain(chain_frame, forward_price, multiplier=20.0, r=0.045, T_days=1.0):
    """Compute a greeks_frame (same shape as load_greeks_csv) directly from the chain via Black-76.
    IV is solved from per-strike premium in POINTS. VERIFIED 2026-06-01: chains carry premium in two forms —
    callLatest/putLatest = POINTS (correct for Black-76); callPrem/putPrem = DOLLARS (= points x multiplier).
    Prefer the Latest (points) columns; fall back to Prem/multiplier only if Latest is absent."""
    F = float(forward_price); T = float(T_days) / 365.0
    have_latest = ("callLatest" in chain_frame.columns and "putLatest" in chain_frame.columns)
    cols = ["strike"] + (["callLatest", "putLatest"] if have_latest else ["callPrem", "putPrem"])
    ch = chain_frame[cols].copy()
    rows = []
    for _, row in ch.iterrows():
        K = float(row["strike"])
        if have_latest:
            cP = row["callLatest"] if pd.notna(row["callLatest"]) else np.nan   # already points
            pP = row["putLatest"] if pd.notna(row["putLatest"]) else np.nan
        else:
            cP = (row["callPrem"] / multiplier) if pd.notna(row["callPrem"]) else np.nan  # dollars -> points
            pP = (row["putPrem"] / multiplier) if pd.notna(row["putPrem"]) else np.nan
        ivc = BS.implied_vol(F, K, T, r, cP, 'call') if pd.notna(cP) and cP > 0 else None
        ivp = BS.implied_vol(F, K, T, r, pP, 'put') if pd.notna(pP) and pP > 0 else None
        iv_mid = np.nanmean([v for v in (ivc, ivp) if v is not None]) if (ivc or ivp) else np.nan
        if not np.isfinite(iv_mid):
            rows.append(dict(strike=K, cDelta=np.nan, pDelta=np.nan, cGamma=0.0, pGamma=0.0,
                             cTheta=np.nan, pTheta=np.nan, cVega=np.nan, pVega=np.nan,
                             cIV=np.nan, pIV=np.nan)); continue
        g = BS.strike_greeks(F, K, T, iv_mid, r)
        if g is None:
            rows.append(dict(strike=K, cDelta=np.nan, pDelta=np.nan, cGamma=0.0, pGamma=0.0,
                             cTheta=np.nan, pTheta=np.nan, cVega=np.nan, pVega=np.nan,
                             cIV=iv_mid, pIV=iv_mid)); continue
        rows.append(dict(strike=K, cDelta=g["deltaCall"], pDelta=g["deltaPut"],
                         cGamma=g["gamma"], pGamma=g["gamma"], cTheta=np.nan, pTheta=np.nan,
                         cVega=g["vega"], pVega=g["vega"], cIV=iv_mid, pIV=iv_mid))
    return pd.DataFrame(rows).sort_values("strike").reset_index(drop=True)


def greeks_layer(chain_frame, greeks_frame, forward_price, multiplier=20.0, r=0.045, T_days=1.0):
    """Compute dealer-basis Greek aggregates + per-strike GEX/charm walls.
    chain_frame: from ingest_chain (has strike, callOI, putOI). greeks_frame: from load_greeks_csv.
    forward_price F = ATM anchor. multiplier: NQ = 20 (full), MNQ = 2."""
    ch = chain_frame[["strike", "callOI", "putOI"]].copy()
    ch["strike"] = ch["strike"].astype(float)
    gk = greeks_frame.copy()
    m = pd.merge(ch, gk, on="strike", how="inner")
    if m.empty:
        return None
    cOI = m["callOI"].fillna(0).to_numpy(float)
    pOI = m["putOI"].fillna(0).to_numpy(float)
    cD, pD = m["cDelta"].to_numpy(float), m["pDelta"].to_numpy(float)
    cG = m["cGamma"].fillna(0).to_numpy(float)
    F = float(forward_price)
    Mult = float(multiplier)
    # I2 Net Dealer Delta (P - C basis), per strike then summed
    netDelta_perstrike = pD * pOI - cD * cOI
    netDelta = float(np.nansum(netDelta_perstrike))
    dollarDelta = netDelta * Mult * F                                   # J2
    # M2 GEX per strike = Γ*(PutOI+CallOI)*F^2*Mult/100  (gamma is same for call/put under BS; use call gamma)
    gex_perstrike = cG * (pOI + cOI) * (F ** 2) * Mult / 100.0
    gex = float(np.nansum(gex_perstrike))
    # direction interpretation
    if netDelta < 0:
        direction = "BULLISH_DELTA_PRESSURE"      # dealers short delta -> must buy
    elif netDelta > 0:
        direction = "BEARISH_DELTA_PRESSURE"      # dealers long delta -> must sell
    else:
        direction = "NEUTRAL"
    # gamma walls: strikes with the largest |GEX contribution| (pin / resistance structure)
    order = np.argsort(np.abs(np.nan_to_num(gex_perstrike)))[::-1]
    walls = [(float(m["strike"].iloc[i]), round(float(gex_perstrike[i]), 1)) for i in order[:6]]
    # zero-gamma / flip: where cumulative GEX (signed by strike side) crosses zero, relative to F
    strikes = m["strike"].to_numpy(float)
    return dict(netDelta=netDelta, dollarDelta=dollarDelta, gex=gex, direction=direction,
                n_matched=int(len(m)), gamma_walls=walls,
                gex_perstrike=gex_perstrike.tolist(), strikes=strikes.tolist(),
                netDelta_perstrike=netDelta_perstrike.tolist())


def gex_read(chain_frame, forward_price, multiplier=20.0, r=0.045, T_days=1.0):
    """One-call GEX/Net-Delta read from a chain: solves per-strike IV internally (real vol surface, points),
    returns dealer-delta direction, GEX, gamma walls, and the gamma-flip (zero-GEX) strike. Independent of CDS."""
    gk = greeks_from_chain(chain_frame, forward_price, multiplier=multiplier, r=r, T_days=T_days)
    g = greeks_layer(chain_frame, gk, forward_price, multiplier=multiplier, r=r, T_days=T_days)
    if g is None:
        return None
    # gamma-flip (zero-gamma level) — TIER-2 INTRADAY-DYNAMIC quantity (not a static Book cell, but real).
    # The Book's Greeks sheet computes GEX magnitude (M2 = Γ·(PutOI+CallOI), UNSIGNED) as the INITIAL snapshot
    # read; it has no zero-gamma cell because the flip only expresses its meaning as the session evolves (OI +
    # spot move). This is the same class as flip-zone migration / conductance timing / delta flip: the framework
    # gives the snapshot, LIVE/UPDATING data makes it operate in real time. Convention here is the STANDARD GEX-
    # desk one: dealer gamma +from puts / −from calls -> signed per-strike Γ·(putOI−callOI); cumulative crosses
    # zero at the flip. Principled + consistent. Treat as DYNAMIC context (sharpen with data updates), not a
    # one-snapshot-precise static reading. (Gamma WALLS = Book M2, static Tier-1; the FLIP = dynamic Tier-2.)
    strikes = np.array(g["strikes"]); cG_ps = None
    # recompute signed per-strike using net OI sign (putOI-callOI) — the dealer-positioning gamma
    gk2 = greeks_from_chain(chain_frame, forward_price, multiplier=multiplier, r=r, T_days=T_days)
    m2 = chain_frame[["strike","callOI","putOI"]].merge(gk2[["strike","cGamma"]], on="strike", how="inner").sort_values("strike")
    netOI = (m2["putOI"].fillna(0) - m2["callOI"].fillna(0)).to_numpy(float)
    gam = m2["cGamma"].fillna(0).to_numpy(float); sk = m2["strike"].to_numpy(float)
    F = float(forward_price); Mult = float(multiplier)
    signed_gex = gam * netOI * (F**2) * Mult / 100.0
    cum = np.cumsum(signed_gex)
    flip = None
    for i in range(1, len(cum)):
        if np.isfinite(cum[i-1]) and np.isfinite(cum[i]) and cum[i-1] != 0 and cum[i] != 0 and np.sign(cum[i-1]) != np.sign(cum[i]):
            flip = float((sk[i-1] + sk[i]) / 2); break
    g["gamma_flip"] = flip
    g["signed_gex_total"] = float(np.nansum(signed_gex))
    return g


def surviving_levels(front_gex, surv_gexes, top=6, topk=8, min_persist=2, confirmed_only=False):
    """Key surviving gamma levels = peaks of the SURVIVING book (longer-dated expiries that
    outlive the front), ranked by surviving magnitude, gated by cross-expiry persistence.
      front_gex : {strike: |GEX|} for the expiring front contract
      surv_gexes: list of {strike: |GEX|} for each surviving (DTE>front) expiry
    Returns "K:persist,K:persist,..." (top N). Levels confirmed in >= `min_persist` expiries
    (front + survivors, top-`topk` walls each) rank first by surviving |GEX|; single-expiry walls
    fill any remaining slots as fallback. persistence counts front for confirmation only; the
    surviving magnitude excludes the front (it rolls off at expiry).
    confirmed_only=True drops the single-expiry fallback entirely -> emits ONLY the
    double-confirmed (persist>=min_persist) walls: the hot spots both books agree on. The
    output length is then variable (only as many as are genuinely confirmed)."""
    def topset(g):
        return set(k for k, _ in sorted(g.items(), key=lambda kv: -kv[1])[:topk])
    if not surv_gexes:
        return ""
    sets_ = [topset(front_gex)] + [topset(g) for g in surv_gexes]
    agg = {}
    for g in surv_gexes:
        for k, v in g.items():
            agg[k] = agg.get(k, 0.0) + v
    if not agg:
        return ""
    def persist(k):
        return sum(1 for s in sets_ if k in s)
    items = sorted(agg.items(), key=lambda kv: -kv[1])              # magnitude rank
    gated = [(k, v) for k, v in items if persist(k) >= min_persist]  # cross-expiry confirmed
    rest = [(k, v) for k, v in items if persist(k) < min_persist]    # single-expiry fallback
    out = gated[:top] if confirmed_only else (gated + rest)[:top]
    return ",".join(f"{int(round(k))}:{persist(k)}" for k, _ in out)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, "engine")
    from quan_engine import ingest_chain
    chain = ingest_chain(sys.argv[1]); gk = load_greeks_csv(sys.argv[2]); F = float(sys.argv[3])
    g = greeks_layer(chain, gk, F)
    print("matched strikes:", g["n_matched"])
    print("Net Dealer Delta:", round(g["netDelta"], 1), "->", g["direction"])
    print("Dollar Delta:", f"{g['dollarDelta']:,.0f}")
    print("GEX:", f"{g['gex']:,.0f}")
    print("top gamma walls (strike, GEX):", g["gamma_walls"])
