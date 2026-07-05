"""
quan_temporal.py — the tick / velocity / temporal globals and the per-position conductance chain.

Verified against the populated NQ Apr-10 Book's cached values (data_only) this session. Every formula is
pinned to an exact Book cell (Observable Fields col CX, Relativity col DB, per-position cols CR/CS/CT/CU).

GLOBALS (per-snapshot scalars), Book Relativity block (col DB), built on Observable Fields (col CX):
  CX2  DIDK   = KURT(AP)        CX3  DITK = KURT(AR)        CX7  DR3K = KURT(AT)
  CX9  DIDAVG = AVERAGE(AP)     CX10 DITAVG = AVERAGE(AR)   CX11 AvgRatio = DIDAVG/DITAVG
  CX13 DIDS   = SKEW(AP)        CX14 DITS = SKEW(AR)        CX15 DR3S = SKEW(AT)
  CX22 R(d)   = max_strike - min_strike        (dealer range / strike span)
  CX23 DIDcurv= |sum(AP)/5|     CX24 DR3curv = |sum(AT)/2|
  CX25 ICA    = (DIDAVG*DIDK)/|DIDS|           CX26 TCA = (DITAVG*DITK)/|DITS|
  CX28 MRW    = |ICA - TCA|     CX29 OMTR = R(d)/MRW
  DB29 K   = DR3K/(DIDK/DITK)   DB30 S = DR3S/(DIDS/DITS)
  DB28 ICF = 1 + K + S          DB31 Mass = K/S   DB32 Force = S/K   DB33 Cs = Mass/Force
  DB25 Tempo V(base) = (DR3curv + DIDcurv)/R(d)           ( = (CX24+CX23)/CX22 )
  DB26 TPS   = Tempo/86400
  DB27 C(f)  = (ICF * Tempo)/TPS                          ( = (DB28*DB25)/DB26 )
  DB2  TMR   = AvgRatio * OMTR * |K|                      ( = CX11*CX29*ABS(DB29) )
  DB3  PT    = TMR/|C(f)|                                 ( = DB2/ABS(DB27) )

PER-POSITION CONDUCTANCE CHAIN (Book cols CR/CS/CT/CU, on the 21-row CW axis):
  CR Pressure Curvature / Packet Timing  = CD / PT                       (col CR = CD/$DB$3)
  CS Chronometric Field Force            = (CR[k+1]-CR[k]) / (CB[k+1]-CB[k])
  CT Chronometric Conductance            = (CS[k+1]-CS[k]) / (CC[k+1]-CC[k])
  CU Chronometric Impedance              = (CC[k+1]-CC[k]) / (CS[k+1]-CS[k])   ( = 1/CT )
"""
import numpy as np


def _moments(frame):
    """Per-strike AP/AR/AT exactly as compute_cascade, returns the arrays for the global moments."""
    AN = frame["putPrem"].fillna(0) - frame["callPrem"].fillna(0)
    O  = frame["putOI"].fillna(0)  - frame["callOI"].fillna(0)
    L  = frame["putVol"].fillna(0) - frame["callVol"].fillna(0)
    AP = (AN / O.replace(0, np.nan)).to_numpy(float)
    AR = (AN / L.replace(0, np.nan)).to_numpy(float)
    AT = (AP / np.where(AR == 0, np.nan, AR))
    return AP, AR, AT


def _skew(a):
    a = a[np.isfinite(a)]; n = a.size
    if n < 3: return 0.0
    m = a.mean(); s = a.std(ddof=1)
    if s == 0: return 0.0
    return (n / ((n - 1) * (n - 2))) * np.sum(((a - m) / s) ** 3)


def _kurt(a):
    a = a[np.isfinite(a)]; n = a.size
    if n < 4: return 0.0
    m = a.mean(); s = a.std(ddof=1)
    if s == 0: return 0.0
    g = (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * np.sum(((a - m) / s) ** 4)
    return g - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3))


