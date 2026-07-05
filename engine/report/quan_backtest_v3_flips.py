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
TIER_MUL={"TIER_1_FULL":1.0,"TIER_2_STANDARD":0.5,"TIER_3_LIGHT":0.25,"STAND_DOWN":0.0}

def load_session(price_csv,d):
    s=datetime.datetime(d.year,d.month,d.day,22,0)-datetime.timedelta(days=1); e=datetime.datetime(d.year,d.month,d.day,21,0); bars=[]
    for row in list(csv.reader(open(price_csv)))[1:]:
        try:
            t=int(row[0]); dt=datetime.datetime.utcfromtimestamp(t)
            if s<=dt<e: bars.append((dt,float(row[1]),float(row[2]),float(row[3]),float(row[4])))
        except: continue
    return bars

def framework(chain_csv):
    fr=ingest_chain(chain_csv); cas=compute_cascade(fr); ps=PS.per_strike(fr)
    glob=T.temporal_globals(fr)
    PP=cas.get("PP"); MRW=glob.get("MRW")
    ES=(PP*MRW) if (PP and MRW) else None; EO=(MRW/PP) if (PP and MRW and PP!=0) else None
    FE=(EO+ES) if (EO is not None and ES is not None) else None; b=abs(FE/ES) if (FE and ES and ES!=0) else 1.0
    es=EXE.triple_confirm(cas["CDS"],cas.get("DIDS",0),cas.get("DITS",0),cas.get("DR3S",0),eb=cas.get("entropyBudget",8) or 8,b=b)
    return cas, ps, max(2.0*es["kellyHalf"],0.0), es

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

