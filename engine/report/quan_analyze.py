"""
quan_analyze — the single clean engine entry point.

analyze(chain, anchor, T_days) runs the verified computation path (via quan_engine.run, so the
numbers are identical to everything already validated) and REORGANIZES the result into the five
layers the framework itself uses, plus a synthesis layer for easy reads.

Layer mapping (faithful to Master_Formula_Reference tabs):
  signal    <- Book_Stats_CDS        (JB tests -> directional signals -> CDS -> tier)
  field     <- Book_Globals          (WSF/WSM, speeds/lags, inertia/trend-length, Cs, regime)
  greeks    <- Greeks_BlackScholes   (net delta, GEX, gamma walls/flip)
  dynamic   <- Compass / SOP Folding / Info Field  (wave-type, flip-watch)  [Tier-2]
  spatial   <- Book_Strike_Level     (levels + per-strike liquidity/watermarks)
  synthesis <- (engine addition)     one trade-relevant read on top

This is a VIEW, not a recomputation. Same verified values, framework-shaped.
"""
import os, datetime as _dt
import quan_engine as _E


def _chain_date(path):
    base = os.path.basename(path)
    import re
    m = re.search(r"(\d{2})_?(\d{2})_?(\d{2})", base)  # mm_dd_yy patterns appear in filenames
    return base[:40]


def _nearest_levels(levels, anchor):
    """Nearest support (floor) below and resistance (ceiling) above the anchor, from the level set."""
    if not levels or anchor is None:
        return {}
    floors, ceils = [], []
    for key in ("SFLOOR", "DFLOOR", "FLADDER"):
        v = levels.get(key)
        if isinstance(v, (int, float)):
            floors.append(float(v))
        elif isinstance(v, (list, tuple)):
            for item in v:
                k = item[0] if isinstance(item, (list, tuple)) else item
                try: floors.append(float(k))
                except Exception: pass
    for key in ("SCEIL", "DCEIL", "CLADDER"):
        v = levels.get(key)
        if isinstance(v, (int, float)):
            ceils.append(float(v))
        elif isinstance(v, (list, tuple)):
            for item in v:
                k = item[0] if isinstance(item, (list, tuple)) else item
                try: ceils.append(float(k))
                except Exception: pass
    a = float(anchor)
    below = max([f for f in floors if f < a], default=None)
    above = min([c for c in ceils if c > a], default=None)
    return {"anchor": a, "nearest_floor": below, "nearest_ceiling": above}


def _synthesize(sig, anchor):
    """One trade-relevant read built from the layers. Descriptive; the honest caveats are explicit."""
    reg = sig.get("REGIME") or {}
    wt = sig.get("WAVE_TYPE") or {}
    fw = sig.get("FLIP_WATCH") or {}
    liq = sig.get("LIQUIDITY") or {}
    warnings = []
    if fw.get("flip_imminent"):
        warnings.append("FLIP-WATCH: " + str(fw.get("directive", "marginal axis on its sign line — recompute intraday")))
    if isinstance(liq, dict) and liq.get("n_watermarks", 0) >= 15:
        warnings.append(f"WATERMARK SATURATION: {liq['n_watermarks']} stuck strikes "
                        f"(lean {liq.get('watermark_sign_lean')}) — heavy dealer inventory, structural")
    return {
        "bias": sig.get("BIAS"),
        "cds": sig.get("CDS"),
        "regime_action": reg.get("action"),
        "regime_readout": reg.get("readout"),
        "expected_path": wt.get("expected_path"),
        "expected_efficiency": wt.get("expected_efficiency"),
        "key_levels": _nearest_levels(sig.get("LEVELS"), anchor),
        "warnings": warnings,
        "honest_note": ("Framework DESCRIBES the dealer field; direction discrimination is UNPROVEN "
                        "(n=4-5). Honest edge 10-15%. Log forward via TradingView; do not gate on small n."),
    }


def analyze(csv_path, anchor=None, T_days=1.0, instrument=None):
    """Single clean entry point. Returns the five framework layers + synthesis + payload."""
    sig = _E.run(csv_path, anchor=anchor, T_days=T_days, instrument=instrument)
    fs = sig.get("FIELD_STATE") or {}

    result = {
        "meta": {
            "anchor": anchor,
            "T_days": T_days,
            "n_strikes": sig.get("n_strikes"),
            "chain": _chain_date(csv_path),
            "timestamp": _dt.datetime.now().isoformat(timespec="seconds"),
        },

        # ---- SIGNAL  (Book_Stats_CDS) ----
        "signal": {
            "cascade": {k: sig.get(k) for k in
                        ("DIDS", "DITS", "DR3S", "DIDK", "DITK", "DR3K", "K", "S", "TP", "PP")},
            "CDS": sig.get("CDS"),
            "BIAS": sig.get("BIAS"),
            "tier": (sig.get("REGIME") or {}).get("cds_tier"),
            "significance": sig.get("SIGNIFICANCE"),
        },

        # ---- FIELD  (Book_Globals) ----
        "field": {
            "WSF": fs.get("WSF"), "WSM": fs.get("WSM"),
            "speeds": fs.get("speeds"), "lags": fs.get("lags"),
            "inertia": fs.get("inertia"), "trend_length": fs.get("trend_length"),
            "Cs": (fs.get("curvature") or {}).get("Cs") if isinstance(fs.get("curvature"), dict) else fs.get("Cs"),
            "spacetime": fs.get("spacetime"),
            "regime": sig.get("REGIME"),
        },

        # ---- GREEKS  (Greeks_BlackScholes) ----
        "greeks": sig.get("GREEKS"),

        # ---- DYNAMIC  (Compass / SOP Folding / Info Field — Tier-2) ----
        "dynamic": {
            "wave_type": sig.get("WAVE_TYPE"),
            "flip_watch": sig.get("FLIP_WATCH"),
        },

        # ---- SPATIAL  (Book_Strike_Level) ----
        "spatial": {
            "levels": sig.get("LEVELS"),
            "liquidity": sig.get("LIQUIDITY"),
        },

        # ---- SYNTHESIS  (engine addition) ----
        "synthesis": _synthesize(sig, anchor),

        "payload": sig.get("PAYLOAD"),
    }
    return result


if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 3:
        print("usage: python3 quan_analyze.py <chain.csv> <anchor> [T_days]")
        sys.exit(1)
    r = analyze(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)
    # print a compact view (drop the big _per_strike frame)
    sp = r.get("spatial", {}).get("liquidity")
    if isinstance(sp, dict):
        sp.pop("_per_strike", None)
    print(json.dumps({k: v for k, v in r.items() if k != "payload"}, indent=2, default=str))
