"""
quan_fullcircle.py — the per-session scorecard that ties the three layers together:

  1. DEALER LEVELS  (corridor: floor/ceiling/target/watermarks)        — WHERE
  2. TENSOR  intent (structure/compression) vs realization (direction)  — WHICH WAY
  3. JERK + STRIKE POINTS  (release session-T decile + price offset)     — WHEN / AT WHAT PRICE

The headline tracked signal is the REALIZATION direction, read with the framework's
inverted realization sign (CDS scores DR3S>0 bullish, opposite to DIDS/DITS<0). It is
logged BEFORE the outcome is known and scored after, so a real track record accumulates.
n is tiny right now — this is a scorecard, not a validated edge.

Usage:
    python quan_fullcircle.py log               # build/append records for all SESSIONS, score, print
    python quan_fullcircle.py log <Label>       # one session
Log file: /mnt/user-data/outputs/fullcircle_log.jsonl  (one JSON record per line)
"""
import os, sys, json, datetime as dt
import pandas as pd
sys.path.insert(0, "/home/claude"); sys.path.insert(0, "/mnt/user-data/outputs")
import quan_tensor as qt
from quan_engine import ingest_chain, compute_cascade, compute_levels

LOG = "/mnt/user-data/outputs/fullcircle_log.jsonl"
DATE = {"Apr-13":"2026-04-13","May-14":"2026-05-14","May-15":"2026-05-15",
        "May-18":"2026-05-18","May-21":"2026-05-21"}
PRICE_FILES = ["/mnt/project/CME_MINI_NQ1_1.csv","/mnt/project/CME_MINI_NQ1_1_30.csv",
               "/mnt/project/CME_MINI_NQ1_1_31.csv","/mnt/project/CME_MINI_NQ1_1_32.csv",
               "/mnt/user-data/uploads/CME_MINI_NQ1___1.csv"]

def _price():
    fr=[]
    for f in PRICE_FILES:
        if not os.path.exists(f): continue
        d=pd.read_csv(f); d["t"]=pd.to_numeric(d["time"],errors="coerce"); d=d.dropna(subset=["t"])
        d["dt"]=pd.to_datetime(d["t"],unit="s",utc=True)-pd.Timedelta(hours=4)
        fr.append(d[["dt","open","high","low","close"]])
    return pd.concat(fr).drop_duplicates("dt").sort_values("dt")

def rth_outcome(date, P):
    dd=dt.date.fromisoformat(date)
    h=P["dt"].dt.hour+P["dt"].dt.minute/60
    s=P[(P["dt"].dt.date==dd)&(h>=9.5)&(h<16.0)]
    if len(s)<10: return None
    o,c=s.iloc[0]["open"],s.iloc[-1]["close"]; hi,lo=s["high"].max(),s["low"].min()
    rng=hi-lo; net=c-o
    rdir="UP" if net>rng*0.15 else "DOWN" if net<-rng*0.15 else "FLAT"
    return dict(open=round(float(o),1),close=round(float(c),1),high=round(float(hi),1),
                low=round(float(lo),1),realized_dir=rdir,range=round(float(rng),1),
                net=round(float(net),1))

def build_record(label):
    csv=qt.SESSIONS[label]; anchor=qt.ANCHORS[label]
    frame=ingest_chain(csv); sig=compute_cascade(frame)
    levels=compute_levels(frame, anchor=anchor, cds=sig["CDS"], bias=sig.get("BIAS"))
    # realization tensor (the directional + jerk + strike layer)
    book=f"/home/claude/_fc_{label}.xlsx"
    qt.inject_pressure(frame, anchor, book, source="realization")
    rec=qt.recalc(book, f"/home/claude/_fcrc_{label}")
    rz=qt.extract(rec)
    # framework-convention realization direction: invert (DR3 bullish = DR3S>0)
    ra=rz["mean_asym"]
    real_dir = "DOWN" if ra>0.10 else "UP" if ra<-0.10 else "NEUTRAL"   # inverted
    jerk_strike = (anchor + rz["jerk_peak_offset"]) if rz["jerk_peak_offset"] is not None else None
    amp_strike  = (anchor + rz["amp_peak_offset"])  if rz["amp_peak_offset"]  is not None else None
    return dict(
        label=label, date=DATE[label], anchor=anchor,
        cascade=dict(CDS=sig["CDS"], bias=sig["BIAS"],
                     DIDS=round(sig["DIDS"],3), DITS=round(sig["DITS"],3), DR3S=round(sig["DR3S"],3)),
        dealer_levels={k: levels.get(k) for k in ("DFLOOR","DCEIL","SFLOOR","SCEIL","TARGET")},
        tensor=dict(geometry=rz["geometry"],
                    realization_asym_raw=ra,
                    predicted_dir=real_dir,             # <-- the tracked signal
                    release_decile=rz["jerk_peak_chronoT"],   # WHEN (session-T)
                    jerk_strike=jerk_strike,                    # AT WHAT PRICE
                    amp_strike=amp_strike),
        logged_at=dt.datetime.now(dt.timezone.utc).isoformat(),
    )

def score(rec, P):
    out=rth_outcome(rec["date"], P)
    if out is None: rec["outcome"]=None; return rec
    pred=rec["tensor"]["predicted_dir"]
    if pred=="NEUTRAL": hit="—"
    else:
        rd=out["realized_dir"]
        hit = "HIT" if pred==rd else ("~flat" if rd=="FLAT" else "MISS")
    rec["outcome"]={**out, "hit":hit}
    return rec

def main():
    only = sys.argv[2] if len(sys.argv)>2 else None
    P=_price()
    records=[]
    for label in qt.SESSIONS:
        if only and label!=only: continue
        records.append(score(build_record(label), P))
    # append to persistent log
    with open(LOG,"a") as fh:
        for r in records: fh.write(json.dumps(r)+"\n")
    # print scorecard
    print(f"\n{'sess':>7} {'bias':>11} {'geom':>11} {'realizAsym':>10} {'PRED':>7} {'realized':>8} {'hit':>5} {'releaseT':>8} {'jerk@strike':>11}")
    for r in records:
        t=r["tensor"]; o=r["outcome"] or {}
        print(f"{r['label']:>7} {r['cascade']['bias']:>11} {t['geometry']:>11} "
              f"{t['realization_asym_raw']:>+10.3f} {t['predicted_dir']:>7} "
              f"{o.get('realized_dir','?'):>8} {o.get('hit','?'):>5} "
              f"{str(t['release_decile']):>8} {str(t['jerk_strike']):>11}")
    hits=[r for r in records if (r['outcome'] or {}).get('hit')=='HIT']
    calls=[r for r in records if r['tensor']['predicted_dir']!='NEUTRAL']
    print(f"\n  directional calls: {len(calls)}/{len(records)}   hits: {len(hits)}/{len(calls) if calls else 0}")
    print(f"  log: {LOG}  (total records now: {sum(1 for _ in open(LOG))})")

if __name__=="__main__":
    main()