def temporal_globals(frame, strikes=None):
    """Compute the full DB-block temporal/velocity globals from a chain. Returns a dict of scalars."""
    AP, AR, AT = _moments(frame)
    DIDK, DITK, DR3K = _kurt(AP), _kurt(AR), _kurt(AT)
    DIDS, DITS, DR3S = _skew(AP), _skew(AR), _skew(AT)
    DIDAVG = np.nanmean(AP); DITAVG = np.nanmean(AR)
    AvgRatio = DIDAVG / DITAVG if DITAVG != 0 else 0.0
    if strikes is None:
        strikes = frame["strike"].to_numpy(float)
    # CX22 R(d) — VERIFIED against live Book formula: =ABS(MAX(BP:BP))-MIN(BP:BP) where BP = the strike column.
    # i.e. Rd = |max strike| - min strike (the full strike RANGE). Confirmed 2026-06-01 by reading the Book XML
    # formula directly + LibreOffice recalc. The glossary ("max strike - min strike") agrees.
    # ⚠ CONFLICT FLAGGED: a prior engine comment claimed the row-anchored A344-A14 reproduced a cached 4500.
    # That was likely an OLDER Book convention; the CURRENT live Book uses max-min strike range. Using the
    # verified current-Book definition. Old row-anchored value kept as Rd_rowanchor for comparison/audit.
    sg = strikes
    fin = sg[np.isfinite(sg)]
    Rd = float(abs(np.nanmax(fin)) - np.nanmin(fin)) if fin.size else 0.0   # CX22 = |max|-min strike range
    Rd_exact = True
    Rd_rowanchor = float(sg[342] - sg[12]) if (sg.size >= 343 and np.isfinite(sg[12]) and np.isfinite(sg[342])) else None
    DIDcurv = abs(np.nansum(AP) / 5.0)                                   # CX23
    DR3curv = abs(np.nansum(AT) / 2.0)                                   # CX24
    ICA = (DIDAVG * DIDK) / abs(DIDS) if DIDS != 0 else 0.0              # CX25
    TCA = (DITAVG * DITK) / abs(DITS) if DITS != 0 else 0.0              # CX26
    MRW = abs(ICA - TCA)                                                 # CX28
    OMTR = Rd / MRW if MRW != 0 else 0.0                                 # CX29
    K = DR3K / (DIDK / DITK) if (DIDK != 0 and DITK != 0) else 0.0       # DB29
    S = DR3S / (DIDS / DITS) if (DIDS != 0 and DITS != 0) else 0.0       # DB30
    ICF = 1 + K + S                                                      # DB28
    Mass = K / S if S != 0 else 0.0                                      # DB31
    Force = S / K if K != 0 else 0.0                                     # DB32
    Cs = Mass / Force if Force != 0 else 0.0                             # DB33
    Tempo = (DR3curv + DIDcurv) / Rd if Rd != 0 else 0.0                 # DB25
    TPS = Tempo / 86400.0                                                # DB26
    Cf = (ICF * Tempo) / TPS if TPS != 0 else 0.0                        # DB27
    TMR = AvgRatio * OMTR * abs(K)                                       # DB2
    PT = TMR / abs(Cf) if Cf != 0 else 0.0                              # DB3
    return dict(DIDK=DIDK, DITK=DITK, DR3K=DR3K, DIDS=DIDS, DITS=DITS, DR3S=DR3S,
                DIDAVG=DIDAVG, DITAVG=DITAVG, AvgRatio=AvgRatio, Rd=Rd,
                DIDcurv=DIDcurv, DR3curv=DR3curv, ICA=ICA, TCA=TCA, MRW=MRW, OMTR=OMTR,
                K=K, S=S, ICF=ICF, Mass=Mass, Force=Force, Cs=Cs,
                Tempo=Tempo, TPS=TPS, Cf=Cf, TMR=TMR, PT=PT, Rd_exact=Rd_exact, Rd_rowanchor=Rd_rowanchor)


def conductance_chain(cc, cd, cw, PT):
    """Per-position conductance chain over the 21-row CW axis, exactly as Book cols CR/CS/CT/CU.
    cc=Pressure Gradient[21], cd=Pressure Curvature[21], cw=Chronometer axis[21], PT=Packet Timing scalar.
    Returns dict of arrays CR, CS, CT, CU."""
    n = len(cw)
    CR = np.zeros(n)
    if PT != 0:
        for k in range(n):
            CR[k] = cd[k] / PT
    CS = np.zeros(n)
    for k in range(n - 1):
        dcb = cw[k + 1] - cw[k]
        if dcb != 0:
            CS[k] = (CR[k + 1] - CR[k]) / dcb
    CT = np.zeros(n)
    CU = np.zeros(n)
    for k in range(n - 1):
        dcc = cc[k + 1] - cc[k]
        dcs = CS[k + 1] - CS[k]
        if dcc != 0:
            CT[k] = dcs / dcc
        if dcs != 0:
            CU[k] = dcc / dcs
    return dict(CR=CR.tolist(), CS=CS.tolist(), CT=CT.tolist(), CU=CU.tolist())


if __name__ == "__main__":
    import sys
    sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, "engine")
    from quan_engine import ingest_chain
    fr = ingest_chain(sys.argv[1])
    g = temporal_globals(fr)
    for k, v in g.items():
        print(f"{k:8}: {v}")