def run_session(name, chain_csv, price_csv, d, require_gate=True):
    bars=load_session(price_csv,d)
    if not bars: return dict(name=name,error="no bars"),[]
    anchor=bars[0][1]; cas,ps,fstar,es=framework(chain_csv)
    cds=cas["CDS"]; cdir=1 if cds>0 else (-1 if cds<0 else 0)
    state=es["state"]; tier=es["tier"]; gate=state in ("GO","SLOW")
    tradeable = gate if require_gate else (cdir!=0)
    zones=flip_zones(ps)
    summ=dict(name=name,anchor=anchor,cds=cds,bias=cas.get("BIAS"),state=state,tier=tier,bars=len(bars),nzones=len(zones))
    if not tradeable or cdir==0 or not zones:
        summ["note"]="gate STAND" if not tradeable else "no flip zones"; return summ,[]
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
    # stop: next flip zone beyond entry in pullback dir, else zone edge - buffer
    if cdir>0:
        nb=below[0][0] if below else Z-BRACKET_ARM
        stop=min(nb, Z-BRACKET_ARM)-STOP_BUFFER
        levels=[Z+BRACKET_ARM, Z, Z-BRACKET_ARM]
    else:
        nb=below[0][0] if below else Z+BRACKET_ARM
        stop=max(nb, Z+BRACKET_ARM)+STOP_BUFFER
        levels=[Z-BRACKET_ARM, Z, Z+BRACKET_ARM]
    eff=sum(levels)/3.0; risk_pts=abs(eff-stop)
    use_tier = tier if (require_gate and gate) else "TIER_2_STANDARD"
    qty=size_qty(risk_pts, use_tier, fstar)
    summ.update(entry_zone=round(Z,0), stop=round(stop,0), targets=[round(t[0],0) for t in tgts])
    if qty<=0: summ["note"]="size=0"; return summ,[]
    per=max(qty//3,1); filled=[]; qo=0; avg=0.0; hit=set(); exits=[]
    for (dt,o,h,l,c) in bars:
        for lv in list(levels):
            if (l<=lv) if cdir>0 else (h>=lv):
                filled.append((lv,per)); qo+=per; avg=sum(p*q for p,q in filled)/sum(q for _,q in filled); levels.remove(lv)
        if qo>0:
            if (l<=stop) if cdir>0 else (h>=stop):
                exits.append(("STOP",stop,qo)); qo=0; break
            for ti,(tpx,mass) in enumerate(tgts,start=1):
                if ((h>=tpx) if cdir>0 else (l<=tpx)) and ti not in hit and qo>0:
                    q=min(per,qo); exits.append((f"T{ti}",tpx,q)); qo-=q; hit.add(ti)
            if qo<=0: break
    if qo>0: exits.append(("EOD",bars[-1][4],qo))
    if not filled: summ["note"]="no fill"; return summ,[]
    fq=sum(q for _,q in filled); pl=sum((px-avg)*cdir*q for ty,px,q in exits)*PT_VALUE
    r=(pl/PT_VALUE)/fq/max(risk_pts,1) if fq else 0
    return summ,[dict(sess=name,dir=cdir,zone=round(Z,0),avg=round(avg,1),stop=round(stop,0),qty=fq,
                      fills=[round(p,0) for p,q in filled],exits=exits,R=round(r,2),pl=round(pl,0),tier=use_tier)]

SESSIONS=[("04/13","/mnt/project/20260413_075705_nqm26optionsmondayweeklyoptionsexp04_13_26showallsidebysideintraday04132026.csv","/mnt/project/CME_MINI_NQ1_1.csv",datetime.date(2026,4,13)),
("05/14","/mnt/project/nqm26optionsfridayweeklyoptionsexp05_15_26showallsidebysideintraday05142026.csv","/mnt/project/CME_MINI_NQ1_1_32.csv",datetime.date(2026,5,14)),
("05/15","/mnt/project/nqm26optionsfridayweeklyoptionsexp05_15_26showallsidebysideintraday05152026.csv","/mnt/project/CME_MINI_NQ1_1_31.csv",datetime.date(2026,5,15)),
("05/18","/mnt/project/nqm26optionstuesdayweeklyoptionsexp05_19_26showallsidebysideintraday05182026.csv","/mnt/project/CME_MINI_NQ1_1_32.csv",datetime.date(2026,5,18))]

def run_all(require_gate):
    mode="GATED (GO/SLOW only)" if require_gate else "BIAS view (any directional bias)"
    print(f"\n{'='*84}\n  {mode}\n{'='*84}")
    print(f"{'sess':>6} {'anchor':>7} {'CDS':>5} {'state':>6} {'entryZ':>7} {'stop':>6} {'target flips':>20} {'trd':>4}")
    allt=[]
    for nm,ch,pr,d in SESSIONS:
        s,tr=run_session(nm,ch,pr,d,require_gate=require_gate)
        if s.get("error"): print(f"{nm:>6} {s['error']}"); continue
        ez=f"{s.get('entry_zone'):.0f}" if s.get('entry_zone') else "-"; st=f"{s.get('stop'):.0f}" if s.get('stop') else "-"
        tg="/".join(f"{x:.0f}" for x in s.get("targets",[])) or "-"; note="" if tr else f"  [{s.get('note','')}]"
        print(f"{nm:>6} {s['anchor']:>7.0f} {s['cds']:>+5.2f} {s['state']:>6} {ez:>7} {st:>6} {tg:>20} {len(tr):>4}{note}")
        allt+=tr
    if allt:
        print("\n  --- trades ---")
        for t in allt:
            ex=", ".join(f"{ty}@{px:.0f}x{q}" for ty,px,q in t["exits"])
            print(f"   {t['sess']} {'LONG' if t['dir']>0 else 'SHORT'} entryZ {t['zone']:.0f} fills {t['fills']} avg {t['avg']:.0f} stop {t['stop']:.0f} q{t['qty']}  R={t['R']:+.2f} P/L ${t['pl']:+,.0f}  [{ex}]")
        wins=sum(1 for t in allt if t["pl"]>0); n=len(allt); tpl=sum(t["pl"] for t in allt); tR=sum(t["R"] for t in allt)
        gp=sum(t["pl"] for t in allt if t["pl"]>0); gl=-sum(t["pl"] for t in allt if t["pl"]<0); pf=f"{gp/gl:.2f}" if gl>0 else "inf"
        print(f"\n  AGGREGATE: trades={n} wins={wins} hit-rate={wins/n*100:.0f}%  totR={tR:+.2f}  P/L=${tpl:+,.0f}  PF={pf}")
    else: print("\n  no trades")
    return allt

if __name__=="__main__":
    g=run_all(True); b=run_all(False)
    print(f"\n  D2: gated={len(g)} trades. Need 50+ with real differential. NOT proven.")
