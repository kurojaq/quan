"""
quan_backtest.py — multi-session paper backtest that MIRRORS the Pine strategy logic.

For each session it: (1) computes the framework payload from the chain (anchor = futures session-open price,
18:00 ET = 22:00 UTC EDT), (2) walks the 1-min bars applying the SAME entry/sizing/stop/target rules as
quan_strategy.pine, (3) scores each trade. Aggregates into a paper-trade ledger toward the D2 50-trade gate.

HONESTY: this is a faithful proxy of the Pine logic, not the Pine engine itself. Use TradingView's Strategy
Tester to confirm any session that looks promising. Sizing uses the framework-Kelly governor clamped at 0.10
(validation cap). Stops/targets are STRUCTURAL prices (ladder rungs), never the mis-scaled framework offsets.
"""
import sys, csv, datetime
sys.path.insert(0, "/mnt/user-data/outputs"); sys.path.insert(0, ".")
from quan_engine import ingest_chain, compute_cascade, compute_levels, compute_zones
import quan_temporal as T
import quan_execution as EXE

# ---- config (mirror the Pine inputs) ----
EQUITY = 100000.0
RISK_PER_TRADE = 0.01      # 1%
MAX_HEAT = 0.05            # 5%
KELLY_GOV = 0.10           # validation cap (clamped)
PT_VALUE = 20.0            # $/pt NQ
TRIG_TOL = 5.0
STOP_BUFFER = 15.0
TIER_MUL = {"TIER_1_FULL": 1.0, "TIER_2_STANDARD": 0.5, "TIER_3_LIGHT": 0.25, "STAND_DOWN": 0.0}


def load_session(price_csv, sess_date):
    """Return the 1-min bars for the futures session of sess_date (22:00 UTC prior day -> 21:00 UTC)."""
    start = datetime.datetime(sess_date.year, sess_date.month, sess_date.day, 22, 0) - datetime.timedelta(days=1)
    end = datetime.datetime(sess_date.year, sess_date.month, sess_date.day, 21, 0)
    bars = []
    with open(price_csv) as fh:
        for row in list(csv.reader(fh))[1:]:
            try:
                t = int(row[0]); dt = datetime.datetime.utcfromtimestamp(t)
                if start <= dt < end:
                    bars.append((dt, float(row[1]), float(row[2]), float(row[3]), float(row[4])))
            except Exception:
                continue
    return bars


def build_payload(chain_csv, anchor):
    fr = ingest_chain(chain_csv)
    cas = compute_cascade(fr)
    lv = compute_levels(fr, anchor=anchor, cds=cas["CDS"], bias=cas.get("BIAS"))
    zones = compute_zones(fr, n_zones=10)
    glob = T.temporal_globals(fr)
    PP = cas.get("PP"); MRW = glob.get("MRW")
    ES = (PP * MRW) if (PP and MRW) else None
    EO = (MRW / PP) if (PP and MRW and PP != 0) else None
    FE = (EO + ES) if (EO is not None and ES is not None) else None
    b = abs(FE / ES) if (FE and ES and ES != 0) else 1.0
    es = EXE.triple_confirm(cas["CDS"], cas.get("DIDS", 0), cas.get("DITS", 0), cas.get("DR3S", 0),
                            eb=cas.get("entropyBudget", 8) or 8, b=b)
    fstar = max(2.0 * es["kellyHalf"], 0.0)
    # full trigger set (TR tap / CV converted / BR break-retest) from the framework, classified vs anchor
    zlist = [(z[0], "C" if z[1] == "C" else "P", z[2] if len(z) > 2 else 0, z[3] if len(z) > 3 else 0) for z in (zones or [])]
    trigs = EXE.triggers_from_levels(None, zlist, anchor)   # list of (strike, type, dir)
    return dict(cas=cas, lv=lv, b=b, fstar=fstar, es=es, trigs=trigs,
                cladder=[s for s, o, w in lv.get("CLADDER", [])],
                fladder=[s for s, o, w in lv.get("FLADDER", [])],
                tladder=dict((k, s) for s, k in lv.get("TLADDER", [])))


