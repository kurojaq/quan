"""
quan_cboe.py — CBOE quotedata proxy of the golden reference.

Adapts a CBOE Global Markets "Download CSV" options export (NDX, SPX, RUT, VIX,
single-name equities, …) into the SAME canonical Golden Reference chain frame that
quan_engine.ingest_chain() produces from the CME vendor CSV. This is a MARKET
ADAPTER, not a separate engine: once it produces the Golden Reference, the entire
Qu'an kernel — Detector, Dealer Intent (DID/DIT/DR3/CDS), Chronometer, Pressure,
Curvature, Greeks, Reports, Heatmaps — runs identically to CME. The engine never
branches on market type; the only distinction is the source of raw observables.

────────────────────────────────────────────────────────────────────────────
PREMIUM IS A LATENT FIELD, NOT A MISSING ONE
────────────────────────────────────────────────────────────────────────────
In Qu'an, Dealer Intent = accumulated inventory (OI) and Dealer Transaction =
inventory flow (Volume). Premium is NEITHER — it is the ENERGY WEIGHTING of the
hedging burden that inventory carries. CME observes premium directly; CBOE does
not. Rather than omit it (and degrade to a structural P-C subset), the adapter
RECONSTRUCTS a latent premium surface from what CBOE *does* publish — strike,
spot, per-side IV, and time:

    E = (K / S)² · IV · √τ        (see energy())

    Dealer Intent            = OI
    Dealer Transaction       = Volume
    Weighted Dealer Intent   = OI · E        (premium-weighted, as on CME)
    Weighted Dealer Txn      = Volume · E
    DR3, DIDS, DITS, CDS, …  = the full cascade, computed on E exactly as CME
                               computes it on observed premium

The analytics layer MUST NOT distinguish observed from reconstructed premium —
only observed vs reconstructed *source*. `premium="energy"` is the default and
the canonical Golden Reference; `premium="mid"|"last"` use observed proxies;
`premium="none"` leaves it NaN (structural-only, legacy).

────────────────────────────────────────────────────────────────────────────
CSV LAYOUT (4 preamble/header lines, then one row per (expiration, strike))
────────────────────────────────────────────────────────────────────────────
  line1: (blank)
  line2: <INDEX NAME>,Last: <spot>,Change: <chg>
  line3: "Date: <ts>",Bid: ..,Ask: ..,Size: ..,Volume: ..
  line4: Expiration Date,Calls,Last Sale,Net,Bid,Ask,Volume,IV,Delta,Gamma,Open Interest,
         Strike,Puts,Last Sale,Net,Bid,Ask,Volume,IV,Delta,Gamma,Open Interest
  line5+: <exp>,<callsym>,<call fields…>,<strike>,<putsym>,<put fields…>

Column indices in the data table (0-based, positional — immune to header mangling):
  0  Expiration Date      11 Strike
  1  Calls (symbol)       12 Puts (symbol)
  2  call Last Sale       13 put Last Sale
  3  call Net             14 put Net
  4  call Bid             15 put Bid
  5  call Ask             16 put Ask
  6  call Volume          17 put Volume
  7  call IV              18 put IV
  8  call Delta           19 put Delta
  9  call Gamma           20 put Gamma
  10 call Open Interest   21 put Open Interest
"""
from __future__ import annotations
import re
import datetime as _dt
import numpy as np
import pandas as pd

# Positional column map for the data table (see header note above).
_COL = dict(
    exp=0, callsym=1, callLast=2, callBid=4, callAsk=5, callVol=6, callIV=7,
    callDelta=8, callGamma=9, callOI=10, strike=11, putsym=12, putLast=13,
    putBid=15, putAsk=16, putVol=17, putIV=18, putDelta=19, putGamma=20, putOI=21,
)
_HEADER_ROWS = 4          # blank + 2 meta lines + column header
_EXP_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
_MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

