"""
quan_backtest.py — STATE-FLIP paper backtest (the model the data pointed to).

Verified framework definitions:
  STATE FLIP  = DIT (AR) sign change row-to-row  [Book AS2 "Transaction Flows: Marks DIT sign flips"]
  MASS        = Dealer Premium Time AO = NetPremium x NetLatest  [Book AO2, verified]
  DIRECTION   = CDS sign

Model (Spence): dealers flip Greeks at the state-flip strikes; price ignites at the nearest flip zone and
runs THROUGH the flip zones ahead in the CDS direction. ENTRY = bracket the ignition flip zone (3 orders
+/-arm), stop below the next flip zone down. TARGETS = the flip zones ahead, scaled out nearest-first.
Flip zones rank by MASS (AO) for conviction. PAPER. Kelly governor clamped 0.10. Real strikes only.
Runs GATED (GO/SLOW) and a wider BIAS view.
"""
import sys, csv, datetime
sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, ".")
from quan_engine import ingest_chain, compute_cascade, apex_basis
import quan_perstrike as PS
import quan_temporal as T
import quan_execution as EXE
import numpy as np

EQUITY=100000.0; RISK_PER_TRADE=0.01; KELLY_GOV=0.10; PT_VALUE=2.0
BRACKET_ARM=15.0; CLUSTER_GAP=25.0; STOP_BUFFER=10.0
USE_FOLD_GATE=False; FOLD_TOL=0.06; LEG_WINDOW=0.15
TIER_MUL={"TIER_1_FULL":1.0,"TIER_2_STANDARD":0.5,"TIER_3_LIGHT":0.25,"STAND_DOWN":0.0}

def load_session(price_csv,d):
    s=datetime.datetime(d.year,d.month,d.day,22,0)-datetime.timedelta(days=1); e=datetime.datetime(d.year,d.month,d.day,21,0); bars=[]
    for row in list(csv.reader(open(price_csv)))[1:]:
        try:
            t=int(row[0]); dt=datetime.datetime.utcfromtimestamp(t)
            if s<=dt<e: bars.append((dt,float(row[1]),float(row[2]),float(row[3]),float(row[4])))
        except: continue
    return bars

def framework(chain_csv, anchor):
    fr=ingest_chain(chain_csv); cas=compute_cascade(fr); ps=PS.per_strike(fr)
    glob=T.temporal_globals(fr)
    PP=cas.get("PP"); MRW=glob.get("MRW")
    ES=(PP*MRW) if (PP and MRW) else None; EO=(MRW/PP) if (PP and MRW and PP!=0) else None
    FE=(EO+ES) if (EO is not None and ES is not None) else None; b=abs(FE/ES) if (FE and ES and ES!=0) else 1.0
    es=EXE.triple_confirm(cas["CDS"],cas.get("DIDS",0),cas.get("DITS",0),cas.get("DR3S",0),eb=cas.get("entropyBudget",8) or 8,b=b)
    # WAVE/TENSOR timing layer — uses the SESSION-OPEN anchor (consistent with all level computation)
    import quan_realization as R, quan_tensor_field as TF
    rw=R.realization_waves(fr, anchor)
    cc=np.array(rw["pressureGradient"]); cd=np.array(rw["pressureCurvature"]); cw=np.array(rw["cwAxis"])
    cond=T.conductance_chain(cc,cd,cw,glob["PT"]); CT=np.array(cond["CT"])
    cwins=sorted(round((cw[k]+1)/2,3) for k in range(len(cw)) if CT[k]>0)
    ts=TF.tensor_surface(rw["sopG"],rw["sopC"])
    tensor_live=bool(np.nanmax(np.abs(ts["surface"]))>0) if ts.get("surface") is not None else False
    folds=[round(x,3) for x in rw.get("crossings_t",[])]
    return cas, ps, max(2.0*es["kellyHalf"],0.0), es, dict(cwins=cwins, tensor_live=tensor_live, folds=folds)
def flip_zones(ps):
    """state-flip strikes (DIT sign change), clustered into zones; each zone = (center, mass=sum|AO|)."""
    m=ps.sort_values("strike"); ar=m["AR"].values; ao=m["AO"].abs().values; sk=m["strike"].values
    flips=[(sk[i], ao[i]) for i in range(1,len(ar)) if (ar[i]==ar[i] and ar[i-1]==ar[i-1] and ar[i]*ar[i-1]<0)]
    zones=[]
    for s,mass in flips:
        if zones and s-zones[-1][-1] <= CLUSTER_GAP:
            zones[-1][0].append(s); zones[-1][1]+=mass; zones[-1].append(s)
        else:
            zones.append([[s], mass, s])
    return [(float(np.mean(z[0])), float(z[1])) for z in zones]   # (center, mass)

