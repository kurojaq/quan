"""
quan_backtest.py — bracket-entry paper backtest with GRAVITATIONAL-ATTRACTOR targets.

Model (Spence, 2026-05-31): jerk peak ignites near anchor; price runs toward gravitational ATTRACTORS
(watermarks |LR|>20) in the CDS direction, nearest-first. ENTRY = a BRACKET around the gravitational zone in
the pullback direction (3 laddered orders at zone, zone+/-15, tight stop below the 3rd) — price entering the
zone fills an order, far higher-probability than tagging one exact level. TARGETS = gravitational attractors
in the trend direction, scaled out nearest-first. PAPER. Kelly governor clamped 0.10. Stops/targets are real
watermark strikes. Bracket params first-pass (tune later). Runs GATED (GO/SLOW) and a wider BIAS view.
"""
import sys, csv, datetime
sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, ".")
from quan_engine import ingest_chain, compute_cascade, apex_basis
import quan_temporal as T
import quan_execution as EXE

EQUITY = 100000.0; RISK_PER_TRADE = 0.01; KELLY_GOV = 0.10; PT_VALUE = 20.0
BRACKET_ARM = 15.0; STOP_BUFFER = 15.0; WM_LR = 20.0
TIER_MUL = {"TIER_1_FULL": 1.0, "TIER_2_STANDARD": 0.5, "TIER_3_LIGHT": 0.25, "STAND_DOWN": 0.0}

def load_session(price_csv, d):
    start = datetime.datetime(d.year, d.month, d.day, 22, 0) - datetime.timedelta(days=1)
    end = datetime.datetime(d.year, d.month, d.day, 21, 0); bars = []
    for row in list(csv.reader(open(price_csv)))[1:]:
        try:
            t = int(row[0]); dt = datetime.datetime.utcfromtimestamp(t)
            if start <= dt < end: bars.append((dt, float(row[1]), float(row[2]), float(row[3]), float(row[4])))
        except Exception: continue
    return bars

def framework(chain_csv, anchor):
    fr = ingest_chain(chain_csv); cas = compute_cascade(fr); ab = apex_basis(fr); glob = T.temporal_globals(fr)
    PP = cas.get("PP"); MRW = glob.get("MRW")
    ES = (PP*MRW) if (PP and MRW) else None; EO = (MRW/PP) if (PP and MRW and PP != 0) else None
    FE = (EO+ES) if (EO is not None and ES is not None) else None
    b = abs(FE/ES) if (FE and ES and ES != 0) else 1.0
    es = EXE.triple_confirm(cas["CDS"], cas.get("DIDS",0), cas.get("DITS",0), cas.get("DR3S",0),
                            eb=cas.get("entropyBudget",8) or 8, b=b)
    return dict(cas=cas, wm=ab[ab["LR"].abs() > WM_LR], fstar=max(2.0*es["kellyHalf"],0.0), es=es)

def attractors(wm, ref, d):
    c = wm[wm["strike"] > ref].sort_values("strike") if d > 0 else wm[wm["strike"] < ref].sort_values("strike", ascending=False)
    return [(float(r.strike), float(r.LR)) for r in c.itertuples()]

def zone_center(wm, ref, d):
    c = wm[wm["strike"] < ref] if d > 0 else wm[wm["strike"] > ref]
    return None if c.empty else float(c.loc[c["LR"].abs().idxmax(), "strike"])

