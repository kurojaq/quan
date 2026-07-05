#!/usr/bin/env python3
"""
quan_log_session.py  —  PRE-SESSION logger for the capture-radius study.

Given the session's chain + anchor (session-open price), computes SIX candidate
"centers of mass" for the dominant pin and appends one row to the append-only
ledger. Outcome columns are left blank; quan_score_session.py fills them after
the close.

The six candidates (pre-registered — frozen set, do not extend mid-study):
  comg      gamma centroid       Σ(K·|gex_K|)/Σ|gex_K|        (true center of mass by gamma)
  peakg     heaviest gamma wall  argmax_K |gex_K|             (single dominant point mass)
  watermark dealer gravity point engine WMARKS[0]             (framework's existing center)
  maxpain   max-pain strike      argmin_S writer payout       (classic pin)
  zerogamma net-gamma flip price where signed GEX crosses 0   (boundary attractor)
  comoi     OI centroid          Σ(K·OI_K)/Σ OI_K             (center of mass by open interest)

Scoring is anchor-based (see quan_score_session.py): gap-closed from the anchor
toward each pin, plus whether price touched the pin in the session range.

Usage:
  python3 quan_log_session.py <chain.csv> <anchor> [T_days=1.0] [ledger.csv]
"""
import sys, os, csv, datetime as _dt
import numpy as np

CANDIDATES = ["comg", "peakg", "watermark", "maxpain", "zerogamma", "comoi"]
FIELDS = (["date", "anchor", "T_days", "bias", "cds", "regime", "wave", "session", "total_mass_gex"]
          + [f"{p}_{c}" for c in CANDIDATES for p in ("pin", "mass", "D")]
          + ["high", "low", "close", "scored"]
          + [f"{p}_{c}" for c in CANDIDATES for p in ("gapclosed", "touched")])


def _engine_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return here


