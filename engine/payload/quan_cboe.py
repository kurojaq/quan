"""
quan_cboe.py — CBOE quotedata proxy of the golden reference.

Adapts a CBOE Global Markets "Download CSV" options export (NDX, SPX, RUT, VIX,
single-name equities, …) into the SAME canonical chain frame that
quan_engine.ingest_chain() produces from the CME vendor CSV. Downstream — apex
levels, zones, per-strike scorecard, relativistic range — is then identical to the
CME path. This is the "proxy of the golden reference": one adapter, and every
CBOE-listed ticker flows through the existing golden-reference cascade.

────────────────────────────────────────────────────────────────────────────
THE PREMIUM GAP (why P-C logic, not the intent cascade)
────────────────────────────────────────────────────────────────────────────
The CME vendor CSV carries a settled `Premium` per side; the golden reference's
INTENT/TRANSACTION/REALIZATION cascade (AN = PutPrem-CallPrem → DID/DIT/DR3 →
CDS bias) is built on it. CBOE quotedata has NO premium field — only Last Sale /
Bid / Ask, which for index options are sparse and stale (mostly 0 or a 20.00
placeholder ask). Feeding those as "premium" would fabricate a bias.

So the proxy leaves premium NULL by default and drives the branch that needs no
premium — the PUT-CALL (P-C) structural logic, computed from OI + Volume, which
CBOE reports reliably:

    O = PutOI - CallOI   (Net OI  → floors/ceilings, dealer walls)
    M = PutOI / CallOI   (PCR-OI)
    L = PutVol - CallVol (Net Txn)
    N = PutVol / CallVol (PCR-Vol)
    LR = (O/M)/(L/N)     (Apex watermark, |LR|>20 = defended wall)
    scorecard Mass/Kurt/T/P  — all derived from [L,M,N,O,P,Q,R,S,T]

`premium_proxy="mid"` or `"last"` is available to opt in to a synthetic premium
(mid = (Bid+Ask)/2) when a chain is liquid enough to trust it — the intent
cascade then lights up — but the default, honest CBOE read is P-C only.

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
    m_dt = re.search(r"Date:\s*(.+?)\"?\s*,", lines[2]) if len(lines) > 2 else None
    asof = (m_dt.group(1).strip() if m_dt else "").strip('"')
    return dict(symbol=name, spot=spot, change=change, asof=asof)


def list_expirations(csv_path: str) -> list[str]:
    """Distinct expirations in chronological order (front-month first)."""
    raw = pd.read_csv(csv_path, skiprows=_HEADER_ROWS, header=None, dtype=str)
    exps = raw[_COL["exp"]].dropna().unique().tolist()
    return sorted(exps, key=_exp_key)


def ingest_cboe(csv_path: str, expiration: str | None = None,
                premium_proxy: str = "none") -> pd.DataFrame:
    """CBOE quotedata CSV → canonical Qu'an chain frame.

    Parameters
    ----------
    expiration : one of list_expirations(); None → front month (nearest expiry).
                 Pass "ALL" to aggregate OI/Vol across every expiration per strike
                 (term-structure collapse — a total dealer-book read).
    premium_proxy : "none" (default, premium = NaN → P-C branch only),
                    "mid"  ((Bid+Ask)/2), or "last" (Last Sale).

    Returns a frame with columns identical to ingest_chain():
      strike, callPrem, putPrem, callOI, putOI, callVol, putVol, callLatest, putLatest
    Metadata (symbol/spot/asof/expiration/premium_proxy) is attached on frame.attrs.
    """
    meta = read_cboe_meta(csv_path)
    raw = pd.read_csv(csv_path, skiprows=_HEADER_ROWS, header=None, dtype=str)
    raw = raw[raw[_COL["strike"]].notna()].copy()

    exps = sorted(raw[_COL["exp"]].dropna().unique().tolist(), key=_exp_key)
    if expiration is None:
        expiration = exps[0] if exps else None
    if expiration and expiration != "ALL":
        raw = raw[raw[_COL["exp"]].astype(str).str.strip() == str(expiration).strip()]

    g = lambda k: _num(raw[_COL[k]].values)
    out = pd.DataFrame({
        "strike":     g("strike"),
        "callOI":     g("callOI"),   "putOI":  g("putOI"),
        "callVol":    g("callVol"),  "putVol": g("putVol"),
        "callLatest": g("callLast"), "putLatest": g("putLast"),
    })

    # Premium: NULL by default (honest CBOE read). Opt-in synthetic proxies.
    if premium_proxy == "mid":
        cmid = (g("callBid") + g("callAsk")) / 2.0
        pmid = (g("putBid") + g("putAsk")) / 2.0
        out["callPrem"], out["putPrem"] = cmid.values, pmid.values
    elif premium_proxy == "last":
        out["callPrem"], out["putPrem"] = g("callLast").values, g("putLast").values
    else:
        out["callPrem"] = np.nan
        out["putPrem"] = np.nan

    out = out.dropna(subset=["strike"])
    if expiration == "ALL":
        # collapse the term structure: sum flow per strike across all expirations
        num_cols = [c for c in out.columns if c != "strike"]
        out = out.groupby("strike", as_index=False)[num_cols].sum(min_count=1)
    out = out.sort_values("strike").reset_index(drop=True)
    out = out[["strike", "callPrem", "putPrem", "callOI", "putOI",
               "callVol", "putVol", "callLatest", "putLatest"]]
    out.attrs.update(meta)
    out.attrs["expiration"] = expiration
    out.attrs["premium_proxy"] = premium_proxy
    return out


# ─────────────────────────────────────────────────────────────
# P-C surface — the CBOE golden-reference proxy read (no premium).
# ─────────────────────────────────────────────────────────────
def pc_surface(frame: pd.DataFrame, anchor: float | None = None) -> dict:
    """Run only the premium-free (P-C) branch of the golden reference:
    apex levels (Net-OI walls / LR watermarks) + the observable scorecard.
    Returns a dict ready to serialize for the terminal / heatmap overlay."""
    import warnings
    import quan_engine as QE
    try:                       # compass engine dir ships no scorecard — degrade cleanly
        import quan_scorecard as SC
    except Exception:
        SC = None
    # Default CBOE path has premium=NaN; the relativistic range does nanmean over
    # those empty slices (→ NaN, the correct "no intent" result). Silence the noise.
    warnings.filterwarnings("ignore", message="Mean of empty slice", category=RuntimeWarning)
    if anchor is None:
        anchor = frame.attrs.get("spot")
        if anchor is None or not np.isfinite(anchor):
            s = pd.to_numeric(frame["strike"], errors="coerce")
            anchor = float(s.median())
    levels = QE.compute_levels(frame, anchor=anchor, cds=0.0)
    zones = QE.compute_zones(frame, anchor=anchor, cds=0.0)
    cards = SC.scorecard(frame, realization_dir="NEUTRAL", anchor=anchor) if SC else []
    ab = QE.apex_basis(frame)
    net = ab["netOI"].fillna(0)
    pcr_oi = frame["putOI"].fillna(0).sum() / max(frame["callOI"].fillna(0).sum(), 1e-9)
    pcr_vol = frame["putVol"].fillna(0).sum() / max(frame["callVol"].fillna(0).sum(), 1e-9)
    return dict(
        meta=dict(frame.attrs),
        exchange=EXCHANGE,
        session=exchange_hours(EXCHANGE),
        anchor=round(float(anchor), 2),
        pcr_oi=round(float(pcr_oi), 4),
        pcr_vol=round(float(pcr_vol), 4),
        net_oi_bias="PUT_HEAVY(support-lean)" if net.sum() > 0 else "CALL_HEAVY(resistance-lean)",
        levels=levels,
        zones=zones,
        scorecard=cards[:12],
        premium_cascade="N/A — CBOE has no premium; run premium_proxy='mid' to enable intent bias",
    )


if __name__ == "__main__":
    import sys, os, json
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    path = sys.argv[1] if len(sys.argv) > 1 else "ndx_quotedata.csv"
    exp = sys.argv[2] if len(sys.argv) > 2 else None
    meta = read_cboe_meta(path)
    print(f"# {meta['symbol']}  spot={meta['spot']}  asof={meta['asof']}")
    print(f"# expirations: {', '.join(list_expirations(path))}\n")
    frame = ingest_cboe(path, expiration=exp)
    print(f"# ingested expiration={frame.attrs['expiration']}  strikes={len(frame)}"
          f"  premium={frame.attrs['premium_proxy']}")
    surf = pc_surface(frame)
    print(json.dumps({k: v for k, v in surf.items() if k != "scorecard"}, indent=2, default=str))
    print("\n# top scorecard strikes (P-C observable):")
    for c in surf["scorecard"][:8]:
        print(f"  {c['strike']:>10}  score={c['score']} tier={c['tier']}"
              f"  {c['gradient']:<14} mass={c['mass']} dist={c['dist']}")
