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
    # Excel/Book semantics: blank OI/premium = 0. AS = IFERROR(AO/O,"") -> blank ONLY when O==0.
    # (A zero net-premium row is AS=0, a VALID row that can become the BI==0 anchor — do NOT drop it.)
    netOI = f["putOI"].fillna(0) - f["callOI"].fillna(0)
    netPrem = f["putPrem"].fillna(0) - f["callPrem"].fillna(0)
    ap = np.where(netOI != 0, netPrem / netOI.replace(0, np.nan), np.nan)
    return f["strike"].to_numpy(), np.asarray(ap, float)

def _pressure_inputs(frame, anchor=None):
    """Returns (cwAxis, CC[21], CD[21], meta). BOOK-FAITHFUL (corrected 2026-06-24, validated
    cell-for-cell vs golden_reference_2 via LibreOffice recalc of the live Book formulas).

      BI (RIPN, "Raw Intent Pressure Normalized") = raw min-max of |AP| over ALL strikes
                                                     (blank OI/prem = 0; NO winsorize).
      BR (Tuning) = row-adjacent BI[r+1]-BI[r]; blank if either side blank.
      ANCHOR      = first strike row (top-down, ascending strike) where BI == 0 or BI == 1.
                    The CC gradient starts the NEXT row: CC[0] = (BR[a+1]-BR[a]) / step.
      CC gradient = (BR[a+1+k]-BR[a+k]) / (CB[k+1]-CB[k]); the +1 EDGE cell divides by
                    (0 - CB[20]) = -1 (the Book's blank CB23 makes that denom -1, not 0.1).
      CD curvature = d(CC) with the same step rule.

    The `anchor` PRICE argument is IGNORED — the window is RIPN-driven (first 0/1), not price-driven.
    This is the manual handshake the operator performs by hand each session, now automatic."""
    strikes, ap = _ap_per_strike(frame)
    N = len(strikes)
    if N < 17:
        return None
    bh = np.abs(ap)
    fin = np.isfinite(bh)
    if int(fin.sum()) < 5:
        return None
    lo = float(bh[fin].min()); hi = float(bh[fin].max())
    rng = hi - lo
    if rng <= 0:
        return None
    bi = np.where(fin, (bh - lo) / rng, np.nan)          # RIPN [0,1], raw min-max
    # BR (Tuning) = row-adjacent first diff; blank ("") if either side blank
    br = np.full(N - 1, np.nan)
    for i in range(N - 1):
        if np.isfinite(bi[i]) and np.isfinite(bi[i + 1]):
            br[i] = bi[i + 1] - bi[i]
    # ANCHOR: first row (top-down) where RIPN hits an extreme (0 or 1). Its strike location drifts
    # day to day (often far OTM, esp. equities) — that drift IS the observed phenomenon, kept as-is.
    ai = None
    for i in range(N):
        if bi[i] == 0.0 or bi[i] == 1.0:
            ai = i; break
    if ai is None:
        return None
    cw = np.round(np.arange(CW_STEPS) * 0.1 - 1.0, 10)    # -1.0 .. +1.0
    def _step(k):                                         # CB[k+1]-CB[k]; CB past +1 is blank=0 -> -CB[k]
        nxt = cw[k + 1] if (k + 1) < CW_STEPS else 0.0
        return nxt - cw[k]
    cc = np.zeros(CW_STEPS)
    for k in range(CW_STEPS):
        a, b = ai + k, ai + k + 1
        d = _step(k)
        if 0 <= a < len(br) and 0 <= b < len(br) and np.isfinite(br[a]) and np.isfinite(br[b]) and d != 0:
            cc[k] = (br[b] - br[a]) / d
    cd = np.zeros(CW_STEPS)
    for k in range(CW_STEPS):
        d = _step(k)
        cc_next = cc[k + 1] if (k + 1) < CW_STEPS else 0.0   # CC past +1 is blank=0 -> edge cell = CC[20]
        cd[k] = (cc_next - cc[k]) / d if d != 0 else 0.0
    covered = (ai + CW_STEPS) <= len(br)
    return cw, cc, cd, dict(anchor_strike=float(strikes[ai]), anchor_idx=ai,
                            atm_strike=float(strikes[ai]), atm_idx=ai,   # back-compat aliases
                            n_strikes=N, offset_covered=covered)


def _dual_phase_tensions(cc, cd):
    """Book CL/CM (the Breach Detector's discrete comparison metric):
       CU = dphase(CJ,CK), CV = dphase(CK,CJ);  CL = CU+CU(next),  CM = CV+CV(next).
       dphase(A,B)[k] = ((A[k+1]-A[k])/(A[k]+A[k+1])) / ((B[k+1]-B[k])/(B[k]+B[k+1])), IFERROR->0.
       CL hard-zeroed at template rows 3,4,5,6,21,22 (idx 1,2,3,4,19,20)."""
    n = len(cc)
    def dphase(A, B):
        out = []
        for k in range(n - 1):
            s1 = A[k] + A[k + 1]; s2 = B[k] + B[k + 1]
            num = (A[k + 1] - A[k]) / s1 if s1 != 0 else 0.0
            den = (B[k + 1] - B[k]) / s2 if s2 != 0 else 0.0
            out.append(num / den if den != 0 else 0.0)
        out.append(0.0)
        return out
    CU = dphase(cc, cd); CV = dphase(cd, cc)
    CL = [CU[k] + CU[k + 1] if k + 1 < n else 0.0 for k in range(n)]
    CM = [CV[k] + CV[k + 1] if k + 1 < n else 0.0 for k in range(n)]
    for idx in (1, 2, 3, 4, 19, 20):
        if idx < n:
            CL[idx] = 0.0
    return dict(tensionCL=CL, tensionCM=CM, dpGradient=CU, dpCurvature=CV)

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
    dpt = _dual_phase_tensions(cc, cd)   # CL/CM dual-phase tensions (Breach Detector metric)
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
                tensionCL=dpt["tensionCL"], tensionCM=dpt["tensionCM"],
                dpGradient=dpt["dpGradient"], dpCurvature=dpt["dpCurvature"],
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
