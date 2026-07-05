"""
quan_perstrike.py — extended per-strike layer (Book_Strike_Level cols W..BN).
Strike Kurt/Skew -> Mass/Force/Speed/Lag/Accel/Jerk, Strike ICF + curvature,
Dealer Premium Time + Dealer-time ratios, raw pressure gradients (normalized).
Needs globals (ICF, Mass, Force, Cs, Cl, TransMass DB37, TransToReal DB38) from compute_relativistic.

NOTE on the tuning/PG/PC block (BR..CU): NOT built here. Those use hard-coded anchor rows
(CC = (BR16-BR15)/Δ, BT = BR*BS20) tied to a fixed strike-grid position, and CM carries a #REF!
in the Book itself. Build separately with explicit anchor handling once their meaning is confirmed.
"""
import numpy as np
import pandas as pd
from quan_engine import excel_skew, excel_kurt, compute_cascade
from quan_relativistic import compute_relativistic

def _rowstat(mat, fn, min_n):
    out = np.full(mat.shape[0], np.nan)
    for i in range(mat.shape[0]):
        v = mat[i][~np.isnan(mat[i])]
        if len(v) >= min_n:
            try: out[i] = fn(v)
            except Exception: pass
    return out

def _minmax(s):
    lo, hi = np.nanmin(s), np.nanmax(s)
    return (s - lo) / (hi - lo) if hi != lo else s*np.nan

def per_strike(frame: pd.DataFrame) -> pd.DataFrame:
    f = frame.reset_index(drop=True)
    cP=f.callPrem.fillna(0); pP=f.putPrem.fillna(0)
    cO=f.callOI.fillna(0);  pO=f.putOI.fillna(0)
    cV=f.callVol.fillna(0); pV=f.putVol.fillna(0)
    cLt=f.callLatest.fillna(0); pLt=f.putLatest.fillna(0)
    nan=lambda x: x.replace(0, np.nan)

    K  = pLt - cLt                       # Net Latest (K)
    L  = pV - cV                         # Net Tx
    M  = pO / nan(cO)                    # PCR_OI
    N  = pV / nan(cV)                    # PCR_Vol
    O  = pO - cO                         # Net OI
    P  = O / nan(M); Q = L / nan(N)
    R  = O / nan(L); S = L / nan(O)
    T  = P / nan(Q)                      # Liquidity Ratio
    AN = pP - cP                         # Net Premium

    d = pd.DataFrame({"strike":f.strike,"K":K,"L":L,"M":M,"N":N,"O":O,"P":P,"Q":Q,"R":R,"S":S,"T":T,"AN":AN})

    # W/X: per-row kurt/skew across [L..T]
    mat = d[["L","M","N","O","P","Q","R","S","T"]].to_numpy(dtype=float)
    d["W"] = _rowstat(mat, excel_kurt, 4)      # Strike Kurt (KURT needs >=4)
    d["X"] = _rowstat(mat, excel_skew, 3)      # Strike Skew (SKEW needs >=3)

    g = compute_relativistic(f, compute_cascade(f)["CDS"])
    Iks,Tks,Rks = g["Iks"],g["Tks"],g["Rks"]
    DB37 = Iks/Tks; DB38 = DB37/Rks            # TransMass, TransToReal
    pg_scale = (DB37-DB38)*g["Mass"]

    W=d["W"]; X=d["X"]
    d["Y"]  = 1 + W + W.shift(-1)              # Strike ICF (this+next kurt)
    d["Z"]  = d["Y"]/86400                     # Time Density
    d["AA"] = d["Z"].shift(-1)-d["Z"]          # STD Gradient
    d["AB"] = d["AA"].shift(-1)-d["AA"]        # STD Curvature
    d["AC"] = d["Y"]/g["ICF"]                  # to global ICF
    d["AD"] = W/nan(X)                         # Strike Mass
    d["AE"] = d["AD"]/g["Mass"]
    d["AF"] = X/nan(W)                         # Strike Force
    d["AG"] = d["AF"]/g["Force"]
    d["AH"] = d["AD"]/nan(d["AF"])             # Strike Speed
    d["AI"] = d["AH"]/g["Cs"]
    d["AJ"] = d["AF"]/nan(d["AD"])             # Strike Lag
    d["AK"] = d["AJ"]/g["Cl"]
    d["AL"] = d["AH"]/nan(d["AJ"])             # Acceleration
    d["AM"] = d["AJ"]/nan(d["AH"])             # Jerk
    d["AO"] = AN*K                             # Dealer Premium Time
    d["AP"] = AN/nan(O)                        # DID
    d["AR"] = AN/nan(L)                        # DIT
    d["AT"] = d["AP"]/nan(d["AR"])             # DR3
    d["AW"] = d["AT"]*d["AO"]                  # Dealer Realized Time
    d["AY"] = d["AP"]/nan(d["AO"])
    d["AZ"] = d["AO"]/nan(d["AP"])             # Dealer Time/DID
    d["BA"] = d["AO"]/nan(d["AR"])
    d["BB"] = d["AW"]/nan(d["AZ"])
    d["BC"] = d["AZ"].shift(-1)-d["AZ"]        # Dealer Time Gradient
    d["BD"] = d["BC"].shift(-1)-d["BC"]
    d["BE"] = pg_scale*d["BC"].abs()           # Dealer Time Normalized (pre-minmax)
    d["BG"] = _minmax(d["BE"])
    d["BH"] = pg_scale*d["AP"].abs()           # Raw Intent Pressure Gradient
    d["BI"] = _minmax(d["BH"])
    d["BJ"] = pg_scale*d["AR"].abs()           # Raw Transaction PG
    d["BK"] = _minmax(d["BJ"])
    d["BL"] = pg_scale*d["AT"].abs()           # Raw Realization PG
    d["BM"] = _minmax(d["BL"])
    d["BN"] = d["BI"].shift(-1)-d["BI"]        # Turning Calculation
    return d
