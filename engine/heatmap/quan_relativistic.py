"""
quan_relativistic.py — CX intermediate panel + DB relativistic/chronometric block.
Spec: Master_Formula_Reference.xlsx Book_Globals (CX*, DB*).
Pure functions of cascade primitives (DIDS/DITS/DR3S, DIDK/DITK/DR3K) + the per-strike
DID(AP)/DIT(AR)/DR3(AT)/LR(T) columns + strike range. No F/IV needed.

Validated field-by-field against the framework Book oracle (see validate_relativistic.py).
"""
import numpy as np
import pandas as pd
from quan_engine import excel_skew, excel_kurt

SEC_PER_DAY = 86400.0

def _cols(frame):
    """Reproduce the per-strike AP/AR/AT/LR columns the globals aggregate over."""
    AN = frame["putPrem"].fillna(0) - frame["callPrem"].fillna(0)   # Net Premium
    O  = frame["putOI"].fillna(0)  - frame["callOI"].fillna(0)      # Net OI
    L  = frame["putVol"].fillna(0) - frame["callVol"].fillna(0)     # Net Tx
    AP = AN / O.replace(0, np.nan)     # DID
    AR = AN / L.replace(0, np.nan)     # DIT
    AT = AP / AR.replace(0, np.nan)    # DR3
    M  = frame["putOI"].fillna(0)  / frame["callOI"].replace(0, np.nan)   # PCR_OI
    N  = frame["putVol"].fillna(0) / frame["callVol"].replace(0, np.nan)  # PCR_Vol
    A  = O / M.replace(0, np.nan)
    B  = L / N.replace(0, np.nan)
    LR = A / B.replace(0, np.nan)      # Liquidity Ratio (T col)
    return AP, AR, AT, LR