# ────────────────────────────────────────────────────────────────────────────
# EXCHANGE IDENTITY & TRADING HOURS
# CBOE uploads differ from CME only in the session clock. The golden-reference
# cascade is exchange-agnostic; the Chronometer / session-fraction is not. This
# is the single source of truth the terminal's sessionT() mirrors per exchange.
#   CME index futures (Globex): 18:00 ET (prev day) → 17:00 ET  = 82800 s (23 h)
#   CBOE index options (RTH):   09:30 ET            → 16:15 ET  = 24300 s
#   CBOE equity options (RTH):  09:30 ET            → 16:00 ET  = 23400 s
# Times are ET (America/New_York); the close crossing midnight (CME) wraps to the
# prior calendar day, matching js/compass.js sessionT().
# ────────────────────────────────────────────────────────────────────────────
EXCHANGE = "CBOE"
EXCHANGE_HOURS = {
    "CME":       dict(open="18:00", close="17:00", span_s=82800, wraps_midnight=True,
                      tz="America/New_York", label="CME Globex (index futures)"),
    "CBOE":      dict(open="09:30", close="16:15", span_s=24300, wraps_midnight=False,
                      tz="America/New_York", label="CBOE RTH (index options)"),
    "CBOE_EQ":   dict(open="09:30", close="16:00", span_s=23400, wraps_midnight=False,
                      tz="America/New_York", label="CBOE RTH (equity options)"),
}


def exchange_hours(exchange: str = EXCHANGE) -> dict:
    """Session-clock definition for an exchange (defaults to this module's CBOE)."""
    return EXCHANGE_HOURS.get(str(exchange).upper(), EXCHANGE_HOURS["CBOE"])


def _num(x):
    """CBOE cells are plain numerics but guard commas / blanks defensively."""
    return pd.to_numeric(
        pd.Series(x).astype(str).str.replace(",", "", regex=False).str.strip()
        .replace({"": np.nan, "nan": np.nan, "N/A": np.nan}),
        errors="coerce",
    )


def _exp_key(exp: str):
    """Sortable key from 'Fri Jul 10 2026' → (2026, 7, 10)."""
    m = re.match(r"[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})", str(exp).strip())
    if not m:
        return (9999, 99, 99)
    mon, day, yr = m.group(1), int(m.group(2)), int(m.group(3))
    return (yr, _MONTHS.get(mon, 99), day)


def _parse_asof(asof: str):
    """'July 11, 2026 at 12:46 AM EDT' → naive datetime (ET). None if unparseable."""
    if not asof:
        return None
    s = re.sub(r"\s+[A-Z]{2,4}$", "", str(asof).strip())  # drop trailing tz (EDT/EST/…)
    for fmt in ("%B %d, %Y at %I:%M %p", "%B %d, %Y", "%b %d, %Y at %I:%M %p", "%b %d, %Y"):
        try:
            return _dt.datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


_YEAR_SECONDS = 365.25 * 86400.0
_TAU_FLOOR_S = 3600.0          # 1h floor: a 0DTE/expired front still gets a positive τ


def _tau_years(expiration: str, asof_dt) -> float:
    """Time to expiry in YEARS from as-of to the expiration's 16:00 ET settle.
    Floors at 1 hour so 0DTE/just-expired fronts stay positive (√τ is a per-expiry
    scale that the ratio/normalized cascade is largely invariant to; it only carries
    real weight across a multi-expiry term structure)."""
    yr, mo, dy = _exp_key(expiration)
    if yr >= 9999:
        return _TAU_FLOOR_S / _YEAR_SECONDS
    try:
        exp_dt = _dt.datetime(yr, mo, dy, 16, 0, 0)          # settle at 16:00 ET
    except ValueError:
        return _TAU_FLOOR_S / _YEAR_SECONDS
    ref = asof_dt if asof_dt is not None else _dt.datetime.now()
    sec = max((exp_dt - ref).total_seconds(), _TAU_FLOOR_S)
    return sec / _YEAR_SECONDS


