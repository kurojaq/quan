"""
quan_compass.py — Time State Compass (mirror-pair gradient/curvature over chronometer axis).
Spec: Book 'Time State Compass(Curvature)'/'(Gradient)'. Input B = Book!CD (Curvature) or CC (Gradient),
i.e. the per-strike Pressure Curvature/Gradient series (rows 2..22 = first 21 strikes).
Mirror pairs are symmetric about row 12 (axis value 0). Pair series spans rows 2..12 (offsets 0..10).
"""
import numpy as np
import pandas as pd
from quan_engine import excel_skew, excel_kurt

def pressure_grad_curv(BN):
    """CC = rolling gradient of Tuning(BR=BN) offset 13 rows; CD = gradient of CC. Step ΔCB=0.1."""
    BR = np.asarray(BN, dtype=float); n = len(BR)
    CC = np.full(n, np.nan); CD = np.full(n, np.nan)
    for i in range(n):                       # CC2(i=0): (BR16-BR15)=(i14-i13)
        a, b = i+14, i+13
        if a < n and b < n: CC[i] = (BR[a]-BR[b]) / 0.1
    for i in range(n-1):
        if not np.isnan(CC[i]) and not np.isnan(CC[i+1]): CD[i] = (CC[i+1]-CC[i]) / 0.1
    return CC, CD

def compass(B_series, n_axis=21):
    """B_series: per-strike Pressure Curvature (or Gradient), first n_axis values -> rows 2..22."""
    B = np.asarray(B_series, dtype=float)[:n_axis]
    B = np.nan_to_num(B, nan=0.0)
    N = len(B)
    idx = lambda m: m-2                       # Book row m -> 0-based index
    R = range(2, 2+N)
    cols = {k: np.full(N, np.nan) for k in
            ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P",
             "R","S","T","U","V","X","Y","Z","AA","AB","AD","AF"]}
    cols["A"] = np.array([round(-1+(r-2)*0.1,10) for r in R])
    cols["B"] = B.copy()
    cols["C"] = np.array([0.0]+[round(0.1*k,10) for k in range(1,N)])
    def g(arr, m):
        j = idx(m)
        return arr[j] if 0 <= j < N else np.nan
    for r in R:
        i = idx(r)
        if r == 2:
            D=E_=K=g(B,12); O=K
        else:
            bm1, bp1 = g(B,14-r), g(B,10+r)        # pairs multiplied/divided (center-out)
            D = bm1*bp1
            E_ = bm1/bp1 if bp1 not in (0,) and not np.isnan(bp1) and bp1!=0 else np.nan
            ka, kb = g(B,r-1), g(B,25-r)            # sum/diff pairs (edge-in)
            K = ka+kb; O = ka-kb
        cols["D"][i]=D; cols["E"][i]=E_; cols["K"][i]=K; cols["O"][i]=O
    with np.errstate(all="ignore"):
        D,E_,K,O,C = cols["D"],cols["E"],cols["K"],cols["O"],cols["C"]
        cols["F"]=np.where(E_!=0, D/E_, 0)
        cols["I"]=np.where(D!=0, E_/D, 0)
        cols["J"]=D*E_
        cols["R"]=np.where(D!=0, K/D, 0)
        cols["S"]=np.where(E_!=0, O/E_, 0)
        cols["U"]=np.where(cols["S"]!=0, cols["R"]/cols["S"], 0)
        cols["V"]=np.where(cols["R"]!=0, cols["S"]/cols["R"], 0)
        cols["X"]=cols["R"]*cols["S"]
        cols["Y"]=np.where(O!=0, K/O, 0)
        cols["AB"]=np.where(K!=0, O/K, 0)
        cols["AD"]=K*O
        sh=lambda a:np.append(a[1:],np.nan)        # next-row shift
        cols["G"]=sh(cols["F"])-cols["F"]
        cols["H"]=sh(cols["G"])-cols["G"]
        cols["L"]=sh(K)-K; cols["M"]=sh(cols["L"])-cols["L"]
        cols["N"]=K+sh(K); cols["P"]=O+sh(O)
        cols["T"]=cols["S"]+sh(cols["S"])
        cols["Z"]=sh(cols["Y"])-cols["Y"]; cols["AA"]=sh(cols["Z"])-cols["Z"]
        num=(K-O)/(K+sh(O)); den=(sh(C)-C)/(C+sh(C))
        cols["AF"]=np.where(den!=0, num/den, 0)
    # Book wraps these in IFERROR(...,0): align edge/NaN behavior
    for k in ["F","G","H","I","J","K","L","M","N","O","P","R","S","T","U","V","X","Y","Z","AA","AB","AD","AF"]:
        cols[k]=np.nan_to_num(cols[k], nan=0.0)
    df = pd.DataFrame(cols)
    pair_stats = {                              # kurt/skew of pair series over rows 2..12 (idx 0..10)
        "KURT_D": excel_kurt(D[:11][~np.isnan(D[:11])]),
        "KURT_E": excel_kurt(E_[:11][~np.isnan(E_[:11])]),
        "KURT_K": excel_kurt(K[:11][~np.isnan(K[:11])]),
        "KURT_O": excel_kurt(O[:11][~np.isnan(O[:11])]),
        "SKEW_D": excel_skew(D[:11][~np.isnan(D[:11])]),
    }
    return df, pair_stats
