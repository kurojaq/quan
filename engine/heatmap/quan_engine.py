"""
quan_engine.py — Qu'an signal engine (clean re-house of golden_reference)

Faithful port of the golden_reference.xlsx cascade. Validated to reproduce the
canonical/oracle numbers across 6 sessions, 2 instruments (see validate_engine.py).

Cascade (Book-sheet column letters):
    Net Premium AN = PutPrem-CallPrem | Net OI O = PutOI-CallOI | Net Txn L = PutVol-CallVol
    DID AP = AN/O | DIT AR = AN/L | DR3 AT = AP/AR
    DIDS/DITS/DR3S = SKEW(AP/AR/AT) ; DIDK/DITK/DR3K = KURT(...)
    CDS = (sign[DIDS<0]+sign[DITS<0]+sign[DR3S>0])/3
Scalars (DB block):  K=DR3K/(DIDK/DITK) S=DR3S/(DIDS/DITS) ICF=1+K+S Cs=K^2/S^2
                     TP=1-|S/K| PP=1-K/S
Levels (Apex dealer basis): NetOI>0 -> floor/support, NetOI<0 -> ceiling/resistance;
                     watermark where |LR|>20, LR=A/B, A=NetOI/PCR(OI), B=NetVol/PCR(Vol).
Fidelity: blanks behave as 0 in Net subtraction; ratio cells exclude div-by-zero rows
          from their column's SKEW/KURT; SKEW/KURT are Excel sample formulas.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

# ---------------------------------------------------------------- moments
def excel_skew(values) -> float:
    x = np.asarray(values, float); x = x[np.isfinite(x)]; n = x.size
    if n < 3: return float("nan")
    m, s = x.mean(), x.std(ddof=1)
    if s == 0: return float("nan")
    return n / ((n - 1) * (n - 2)) * np.sum(((x - m) / s) ** 3)

def excel_kurt(values) -> float:
    x = np.asarray(values, float); x = x[np.isfinite(x)]; n = x.size
    if n < 4: return float("nan")
    m, s = x.mean(), x.std(ddof=1)
    if s == 0: return float("nan")
    t1 = n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * np.sum(((x - m) / s) ** 4)
    t2 = 3 * (n - 1) ** 2 / ((n - 2) * (n - 3))
    return t1 - t2

# ---------------------------------------------------------------- ingest
def _clean(series: pd.Series) -> pd.Series:
    s = (series.astype(str).str.replace(",", "", regex=False).str.rstrip("s").str.strip()
         .replace({"N/A": np.nan, "": np.nan, "nan": np.nan, "None": np.nan}))
    return pd.to_numeric(s, errors="coerce")

def ingest_chain(csv_path: str) -> pd.DataFrame:
    raw = pd.read_csv(csv_path)
    out = pd.DataFrame({
        "strike": _clean(raw["Strike"]),
        "callPrem": _clean(raw["Premium"]),   "putPrem": _clean(raw["Premium.1"]),
        "callOI": _clean(raw["Open Int"]),     "putOI": _clean(raw["Open Int.1"]),
        "callVol": _clean(raw["Volume"]),      "putVol": _clean(raw["Volume.1"]),
        "callLatest": _clean(raw["Latest"]),   "putLatest": _clean(raw["Latest.1"]),
    })
    return out.dropna(subset=["strike"]).sort_values("strike").reset_index(drop=True)


def ingest_book(xlsx_path: str, sheet: str = "Book") -> pd.DataFrame:
    """Read a parser-stage Book (.xlsx) raw inputs into the engine frame.
    Handles duplicate headers (e.g. the triple 'Strike' columns) by choosing,
    for each field, the column with the most populated cells."""
    import openpyxl
    wb = openpyxl.load_workbook(xlsx_path, data_only=False, read_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    hdr, data = rows[0], rows[1:]
    namecols = {}
    for c, h in enumerate(hdr):
        namecols.setdefault(str(h).strip().lower() if h is not None else "", []).append(c)
    def col(name):
        best_ser, bestn = pd.Series([np.nan] * len(data)), -1
        for c in namecols.get(name, []):
            ser = _clean(pd.Series([r[c] if c < len(r) else None for r in data]))
            cnt = int(ser.notna().sum())
            if cnt > bestn: best_ser, bestn = ser, cnt
        return best_ser
    frame = pd.DataFrame({
        "strike": col("strike"),
        "callPrem": col("call premium"), "putPrem": col("put premium"),
        "callOI": col("call oi"),        "putOI": col("put oi"),
        "callVol": col("call vol"),      "putVol": col("put vol"),
        "callLatest": col("call latest"),"putLatest": col("put latest"),
    })
    return frame.dropna(subset=["strike"]).sort_values("strike").reset_index(drop=True)


def load_chain(path: str) -> pd.DataFrame:
    """Dispatch: .xlsx -> Book reader, else vendor CSV."""
    return ingest_book(path) if path.lower().endswith((".xlsx", ".xlsm")) else ingest_chain(path)

# ---------------------------------------------------------------- cascade + scalars
BIAS_TIERS = ((lambda c: c >= 0.67, "STRONG_BULL"), (lambda c: c > 0, "BULL_BIAS"),
              (lambda c: c == 0, "NEUTRAL"), (lambda c: c >= -0.67, "BEAR_BIAS"),
              (lambda c: True, "STRONG_BEAR"))

def bias_tier(cds: float) -> str:
    for test, label in BIAS_TIERS:
        if test(cds): return label
    return "NEUTRAL"

def compute_cascade(frame: pd.DataFrame) -> dict:
    AN = frame["putPrem"].fillna(0) - frame["callPrem"].fillna(0)
    O  = frame["putOI"].fillna(0)  - frame["callOI"].fillna(0)
    L  = frame["putVol"].fillna(0) - frame["callVol"].fillna(0)
    AP = AN / O.replace(0, np.nan)
    AR = AN / L.replace(0, np.nan)
    AT = AP / AR.replace(0, np.nan)
    DIDS, DIDK = excel_skew(AP), excel_kurt(AP)
    DITS, DITK = excel_skew(AR), excel_kurt(AR)
    DR3S, DR3K = excel_skew(AT), excel_kurt(AT)
    cds = ((1 if DIDS < 0 else -1) + (1 if DITS < 0 else -1) + (1 if DR3S > 0 else -1)) / 3.0
    K = DR3K / (DIDK / DITK); S = DR3S / (DIDS / DITS)
    return {
        "DIDS": DIDS, "DITS": DITS, "DR3S": DR3S, "DIDK": DIDK, "DITK": DITK, "DR3K": DR3K,
        "CDS": cds, "BIAS": bias_tier(cds),
        "K": K, "S": S, "ICF": 1 + K + S, "Cs": K**2 / S**2,
        "TP": 1 - abs(S / K), "PP": 1 - K / S,
        "n_strikes": int(frame.shape[0]),
    }

# ---------------------------------------------------------------- Apex level basis
def apex_basis(frame: pd.DataFrame) -> pd.DataFrame:
    cO, pO = frame["callOI"].fillna(0), frame["putOI"].fillna(0)
    cV, pV = frame["callVol"].fillna(0), frame["putVol"].fillna(0)
    O = pO - cO; L = pV - cV
    M = pO / cO.replace(0, np.nan); N = pV / cV.replace(0, np.nan)
    A = O / M.replace(0, np.nan);   B = L / N.replace(0, np.nan)
    LR = A / B.replace(0, np.nan)
    return pd.DataFrame({"strike": frame["strike"], "netOI": O, "LR": LR, "cOI": cO, "pOI": pO})

def compute_levels(frame, anchor=None, cds=0.0, target_offset=50.0, n_watermarks=4, bias=None) -> dict:
    """Corridor levels from VERIFIED framework primitives only.

    HONEST SCOPE NOTE (2026-05-31): The framework's range/displacement family lives in Book_Globals —
    R(d)=max(strike)-min(strike), MRW=|ICA-TCA|, ES=PP*MRW, EO=MRW/PP, FE=EO+ES, FP=RS*MRW. These are the
    ONLY documented range primitives. The framework reference does NOT document the scaling that maps these
    to a projected daily HIGH/LOW around the anchor (raw MRW~9.5k, ES~133k are in curvature-anchor units, not
    NQ points). Until that mapping is verified from the original documents, this function does NOT fabricate a
    percent-band or offset-projected corridor. It reports the structural walls the framework DOES define:
    NetOI tiers (floorMin 50 / ceilingMin -50 / strong +-150 per Coefficient_Reference) and LR watermark>20.
    The terminal's QUAN_DAILY_ZONE/QUAN_WEEKLY_ZONE percent-bands were a terminal-only construct and are NOT
    used here (they are not in the framework).
    """
    ab = apex_basis(frame)
    # DISTANCE GATE: levels must sit within a sane band of the anchor. Far-OTM strikes carry leftover
    # OI (e.g. a 4000-pt-OTM call with stale OI=100) that would otherwise win the ceiling/floor pick and
    # produce absurd levels. The framework's own range family bounds this: use the MRW range projection
    # (~3.9*sqrt(MRW)) as the displacement scale; allow a 3x multiple for the outer ladder reach. Same
    # liquidity/distance discipline already applied to watermarks, gamma walls, and pressure ranges.
    if anchor is not None:
        try:
            import quan_relativistic as _REL
            _mrw = abs(_REL.compute_relativistic(frame, cds).get("MRW", 0.0))
            _rproj = 3.9 * (_mrw ** 0.5) if _mrw > 0 else 0.0
        except Exception:
            _rproj = 0.0
        # fall back to a percent band if MRW unavailable; cap reach at 3x the range projection
        band = max(_rproj * 3.0, anchor * 0.05) if _rproj > 0 else anchor * 0.06
        ab = ab[(ab["strike"] >= anchor - band) & (ab["strike"] <= anchor + band)].copy()
    floors = ab[ab["netOI"] > 0]      # put-heavy -> support (attractor)
    ceils  = ab[ab["netOI"] < 0]      # call-heavy -> resistance (repulsor)
    lv = {}
    # strongest structural walls (framework NetOI tiers — regime-independent)
    if not floors.empty:
        lv["SFLOOR"] = float(floors.loc[floors["netOI"].idxmax(), "strike"])
    if not ceils.empty:
        lv["SCEIL"]  = float(ceils.loc[ceils["netOI"].idxmin(), "strike"])
    if anchor is not None:
        # LADDER design (Spence 2026-05-31, watermark-first):
        #   CEILING = the gravitational pull above — a DEFENDED WATERMARK (|LR|>20) outranks a thicker-but-
        #   undefended strike, because dealers are committed/must-hedge there. Ladder climbs watermark-first,
        #   skipping thin noise. Qualify a ceiling rung by: watermark(netOI<0) OR |netOI|>=100. Nearest-first.
        #   FLOOR = strongest wall below (by |netOI|) — the dominant support, incl. a converted ceiling.
        #   Floor ladder rungs qualify the same way (watermark OR |netOI|>=100), nearest-first.
        #   (anchor-relative here; Pine re-bases active/crossed against LIVE price + session hi/lo.)
        def _is_wm(r): return (r.LR == r.LR) and abs(r.LR) > 20      # LR finite and >20
        cl = ab[(ab["strike"] > anchor) & (((ab["LR"].abs() > 20) & (ab["netOI"] < 0)) | (ab["netOI"] <= -100))]
        fl = ab[(ab["strike"] < anchor) & (((ab["LR"].abs() > 20) & (ab["netOI"] > 0)) | (ab["netOI"] >= 100))]
        cl = cl.sort_values("strike")                   # ascending: nearest above first
        fl = fl.sort_values("strike", ascending=False)  # descending: nearest below first
        # carry up to 6 rungs each side; Pine numbers active/backup and converts crossed rungs vs live price
        lv["CLADDER"] = [(float(r.strike), float(r.netOI), 1 if _is_wm(r) else 0) for r in cl.head(6).itertuples()]
        lv["FLADDER"] = [(float(r.strike), float(r.netOI), 1 if _is_wm(r) else 0) for r in fl.head(6).itertuples()]
        # DEALER FLOOR (Layer 1) = strongest wall below anchor (by |netOI|); DEALER CEILING (Layer 1) = nearest
        # defended watermark above anchor, else strongest wall above. Pine re-anchors these to live price.
        belowAll = ab[ab["strike"] < anchor]
        aboveWM  = ab[(ab["strike"] > anchor) & (ab["LR"].abs() > 20) & (ab["netOI"] < 0)].sort_values("strike")
        aboveAll = ab[(ab["strike"] > anchor) & (ab["netOI"] < 0)]
        if not belowAll.empty:
            lv["DFLOOR"] = float(belowAll.loc[belowAll["netOI"].abs().idxmax(), "strike"])
        if not aboveWM.empty:
            lv["DCEIL"] = float(aboveWM.iloc[0]["strike"])        # nearest defended watermark above
        elif not aboveAll.empty:
            lv["DCEIL"] = float(aboveAll.loc[aboveAll["netOI"].idxmin(), "strike"])  # else strongest wall above
        # TARGET LADDER (Spence 2026-05-31): directional tiered objectives from the anchor — fixed-offset
        # projection (T1/T2/T3) in the CDS direction. Honest: a fixed-distance projection, NOT a chain-read
        # level. Restores the __14 target read (anchor +50 = T1) as a labeled tier ladder. Downside mass/jerk
        # target (bottoming-out) is deferred to the Python/live-data side, not here.
        tgt_step = target_offset   # default 50
        if cds > 0:
            lv["TLADDER"] = [(round(anchor + tgt_step * k, 2), k) for k in (1, 2, 3)]
        elif cds < 0:
            lv["TLADDER"] = [(round(anchor - tgt_step * k, 2), k) for k in (1, 2, 3)]
        else:
            lv["TLADDER"] = []
        # TARGET (single, back-compat) = first tier in the CDS direction; else dealer ceiling/floor
        if lv["TLADDER"]:
            lv["TARGET"] = lv["TLADDER"][0][0]
        elif cds > 0 and "DCEIL" in lv:   lv["TARGET"] = lv["DCEIL"]
        elif cds < 0 and "DFLOOR" in lv: lv["TARGET"] = lv["DFLOOR"]
    wm = ab[ab["LR"].abs() > 20].copy()
    if not wm.empty:
        wm = wm.reindex(wm["LR"].abs().sort_values(ascending=False).index).head(n_watermarks)
        lv["WMARKS"] = [(float(r.strike), "F" if r.netOI > 0 else "C") for r in wm.itertuples()]
    return lv

def compute_zones(frame, gex_perstrike=None, n_zones=6, anchor=None, cds=0.0) -> list:
    """Top dealer-positioning zones for the overlay's order-block bands.
    Each zone: (strike, side, oi_strength, gex_at_strike).
      side  'F' = demand/floor (netOI>0, dealer-long)  ·  'C' = supply/ceiling (netOI<0)
      oi_strength = |net OI|  -> band WIDTH
      gex_at_strike = |GEX contribution| -> band COLOR INTENSITY (0 if no Greeks supplied)
    gex_perstrike: optional dict {strike: gex_contrib} from greeks_from_barchart.
    """
    ab = apex_basis(frame)
    # same distance gate as compute_levels — exclude far-OTM remnant strikes
    if anchor is not None:
        try:
            import quan_relativistic as _REL
            _mrw = abs(_REL.compute_relativistic(frame, cds).get("MRW", 0.0))
            _rproj = 3.9 * (_mrw ** 0.5) if _mrw > 0 else 0.0
        except Exception:
            _rproj = 0.0
        band = max(_rproj * 3.0, anchor * 0.05) if _rproj > 0 else anchor * 0.06
        ab = ab[(ab["strike"] >= anchor - band) & (ab["strike"] <= anchor + band)]
    ab = ab[ab["netOI"].abs() > 0].copy()
    ab["mag"] = ab["netOI"].abs()
    ab = ab.reindex(ab["mag"].sort_values(ascending=False).index).head(n_zones)
    gx = gex_perstrike or {}
    zones = []
    for r in ab.itertuples():
        side = "F" if r.netOI > 0 else "C"
        gexv = abs(gx.get(float(r.strike), 0.0))
        zones.append((float(r.strike), side, float(r.mag), float(gexv)))
    return zones


# ---------------------------------------------------------------- payload (Pine contract)
def emit_payload(signals, anchor=None, levels=None, gex=None, zones=None, exec_seg=None) -> str:
    levels = levels or {}
    fields = [("ANCHOR", anchor), ("BIAS", signals.get("BIAS")), ("CDS", round(signals.get("CDS", 0.0), 2)),
              ("DFLOOR", levels.get("DFLOOR")), ("DCEIL", levels.get("DCEIL")),
              ("WFLOOR", levels.get("WFLOOR")), ("WCEIL", levels.get("WCEIL")),
              ("SFLOOR", levels.get("SFLOOR")), ("SCEIL", levels.get("SCEIL")),
              ("TARGET", levels.get("TARGET"))]
    parts = [f"{k}={v}" for k, v in fields if v is not None]
    if levels.get("WMARKS"):
        parts.append("WMARKS=" + ",".join(f"{px}:{side}" for px, side in levels["WMARKS"]))
    # GEX layer (from Barchart-quoted Greeks; optional). GDIR: +1 bullish delta, -1 bearish.
    if gex:
        if gex.get("gex") is not None:
            parts.append(f"GEX={round(gex['gex'])}")
        d = gex.get("direction", "")
        gdir = 1 if d.startswith("BULL") else (-1 if d.startswith("BEAR") else 0)
        parts.append(f"GDIR={gdir}")
        if gex.get("walls"):  # list of (strike, gex_contrib)
            parts.append("GWALLS=" + ",".join(f"{px}" for px, _ in gex["walls"][:4]))
    # Dealer-positioning ZONES (order-block bands). strike:side:oiNorm:gexNorm, each 0-1.
    if zones:
        oi_max = max((z[2] for z in zones), default=0) or 1.0
        gx_max = max((z[3] for z in zones), default=0) or 1.0
        zparts = []
        for strike, side, oi, gx in zones:
            oin = round(oi / oi_max, 3)
            gxn = round(gx / gx_max, 3) if gx_max else 0.0
            zparts.append(f"{strike}:{side}:{oin}:{gxn}")
        parts.append("ZONES=" + ",".join(zparts))
    if exec_seg:
        parts.append(exec_seg)
    # Framework state read: REGIME (action), WAVE-TYPE (path-shape), FLIP-WATCH (Tier-2 recompute flag).
    rg = signals.get("REGIME")
    if rg:
        parts.append(f"REGIME={rg.get('regime')}")
        parts.append(f"RDIR={rg.get('direction')}")
        ro = rg.get("readout", {})
        if ro.get("TP") is not None:
            parts.append(f"TP={round(ro['TP'],3)}")  # bow draw
            parts.append(f"TR={round(ro.get('TR',0),3)}")  # bow release
    wt = signals.get("WAVE_TYPE")
    if wt and wt.get("wave"):
        parts.append(f"WAVE={wt['wave']}")
        sg = wt.get("signature", {})
        if sg.get("destructive_nodes") is not None:
            parts.append(f"WNODES={sg['destructive_nodes']}")
    fw = signals.get("FLIP_WATCH")
    if fw and fw.get("flip_imminent"):
        parts.append("FLIPWATCH=1")
        ma = fw.get("marginal_axes", [])
        if ma:
            parts.append(f"FLIPAXIS={ma[0]['axis'].split('(')[0]}")
    return "|".join(parts)

def run(csv_path: str, anchor=None, T_days=1.0) -> dict:
    """Single standalone entry point: chain -> full framework read -> regime + implied action -> payload.
    Composes the verified static (Tier-1) layers: cascade, field-state, greeks, significance, regime."""
    frame = ingest_chain(csv_path)
    sig = compute_cascade(frame)
    lv = compute_levels(frame, anchor=anchor, cds=sig["CDS"], bias=sig.get("BIAS"))
    sig["LEVELS"] = lv

    # Tier-1 framework axes (verified)
    try:
        import quan_field_state as _FS
        sig["FIELD_STATE"] = _FS.field_state(frame)
    except Exception as e:
        sig["FIELD_STATE"] = None; sig["_field_state_err"] = str(e)
    try:
        import quan_significance as _SIG
        sig["SIGNIFICANCE"] = _SIG.significance(frame)
    except Exception as e:
        sig["SIGNIFICANCE"] = None
    if anchor is not None:
        try:
            import quan_greeks as _GK
            sig["GREEKS"] = _GK.gex_read(frame, float(anchor), multiplier=20.0, r=0.053, T_days=T_days)
        except Exception as e:
            sig["GREEKS"] = None

    # Tier-1 regime classifier (the framework as strategy)
    if sig.get("FIELD_STATE"):
        try:
            import quan_regime as _RG
            sig["REGIME"] = _RG.field_regime(sig, sig["FIELD_STATE"], sig.get("SIGNIFICANCE"))
        except Exception as e:
            sig["REGIME"] = None; sig["_regime_err"] = str(e)

    # Wave-type axis (expected daily path-shape from fold-coherence graphs)
    try:
        import quan_wavetype as _WT
        sig["WAVE_TYPE"] = _WT.classify_wave(frame)
    except Exception as e:
        sig["WAVE_TYPE"] = None; sig["_wave_err"] = str(e)

    # Tier-2: imminent-flip watch (marginal cascade axis + early coherence breaks)
    try:
        import quan_flipwatch as _FW
        import quan_realization as _R
        sig["FLIP_WATCH"] = _FW.flip_watch(sig, realization=_R.realization_waves(frame, 0))
    except Exception as e:
        sig["FLIP_WATCH"] = None; sig["_flip_err"] = str(e)

    # Per-strike liquidity profile (canonical T-watermark @|T|>=20, sign-aware + cluster;
    # optional within-session W relative overlay). Spatial view the Book never surfaces.
    try:
        import quan_perstrike as _PS
        import quan_liquidity as _LQ
        sig["LIQUIDITY"] = _LQ.liquidity_profile(_PS.per_strike(frame), w_overlay=True)
    except Exception as e:
        sig["LIQUIDITY"] = None; sig["_liq_err"] = str(e)

    sig["PAYLOAD"] = emit_payload(sig, anchor=anchor, levels=lv)
    return sig

if __name__ == "__main__":
    import sys
    anchor = float(sys.argv[2]) if len(sys.argv) > 2 else None
    T_days = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    r = run(sys.argv[1], anchor=anchor, T_days=T_days)
    print("scalars: CDS=%.2f (%s) Cs=%.2f" % (r["CDS"], r["BIAS"], r["Cs"]))
    if r.get("FIELD_STATE"):
        fs = r["FIELD_STATE"]
        print("field: type=%s SC=%s WSF=%.2f/%.2f/%.2f intentTL=%.0f" % (
            fs["field_type"], fs["spacetime"]["SC"], fs["WSF"]["I"], fs["WSF"]["T"], fs["WSF"]["R"],
            fs["trend_length"]["intent"]))
    if r.get("REGIME"):
        rg = r["REGIME"]
        print("REGIME: %s  (%s)" % (rg["regime"], rg["direction"]))
        print("ACTION: %s" % rg["action"])
    if r.get("WAVE_TYPE"):
        wt = r["WAVE_TYPE"]
        sg = wt.get("signature", {})
        print("WAVE: %s  (nodes=%s ZC=%s energy=%s) -> %s" % (
            wt["wave"], sg.get("destructive_nodes"), sg.get("fold_zero_crosses"),
            sg.get("fold_energy"), wt.get("expected_path")))
    if r.get("FLIP_WATCH") and r["FLIP_WATCH"].get("flip_imminent"):
        print("FLIP-WATCH: " + r["FLIP_WATCH"]["directive"])