def size_qty(risk_pts, tier, fstar):
    gov = max(KELLY_GOV*fstar, 0.0); rf = min(RISK_PER_TRADE, gov)*TIER_MUL.get(tier, 0.0)
    return max(int((EQUITY*rf)//(max(risk_pts,1.0)*PT_VALUE)), 0), EQUITY*rf

def run_session(name, chain_csv, price_csv, d, require_gate=True):
    bars = load_session(price_csv, d)
    if not bars: return dict(name=name, error="no bars"), []
    anchor = bars[0][1]; F = framework(chain_csv, anchor)
    cds = F["cas"]["CDS"]; cdir = 1 if cds > 0 else (-1 if cds < 0 else 0)
    state = F["es"]["state"]; tier = F["es"]["tier"]; gate = state in ("GO","SLOW")
    tradeable = gate if require_gate else (cdir != 0)
    tgts = attractors(F["wm"], anchor, cdir)[:3]; Z = zone_center(F["wm"], anchor, cdir)
    summ = dict(name=name, anchor=anchor, cds=cds, bias=F["cas"].get("BIAS"), state=state, tier=tier,
                zone=Z, targets=[t[0] for t in tgts], bars=len(bars))
    if not tradeable or Z is None or not tgts:
        summ["note"] = "gate STAND" if not tradeable else "no zone/targets"; return summ, []
    if cdir > 0: levels = [Z+BRACKET_ARM, Z, Z-BRACKET_ARM]; stop = Z-BRACKET_ARM-STOP_BUFFER
    else: levels = [Z-BRACKET_ARM, Z, Z+BRACKET_ARM]; stop = Z+BRACKET_ARM+STOP_BUFFER
    eff = sum(levels)/3.0; risk_pts = abs(eff-stop)
    use_tier = tier if (require_gate and gate) else "TIER_2_STANDARD"
    qty_total, risk_d = size_qty(risk_pts, use_tier, F["fstar"])
    if qty_total <= 0: summ["note"] = "size=0"; return summ, []
    per = max(qty_total//3, 1)
    filled = []; qty_open = 0; avg = 0.0; hit = set(); exits = []
    for (dt,o,h,l,c) in bars:
        for lv in list(levels):
            if (l <= lv) if cdir > 0 else (h >= lv):
                filled.append((lv, per)); qty_open += per
                avg = sum(p*q for p,q in filled)/sum(q for _,q in filled); levels.remove(lv)
        if qty_open > 0:
            if (l <= stop) if cdir > 0 else (h >= stop):
                exits.append(("STOP", stop, qty_open)); qty_open = 0; break
            for ti,(tpx,lr) in enumerate(tgts, start=1):
                if ((h >= tpx) if cdir > 0 else (l <= tpx)) and ti not in hit and qty_open > 0:
                    q = min(per, qty_open); exits.append((f"T{ti}", tpx, q)); qty_open -= q; hit.add(ti)
            if qty_open <= 0: break
    if qty_open > 0: exits.append(("EOD", bars[-1][4], qty_open))
    if not filled: summ["note"] = "no fill (never entered zone)"; return summ, []
    fq = sum(q for _,q in filled); pl = sum((px-avg)*cdir*q for typ,px,q in exits)*PT_VALUE
    r = (pl/PT_VALUE)/fq/max(risk_pts,1) if fq else 0
    return summ, [dict(sess=name, dir=cdir, zone=Z, avg=round(avg,1), stop=round(stop,1), qty=fq,
                       fills=[round(p,0) for p,q in filled], exits=exits, R=round(r,2), pl=round(pl,0), tier=use_tier)]

SESSIONS = [
    ("04/13","/mnt/project/20260413_075705_nqm26optionsmondayweeklyoptionsexp04_13_26showallsidebysideintraday04132026.csv","/mnt/project/CME_MINI_NQ1_1.csv",datetime.date(2026,4,13)),
    ("05/14","/mnt/project/nqm26optionsfridayweeklyoptionsexp05_15_26showallsidebysideintraday05142026.csv","/mnt/project/CME_MINI_NQ1_1_32.csv",datetime.date(2026,5,14)),
    ("05/15","/mnt/project/nqm26optionsfridayweeklyoptionsexp05_15_26showallsidebysideintraday05152026.csv","/mnt/project/CME_MINI_NQ1_1_31.csv",datetime.date(2026,5,15)),
    ("05/18","/mnt/project/nqm26optionstuesdayweeklyoptionsexp05_19_26showallsidebysideintraday05182026.csv","/mnt/project/CME_MINI_NQ1_1_32.csv",datetime.date(2026,5,18)),
]

def run_all(require_gate):
    mode = "GATED (GO/SLOW only)" if require_gate else "BIAS view (any directional bias — wider net, for tuning)"
    print(f"\n{'='*82}\n  {mode}\n{'='*82}")
    print(f"{'sess':>6} {'anchor':>7} {'CDS':>5} {'state':>6} {'zone':>6} {'targets(WM)':>24} {'trd':>4}")
    allt = []
    for nm,ch,pr,d in SESSIONS:
        s,tr = run_session(nm,ch,pr,d,require_gate=require_gate)
        if s.get("error"): print(f"{nm:>6}  {s['error']}"); continue
        tg = "/".join(f"{x:.0f}" for x in s.get("targets",[])) or "-"; zn = f"{s['zone']:.0f}" if s.get("zone") else "-"
        note = "" if tr else f"  [{s.get('note','')}]"
        print(f"{nm:>6} {s['anchor']:>7.0f} {s['cds']:>+5.2f} {s['state']:>6} {zn:>6} {tg:>24} {len(tr):>4}{note}")
        allt += tr
    if allt:
        print("\n  --- trades ---")
        for t in allt:
            ex = ", ".join(f"{ty}@{px:.0f}x{q}" for ty,px,q in t["exits"])
            print(f"   {t['sess']} {'LONG' if t['dir']>0 else 'SHORT'} zone {t['zone']:.0f} fills {t['fills']} avg {t['avg']:.0f} stop {t['stop']:.0f} q{t['qty']}  R={t['R']:+.2f} P/L ${t['pl']:+,.0f}  [{ex}]")
        wins = sum(1 for t in allt if t["pl"]>0); n=len(allt); totpl=sum(t["pl"] for t in allt); totR=sum(t["R"] for t in allt)
        gp=sum(t["pl"] for t in allt if t["pl"]>0); gl=-sum(t["pl"] for t in allt if t["pl"]<0); pf=f"{gp/gl:.2f}" if gl>0 else "inf"
        print(f"\n  AGGREGATE: trades={n} wins={wins} hit-rate={wins/n*100:.0f}%  totR={totR:+.2f}  P/L=${totpl:+,.0f}  PF={pf}")
    else: print("\n  no trades")
    return allt

if __name__ == "__main__":
    g = run_all(True); b = run_all(False)
    print(f"\n  D2: gated={len(g)} trades. Need 50+ with real differential. NOT proven.")