def size_qty(risk_pts, tier, fstar):
    gov=max(KELLY_GOV*fstar,0.0); rf=min(RISK_PER_TRADE,gov)*TIER_MUL.get(tier,0.0)
    return max(int((EQUITY*rf)//(max(risk_pts,1.0)*PT_VALUE)),0)

def run_session(name, chain_csv, price_csv, d, require_gate=True, entry_mode="reclaim"):
    bars=load_session(price_csv,d)
    if not bars: return dict(name=name,error="no bars"),[]
    anchor=bars[0][1]; cas,ps,fstar,es,wt=framework(chain_csv, anchor)
    cds=cas["CDS"]; cdir=1 if cds>0 else (-1 if cds<0 else 0)
    state=es["state"]; tier=es["tier"]; gate=state in ("GO","SLOW")
    tradeable = gate if require_gate else (cdir!=0)
    zones=flip_zones(ps)
    cwins=wt["cwins"]; tensor_live=wt["tensor_live"]; folds=wt["folds"]
    summ=dict(name=name,anchor=anchor,cds=cds,bias=cas.get("BIAS"),state=state,tier=tier,bars=len(bars),
              nzones=len(zones),ncwin=len(cwins),tensor=tensor_live)
    if not tradeable or cdir==0 or not zones:
        summ["note"]="gate STAND" if not tradeable else "no flip zones"; return summ,[]
    # TIMING GATE (Spence): only enter when the field is OPEN — a conductance window AND tensor aligned. If
    # neither is present (e.g., sparse snapshot), the field isn't open -> WAIT, take no trade.
    if not cwins or not tensor_live:
        summ["note"]="field closed (no conductance window / tensor) -> WAIT"; return summ,[]
    # entry flip zone = nearest flip zone to anchor; targets = flip zones ahead in CDS dir, nearest-first
    if cdir>0:
        ahead=sorted([z for z in zones if z[0]>anchor], key=lambda z:z[0])
        below=sorted([z for z in zones if z[0]<=anchor], key=lambda z:-z[0])
    else:
        ahead=sorted([z for z in zones if z[0]<anchor], key=lambda z:-z[0])
        below=sorted([z for z in zones if z[0]>=anchor], key=lambda z:z[0])
    entry_zone = ahead[0] if ahead else (below[0] if below else None)   # ignition = nearest flip in trend dir
    tgts = ahead[1:4] if len(ahead)>1 else ahead[:3]                    # flip zones beyond ignition
    if entry_zone is None or not tgts:
        summ["note"]="no entry/targets"; return summ,[]
    Z=entry_zone[0]
    # bracket geometry around the flip zone
    if cdir>0:
        wick_lvl=Z-BRACKET_ARM; zone_lo=Z-BRACKET_ARM
    else:
        wick_lvl=Z+BRACKET_ARM; zone_lo=Z+BRACKET_ARM
    use_tier = tier if (require_gate and gate) else "TIER_2_STANDARD"
    summ.update(entry_zone=round(Z,0), targets=[round(t[0],0) for t in tgts], mode=entry_mode)
    t0=bars[0][0]; tspan=(bars[-1][0]-t0).total_seconds() or 1; CWIN_TOL=0.04
    qo=0; avg=0.0; stop=None; risk_pts=None; hit=set(); exits=[]; entered=False
    for (dt,o,h,l,c) in bars:
        st=(dt-t0).total_seconds()/tspan
        win_open=any(abs(st-w)<=CWIN_TOL for w in cwins)
        fold_ok = (not USE_FOLD_GATE) or any(0 <= (st-f) <= LEG_WINDOW for f in folds)   # in the leg AFTER a flip
        # ---- ENTRY ----
        if not entered and win_open and fold_ok:
            if entry_mode=="reclaim":
                # dipped INTO the zone and CLOSED back through it in the trade dir = flip held
                tested = (l<=Z) if cdir>0 else (h>=Z)
                held   = (c>Z) if cdir>0 else (c<Z)
                if tested and held:
                    entry=c; stop=(l if cdir>0 else h)-(STOP_BUFFER if cdir>0 else -STOP_BUFFER)
                    risk_pts=abs(entry-stop); qty=size_qty(risk_pts,use_tier,fstar)
                    if qty>0: avg=entry; qo=qty; entered=True
            elif entry_mode=="wick":
                # limit at the BOTTOM of the zone — catch the wick-through flush
                tag = (l<=wick_lvl) if cdir>0 else (h>=wick_lvl)
                if tag:
                    entry=wick_lvl; stop=wick_lvl-STOP_BUFFER if cdir>0 else wick_lvl+STOP_BUFFER
                    risk_pts=abs(entry-stop); qty=size_qty(risk_pts,use_tier,fstar)
                    if qty>0: avg=entry; qo=qty; entered=True
        # ---- MANAGE ----
        if qo>0:
            if (l<=stop) if cdir>0 else (h>=stop):
                exits.append(("STOP",stop,qo)); qo=0; break
            per=max(qo//3,1)
            for ti,(tpx,mass) in enumerate(tgts,start=1):
                if ((h>=tpx) if cdir>0 else (l<=tpx)) and ti not in hit and qo>0:
                    q=min(per,qo); exits.append((f"T{ti}",tpx,q)); qo-=q; hit.add(ti)
            if qo<=0: break
    if not entered: summ["note"]="no entry (no reclaim/wick in window)"; return summ,[]
    if qo>0: exits.append(("EOD",bars[-1][4],qo))
    summ.update(stop=round(stop,0))
    tot_qty=sum(q for ty,px,q in exits)
    pl=sum((px-avg)*cdir*q for ty,px,q in exits)*PT_VALUE
    r=(pl/PT_VALUE)/tot_qty/max(risk_pts,1) if tot_qty else 0
    return summ,[dict(sess=name,dir=cdir,zone=round(Z,0),avg=round(avg,1),stop=round(stop,0),qty=tot_qty,
                      exits=exits,R=round(r,2),pl=round(pl,0),tier=use_tier,mode=entry_mode)]

SESSIONS=[("04/13","/mnt/project/20260413_075705_nqm26optionsmondayweeklyoptionsexp04_13_26showallsidebysideintraday04132026.csv","/mnt/project/CME_MINI_NQ1_1.csv",datetime.date(2026,4,13)),
("05/14","/mnt/project/nqm26optionsfridayweeklyoptionsexp05_15_26showallsidebysideintraday05142026.csv","/mnt/project/CME_MINI_NQ1_1_32.csv",datetime.date(2026,5,14)),
("05/15","/mnt/project/nqm26optionsfridayweeklyoptionsexp05_15_26showallsidebysideintraday05152026.csv","/mnt/project/CME_MINI_NQ1_1_31.csv",datetime.date(2026,5,15)),
("05/18","/mnt/project/nqm26optionstuesdayweeklyoptionsexp05_19_26showallsidebysideintraday05182026.csv","/mnt/project/CME_MINI_NQ1_1_32.csv",datetime.date(2026,5,18))]

def run_all(require_gate, entry_mode):
    mode=("GATED" if require_gate else "BIAS")+f" · entry={entry_mode}"
    print(f"\n{'='*84}\n  {mode}\n{'='*84}")
    print(f"{'sess':>6} {'anchor':>7} {'CDS':>5} {'state':>6} {'cwin':>5} {'tens':>5} {'entryZ':>7} {'stop':>6} {'targets':>18} {'trd':>4}")
    allt=[]
    for nm,ch,pr,d in SESSIONS:
        s,tr=run_session(nm,ch,pr,d,require_gate=require_gate,entry_mode=entry_mode)
        if s.get("error"): print(f"{nm:>6} {s['error']}"); continue
        ez=f"{s.get('entry_zone'):.0f}" if s.get('entry_zone') else "-"; st=f"{s.get('stop'):.0f}" if s.get('stop') else "-"
        tg="/".join(f"{x:.0f}" for x in s.get("targets",[])) or "-"; note="" if tr else f"  [{s.get('note','')}]"
        cw=s.get('ncwin','-'); tn="Y" if s.get('tensor') else "n"
        print(f"{nm:>6} {s['anchor']:>7.0f} {s['cds']:>+5.2f} {s['state']:>6} {str(cw):>5} {tn:>5} {ez:>7} {st:>6} {tg:>18} {len(tr):>4}{note}")
        allt+=tr
    if allt:
        print("\n  --- trades ---")
        for t in allt:
            ex=", ".join(f"{ty}@{px:.0f}x{q}" for ty,px,q in t["exits"])
            print(f"   {t['sess']} {'LONG' if t['dir']>0 else 'SHORT'} entry {t['avg']:.0f} stop {t['stop']:.0f} q{t['qty']}  R={t['R']:+.2f} P/L ${t['pl']:+,.0f}  [{ex}]")
        wins=sum(1 for t in allt if t["pl"]>0); n=len(allt); tpl=sum(t["pl"] for t in allt); tR=sum(t["R"] for t in allt)
        gp=sum(t["pl"] for t in allt if t["pl"]>0); gl=-sum(t["pl"] for t in allt if t["pl"]<0); pf=f"{gp/gl:.2f}" if gl>0 else "inf"
        print(f"\n  AGGREGATE: trades={n} wins={wins} hit-rate={wins/n*100:.0f}%  totR={tR:+.2f}  P/L=${tpl:+,.0f}  PF={pf}")
    else: print("\n  no trades")
    return allt

if __name__=="__main__":
    print("\n########## (A) RECLAIM-CONFIRMED ENTRY (dip into zone, close back through, in conductance window) ##########")
    run_all(True,"reclaim"); run_all(False,"reclaim")
    print("\n########## (B) WICK ENTRY (limit buy at the BOTTOM of the zone — catch the flush) ##########")
    run_all(True,"wick"); run_all(False,"wick")