def read_cboe_meta(csv_path: str) -> dict:
    """Underlier symbol, spot (Last), change, and as-of timestamp from lines 2-3."""
    with open(csv_path, "r", encoding="utf-8-sig") as fh:
        lines = [next(fh, "") for _ in range(3)]
    name = lines[1].split(",")[0].strip() if len(lines) > 1 else ""
    def _grab(text, label):
        m = re.search(label + r":\s*([-\d.]+)", text)
        return float(m.group(1)) if m else float("nan")
    spot = _grab(lines[1], "Last")
    change = _grab(lines[1], "Change")
    # the whole field is quoted: "Date: July 11, 2026 at 12:46 AM EDT" — capture to the closing quote
    m_dt = re.search(r'Date:\s*(.+?)"', lines[2]) if len(lines) > 2 else None
    asof = (m_dt.group(1).strip() if m_dt else "").strip('"')
    return dict(symbol=name, spot=spot, change=change, asof=asof)


def list_expirations(csv_path: str) -> list[str]:
    """Distinct expirations in chronological order (front-month first)."""
    raw = pd.read_csv(csv_path, skiprows=_HEADER_ROWS, header=None, dtype=str)
    exps = raw[_COL["exp"]].dropna().unique().tolist()
    return sorted(exps, key=_exp_key)


def energy(strike, spot, iv, tau):
    """The latent premium field (synthetic energy proxy) per option:

        E = (K / S)² · IV · √τ

    Premium is not Dealer Intent (OI) nor Dealer Transaction (Volume) — it is the
    energy weighting of the hedging burden carried by inventory. CME observes it
    directly; CBOE does not, so the adapter RECONSTRUCTS it from the observables
    CBOE *does* publish (strike, spot, per-side IV, time). The moneyness² term is
    the geometric hedging leverage, IV the vol-risk intensity, √τ the temporal
    accrual. Downstream the engine consumes this exactly as it consumes observed
    premium — the analytics never distinguish observed from reconstructed."""
    with np.errstate(invalid="ignore", divide="ignore"):
        m2 = np.square(np.asarray(strike, float) / float(spot)) if np.isfinite(spot) and spot else np.nan
        return m2 * np.asarray(iv, float) * np.sqrt(np.asarray(tau, float))


