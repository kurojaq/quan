"""
quan_fib.py — Playbook Part III: Fibonacci Strike Architecture & Directional Gradient.

Built on the validated quan_scorecard per-strike block + scorecard.
  Step 1  Anchor selection: positive-Mass (>+2.0) PDSL attractors bracketing price.
          AL = dominant attractor below price; AH = dominant attractor above.
          >2 candidates -> highest Deep Strike score. 1 -> extend to nearest DSC.
  Step 2  Orientation from anchor Force/gradient (field sets it, not a choice).
  Step 3  Fib level table + 16 quarter levels, as price points, with roles/actions.
  Price mapping: where current price sits in the structure.

Note: the +2 TSC-prior criterion is a live close reading (NO_ARC on snapshots), so the
scorecard score here uses the 4 snapshot-computable criteria; anchor ranking is unaffected.
"""
import sys; sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, "/home/claude")
import numpy as np
import quan_scorecard as qs
from quan_engine import ingest_chain

FIB = [
    (0.000, "AL — dealer floor / max Mass", "BUY here (ascending); hard stop BELOW"),
    (0.236, "near-base retrace; high-velocity transit", "scale-in for strong continuation"),
    (0.382, "first quarter retrace; PRIMARY ENTRY", "entry (asc); stop at AL; target 0.618-0.786"),
    (0.500, "midpoint / equilibrium / phase-boundary", "phase-boundary entry; needs ZC confirm"),
    (0.618, "golden ratio; resistance(asc)/support(desc)", "partial profit from 0.382; trail to 0.500"),
    (0.786, "deep retrace; last defense before AH", "final add (high conviction); stop 0.500"),
    (1.000, "AH — dealer ceiling / upper watermark", "SELL here (descending); hard stop ABOVE"),
    (1.272, "first extension; next zone above AH", "extension target for breakout"),
    (1.618, "second extension; major breakout target", "full target on confirmed breakout"),
]
QUARTERS = [0.059,0.118,0.177,0.236, 0.273,0.309,0.345,0.382, 0.412,0.441,0.471,0.500,
            0.530,0.559,0.588,0.618, 0.660,0.702,0.744,0.786, 0.840,0.893,0.947,1.000]
ROUND_FIB = {0.0,0.236,0.382,0.5,0.618,0.786,1.0}

def _cards(frame, anchor_price):
    # full candidate set with per-strike mass/force/gradient; NEUTRAL prior (live-only +2)
    df = qs.classify_gradient(qs.observable_scan(qs.per_strike_block(frame)))
    out=[]
    for _,r in df[df["criteriaMet"]>=3].iterrows():
        pts,tier,bd = qs.score_strike(r, "NEUTRAL")
        out.append(dict(strike=float(r["strike"]), kind=("PDSL" if r["isPDSL"] else "DSC"),
                        mass=float(r["Mass"]) if np.isfinite(r["Mass"]) else None,
                        force=float(r["Force"]) if np.isfinite(r["Force"]) else None,
                        netOI=float(r["O"]) if np.isfinite(r["O"]) else 0.0,
                        gradient=r["gradient"], score=pts, tier=tier))
    return out

# Net OI structural tiers (Coefficient_Reference, NQ-calibrated). ATT=floor, REP=ceiling.
FLOOR_MIN, FLOOR_STRONG = 50, 150       # NetOI >= -> ATT / ATT-X
CEIL_MIN,  CEIL_STRONG  = -50, -150     # NetOI <= -> REP / REP-X
NEAR = 600                               # proximity window (pts) for relevant structure

def net_role(o):
    return "ATT-X" if o>=FLOOR_STRONG else "ATT" if o>=FLOOR_MIN else "REP-X" if o<=CEIL_STRONG else "REP" if o<=CEIL_MIN else "—"

def select_anchors(cards, price):
    """Canonical (Coefficient_Reference): AL = strongest ATT (Net OI floor) below price;
       AH = strongest REP (Net OI ceiling) above price. |Mass|>2 already (PDSL). Net OI sets role."""
    pdsl=[c for c in cards if c["kind"]=="PDSL" and abs(c["strike"]-price)<=NEAR]
    below=[c for c in pdsl if c["strike"]<price and c["netOI"]>=FLOOR_MIN]   # ATT floors
    above=[c for c in pdsl if c["strike"]>price and c["netOI"]<=CEIL_MIN]    # REP ceilings
    AL = max(below, key=lambda c:c["netOI"]) if below else None              # strongest attractor
    AH = min(above, key=lambda c:c["netOI"]) if above else None              # strongest repulsor
    # structure classification
    if AL and AH:   structure="BRACKETED"      # defended range
    elif AH and not AL: structure="CEILING_ONLY"   # no floor -> downward / breakdown risk
    elif AL and not AH: structure="FLOOR_ONLY"     # no ceiling -> upward room
    else:           structure="UNBRACKETED"        # no defended structure near price -> trend/undefined
    return AL, AH, structure

