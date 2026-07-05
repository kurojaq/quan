"""
quan_field_state.py — the six-axis FIELD CLASSIFICATION layer.

Built DIRECTLY from the live Book sheet (cols CV-DD), the authoritative formula source (not the reference
paraphrase). Every quantity bottoms out in KURT/SKEW/AVERAGE of the per-strike DID(AP)/DIT(AR)/DR3(AT)/
NetLatest(K) columns + the temporal globals (TMR/TPS) the engine already computes.

Verified Book formulas (cell -> meaning):
  CX2/3/7   DIDK/DITK/DR3K   = KURT(AP/AR/AT)
  CX13/14/15 DIDS/DITS/DR3S  = SKEW(AP/AR/AT)
  CX16      KURT(NetLatest)  CX17 DIDAVG=AVG(AP)  CX18 AVG(NetLatest)
  CX35-37   Mass k/s   I=DIDK/DIDS, T=DITK/DITS, R=DR3K/DR3S
  CX41-43   Energy s/k = inverses
  CX46-48   WSF (composition)  = |mass_i| / Σ|mass|
  CX51-53   WSM (motion)       = |energy_i| / Σ|energy|   ⚠ CX52 references CX47 (a WSF cell) in the live Book —
                                  replicated faithfully + flagged (cross-term or Book bug; not silent-fixed).
  DB5-7     Speeds  SoR=|DR3S|·|DR3K|·TPS, SoI=DIDK²/DIDS² (=CX35/CX41), SoT=CX36/CX42
  DB8-10    Lags = exact inverses of speeds
  DB11-13   Inertia  II=DIDAVG/SoI, TI=AVG(NetLatest)/SoT, RI=KURT(NetLatest)/SoR
  DB17-19   TREND LENGTH  IntentTL=II·TMR, TransTL=TI·TMR, RealizTL=TMR·|RI|   (the rolling-market quantity)
  DB29 K=DR3K/(DIDK/DITK)  DB30 S=DR3S/(DIDS/DITS)  DB31 Mass=K/S  DB32 Force=S/K  DB33 Cs=Mass/Force
  DB52/53   Lorentz γ_T=1/√(1−(SoT/Cs)²), γ_R=1/√(1−(SoR/Cs)²)
  DB58/59   s²_I=Cs²·DITS²−IntentTL² ; SC_I = TIMELIKE(s²>0)/SPACELIKE(s²<0)/LIGHTLIKE(0)

Field TYPE label from cascade sign-alignment (panel: I&T opposition-signed -> ROTATIONAL; aligned -> DIRECTIONAL).
PAPER / analysis only. Framework-native units.
"""
import numpy as np
from quan_engine import excel_kurt, excel_skew
import quan_perstrike as PS
import quan_temporal as T

def _safe(a, b):
    return a / b if (b not in (0, 0.0) and not np.isnan(b)) else float("nan")