def compute_candidates(csv_path, anchor, T_days=1.0):
    sys.path.insert(0, _engine_path())
    import quan_greeks as GK
    from quan_engine import ingest_chain
    import quan_pine_export as PX

    fr = ingest_chain(csv_path)
    gf = GK.greeks_from_chain(fr, anchor, multiplier=20.0, T_days=T_days)
    greeks = GK.greeks_layer(fr, gf, anchor, multiplier=20.0)
    strikes = np.array(greeks["strikes"], dtype=float)
    gex = np.abs(np.array(greeks["gex_perstrike"], dtype=float))   # magnitude per strike (gamma candidates)
    # full-chain OI (NaN cells -> 0) for the OI-based candidates and gamma-sign alignment
    frv = fr.copy()
    frv["callOI"] = frv["callOI"].fillna(0.0); frv["putOI"] = frv["putOI"].fillna(0.0)
    Ks = frv["strike"].to_numpy(dtype=float)
    cOf = frv["callOI"].to_numpy(dtype=float); pOf = frv["putOI"].to_numpy(dtype=float)
    tOf = cOf + pOf
    oi_at = {float(k): (c, p) for k, c, p in zip(Ks, cOf, pOf)}    # strike -> (callOI, putOI)
    cOI = np.array([oi_at.get(float(s), (0.0, 0.0))[0] for s in strikes])
    pOI = np.array([oi_at.get(float(s), (0.0, 0.0))[1] for s in strikes])
    totOI = cOI + pOI

    out = {}
    # 1. gamma centroid
    gsum = gex.sum()
    out["comg"] = (float((strikes * gex).sum() / gsum) if gsum > 0 else float("nan"),
                   float(gsum))
    # 2. heaviest gamma wall
    if len(gex) and gex.max() > 0:
        i = int(np.argmax(gex)); out["peakg"] = (float(strikes[i]), float(gex[i]))
    else:
        out["peakg"] = (float("nan"), 0.0)
    # 3. watermark — from the engine's own payload (WMARKS[0])
    wm = float("nan"); wm_mass = float("nan")
    try:
        payload = PX.export_snapshot(csv_path, anchor, multiplier=20.0, T_days=T_days)
        d = dict(kv.split("=", 1) for kv in payload.split("|") if "=" in kv)
        wmstr = d.get("WMARKS", "")
        if wmstr:
            wm = float(wmstr.split(",")[0].split(":")[0])
            # local mass = |gex| at nearest strike
            j = int(np.argmin(np.abs(strikes - wm))) if len(strikes) else None
            wm_mass = float(gex[j]) if j is not None else float("nan")
        _read = dict(bias=d.get("BIAS_VOTE", ""), cds=d.get("CDS", ""), regime=d.get("REGIME", ""),
                     wave=d.get("WAVE", ""), session=d.get("SESSION", ""))
    except Exception as e:
        _read = dict(bias="", cds="", regime="", wave="", session="")
    out["watermark"] = (wm, wm_mass)
    # 4. max-pain — strike minimizing total writer payout
    mp = float("nan"); mp_mass = float("nan")
    if len(Ks) and tOf.sum() > 0:
        pains = [(cOf * np.maximum(S - Ks, 0) + pOf * np.maximum(Ks - S, 0)).sum() for S in Ks]
        k = int(np.argmin(pains)); mp = float(Ks[k]); mp_mass = float(tOf[k])
    out["maxpain"] = (mp, mp_mass)
    # 5. zero-gamma flip — where cumulative SIGNED gex crosses zero
    zg = float("nan"); zg_mass = float("nan")
    if len(strikes) > 1:
        gamma = np.where(totOI > 0, np.abs(np.array(greeks["gex_perstrike"])) / np.maximum(totOI, 1), 0.0)
        signed = gamma * (cOI - pOI)                  # per strike: call-heavy +, put-heavy -
        order = np.argsort(strikes)
        ks = strikes[order]; sg = signed[order]
        crossings = []
        for a in range(len(sg) - 1):
            if sg[a] == 0:
                continue
            if (sg[a] < 0 <= sg[a + 1]) or (sg[a] > 0 >= sg[a + 1]):
                t = abs(sg[a]) / (abs(sg[a]) + abs(sg[a + 1]) + 1e-12)
                crossings.append(float(ks[a] + t * (ks[a + 1] - ks[a])))
        if crossings:                                  # the dominance boundary nearest the anchor
            zg = min(crossings, key=lambda x: abs(x - anchor))
            j = int(np.argmin(np.abs(strikes - zg))); zg_mass = float(abs(signed[j]))
    out["zerogamma"] = (zg, zg_mass)
    # 6. OI centroid
    osum = tOf.sum()
    out["comoi"] = (float((Ks * tOf).sum() / osum) if osum > 0 else float("nan"), float(osum))
    return out, float(gsum), _read


def log_session(csv_path, anchor, T_days=1.0, ledger="quan_ledger.csv"):
    cands, total_mass, read = compute_candidates(csv_path, anchor, T_days)
    row = {f: "" for f in FIELDS}
    row.update(date=_dt.date.today().isoformat(), anchor=f"{anchor:.2f}", T_days=f"{T_days:.3f}",
               total_mass_gex=f"{total_mass:.0f}", scored="0", **read)
    for c in CANDIDATES:
        pin, mass = cands[c]
        row[f"pin_{c}"] = "" if (pin != pin) else f"{pin:.2f}"          # nan-safe
        row[f"mass_{c}"] = "" if (mass != mass) else f"{mass:.1f}"
        row[f"D_{c}"] = "" if (pin != pin) else f"{pin - anchor:.2f}"
    new = not os.path.exists(ledger)
    with open(ledger, "a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        if new:
            w.writeheader()
        w.writerow(row)
    print(f"logged {row['date']} anchor {anchor:.2f} -> {ledger}")
    for c in CANDIDATES:
        print(f"  {c:10s} pin={row['pin_'+c] or 'na':>9}  D={row['D_'+c] or 'na':>8}  mass={row['mass_'+c] or 'na'}")
    return ledger


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: python3 quan_log_session.py <chain.csv> <anchor> [T_days=1.0] [ledger.csv]"); sys.exit(1)
    chain = sys.argv[1]; anchor = float(sys.argv[2])
    T = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    led = sys.argv[4] if len(sys.argv) > 4 else "quan_ledger.csv"
    log_session(chain, anchor, T, led)