def orient(AL, AH):
    """Field sets orientation. Use anchor gradients/Force signs."""
    if AL is None or AH is None: return "UNDEFINED"
    gl, gh = AL["gradient"], AH["gradient"]
    if "PHASE_BOUNDARY" in (gl, gh): return "BOTH_WAYS"      # phase boundary = symmetric origin
    if gl=="ASCENDING" and gh=="ASCENDING": return "ASCENDING"
    if gl=="DESCENDING" and gh=="DESCENDING": return "DESCENDING"
    if gl=="ASCENDING" and gh=="DESCENDING": return "RANGE"  # support below, resistance above (dealer-pinned)
    if gl=="DESCENDING" and gh=="ASCENDING": return "EXPANSION"  # repulsion both sides
    return "MIXED"

def fib_table(AL, AH, orientation):
    lo, hi = AL["strike"], AH["strike"]; rng = hi - lo
    desc = orientation in ("DESCENDING",)
    rows=[]
    for ratio, role, action in FIB:
        price = (hi - ratio*rng) if desc else (lo + ratio*rng)
        rows.append(dict(ratio=ratio, price=round(price,1), role=role, action=action))
    return rows

def quarter_table(AL, AH, orientation):
    lo, hi = AL["strike"], AH["strike"]; rng = hi - lo
    desc = orientation in ("DESCENDING",)
    out=[]
    for q in QUARTERS:
        price=(hi - q*rng) if desc else (lo + q*rng)
        out.append(dict(ratio=q, price=round(price,1), stop_eligible=(q not in ROUND_FIB)))
    return out

def price_position(price, AL, AH):
    lo,hi=AL["strike"],AH["strike"]
    if hi==lo: return None
    frac=(price-lo)/(hi-lo)
    return round(frac,3)

def build_fib(frame, anchor_price):
    cards=_cards(frame, anchor_price)
    AL,AH,structure=select_anchors(cards, anchor_price)
    near=[c for c in cards if c["kind"]=="PDSL" and abs(c["strike"]-anchor_price)<=NEAR]
    floors=[c["strike"] for c in near if c["netOI"]>=FLOOR_MIN and c["strike"]<anchor_price]   # ATT below
    ceils =[c["strike"] for c in near if c["netOI"]<=CEIL_MIN  and c["strike"]>anchor_price]   # REP above
    rep_below=[c["strike"] for c in near if c["netOI"]<=CEIL_MIN and c["strike"]<anchor_price] # cleared ceilings (bullish)
    att_above=[c["strike"] for c in near if c["netOI"]>=FLOOR_MIN and c["strike"]>anchor_price]
    if structure!="BRACKETED":
        return dict(ok=False, structure=structure, price=anchor_price,
                    floors_below=floors, ceilings_above=ceils,
                    rep_below=rep_below, att_above=att_above,
                    note=f"{structure}: no defended Fib bracket")
    o="RANGE"   # ATT floor + REP ceiling = defended range; orientation resolved by live TSC prior
    return dict(ok=True, structure=structure, AL=AL, AH=AH, orientation=o,
                f_range=round(AH["strike"]-AL["strike"],1),
                price=anchor_price, price_frac=price_position(anchor_price,AL,AH),
                floors_below=floors, ceilings_above=ceils,
                fib=fib_table(AL,AH,o), quarters=quarter_table(AL,AH,o))

if __name__=="__main__":
    import quan_tensor as qt
    for lab in ["Apr-13","May-14","May-15","May-18","May-21"]:
        anc=qt.ANCHORS[lab]
        fb=build_fib(ingest_chain(qt.SESSIONS[lab]), anc)
        print(f"\n=== {lab}  price/anchor={anc} ===")
        if not fb["ok"]:
            print("  ", fb["note"], " | positive-mass PDSLs:", [c['strike'] for c in fb['pos_pdsl']])
            continue
        print(f"  AL={fb['AL']['strike']:.0f} (mass {fb['AL']['mass']:.1f}, {fb['AL']['gradient']}, score {fb['AL']['score']}) "
              f"AH={fb['AH']['strike']:.0f} (mass {fb['AH']['mass']:.1f}, {fb['AH']['gradient']}, score {fb['AH']['score']})")
        print(f"  range={fb['f_range']}  orientation={fb['orientation']}  price_frac={fb['price_frac']}  "
              f"(pos-mass PDSLs available: {fb['n_pos_pdsl']}) {fb['note']}")
        for r in fb["fib"]:
            print(f"    {r['ratio']:.3f}  {r['price']:>8.0f}  {r['role']}")
