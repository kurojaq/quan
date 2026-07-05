"""
quan_information.py — Step 2 layers (no new inputs beyond the chain):
  A) Book_Stats_CDS: σ / variance / excess kurtosis, Jarque-Bera tests, signal labels.
  B) Information_Field: Shannon + Rényi entropy of |Net Premium|, mutual-information proxies.
Spec: Master_Formula_Reference Book_Stats_CDS (CX65-86) and Information_Field (C5-C25).
"""
import numpy as np
import pandas as pd
from quan_engine import excel_skew, excel_kurt

def _cols(frame):
    AN = frame["putPrem"].fillna(0) - frame["callPrem"].fillna(0)
    O  = frame["putOI"].fillna(0)  - frame["callOI"].fillna(0)
    L  = frame["putVol"].fillna(0) - frame["callVol"].fillna(0)
    AP = AN / O.replace(0, np.nan)
    AR = AN / L.replace(0, np.nan)
    AT = AP / AR.replace(0, np.nan)
    return AN, AP, AR, AT

def compute_stats_cds(frame: pd.DataFrame) -> dict:
    _, AP, AR, AT = _cols(frame)
    apd, ard, atd = AP.dropna(), AR.dropna(), AT.dropna()
    # std / var (Excel STDEV/VAR are sample = ddof=1)
    out = {
        "DID_sd": apd.std(ddof=1), "DIT_sd": ard.std(ddof=1), "DR3_sd": atd.std(ddof=1),
        "DID_var": apd.var(ddof=1), "DIT_var": ard.var(ddof=1), "DR3_var": atd.var(ddof=1),
    }
    DIDS, DIDK = excel_skew(AP), excel_kurt(AP)
    DITS, DITK = excel_skew(AR), excel_kurt(AR)
    DR3S, DR3K = excel_skew(AT), excel_kurt(AT)
    out["DIDK_ex"], out["DITK_ex"], out["DR3K_ex"] = DIDK-3, DITK-3, DR3K-3
    # Jarque-Bera: (n/6)*(S^2 + ExcessKurt^2/4)   n = COUNTA of the column
    nI, nT, nR = len(apd), len(ard), len(atd)
    out["JB_I"] = (nI/6)*(DIDS**2 + (DIDK-3)**2/4)
    out["JB_T"] = (nT/6)*(DITS**2 + (DITK-3)**2/4)
    out["JB_R"] = (nR/6)*(DR3S**2 + (DR3K-3)**2/4)
    # signals (Intent/Trans inverse: skew<0=bull; Realization classic: skew>0=bull)
    out["I_SIG"] = "BULLISH" if DIDS < 0 else "BEARISH"
    out["T_SIG"] = "BULLISH" if DITS < 0 else "BEARISH"
    out["R_SIG"] = "BULLISH" if DR3S > 0 else "BEARISH"
    return out

def compute_information_field(frame: pd.DataFrame) -> dict:
    AN, AP, AR, AT = _cols(frame)
    a = AN.abs()
    a = a[a > 0]                       # active (non-zero) net premium
    total = a.sum(); N = len(a)
    p = a / total
    H = float(-(p * np.log(p)).sum())  # Shannon, nats
    Hmax = float(np.log(N)) if N > 0 else np.nan
    Hn = H / Hmax if Hmax else np.nan
    if   Hn < 0.33: htier = "HIGH CONVICTION"
    elif Hn < 0.67: htier = "MODERATE"
    elif Hn < 0.95: htier = "DISPERSED"
    else:           htier = "UNIFORM"
    # Renyi spectrum — Book uses LOG base-10 (validated exact vs Book C13/C14)
    sp = float(np.sqrt(p).sum()); coll = float((p**2).sum())
    H05 = 2*np.log10(sp)      # Renyi a=0.5, base-10 (Book convention)
    H2  = -np.log10(coll)     # Renyi a=2  (collision), base-10
    dH  = H05 - H2            # spread; Book C16 threshold: >1 => fat-tailed concentration
    # MI proxies: pairwise Pearson over aligned active rows of DID/DIT/DR3
    df = pd.DataFrame({"DID": AP, "DIT": AR, "DR3": AT}).dropna()
    rho_IT = df["DID"].corr(df["DIT"]); rho_IR = df["DID"].corr(df["DR3"]); rho_TR = df["DIT"].corr(df["DR3"])
    def mi(r): return -0.5*np.log(1-r**2) if (r is not None and abs(r) < 1) else np.nan
    return {
        "H_shannon": H, "H_max": Hmax, "H_norm": Hn, "H_tier": htier,
        "H_renyi_0.5": H05, "H_renyi_2": H2, "dH_spread": dH,
        "rho_IT": rho_IT, "rho_IR": rho_IR, "rho_TR": rho_TR,
        "MI_IT": mi(rho_IT), "MI_IR": mi(rho_IR), "MI_TR": mi(rho_TR),
        "N_active": N,
    }
