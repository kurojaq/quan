"""
quan_execution.py — execution signal layer (engine side).

Computes the triple-confirmation state (GO / SLOW / STAND_DOWN) from the validated
cascade, mirroring the terminal's rule but sourced from the clean engine:
    enterFull (GO)  : kellyHalf >= 0.25  AND  cosigned strong cascade  AND  tier-1 edge
    enterLight(SLOW): kellyHalf >= 0.10  AND  tier 1-2
    else            : STAND_DOWN

Emits an EXEC payload segment the Pine layer reads to GATE live triggers:
    EXEC=<STATE>:<DIR>:<SIZE>     STATE GO|SLOW|STAND  DIR +1|-1|0  SIZE full|half|none
Plus per-level trigger TYPES so Pine knows which interaction to watch at each price:
    TRIGGERS=px:type:dir,...      type TR(tap-reject) | BR(break-retest) | CV(converted)
Tensor phase gate (optional): TPHASE=<chronoT 0-1>  — session fraction where compression
releases; Pine weights triggers toward this window.

D2/D3 honest note: this is the SIGNAL surface for PAPER markers, not a live-capital
execution system. Edge still 10-15%, sample n=1 bull-biased. Backtest/replay first.
"""
import sys
sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, "/home/claude")

def kelly_half_from_cds(cds, b=1.0):
    """Half-Kelly from cascade CDS. p = (1+CDS)/2 ; f* = (b*p - q)/b ; half = f*/2.
    b defaults 1.0 (even odds) when entry/exit geometry not supplied — conservative."""
    p = (1.0 + cds) / 2.0
    q = 1.0 - p
    f = (b * p - q) / b
    return max(f, 0.0) / 2.0

def triple_confirm(cds, didS, ditS, dr3S, eb=8, b=1.0):
    """Reproduce the terminal's GO/SLOW/STAND from validated cascade inputs.
    Co-signing: all three skews agree with the bull/bear direction.
    Strong: |skew| > 2.0 each ; Moderate: > 1.0 each (terminal Candidate-C tiers)."""
    kh = kelly_half_from_cds(cds, b)
    cosigned = (didS < 0 and ditS < 0 and dr3S > 0) or (didS > 0 and ditS > 0 and dr3S < 0)
    allStrong = abs(didS) > 2.0 and abs(ditS) > 2.0 and abs(dr3S) > 2.0
    allMod    = abs(didS) > 1.0 and abs(ditS) > 1.0 and abs(dr3S) > 1.0
    # composite tier (Candidate C, locked)
    if allStrong and cosigned: comp, tier = 0.90, "TIER_1_FULL"
    elif allMod and cosigned:  comp, tier = 0.75, "TIER_2_STANDARD"
    elif cosigned:             comp, tier = 0.50, "TIER_3_LIGHT"
    else:                      comp, tier = 0.30, "STAND_DOWN"
    enterFull  = kh >= 0.25 and eb >= 8 and tier == "TIER_1_FULL"
    enterLight = (not enterFull) and kh >= 0.10 and eb >= 5 and tier in ("TIER_1_FULL", "TIER_2_STANDARD")
    state = "GO" if enterFull else ("SLOW" if enterLight else "STAND")
    size  = "full" if enterFull else ("half" if enterLight else "none")
    dirn  = 1 if cds > 0 else (-1 if cds < 0 else 0)
    return dict(state=state, dir=dirn, size=size, kellyHalf=round(kh, 4),
                composite=comp, tier=tier, cosigned=cosigned)

def triggers_from_levels(levels, zones, anchor, close=None):
    """Tag each trigger-eligible level by interaction TYPE for Pine to watch live.
      TR tap-reject  : walls price has NOT crossed -> defend/mean-revert
      CV converted   : walls price HAS crossed     -> role-inverted support/resistance
      BR break-retest: every wall is also break-retest eligible (Pine confirms the break live)
    dir: +1 if a long is implied at that level (floor/support), -1 if short (ceiling/resistance).
    """
    px = close if close is not None else anchor
    out = []
    # zones carry side + (post-breach) effective role
    for z in (zones or []):
        strike, side, oi, gex = z
        rawCeil = (side == "C")
        crossed = (rawCeil and px > strike) or (not rawCeil and px < strike)
        effCeil = (not rawCeil) if crossed else rawCeil
        typ = "CV" if crossed else "TR"
        d = -1 if effCeil else 1            # support -> long(+1), resistance -> short(-1)
        out.append((strike, typ, d))
        out.append((strike, "BR", -d))      # break of the level implies the opposite-side momentum trade
    return out

def emit_exec(exec_state, triggers=None, tphase=None):
    parts = [f"EXEC={exec_state['state']}:{exec_state['dir']:+d}:{exec_state['size']}"]
    if triggers:
        seen = set(); items = []
        for strike, typ, d in triggers:
            key = (strike, typ)
            if key in seen: continue
            seen.add(key); items.append(f"{strike}:{typ}:{d:+d}")
        parts.append("TRIGGERS=" + ",".join(items))
    if tphase is not None:
        parts.append(f"TPHASE={round(tphase, 3)}")
    return "|".join(parts)