def ingest_cboe(csv_path: str, expiration: str | None = None,
                premium: str = "energy", premium_proxy: str | None = None) -> pd.DataFrame:
    """CBOE quotedata CSV → canonical Qu'an Golden Reference chain frame.

    Parameters
    ----------
    expiration : one of list_expirations(); None → front month (nearest expiry).
                 Pass "ALL" to aggregate across every expiration per strike
                 (term-structure collapse — a total dealer-book read).
    premium    : how the (latent) premium field is produced —
                 "energy" (DEFAULT) reconstructs E=(K/S)²·IV·√τ so the FULL
                            golden-reference cascade (DID/DIT/DR3/CDS, pressure)
                            runs identically to CME;
                 "mid"    ((Bid+Ask)/2), "last" (Last Sale) — observed-proxy modes;
                 "none"   leaves premium NaN (structural P-C branch only).
    premium_proxy : deprecated alias for `premium` (back-compat).

    Returns the canonical frame (identical schema to ingest_chain):
      strike, callPrem, putPrem, callOI, putOI, callVol, putVol, callLatest, putLatest
    plus inherited observables for the greeks/vol modules:
      callIV, putIV, callDelta, putDelta, callGamma, putGamma, callEnergy, putEnergy, tau
    Metadata on frame.attrs (symbol/spot/asof/expiration/premium_source).
    """
    if premium_proxy is not None:            # back-compat: old kwarg wins if passed
        premium = premium_proxy
    meta = read_cboe_meta(csv_path)
    spot = meta.get("spot")
    asof_dt = _parse_asof(meta.get("asof"))
    raw = pd.read_csv(csv_path, skiprows=_HEADER_ROWS, header=None, dtype=str)
    raw = raw[raw[_COL["strike"]].notna()].copy()

    exps = sorted(raw[_COL["exp"]].dropna().unique().tolist(), key=_exp_key)
    if expiration is None:
        expiration = exps[0] if exps else None
    if expiration and expiration != "ALL":
        raw = raw[raw[_COL["exp"]].astype(str).str.strip() == str(expiration).strip()]

    g = lambda k: _num(raw[_COL[k]].values).to_numpy(dtype=float)
    K = g("strike")
    cIV, pIV = g("callIV"), g("putIV")
    tau = np.array([_tau_years(e, asof_dt) for e in
                    raw[_COL["exp"]].astype(str).str.strip().to_numpy()], dtype=float)

    # Reconstruct the latent premium surface (per side; same moneyness²·√τ, own IV).
    cE = energy(K, spot, cIV, tau)
    pE = energy(K, spot, pIV, tau)

    out = pd.DataFrame({
        "strike": K,
        "callOI": g("callOI"), "putOI": g("putOI"),
        "callVol": g("callVol"), "putVol": g("putVol"),
        "callLatest": g("callLast"), "putLatest": g("putLast"),
        "callIV": cIV, "putIV": pIV,
        "callDelta": g("callDelta"), "putDelta": g("putDelta"),
        "callGamma": g("callGamma"), "putGamma": g("putGamma"),
        "callEnergy": cE, "putEnergy": pE, "tau": tau,
    })

    if premium == "energy":
        out["callPrem"], out["putPrem"] = cE, pE
    elif premium == "mid":
        out["callPrem"] = (g("callBid") + g("callAsk")) / 2.0
        out["putPrem"] = (g("putBid") + g("putAsk")) / 2.0
    elif premium == "last":
        out["callPrem"], out["putPrem"] = g("callLast"), g("putLast")
    else:  # "none"
        out["callPrem"], out["putPrem"] = np.nan, np.nan

    out = out.dropna(subset=["strike"])
    if expiration == "ALL":
        # term-structure collapse: sum flow/OI; OI-weight the premium & greeks
        flow = ["callOI", "putOI", "callVol", "putVol"]
        agg = out.groupby("strike", as_index=False)[flow].sum(min_count=1)
        wcols = ["callPrem", "putPrem", "callEnergy", "putEnergy", "callIV", "putIV",
                 "callDelta", "putDelta", "callGamma", "putGamma", "callLatest", "putLatest", "tau"]
        w = out.assign(_w=out["callOI"].fillna(0) + out["putOI"].fillna(0))
        for c in wcols:
            num = (w[c].fillna(0) * w["_w"]).groupby(w["strike"]).sum()
            den = w["_w"].groupby(w["strike"]).sum().replace(0, np.nan)
            agg[c] = agg["strike"].map((num / den))
        out = agg
    out = out.sort_values("strike").reset_index(drop=True)
    lead = ["strike", "callPrem", "putPrem", "callOI", "putOI",
            "callVol", "putVol", "callLatest", "putLatest"]
    out = out[lead + [c for c in out.columns if c not in lead]]
    out.attrs.update(meta)
    out.attrs["expiration"] = expiration
    out.attrs["premium_source"] = "reconstructed:energy" if premium == "energy" else \
        ("observed:" + premium if premium in ("mid", "last") else "none")
    return out


