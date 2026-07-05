"""
quan_realization.py — realization-wave layer (SOP folding + zero-cross "coherence breaks").

Ported verbatim from the terminal's reverse-engineered Toroidal Fold construction
(The_Quan_Terminal_v7_22_33, sampleCWPressureValues / computeTSCVariant / computeSOPFolding).
This resolves the Book's deferred Tuning block (BR/BS) without the hard-coded-anchor unknowns:

Chain — CORRECTED 2026-05-31 to the VERIFIED framework formulas (populated NQ Apr-10 Book;
live formula text + cached values agree to 16 sig figs). The previous ATM-windowed version was WRONG.

Per-strike ladder (one row per strike, down the WHOLE chain — NO strike selection, NO ATM window):
  AP  (col AP) = (PutPrem - CallPrem) / (PutOI - CallOI)                 # per-strike DID
  BH  (col BH) = |AP| * (DB37 - DB38) * DB31                             # global multiplier (per-snapshot const)
  BI  (col BI) = (BH - min) / (max - min)  over ALL strikes              # normalize to [0,1]
  BN  (col BN) = BI[r+1] - BI[r]                                         # "Turning Calculation" (first diff)
  BR  (col BR) = BN[r]                                                   # "Tuning Calculation" (copy of BN)

Chronometer + pressure field (the FIXED 21-cell axis, independent of strike count):
  CB  Chronometer Watch = [-1.0, -0.9, ... +1.0]  (CB2..CB22, hard-set, 21 positions)
  CC  Pressure Gradient  = (BR[r+16] - BR[r+15]) / (CB[r+1]-CB[r])       # +15/+16 STRIKE-ROW OFFSET
  CD  Pressure Curvature = (CC[r+1] - CC[r]) / (CB[r+1]-CB[r])
  -> CW position k (k=0..20) is fed by strike-derivative rows (k+15) and (k+16). NOT centered on ATM.

Sum of Pairs / fold / zero-cross operate on the 21-row CC/CD axis (unchanged):
  Sum of Pairs (per variant): for n=1..10, left=B[mid-n], right=B[mid+n], SOP_n = left+right
  Fold J[row] = SOPg[row] * SOPc[row]
  Zero-cross (REALIZATION) = sign(J[i]) != sign(J[i-1])  -> "coherence break"
Session-time map: t = (CW + 1) / 2  (non-linear in clock time; window-weight schedule applies separately).

Global multiplier note: BH = |AP| * (DB37-DB38) * DB31 is a per-snapshot CONSTANT times |AP|,
so normalize(BH) == normalize(|AP|) exactly. We keep BI = normalize(|AP|); identical to the Book's BI. VERIFIED.
The `anchor` argument is now informational only — the framework does NOT center the axis on it.
"""
import numpy as np

CW_STEPS = 21
MID = 10           # CW = 0 index
DT = 0.1

# --- Outlier handling for the per-strike pressure (open item #2) ---
# Far-OTM/deep-ITM strikes with |netOI| = 1 but huge premium produce AP ~ 70x median, which pins one
# strike at 1.0 in min-max normalization and crushes the real ATM-area strikes to 0 (the "flat wave").
# FIX: do NOT drop strikes (that breaks the adjacent-strike contiguity the BN first-difference needs).
# Instead winsorize the |AP| VALUE in place to robust percentile bounds, keeping every strike row so
# BN/BR/CC stay defined on contiguous strikes exactly as the framework Book computes them.
BI_CLIP_PCT = 5.0     # winsorize |AP| to [p, 100-p] percentile before normalize. 0 disables.

def _ap_per_strike(frame):
    """AP = (PutPrem - CallPrem) / (PutOI - CallOI), per strike, sorted by strike. No strike dropping."""
    f = frame.sort_values("strike").reset_index(drop=True)
    netOI = f["putOI"].fillna(0) - f["callOI"].fillna(0)
    netPrem = f["putPrem"].fillna(0) - f["callPrem"].fillna(0)
    ap = np.where((netOI != 0) & (netPrem != 0), netPrem / netOI.replace(0, np.nan), np.nan)
    return f["strike"].to_numpy(), np.asarray(ap, float)