def field_state(frame):
    ps = PS.per_strike(frame)
    AP = ps["AP"].replace([np.inf, -np.inf], np.nan).dropna().to_numpy()   # DID
    AR = ps["AR"].replace([np.inf, -np.inf], np.nan).dropna().to_numpy()   # DIT
    AT = ps["AT"].replace([np.inf, -np.inf], np.nan).dropna().to_numpy()   # DR3
    K  = ps["K"].replace([np.inf, -np.inf], np.nan).dropna().to_numpy() if "K" in ps else np.array([])

    # Liquidity Ratio (Book column T = P/Q): P = NetOI/(putOI/callOI), Q = NetVol/(putVol/callVol).
    # CX16 = KURT(T), CX18 = AVG(T). VERIFIED: the inertia branch uses Liquidity Ratio, NOT Net Latest.
    f = frame
    with np.errstate(all="ignore"):
        O = (f["putOI"] - f["callOI"]); M = (f["putOI"] / f["callOI"])
        L = (f["putVol"] - f["callVol"]); N = (f["putVol"] / f["callVol"])
        P = O / M; Q = L / N
        LIQ = (P / Q).replace([np.inf, -np.inf], np.nan).dropna().to_numpy()

    DIDK, DITK, DR3K = excel_kurt(AP), excel_kurt(AR), excel_kurt(AT)      # CX2/3/7
    DIDS, DITS, DR3S = excel_skew(AP), excel_skew(AR), excel_skew(AT)      # CX13/14/15
    NLK   = excel_kurt(LIQ) if LIQ.size else float("nan")                # CX16 = KURT(Liquidity Ratio)
    DIDAVG = float(np.nanmean(AP)) if AP.size else float("nan")           # CX17
    NLAVG  = float(np.nanmean(LIQ)) if LIQ.size else float("nan")         # CX18 = AVG(Liquidity Ratio)

    # masses (k/s) and energies (s/k)
    I_ks, T_ks, R_ks = _safe(DIDK, DIDS), _safe(DITK, DITS), _safe(DR3K, DR3S)   # CX35-37
    I_sk, T_sk, R_sk = _safe(DIDS, DIDK), _safe(DITS, DITK), _safe(DR3S, DR3K)   # CX41-43

    # WSF composition (CX46-48)
    sden = abs(I_ks) + abs(T_ks) + abs(R_ks)
    WSF = dict(I=_safe(abs(I_ks), sden), T=_safe(abs(T_ks), sden), R=_safe(abs(R_ks), sden))
    # WSM motion (CX51-53) — NOTE the live-Book CX52 quirk (uses CX47=T(WSF) not T_sk). Replicated + flagged.
    eden = abs(I_sk) + abs(T_sk) + abs(R_sk)
    T_wsf = WSF["T"]
    WSM = dict(I=_safe(abs(I_sk), eden), T=_safe(abs(T_wsf), eden), R=_safe(abs(R_sk), eden),
               _quirk="CX52 uses T(WSF) not T(s/k) — live-Book cross-term, replicated as-is")

    # temporal globals for TMR / TPS
    g = T.temporal_globals(frame)
    TMR, TPS = g.get("TMR", float("nan")), g.get("TPS", float("nan"))

    # speeds (DB5-7), lags (DB8-10)
    SoI = _safe(I_ks, I_sk)                       # = DIDK²/DIDS²
    SoT = _safe(T_ks, T_sk)
    SoR = abs(DR3S) * abs(DR3K) * TPS if not np.isnan(TPS) else float("nan")
    lag = dict(I=_safe(I_sk, I_ks), T=_safe(T_sk, T_ks), R=_safe(R_sk, R_ks))

    # inertia (DB11-13)
    II = _safe(DIDAVG, SoI)
    TI = _safe(NLAVG, SoT)
    RI = _safe(NLK, SoR)

    # TREND LENGTH (DB17-19) — the rolling-market quantity
    TL = dict(intent=II * TMR if not np.isnan(II) and not np.isnan(TMR) else float("nan"),
              trans=TI * TMR if not np.isnan(TI) and not np.isnan(TMR) else float("nan"),
              realiz=TMR * abs(RI) if not np.isnan(RI) and not np.isnan(TMR) else float("nan"))

    # curvature fields + Cs (DB29-33)
    Kf = _safe(DR3K, _safe(DIDK, DITK))           # DB29
    Sf = _safe(DR3S, _safe(DIDS, DITS))           # DB30
    Mass = _safe(Kf, Sf); Force = _safe(Sf, Kf); Cs = _safe(Mass, Force)   # DB31/32/33

    # spacetime (DB52-59)
    def gamma(v):
        try:
            x = 1 - (v / Cs) ** 2
            return 1 / np.sqrt(x) if x > 0 else 0.0
        except Exception:
            return 0.0
    gamma_T, gamma_R = gamma(SoT), gamma(SoR)
    s2_I = (Cs ** 2) * (DITS ** 2) - (TL["intent"] ** 2) if not np.isnan(Cs) and not np.isnan(TL["intent"]) else float("nan")
    SC = ("TIMELIKE" if (s2_I == s2_I and s2_I > 0) else
          "SPACELIKE" if (s2_I == s2_I and s2_I < 0) else "LIGHTLIKE")

    # field TYPE — convention-aware (2026-06-03 fix). DIDS/DITS are INVERSE (neg=bull), DR3S is
    # CLASSIC (pos=bull); test DIRECTIONAL agreement the way CDS does, not raw-sign equality.
    iSign, tSign = np.sign(DIDS), np.sign(DITS)
    if iSign != 0 and tSign != 0 and iSign != tSign:
        ftype = "ROTATIONAL"          # intent & transaction oppose (convention-robust)
    elif (DIDS < 0 and DITS < 0 and DR3S > 0) or (DIDS > 0 and DITS > 0 and DR3S < 0):
        ftype = "DIRECTIONAL"         # all three agree DIRECTIONALLY (= |CDS|==1)
    else:
        ftype = "CONFLICTED"          # I&T agree, realization opposes

    return dict(
        WSF=WSF, WSM=WSM, speeds=dict(I=SoI, T=SoT, R=SoR), lags=lag,
        inertia=dict(I=II, T=TI, R=RI), trend_length=TL,
        curvature=dict(K=Kf, S=Sf, Mass=Mass, Force=Force, Cs=Cs),
        spacetime=dict(gamma_T=gamma_T, gamma_R=gamma_R, s2_I=s2_I, SC=SC),
        field_type=ftype,
        primitives=dict(DIDK=DIDK, DITK=DITK, DR3K=DR3K, DIDS=DIDS, DITS=DITS, DR3S=DR3S,
                        DIDAVG=DIDAVG, NLAVG=NLAVG, NLK=NLK, TMR=TMR, TPS=TPS),
    )