def contracts(stop_dist, tier):
    gov = max(KELLY_GOV * P["fstar"], 0.0)
    rf = min(RISK_PER_TRADE, gov) * TIER_MUL.get(tier, 0.0)
    risk_dollars = EQUITY * rf
    d = max(stop_dist, 1.0)
    return max(int(risk_dollars // (d * PT_VALUE)), 0), risk_dollars


def nearest_below(levels, ref):
    c = [v for v in levels if v < ref]
    return max(c) if c else None
def nearest_above(levels, ref):
    c = [v for v in levels if v > ref]
    return min(c) if c else None


def run_session(name, chain_csv, price_csv, sess_date):
    global P
    bars = load_session(price_csv, sess_date)
    if not bars:
        return dict(name=name, error="no session bars"), []
    anchor = bars[0][2] if False else bars[0][1]   # open of first session bar
    P = build_payload(chain_csv, anchor)
    es = P["es"]
    gate_open = es["state"] in ("GO", "SLOW")
    cds_dir = 1 if P["cas"]["CDS"] > 0 else (-1 if P["cas"]["CDS"] < 0 else 0)
    trades = []
    pos = None                                     # open position dict or None
    sHi = sLo = None
    for i, (dt, o, h, l, c) in enumerate(bars):
        sHi = h if sHi is None else max(sHi, h)
        sLo = l if sLo is None else min(sLo, l)
        # ---- manage open position: check stop / targets bar by bar ----
        if pos:
            if pos["dir"] > 0:
                if l <= pos["stop"]:
                    pos["exits"].append(("STOP", pos["stop"], pos["qty_open"])); pos["qty_open"] = 0
                else:
                    for tk in (1, 2, 3):
                        tpx = P["tladder"].get(tk)
                        if tpx and tk not in pos["hit"] and h >= tpx:
                            q = pos["scale"][tk]; pos["exits"].append((f"T{tk}", tpx, q)); pos["qty_open"] -= q; pos["hit"].add(tk)
            else:
                if h >= pos["stop"]:
                    pos["exits"].append(("STOP", pos["stop"], pos["qty_open"])); pos["qty_open"] = 0
                else:
                    for tk in (1, 2, 3):
                        tpx = P["tladder"].get(tk)
                        if tpx and tk not in pos["hit"] and l <= tpx:
                            q = pos["scale"][tk]; pos["exits"].append((f"T{tk}", tpx, q)); pos["qty_open"] -= q; pos["hit"].add(tk)
            if pos["qty_open"] <= 0:
                # realize R
                rmult = 0.0
                for typ, px, q in pos["exits"]:
                    rmult += (px - pos["entry"]) * pos["dir"] * q
                rmult_pts = rmult / max(pos["qty"], 1)
                r = (rmult_pts) / max(pos["risk_pts"], 1)
                pl = rmult * PT_VALUE * pos["dir"] if False else sum((px - pos["entry"]) * pos["dir"] * q for typ, px, q in pos["exits"]) * PT_VALUE
                trades.append(dict(dir=pos["dir"], entry=pos["entry"], stop=pos["stop"], qty=pos["qty"],
                                   exits=pos["exits"], R=round(r, 2), pl=round(pl, 0), tier=es["tier"]))
                pos = None
        # ---- new entry on a trigger interaction (only when flat + gate open) ----
        if pos is None and gate_open and i > 0:
            po, ph, pl_, pc = bars[i-1][1], bars[i-1][2], bars[i-1][3], bars[i-1][4]
            for tpx, ttp, tdr in P["trigs"]:
                # long: dir must be +1 and cds bull
                if cds_dir > 0 and tdr > 0:
                    tap = (l <= tpx + TRIG_TOL and l >= tpx - TRIG_TOL*3 and c > tpx)   # TR/CV
                    brk = (c > tpx and o <= tpx)                                         # BR break up
                    fire = (tap if ttp in ("TR", "CV") else (brk if ttp == "BR" else False))
                    if fire:
                        entry = c; rawstop = nearest_below(P["fladder"], entry)
                        stop = (rawstop if rawstop is not None else tpx) - STOP_BUFFER
                        qty, rd = contracts(entry - stop, es["tier"])
                        if qty > 0 and (entry - stop) > 0:
                            sc = {1: round(qty*0.34), 2: round(qty*0.33), 3: qty - round(qty*0.34) - round(qty*0.33)}
                            pos = dict(dir=1, entry=entry, stop=stop, qty=qty, qty_open=qty, scale=sc, hit=set(),
                                       exits=[], risk_pts=entry-stop, trig=ttp); break
                # short: dir must be -1 and cds bear
                if cds_dir < 0 and tdr < 0:
                    tap = (h >= tpx - TRIG_TOL and h <= tpx + TRIG_TOL*3 and c < tpx)
                    brk = (c < tpx and o >= tpx)
                    fire = (tap if ttp in ("TR", "CV") else (brk if ttp == "BR" else False))
                    if fire:
                        entry = c; rawstop = nearest_above(P["cladder"], entry)
                        stop = (rawstop if rawstop is not None else tpx) + STOP_BUFFER
                        qty, rd = contracts(stop - entry, es["tier"])
                        if qty > 0 and (stop - entry) > 0:
                            sc = {1: round(qty*0.34), 2: round(qty*0.33), 3: qty - round(qty*0.34) - round(qty*0.33)}
                            pos = dict(dir=-1, entry=entry, stop=stop, qty=qty, qty_open=qty, scale=sc, hit=set(),
                                       exits=[], risk_pts=stop-entry, trig=ttp); break
    # close any still-open position at session end (mark to last close)
    if pos and pos["qty_open"] > 0:
        lastc = bars[-1][4]
        pos["exits"].append(("EOD", lastc, pos["qty_open"]))
        pl = sum((px - pos["entry"]) * pos["dir"] * q for typ, px, q in pos["exits"]) * PT_VALUE
        r = sum((px - pos["entry"]) * pos["dir"] * q for typ, px, q in pos["exits"]) / max(pos["qty"],1) / max(pos["risk_pts"],1)
        trades.append(dict(dir=pos["dir"], entry=pos["entry"], stop=pos["stop"], qty=pos["qty"],
                           exits=pos["exits"], R=round(r,2), pl=round(pl,0), tier=es["tier"]))
    return dict(name=name, anchor=anchor, cds=P["cas"]["CDS"], bias=P["cas"].get("BIAS"),
                state=es["state"], tier=es["tier"], fstar=round(P["fstar"],3),
                bars=len(bars), sHi=sHi, sLo=sLo), trades


SESSIONS = [
    ("04/13", "/mnt/project/20260413_075705_nqm26optionsmondayweeklyoptionsexp04_13_26showallsidebysideintraday04132026.csv",
     "/mnt/project/CME_MINI_NQ1_1.csv", datetime.date(2026,4,13)),
    ("05/14", "/mnt/project/nqm26optionsfridayweeklyoptionsexp05_15_26showallsidebysideintraday05142026.csv",
     "/mnt/project/CME_MINI_NQ1_1_32.csv", datetime.date(2026,5,14)),
    ("05/15", "/mnt/project/nqm26optionsfridayweeklyoptionsexp05_15_26showallsidebysideintraday05152026.csv",
     "/mnt/project/CME_MINI_NQ1_1_31.csv", datetime.date(2026,5,15)),
    ("05/18", "/mnt/project/nqm26optionstuesdayweeklyoptionsexp05_19_26showallsidebysideintraday05182026.csv",
     "/mnt/project/CME_MINI_NQ1_1_32.csv", datetime.date(2026,5,18)),
]

if __name__ == "__main__":
    all_trades = []
    print(f"{'sess':>6} {'anchor':>8} {'CDS':>5} {'bias':>12} {'state':>6} {'tier':>16} {'bars':>5} {'trades':>7}")
    print("-"*75)
    rows = []
    for name, chain, price, d in SESSIONS:
        summ, trades = run_session(name, chain, price, d)
        if summ.get("error"):
            print(f"{name:>6}  {summ['error']}"); continue
        all_trades += [dict(sess=name, **t) for t in trades]
        rows.append((summ, trades))
        print(f"{name:>6} {summ['anchor']:>8.0f} {summ['cds']:>+5.2f} {str(summ['bias']):>12} {summ['state']:>6} {summ['tier']:>16} {summ['bars']:>5} {len(trades):>7}")
    print("\n=== TRADE LEDGER ===")
    if not all_trades:
        print("  No trades fired across these sessions (gate stayed STAND, or no qualifying triggers).")
    for t in all_trades:
        ex = ", ".join(f"{typ}@{px:.0f}×{q}" for typ, px, q in t["exits"])
        print(f"  {t['sess']}  {'LONG' if t['dir']>0 else 'SHORT'}  entry {t['entry']:.0f}  stop {t['stop']:.0f}  qty {t['qty']}  R={t['R']:+.2f}  P/L ${t['pl']:+,.0f}  [{ex}]")
    if all_trades:
        wins = sum(1 for t in all_trades if t["pl"] > 0); losses = sum(1 for t in all_trades if t["pl"] <= 0)
        totpl = sum(t["pl"] for t in all_trades); totR = sum(t["R"] for t in all_trades)
        gp = sum(t["pl"] for t in all_trades if t["pl"] > 0); gl = -sum(t["pl"] for t in all_trades if t["pl"] < 0)
        print(f"\n=== AGGREGATE ===\n  trades={len(all_trades)}  wins={wins}  losses={losses}  hit-rate={wins/len(all_trades)*100:.0f}%")
        print(f"  total R={totR:+.2f}  total P/L=${totpl:+,.0f}  profit factor={gp/gl:.2f}" if gl>0 else f"  total R={totR:+.2f}  total P/L=${totpl:+,.0f}")
        print(f"\n  D2 gate: {len(all_trades)}/50 trades. Edge proven? NOT YET — need 50+ with a real differential.")