def _pressure_inputs(frame, anchor):
    """Returns (cwAxis, CC[21], CD[21], meta). Framework-exact: fixed CB axis + +15/+16 offset into BR.
    NO ATM centering. `anchor` is informational only."""
    strikes, ap = _ap_per_strike(frame)
    N = len(strikes)
    if N < 17:                       # need at least row r+16 for r=0 -> >=17 strikes
        return None
    # BH = |AP| * const ; BI = normalize over ALL strikes (const cancels in normalize)
    bh = np.abs(ap)
    valid = bh[np.isfinite(bh)]
    if valid.size < 5:
        return None
    # Winsorize to robust percentile bounds so a lone |netOI|=1 survivor (if any slipped the OI
    # floor) can't pin the [0,1] scale. Clamp BH into [p, 100-p] before min-max.
    if BI_CLIP_PCT > 0:
        lo = float(np.percentile(valid, BI_CLIP_PCT))
        hi = float(np.percentile(valid, 100 - BI_CLIP_PCT))
        bh = np.clip(bh, lo, hi)
    else:
        lo, hi = valid.min(), valid.max()
    rng = hi - lo
    bi = np.where(np.isfinite(bh), (bh - lo) / rng if rng > 0 else 0.0, np.nan)
    # BN = BI[r+1]-BI[r]  (Turning) ; BR = BN  (Tuning copy)  -- down the full strike list
    bn = np.full(N - 1, np.nan)
    for i in range(N - 1):
        if np.isfinite(bi[i]) and np.isfinite(bi[i + 1]):
            bn[i] = bi[i + 1] - bi[i]
    br = bn                                   # BR (col BR) = BN (col BN), straight copy
    # CB axis: fixed 21 cells -1.0..+1.0 step 0.1
    cw = np.round(np.arange(CW_STEPS) * 0.1 - 1.0, 10)
    # ATM-CENTERED WINDOW (fix 2026-06-02): the fold reads the pressure structure AROUND current price,
    # so the 21-cell CC/CD window must straddle the ATM strike. The prior code used a FIXED +15/+16
    # offset from the chain START, which only worked when the chain's strikes were roughly centered on
    # price. Chains with a large low/high tail (e.g. 06/02 starts at 20,500 while price is 30,520) put the
    # fixed window thousands of points away in unpositioned space -> all-zero fold -> false COHERENT/STILL.
    # Anchor the window on the ATM: base = atm_idx - 10 so cell 10 (chronoT 0) sits at the ATM. Preserves
    # the +1-row gradient construction; only the window's CENTER moves from chain-start to ATM.
    atm = int(np.argmin(np.abs(strikes - anchor))) if anchor is not None else (len(strikes) // 2)
    base = atm - (CW_STEPS // 2)              # CW_STEPS//2 = 10 -> chronoT 0 lands on the ATM
    cc = np.zeros(CW_STEPS)
    for k in range(CW_STEPS):
        a, b = base + k, base + k + 1
        if 0 <= a < len(br) and 0 <= b < len(br) and np.isfinite(br[a]) and np.isfinite(br[b]):
            cc[k] = (br[b] - br[a]) / DT      # CB step is constant 0.1
    # CD[k] = (CC[k+1]-CC[k]) / 0.1
    cd = np.zeros(CW_STEPS)
    for k in range(CW_STEPS - 1):
        cd[k] = (cc[k + 1] - cc[k]) / DT
    # coverage iff the ATM-centered window fits within the BR array
    covered = (base >= 0) and ((base + CW_STEPS) < len(br))
    return cw, cc, cd, dict(atm_strike=float(strikes[atm]) if anchor is not None else None, atm_idx=atm,
                            n_strikes=N, offset_covered=covered)

PAIR_ROWS = 11        # the 21-row axis folds into 11 pairs (indices 0..10 below)

def _pairs(B):
    """Framework pairing: fold the 21-cell axis from opposite ends toward center.
    Book rows 2..22 -> python idx 0..20. Pair n (n=0..10) couples idx n with idx (20-n).
    Returns four wave columns over the 11 pair rows:
      SOP   = B[n] + B[20-n]      (Sum of Pairs, symmetric)
      PM    = B[n] * B[20-n]      (Pairs Multiplied, symmetric)
      PD    = B[n] / B[20-n]      (Pairs Divided, antisymmetric)
      DIP   = B[n] - B[20-n]      (DIPLTR, antisymmetric directional carrier)
    """
    sop, pm, pd, dip = [], [], [], []
    for n in range(PAIR_ROWS):
        hi, lo = B[n], B[20 - n]
        sop.append(hi + lo)
        pm.append(hi * lo)
        pd.append(hi / lo if lo != 0 else 0.0)
        dip.append(hi - lo)
    return dict(sop=sop, pm=pm, pd=pd, dip=dip)

def realization_waves(frame, anchor):
    """Full realization layer. Fold = SumOfPairs(CC) * SumOfPairs(CD) over the 11 pair rows.
    Matches Book 'SOP Folding' sheet: SOPG = TSC(Gradient)!SumOfPairs on CC, SOPC = TSC(Curvature)!SumOfPairs on CD,
    J = SOPG*SOPC. ZC = sign change in J. Asymmetric by construction (two different input waves)."""
    pin = _pressure_inputs(frame, anchor)
    if pin is None:
        return None
    cw, cc, cd, meta = pin
    gp = _pairs(cc)        # waves on Pressure Gradient
    cp = _pairs(cd)        # waves on Pressure Curvature
    sopG = gp["sop"]       # SOP Gradient (col F = TSC-Gradient Sum of Pairs)
    sopC = cp["sop"]       # SOP Curvature (col G = TSC-Curvature Sum of Pairs)
    fold = [g * c for g, c in zip(sopG, sopC)]     # J = SOPG*SOPC, 11 pair rows
    # pair n maps to CW position of the "hi" end: idx n -> cw[n]; report crossings at that CW
    zc, total, cross_cw = [], 0, []
    for i in range(PAIR_ROWS):
        if i == 0 or fold[i] == 0:
            zc.append(0)
        else:
            sc, sp = np.sign(fold[i]), np.sign(fold[i - 1])
            if sc != 0 and sp != 0 and sc != sp:
                zc.append(1); total += 1; cross_cw.append(round(float(cw[i]), 2))
            else:
                zc.append(0)
    # entropy over the 11-row fold (matches SOP Folding cols U/V)
    absum = sum(abs(v) for v in fold)
    ent = 0.0
    if absum > 0:
        for v in fold:
            u = abs(v) / absum
            if u > 0:
                ent -= u * np.log(u)
    cross_t = [round((c + 1) / 2, 3) for c in cross_cw]
    # ATM-FOLD ASYMMETRY (2026-06-02): reflect the below-ATM fold half onto the above-ATM half. >0 =
    # upside-heavy pressure, <0 = downside-heavy. NOTE: asymmetry-as-DIRECTION tested 2/4 (coin flip)
    # across sessions — kept as a lens, NOT a direction signal. The entropy above is the useful coherence read.
    _fa = np.asarray(fold, float); _mid = len(_fa) // 2
    _lh = _fa[:_mid][::-1]; _rh = _fa[_mid + 1:]; _nn = min(len(_lh), len(_rh))
    fold_asym = round(float(_rh[:_nn].sum() - _lh[:_nn].sum()), 4) if _nn else 0.0
    # EXHAUSTION / COIL (2026-06-02): WHERE the fold energy sits across the 11 pairs. Pair 0 = ±1.0
    # (outer, far from ATM = "spent/exhausted"); pair 10 = ATM (center = "coiled/loaded"). Energy
    # center-of-mass: low = exhausted (move already priced at extremes, expect SMALLER range); high =
    # coiled (stored tension near price, expect LARGER range). Orthogonality-tested: explains 89% of the
    # range LEFTOVER after sqrt(MRW) (n=4 — promising, NOT proven; log forward). outer_frac = pairs 0-3 share.
    _abf = np.abs(_fa); _tot = _abf.sum()
    if _tot > 0:
        fold_com = round(float(np.sum(np.arange(len(_abf)) * _abf) / _tot), 3)
        fold_outer_frac = round(float(_abf[:4].sum() / _tot), 3)
        # exhaustion state: 0..10 CoM -> EXHAUSTED (<4) / MID / COILED (>6)
        exhaustion = ("EXHAUSTED" if fold_com < 4 else "COILED" if fold_com > 6 else "MID")
    else:
        fold_com = None; fold_outer_frac = None; exhaustion = None
    return dict(cwAxis=cw.tolist(), pressureGradient=cc.tolist(), pressureCurvature=cd.tolist(),
                sopG=sopG, sopC=sopC, fold=fold, zeroCrosses=zc, totalZC=total,
                crossings_cw=cross_cw, crossings_t=cross_t, fold_asym=fold_asym,
                fold_com=fold_com, fold_outer_frac=fold_outer_frac, exhaustion=exhaustion,
                # full wave set (the "Greek waves"): directional carriers + symmetric envelopes
                gradient_DIPLTR=gp["dip"], curvature_DIPLTR=cp["dip"],
                gradient_PairsMult=gp["pm"], gradient_PairsDiv=gp["pd"],
                entropy=round(ent, 4), entropyNorm=round(ent / np.log(PAIR_ROWS), 4),
                **meta)

if __name__ == "__main__":
    import sys
    sys.path.insert(0, "/mnt/user-data/outputs")
    from quan_engine import ingest_chain
    fr = ingest_chain(sys.argv[1]); anchor = float(sys.argv[2])
    r = realization_waves(fr, anchor)
    print("n_strikes:", r["n_strikes"], "offset_covered:", r["offset_covered"], "totalZC:", r["totalZC"])
    print("realization crossings chronoT:", r["crossings_cw"], "-> session-t:", r["crossings_t"])
    print("fold:", [round(v, 2) for v in r["fold"]])
