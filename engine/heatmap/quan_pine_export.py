"""
quan_pine_export.py — emit the compact per-strike snapshot Pine needs for live price-driven Greeks.

Pine cannot fetch a chain, so the pre-session run exports: the corridor levels + a compact per-strike
table (strike : callOI : putOI : sigma) for the meaningful strikes near ATM. Pine freezes this snapshot
and recomputes Black-76 Δ/Γ against LIVE price F and LIVE time T at each 0.1 session-t mark, inside the
corridor (anchored to session-open price per the framework's session-open anchor rule).
"""
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, ".")
from quan_engine import ingest_chain, compute_cascade, compute_levels, compute_zones
import quan_greeks as GK
import quan_realization as R
import quan_temporal as T
import quan_tensor_field as TF
import quan_execution as EXE
import quan_perstrike as PS
import numpy as _npp
import numpy as _np


def export_snapshot(csv_path, anchor, multiplier=20.0, T_days=1.0, window=400, max_strikes=14, greeks_csv=None, survivors=None):
    # NOTE (perf 2026-06-02): the Pine indicator runs 3 per-bar loops over every SNAP strike doing
    # Black-76 Greek recomputes on EVERY historical bar. 30 strikes over +-900pt made TradingView slow
    # to load. Far-OTM strikes contribute ~0 Greeks at spot, so we trim to the near-anchor band
    # (window +-400, <=14 strikes). Cuts per-bar work ~half with no meaningful loss in the live Greek read.
    fr = ingest_chain(csv_path)
    cas = compute_cascade(fr)
    lv = compute_levels(fr, anchor=anchor, cds=cas["CDS"], bias=cas.get("BIAS"))
    # GREEK SOURCE: if a vendor greeks CSV is supplied (Barchart volatility-greeks export), use its
    # per-strike IV/gamma directly and weight by THIS chain's OI; else solve greeks from premium as before.
    # Pressure/cascade/levels/realization always run off the chain (fr); only the greek layer is swapped.
    if greeks_csv:
        gf = GK.load_greeks_csv(greeks_csv)
    else:
        gf = GK.greeks_from_chain(fr, anchor, multiplier=multiplier, T_days=T_days)
    greeks = GK.greeks_layer(fr, gf, anchor, multiplier=multiplier)
    # SURVIVING LEVELS (additive): peaks of the longer-dated book that outlives the front,
    # cross-expiry persistence-gated. survivors = [{"chain": path, "greeks": path|None}, ...]
    swall = ""
    if survivors:
        def _gmap(L):
            return {round(float(s)): abs(float(v)) for s, v in zip(L.get("strikes", []), L.get("gex_perstrike", []))}
        front_g = _gmap(greeks)
        surv_g = []
        for sv in survivors:
            try:
                sfr = ingest_chain(sv["chain"])
                if sv.get("greeks"):
                    sgf = GK.load_greeks_csv(sv["greeks"])
                else:
                    sgf = GK.greeks_from_chain(sfr, anchor, multiplier=multiplier, T_days=T_days)
                surv_g.append(_gmap(GK.greeks_layer(sfr, sgf, anchor, multiplier=multiplier)))
            except Exception:
                continue
        swall = GK.surviving_levels(front_g, surv_g, top=6, topk=8)
    survseg = ("|SWALLS=" + swall) if swall else ""
    gex_ps = {}
    if greeks and "strikes" in greeks:
        gex_ps = {float(s): abs(v) for s, v in zip(greeks["strikes"], greeks["gex_perstrike"])}
    m = pd.merge(fr[["strike", "callOI", "putOI"]], gf[["strike", "cIV"]], on="strike", how="inner")
    m["callOI"] = m["callOI"].fillna(0); m["putOI"] = m["putOI"].fillna(0)
    m["totOI"] = m["callOI"] + m["putOI"]
    near = m[(m["strike"] >= anchor - window) & (m["strike"] <= anchor + window) & (m["totOI"] > 0)].copy()
    near = near.reindex(near["totOI"].sort_values(ascending=False).index).head(max_strikes).sort_values("strike")
    snap = []
    for r in near.itertuples():
        sig = r.cIV if (isinstance(r.cIV, float) and np.isfinite(r.cIV)) else 0.20
        snap.append(f"{r.strike:.0f}:{r.callOI:.0f}:{r.putOI:.0f}:{sig:.3f}")
    # ZONES: every dealer floor/ceiling band -> strike:side:oiNorm:gexNorm (Pine draws green/red boxes)
    zones = compute_zones(fr, gex_perstrike=gex_ps, n_zones=10, anchor=anchor, cds=cas["CDS"])
    zstr = ""
    if zones:
        oimax = max((z[2] for z in zones), default=1.0) or 1.0
        gxmax = max((z[3] for z in zones), default=1.0) or 1.0
        zstr = ",".join(f"{z[0]:.0f}:{z[1]}:{z[2]/oimax:.3f}:{(z[3]/gxmax if gxmax else 0):.3f}" for z in zones)
    # WAVE: time-based forecast markers over session-t. NOT a price path — "watch here" state-shift markers.
    #   fold zero-crossings (where realization coherence flips), conductance windows (field open), tensor peak.
    rw = R.realization_waves(fr, anchor)
    glob = T.temporal_globals(fr)
    cc = _np.array(rw["pressureGradient"]); cd_ = _np.array(rw["pressureCurvature"]); cw = _np.array(rw["cwAxis"])
    cond = T.conductance_chain(cc, cd_, cw, glob["PT"])
    CT = _np.array(cond["CT"])
    cross = ",".join(f"{t:.2f}" for t in rw["crossings_t"])
    condw = ",".join(f"{round((cw[k]+1)/2,2):.2f}" for k in range(len(cw)) if CT[k] > 0)
    ts = TF.tensor_surface(rw["sopG"], rw["sopC"])
    wave = f"FOLDX={cross}|CONDW={condw}|PEAK={ts['peak_offset']:.1f}|LEAN={cas['CDS']:+.2f}"
    # ---- EXECUTION / SIZING layer (framework-Kelly, unit-free) ----
    # b = |FE/ES| (the framework's own payoff ratio; units cancel so it's trustworthy even though ES/FE are
    #     in curvature-anchor units). p = (1+CDS)/2. f* = (b*p - q)/b. Tier from triple-confirmation.
    PP = cas.get("PP"); MRW = glob.get("MRW")
    ES = (PP * MRW) if (PP and MRW) else None
    EO = (MRW / PP) if (PP and MRW and PP != 0) else None
    FE = (EO + ES) if (EO is not None and ES is not None) else None
    b  = abs(FE / ES) if (FE and ES and ES != 0) else 1.0
    didS = cas.get("DIDS", 0.0); ditS = cas.get("DITS", 0.0); dr3S = cas.get("DR3S", 0.0)
    eb = cas.get("entropyBudget", 8)
    es_state = EXE.triple_confirm(cas["CDS"], didS, ditS, dr3S, eb=eb if eb else 8, b=b)
    fstar = max(2.0 * es_state["kellyHalf"], 0.0)        # full Kelly (kellyHalf*2), floored at 0
    # full trigger set from the framework: TR (tap uncrossed wall), CV (pullback to a crossed/converted wall),
    # BR (break-retest momentum). Classified relative to the anchor (Pine re-confirms crossings live).
    zlist = [(z[0], "C" if z[1] == "C" else "P", z[2] if len(z) > 2 else 0, z[3] if len(z) > 3 else 0) for z in (zones or [])]
    trigs = EXE.triggers_from_levels(None, zlist, anchor)
    # tphase = tensor compression-release window (session-t of peak); reuse PEAK->chronoT proxy via crossings
    tphase = (rw["crossings_t"][0] if rw.get("crossings_t") else None)
    execseg = EXE.emit_exec(es_state, triggers=trigs, tphase=tphase)
    # sizing payload: KELLY=b:fstar  TIER=tier:composite  (strategy fork derives contracts from these + stops)
    sizeseg = f"KELLY={b:.4f}:{fstar:.4f}|TIER={es_state['tier']}:{es_state['composite']:.2f}|CDIR={es_state['dir']:+d}"
    # corridor payload (matches the existing Pine payload contract) + the SNAP block + T params
    def g(k): return lv.get(k, "")
    cladder = ",".join(f"{s:.0f}:{int(o)}:{w}" for s, o, w in lv.get("CLADDER", []))
    fladder = ",".join(f"{s:.0f}:{int(o)}:{w}" for s, o, w in lv.get("FLADDER", []))
    tladder = ",".join(f"{s:.0f}:{k}" for s, k in lv.get("TLADDER", []))
    # STATE-FLIP zones (framework AS2: DIT sign change), clustered, mass = sum|Dealer Premium Time AO|.
    # Emitted nearest-first in BOTH directions so Pine picks entry/targets vs live price. strike:mass.
    ps_ = PS.per_strike(fr).sort_values("strike")
    _ar = ps_["AR"].values; _ao = ps_["AO"].abs().values; _sk = ps_["strike"].values
    _flips = [(_sk[i], _ao[i]) for i in range(1, len(_ar))
              if (_ar[i] == _ar[i] and _ar[i-1] == _ar[i-1] and _ar[i] * _ar[i-1] < 0)]
    _zones = []
    for s, mass in _flips:
        if _zones and s - _zones[-1][-1] <= 25.0:
            _zones[-1][0].append(s); _zones[-1][1] += mass; _zones[-1].append(s)
        else:
            _zones.append([[s], mass, s])
    flipz = ",".join(f"{float(_npp.mean(z[0])):.0f}:{z[1]:.0f}" for z in _zones)
    # PRESSURE→GRAVITY map points (parity with the PDF map): top intent |DID| (BH) + transaction
    # |DIT| (BJ) pressure-accumulation strikes near the anchor, via the framework's own peak helper.
    try:
        from quan_pressure_path import _peaks as _pg_peaks
        _pg_int = _pg_peaks(ps_, "BH", anchor, 700, 3)   # span=700 == the PDF map (brief uses 700)
        _pg_trn = _pg_peaks(ps_, "BJ", anchor, 700, 3)
        pgmap = ",".join([f"{float(s):.0f}:I" for s, _v in _pg_int]
                         + [f"{float(s):.0f}:T" for s, _v in _pg_trn])
    except Exception:
        pgmap = ""
    wm = ",".join(f"{s:.0f}:{sd}" for s, sd in lv.get("WMARKS", []))
    # MRW DAILY CORRIDOR (calibrated 2026-06-02, n=4): projected session range = 3.9*sqrt(MRW),
    # centered on the anchor. RLO/RHI = corridor floor/ceiling, RPROJ = full width. NQ k=3.9 (CV 0.09,
    # MAPE 7% across 4 sessions). Honest: range projection only, NOT direction; unvalidated vs vol baseline.
    mrwseg = ""
    try:
        import quan_relativistic as _REL
        _mrw = abs(_REL.compute_relativistic(fr, cas["CDS"]).get("MRW", 0.0))
        if _mrw > 0:
            _rproj = 3.9 * (_mrw ** 0.5)
            _rlo = anchor - _rproj / 2.0
            _rhi = anchor + _rproj / 2.0
            mrwseg = f"|MRW={_mrw:.0f}|RPROJ={_rproj:.0f}|RLO={_rlo:.1f}|RHI={_rhi:.1f}"
    except Exception:
        mrwseg = ""
    # ---- framework state read: REGIME (action) · WAVE-TYPE (path-shape) · FLIP-WATCH (Tier-2 recompute) ----
    import quan_field_state as _FS, quan_significance as _SIG, quan_regime as _RG, quan_wavetype as _WT, quan_flipwatch as _FW
    regseg = ""
    _ftype = ""
    try:
        fs = _FS.field_state(fr); sg = _SIG.significance(fr)
        rg = _RG.field_regime(cas, fs, sg)
        _ftype = rg.get("field_type", fs.get("field_type", ""))
        ro = rg.get("readout", {})
        regseg = f"|REGIME={rg['regime']}|RDIR={rg['direction']}"
        if ro.get("TP") is not None:
            regseg += f"|TP={ro['TP']:.3f}|TR={ro.get('TR',0):.3f}"
    except Exception:
        pass
    waveseg = ""
    _wavelabel = ""
    try:
        wt = _WT.classify_wave(fr)
        if wt.get("wave"):
            _wavelabel = wt["wave"]
            waveseg = f"|WAVE={wt['wave']}"
            wn = wt.get("signature", {}).get("destructive_nodes")
            if wn is not None:
                waveseg += f"|WNODES={wn}"
    except Exception:
        pass
    flipseg = ""
    try:
        fw = _FW.flip_watch(cas, realization=rw)
        if fw.get("flip_imminent"):
            flipseg = "|FLIPWATCH=1"
            ma = fw.get("marginal_axes", [])
            if ma:
                flipseg += f"|FLIPAXIS={ma[0]['axis'].split('(')[0]}"
    except Exception:
        pass
    # ---- DIRECTION: binary BIAS_VOTE from wall-geometry G (primary driver; cascade demoted to context) ----
    # G = sign(dominant gamma wall - anchor): wall ABOVE spot => +1 (room up / BULL); wall at/below => -1 (stall/BEAR).
    # Decided 2026-06-03: cascade direction is pinned-bull for NQ (per-instrument baseline), so the binary vote is
    # sourced from G, the validated wall-geometry lead. CASCADE_VOTE is kept as explicit context, not the headline.
    _gw = (greeks.get("gamma_walls") if greeks else []) or []
    _gw_near = [(float(s), gx) for s, gx in _gw if abs(float(s) - anchor) <= (window + 200)] or _gw
    _dom = float(_gw_near[0][0]) if _gw_near else None
    G = 1 if (_dom is not None and _dom > anchor) else (-1 if _dom is not None else 0)
    bias_vote = "BULL" if G > 0 else ("BEAR" if G < 0 else "NEUTRAL")
    # ---- LENS readout (TEST / display-only, added 2026-06-05) — each directional lens on its own.
    # Emitted for the chart's LENS panel + the per-lens forward ledger. Gates NOTHING (not SESSION, EXEC,
    # sizing, targets, or BIAS_VOTE). UNVALIDATED. cascade/pgrav are atomic; latent/tension are the two
    # directional pieces of the SOP path; coh/ent are shape (chop vs trend), not direction.
    lensseg = ""
    try:
        import quan_paths as _PA
        _sp = _PA.session_paths(R.realization_waves(fr, anchor))
        _Lz = _sp.get("lenses", {})
        def _ld(v): return "BULL" if v == "UP" else ("BEAR" if v == "DOWN" else "NEUTRAL")
        _latent = _ld((_Lz.get("latent_path", {}) or {}).get("direction", ""))
        _tr = (_Lz.get("tension", {}) or {}).get("read", "")
        _tens = "BULL" if _tr == "RELEASING_UP" else ("BEAR" if _tr == "RELEASING_DOWN" else "NEUTRAL")
        _coh = (_Lz.get("coherence", {}) or {}).get("read", "")
        _ent = (_Lz.get("entropy", {}) or {}).get("read", "")
        _conv = (_sp.get("convergence") or {}).get("direction", {}) or {}
        _pconv = _ld(_conv.get("verdict", ""))
        _casc = "BULL" if cas["CDS"] > 0 else ("BEAR" if cas["CDS"] < 0 else "NEUTRAL")
        _bel = _abv = 0
        for _it in pgmap.split(","):
            if _it and ":" in _it:
                _ps = float(_it.split(":")[0])
                if _ps < anchor: _bel += 1
                elif _ps > anchor: _abv += 1
        _pg = "NEUTRAL" if _bel == _abv else ("BEAR" if _bel > _abv else "BULL")
        lensseg = (f"|LENS=WALL:{bias_vote},CASC:{_casc},PGRAV:{_pg},LATENT:{_latent},"
                   f"TENS:{_tens},PCONV:{_pconv},COH:{_coh},ENT:{_ent}")
    except Exception:
        lensseg = ""
    gex_i = int(greeks["gex"]) if (greeks and greeks.get("gex") == greeks.get("gex")) else 0
    gdir = 1 if (greeks and greeks.get("direction") == "BULLISH_DELTA_PRESSURE") else \
          (-1 if (greeks and greeks.get("direction") == "BEARISH_DELTA_PRESSURE") else 0)
    # WM PRIORITY (2026-06-05): if a gamma wall shares a price with a watermark, drop it from the displayed
    # GWALLS so that price emits ONLY as a watermark (purple) — never an orange gamma tab. _dom above is taken
    # from the UNFILTERED _gw_near, so BIAS_VOTE / direction is unchanged.
    _wm_px = {round(float(s)) for s, _sd in lv.get("WMARKS", [])}
    _gw_disp = [(s, gx) for s, gx in _gw_near if round(float(s)) not in _wm_px]
    gwalls = ",".join(f"{float(s):.0f}" for s, _gx in _gw_disp[:6])
    # DEALER-LEVEL TARGET LADDER (2026-06-05): tiers from ACTUAL dealer structure (gamma walls + watermarks)
    # above/below the anchor, nearest-first. Runs SIDE BY SIDE with the fixed-offset TLADDER (kept as the
    # substitute/fallback). Format px:U|D:tier. Reversible — drop DLADDER or toggle it off in Pine.
    _dlv = set()
    for _s, _gx in _gw_disp:
        _dlv.add(round(float(_s)))
    for _s, _sd in lv.get("WMARKS", []):
        _dlv.add(round(float(_s)))
    _dabove = sorted([x for x in _dlv if x > anchor])
    _dbelow = sorted([x for x in _dlv if x < anchor], reverse=True)
    dladder = ",".join([f"{x:.0f}:U:{i+1}" for i, x in enumerate(_dabove[:4])]
                        + [f"{x:.0f}:D:{i+1}" for i, x in enumerate(_dbelow[:4])])
    # SESSION (the gate): regime field-class + binary vote + wave-type. Regime/wave now weighted as the
    # actionable gate — a CONFLICTED/ROTATIONAL field downgrades any vote to lean/stand-aside; DESTRUCTIVE wave = chop.
    session = f"{_ftype} {bias_vote} \u00b7 {_wavelabel}".strip()
    payload = (f"ANCHOR={anchor:.1f}|BIAS_VOTE={bias_vote}|CASCADE_VOTE={cas['BIAS']}|CDS={cas['CDS']:.2f}"
               f"|DFLOOR={g('DFLOOR')}|DCEIL={g('DCEIL')}|SFLOOR={g('SFLOOR')}|SCEIL={g('SCEIL')}"
               f"|CLADDER={cladder}|FLADDER={fladder}|TLADDER={tladder}|DLADDER={dladder}|FLIPZ={flipz}"
               f"|TARGET={g('TARGET')}|WMARKS={wm}|ZONES={zstr}|GEX={gex_i}|GDIR={gdir:+d}|GWALLS={gwalls}|{wave}"
               f"|SESSION={session}"
               f"{lensseg}"
               f"{regseg}{waveseg}{flipseg}"
               f"|MULT={multiplier:.0f}|TDAYS={T_days:.3f}|RFR=0.037"
               f"|{execseg}|{sizeseg}"
               f"{mrwseg}"
               f"|PGMAP={pgmap}"
               f"|SNAP={','.join(snap)}"
               f"{survseg}")
    return payload


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 quan_pine_export.py <chain.csv> <anchor> [T_days] [multiplier]")
        print("  chain.csv  : Barchart side-by-side options chain export")
        print("  anchor     : Globex/session open price (e.g. 30416)")
        print("  T_days     : days to expiry (default 1.0; e.g. 0.33 for same-day weekly)")
        print("  multiplier : contract multiplier (default 20 for NQ)")
        print("\nPrints the full payload string — copy/paste into the indicator's payload box.")
        sys.exit(1)
    csv = sys.argv[1]; anchor = float(sys.argv[2])
    tdays = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    mult = float(sys.argv[4]) if len(sys.argv) > 4 else 20.0
    print(export_snapshot(csv, anchor, multiplier=mult, T_days=tdays))
