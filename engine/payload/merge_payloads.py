#!/usr/bin/env python3
"""
merge_payloads.py  —  Qu'an prior-session level merge (2026-06-18)

Folds the PREVIOUS session's structural levels (gamma ranges + key points) into the
CURRENT session's payload, emitting ONE combined payload string for the session.

Design (matches the prior-overlay decision record):
  - TODAY is the base. Every today key passes through UNTOUCHED — anchor, FLIPZ (dealer
    flip), REGIME, EXEC, TARGET, MRW, ladders, zones, triggers, SNAP, TSC fields, etc.
  - GWALLS (gamma levels) -> UNION of {today, prior}, de-duped on exact strike (discrete
    50/100 grid; no fuzzy tolerance). Plain v1 draws every union strike with no change.
  - WMARKS (watermarks / key points) -> UNION by strike. Prior-only watermarks appended.
  - S-band (SFLOOR/SCEIL) -> per --sband: union (widen to outermost) | today (default keep
    today) | off. A single payload carries one band, so 'union' = the defended envelope.
  - DEALER FLIP is TODAY-ONLY by design: prior FLIPZ is never merged.

Provenance is preserved IN-BAND without breaking the contract:
  - GWALLS stays a BARE union (max overlay compatibility).
  - GWPROV=<strike>:<H|P|T>,...   H=held(both)  P=prior-only  T=today-only   (optional key;
    plain v1 ignores it; a provenance-aware overlay can read it for [P]/·held tags.)
  - WMPROV=<strike>:<H|P>,...     (same idea for watermarks)
  - PRIORMERGE=<n_held>:<n_prior>:<sband_mode>   one-line merge status for the readout.

Usage:
    python3 merge_payloads.py PRIOR.txt TODAY.txt [--sband today|union|off] [--no-prov] > COMBINED.txt
"""
import sys, argparse

def parse(s):
    d = {}
    for kv in s.strip().split("|"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            d[k] = v
    return d

def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def gwalls_set(v):
    """GWALLS entry is 'strike' or 'strike:tag' — return ordered list of float strikes."""
    out = []
    if v:
        for tok in v.split(","):
            tok = tok.strip()
            if not tok:
                continue
            s = fnum(tok.split(":")[0])
            if s is not None:
                out.append(s)
    return out

def wmarks_map(v):
    """WMARKS entry is 'strike:side' (F|C) -> dict strike->side, last side wins."""
    out = {}
    if v:
        for tok in v.split(","):
            tok = tok.strip()
            if not tok or ":" not in tok:
                continue
            sp = tok.split(":")
            s = fnum(sp[0])
            if s is not None:
                out[s] = sp[1]
    return out

def fmt_strike(s):
    """30200.0 -> '30200', 30200.5 -> '30200.5' (drop trailing .0 to match payload style)."""
    return str(int(s)) if float(s).is_integer() else str(s)

def merge(prior, today, sband_mode="today", provenance=True):
    out = dict(today)  # base = today, everything passes through

    # ---- GAMMA union (de-dup exact strike) ----
    tg = gwalls_set(today.get("GWALLS", ""))
    pg = gwalls_set(prior.get("GWALLS", ""))
    tgS, pgS = set(tg), set(pg)
    union = sorted(tgS | pgS)
    out["GWALLS"] = ",".join(fmt_strike(s) for s in union)

    # ---- WATERMARK union (by strike) ----
    tw = wmarks_map(today.get("WMARKS", ""))
    pw = wmarks_map(prior.get("WMARKS", ""))
    wm_union = dict(tw)
    for s, side in pw.items():
        wm_union.setdefault(s, side)  # today's side wins on a tie
    out["WMARKS"] = ",".join(f"{fmt_strike(s)}:{wm_union[s]}" for s in sorted(wm_union))

    # ---- SNAP union (2026-06-18): today wins per strike; PRIOR extends the range to strikes today's chain
    # didn't reach (e.g. 30550–30700), so the overlay's live per-strike gamma recompute has rows to compute
    # in the upper void. Prior-extended strikes carry prior OI/IV (best available for that range). ----
    def snap_map(v):
        out = {}
        for t in v.split(","):
            p = t.split(":")
            if len(p) == 4:
                k = fnum(p[0])
                if k is not None:
                    out[k] = (p[1], p[2], p[3])
        return out
    ts, ps = snap_map(today.get("SNAP", "")), snap_map(prior.get("SNAP", ""))
    snap_u = dict(ps); snap_u.update(ts)  # today wins on shared strikes
    snap_ext = sorted(set(ps) - set(ts))
    if snap_u:
        out["SNAP"] = ",".join(f"{fmt_strike(k)}:{snap_u[k][0]}:{snap_u[k][1]}:{snap_u[k][2]}" for k in sorted(snap_u))

    # ---- S-band ----
    if sband_mode == "union":
        tf, tc = fnum(today.get("SFLOOR")), fnum(today.get("SCEIL"))
        pf, pc = fnum(prior.get("SFLOOR")), fnum(prior.get("SCEIL"))
        floors = [x for x in (tf, pf) if x is not None]
        ceils = [x for x in (tc, pc) if x is not None]
        if floors:
            out["SFLOOR"] = fmt_strike(min(floors)) + ".0" if min(floors).is_integer() else str(min(floors))
        if ceils:
            out["SCEIL"] = fmt_strike(max(ceils)) + ".0" if max(ceils).is_integer() else str(max(ceils))
    # 'today' (default) and 'off' both leave today's SFLOOR/SCEIL as-is.

    # ---- provenance (optional, ignored by plain v1) ----
    held = sorted(tgS & pgS)
    pri_only = sorted(pgS - tgS)
    if provenance:
        prov = []
        for s in union:
            tag = "H" if (s in tgS and s in pgS) else ("P" if s in pgS else "T")
            prov.append(f"{fmt_strike(s)}:{tag}")
        out["GWPROV"] = ",".join(prov)
        wmp = []
        for s in sorted(wm_union):
            tag = "H" if (s in tw and s in pw) else ("P" if s in pw else "T")
            wmp.append(f"{fmt_strike(s)}:{tag}")
        out["WMPROV"] = ",".join(wmp)
    out["PRIORMERGE"] = f"{len(held)}:{len(pri_only)}:{sband_mode}:snapext{len(snap_ext)}"

    return out, held, pri_only, snap_ext

def emit(d):
    # keep today's key order; new keys (GWPROV/WMPROV/PRIORMERGE) appended at end
    base_order = list(d.keys())
    return "|".join(f"{k}={d[k]}" for k in base_order)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prior")
    ap.add_argument("today")
    ap.add_argument("--sband", choices=["today", "union", "off"], default="today")
    ap.add_argument("--no-prov", action="store_true")
    ap.add_argument("--summary", action="store_true", help="print held/new summary to stderr")
    a = ap.parse_args()
    prior = parse(open(a.prior).read())
    today = parse(open(a.today).read())
    out, held, pri_only, snap_ext = merge(prior, today, a.sband, not a.no_prov)
    sys.stdout.write(emit(out) + "\n")
    if a.summary:
        sys.stderr.write(f"[merge] gamma held={held} prior-only={pri_only} sband={a.sband}\n")
        sys.stderr.write(f"[merge] SNAP prior-extended strikes (live-gamma void rows): {snap_ext}\n")

if __name__ == "__main__":
    main()