def compute_relativistic(frame: pd.DataFrame, cds: float) -> dict:
    AP, AR, AT, LR = _cols(frame)
    K_strike = frame["strike"]

    # --- primitives (CX13-15 skew, CX2/3/7 kurt) ---
    DIDS, DIDK = excel_skew(AP), excel_kurt(AP)
    DITS, DITK = excel_skew(AR), excel_kurt(AR)
    DR3S, DR3K = excel_skew(AT), excel_kurt(AT)

    # --- CX panel: averages, curvatures, range ---
    DIDAVG = np.nanmean(AP); DITAVG = np.nanmean(AR); DR3AVG = np.nanmean(AT)
    DID_curv = abs(np.nansum(AP)) / 5.0          # CX23 DID©
    DR3_curv = abs(np.nansum(AT)) / 2.0          # CX24 DR3©
    # CX22 R(d) = ABS(MAX(BP)) - MIN(BP). In the Book the BP column spans blank/zero
    # rows so MIN(BP)=0 -> R(d)=|max strike|. Verified vs ZN Book via Vbase reconciliation
    # (implied R(d)=123.759 = max strike, not the 26-wide strike range). Confirm on NQ.
    Rd = abs(K_strike.max())                      # CX22 R(d)
    LIQK = excel_kurt(LR)                         # CX16
    LIQS_named = DIDAVG                           # CX17 (mislabeled; formula = AVG(AP))
    LIQAVG = np.nanmean(LR)                       # CX18

    # curvature anchors (CX25-27), MRW (CX28), OMTR (CX29)
    ICA = (DIDAVG * DIDK) / abs(DIDS)
    TCA = (DITAVG * DITK) / abs(DITS)
    RCA = (DR3K * DR3AVG) / abs(DR3S)
    MRW = abs(ICA - TCA)
    OMTR = Rd / MRW if MRW else np.nan

    # masses / energies (CX35-37, CX41-43)
    Iks = DIDK / DIDS; Tks = DITK / DITS; Rks = DR3K / DR3S
    isk = DIDS / DIDK; tsk = DITS / DITK; esk = DR3S / DR3K

    # --- DB curvature fields ---
    K = DR3K / (DIDK / DITK)        # DB29 Kinetic Curvature
    S = DR3S / (DIDS / DITS)        # DB30 Static Curvature
    ICF = 1 + K + S                 # DB28
    Mass = K / S                    # DB31
    Force = S / K                   # DB32
    Cs = Mass / Force               # DB33  (= K^2/S^2)
    Cl = Force / Mass               # DB34

    # --- tempo / time base (DB25-27) ---
    # TPS sourced from canonical quan_temporal.temporal_globals (the same source quan_field_state uses),
    # NOT the local Vbase/86400 which was confirmed off-Book on 2026-06-01 (gave SoR=0.0768 vs Book 0.1781,
    # inflating RI to 849 vs Book 366). quan_temporal has no per_strike/field_state dependency, so no import cycle.
    import quan_temporal as _T
    _tg = _T.temporal_globals(frame)
    Vbase = (DR3_curv + DID_curv) / Rd if Rd else np.nan   # DB25 (retained for reference)
    TPS = _tg.get("TPS", float("nan"))                      # DB26 (canonical)
    Cf = (ICF * Vbase) / TPS if TPS else np.nan             # DB27

    # --- packet / motion (DB2-4) ---
    # TMR from canonical quan_temporal (same source field_state uses). The local (DIDAVG/DITAVG)*OMTR*|K|
    # was confirmed off-Book on 2026-06-01 (8.32 vs Book 3.587), throwing IntentTL/TransTL/RealizTL.
    TMR = _tg.get("TMR", float("nan"))          # DB2 (canonical)
    PT = TMR / abs(Cf) if Cf else np.nan        # DB3
    PU = TMR / 0.05                              # DB4

    # --- speeds (DB5-7) ---
    SoI = Iks / isk                # = DIDK^2/DIDS^2
    SoT = Tks / tsk                # = DITK^2/DITS^2
    SoR = abs(DR3S) * abs(DR3K) * TPS

    # --- inertias / trend lengths (DB11-22) ---
    II = LIQS_named / SoI
    TI = LIQAVG / SoT
    RI = LIQK / SoR if SoR else np.nan
    RID = RI * 0.05
    IntentTL = II * TMR
    TransTL  = TI * TMR
    RealizTL = TMR * abs(RI)

    # --- conductance/impedance, transitional (DB35-40) ---
    Conductance = 1 / (ICF * PT) if (ICF and PT) else np.nan
    Impedance = Cf * PT
    TransMass = Iks / Tks
    TransToRealMass = TransMass / Rks
    TransForce = isk / tsk

    # --- trigger / entry-exit geometry (DB42-49) ---
    TP = 1 - abs(S / K)            # DB42
    TL_release = 1 - TP            # DB43
    PP = 1 - (K / S)               # DB45
    sign_PP = np.sign(PP)          # DB44
    ExS = 1 / PP if PP else np.nan # CX30
    ESC = TP * RID                 # DB46
    ES = PP * MRW                  # DB47
    EO = ExS * MRW                 # DB48
    FE = EO + ES                   # DB49

    # --- tachyonic / Lorentz / spacetime / Kelly (DB51-60) ---
    TII = (1/np.sqrt((SoI/Cs)**2 - 1)) if (Cs and SoI > Cs) else "Sub-luminal"
    gT = (1/np.sqrt(1 - (SoT/Cs)**2)) if (Cs and abs(SoT/Cs) < 1) else 0.0
    gR = (1/np.sqrt(1 - (SoR/Cs)**2)) if (Cs and abs(SoR/Cs) < 1) else 0.0
    ITI = abs(II / TI) if TI else np.nan
    TRW = TP / SoI if SoI else np.nan
    b = abs(FE / ES) if ES else np.nan       # Kelly odds
    p = (1 + cds) / 2.0                        # win prob from CDS
    q = 1 - p
    f_kelly = (b * p - q) / b if b else np.nan
    f_half = f_kelly / 2 if f_kelly == f_kelly else np.nan
    s2_I = Cs**2 * DITS**2 - IntentTL**2
    sc_I = "TIMELIKE" if s2_I > 0 else ("SPACELIKE" if s2_I < 0 else "LIGHTLIKE")
    m2_inv = (Mass * Cs)**2 - IntentTL**2 - TransTL**2 - RealizTL**2

    return {
        # curvature core
        "K": K, "S": S, "ICF": ICF, "Mass": Mass, "Force": Force, "Cs": Cs, "Cl": Cl,
        # CX intermediates
        "DIDAVG": DIDAVG, "DITAVG": DITAVG, "DR3AVG": DR3AVG,
        "ICA": ICA, "TCA": TCA, "RCA": RCA, "MRW": MRW, "OMTR": OMTR, "Rd": Rd,
        "Iks": Iks, "Tks": Tks, "Rks": Rks,
        # tempo
        "Vbase": Vbase, "TPS": TPS, "Cf": Cf,
        "TMR": TMR, "PT": PT, "PU": PU,
        # speeds / inertias
        "SoI": SoI, "SoT": SoT, "SoR": SoR,
        "II": II, "TI": TI, "RI": RI, "RID": RID,
        "IntentTL": IntentTL, "TransTL": TransTL, "RealizTL": RealizTL,
        "Conductance": Conductance, "Impedance": Impedance,
        "TransMass": TransMass, "TransForce": TransForce,
        # geometry
        "TP": TP, "TL_release": TL_release, "PP": PP, "sign_PP": sign_PP, "ExS": ExS,
        "ESC": ESC, "ES": ES, "EO": EO, "FE": FE,
        # apex signals
        "TII": TII, "gamma_T": gT, "gamma_R": gR, "ITI": ITI, "TRW": TRW,
        "Kelly_f": f_kelly, "Kelly_half": f_half,
        "s2_Intent": s2_I, "SpacetimeClass": sc_I, "m2_invariant": m2_inv,
    }