# ─────────────────────────────────────────────────────────────
# GOLDEN REFERENCE — the complete CBOE read. With premium reconstructed, the
# FULL cascade runs: Dealer Intent (DID), Dealer Transaction (DIT), DR3, CDS
# bias, skew/kurt moments, apex levels, zones, scorecard. Identical to CME.
# ─────────────────────────────────────────────────────────────
def golden_reference(frame: pd.DataFrame, anchor: float | None = None) -> dict:
    """Construct the Golden Reference surface from a canonical frame — the SAME
    read the CME path produces. The analytics never learn whether premium was
    observed (CME) or reconstructed (CBOE); they consume a completed reference."""
    import warnings
    import quan_engine as QE
    try:
        import quan_scorecard as SC
    except Exception:
        SC = None
    warnings.filterwarnings("ignore", message="Mean of empty slice", category=RuntimeWarning)
    if anchor is None:
        anchor = frame.attrs.get("spot")
        if anchor is None or not np.isfinite(anchor):
            anchor = float(pd.to_numeric(frame["strike"], errors="coerce").median())

    casc = QE.compute_cascade(frame)                      # DID/DIT/DR3 moments, CDS, BIAS, ICF…
    cds = casc.get("CDS", 0.0) or 0.0
    levels = QE.compute_levels(frame, anchor=anchor, cds=cds, bias=casc.get("BIAS"))
    zones = QE.compute_zones(frame, anchor=anchor, cds=cds)
    cards = SC.scorecard(frame, realization_dir="NEUTRAL", anchor=anchor) if SC else []
    ab = QE.apex_basis(frame)
    net = ab["netOI"].fillna(0)
    pcr_oi = frame["putOI"].fillna(0).sum() / max(frame["callOI"].fillna(0).sum(), 1e-9)
    pcr_vol = frame["putVol"].fillna(0).sum() / max(frame["callVol"].fillna(0).sum(), 1e-9)
    _r = lambda v: round(float(v), 4) if isinstance(v, (int, float)) and np.isfinite(v) else None
    return dict(
        meta=dict(frame.attrs),
        exchange=EXCHANGE,
        session=exchange_hours(EXCHANGE),
        premium_source=frame.attrs.get("premium_source", "reconstructed:energy"),
        anchor=round(float(anchor), 2),
        pcr_oi=round(float(pcr_oi), 4), pcr_vol=round(float(pcr_vol), 4),
        net_oi_bias="PUT_HEAVY(support-lean)" if net.sum() > 0 else "CALL_HEAVY(resistance-lean)",
        cascade=dict(CDS=_r(casc.get("CDS")), BIAS=casc.get("BIAS"),
                     DIDS=_r(casc.get("DIDS")), DITS=_r(casc.get("DITS")), DR3S=_r(casc.get("DR3S")),
                     DIDK=_r(casc.get("DIDK")), DITK=_r(casc.get("DITK")), DR3K=_r(casc.get("DR3K")),
                     K=_r(casc.get("K")), S=_r(casc.get("S")), ICF=_r(casc.get("ICF")),
                     Cs=_r(casc.get("Cs")), TP=_r(casc.get("TP")), PP=_r(casc.get("PP"))),
        levels=levels, zones=zones, scorecard=cards[:12],
    )


def pc_surface(frame: pd.DataFrame, anchor: float | None = None) -> dict:
    """Deprecated alias — kept for callers written before the premium
    reconstruction. Returns the full golden_reference() now."""
    return golden_reference(frame, anchor=anchor)


if __name__ == "__main__":
    import sys, os, json
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    path = sys.argv[1] if len(sys.argv) > 1 else "ndx_quotedata.csv"
    exp = sys.argv[2] if len(sys.argv) > 2 else None
    meta = read_cboe_meta(path)
    print(f"# {meta['symbol']}  spot={meta['spot']}  asof={meta['asof']}")
    print(f"# expirations: {', '.join(list_expirations(path))}\n")
    frame = ingest_cboe(path, expiration=exp)
    print(f"# expiration={frame.attrs['expiration']}  strikes={len(frame)}"
          f"  premium={frame.attrs['premium_source']}")
    gr = golden_reference(frame)
    print(json.dumps({k: v for k, v in gr.items() if k != "scorecard"}, indent=2, default=str))
    print("\n# top scorecard strikes:")
    for c in gr["scorecard"][:8]:
        print(f"  {c['strike']:>10}  score={c['score']} tier={c['tier']}"
              f"  {c['gradient']:<14} mass={c['mass']} dist={c['dist']}")
