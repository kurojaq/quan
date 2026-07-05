#!/usr/bin/env python3
"""
quan_bias_combined_test.py — per-LENS forward-ledger harness.

Logs each directional lens on its OWN, blind (outcome filled after), and scores each independently
against the realized session direction. Nothing here is wired to anything live — production (engine
export + Pine indicator) is untouched. Everything is derived read-only from the standard payload
and/or the chain. See BIAS_COMBINED_test.md.

PRINCIPLE: log ATOMIC, combine LATER. Each lens is its own column; blends are reconstructable from
the atomic log, but the atomic reads can never be recovered from a pre-made blend.

ATOMIC DIRECTIONAL LENSES (each scored on its own)
  bias_vote      wall geometry G = sign(dom wall - anchor)        [added 2026-06-03, not framework]
  cascade_only   framework-native = sign(CDS)                     [can call bears]
  pgrav_lean     pressure->gravity: peaks below anchor=BEAR       [from PGMAP]
  latent_path    SOP latent trajectory (P/Q/R majority)           [from chain]
  tension        fold tension accumulator sign                    [from chain]
  headline_read  YOUR pre-session read of the headline surface    [manual]

SHAPE CONTEXT (logged, NOT directionally scored — these read chop vs trend, not up/down)
  coherence  FRACTURED/COHERENT      entropy  PINNED/DISPERSED

REFERENCE BLENDS (logged + scored, but flagged — they factor atomic lenses together)
  bias_combined  structure x flow      path_conv  multi-lens convergence verdict

HONEST: the more lenses we score, the more some will beat the base rate by luck. A real edge holds
across MANY disagreement days, out-of-sample. A bear label is not a bear call until the ledger says so.

USAGE
  python3 quan_bias_combined_test.py append <payload> --date 2026-06-05 \
      --chain <chain.csv> --anchor 30399.5 --headline-read BEAR
  python3 quan_bias_combined_test.py outcome 2026-06-05 DOWN        # UP | DOWN | FLAT
  python3 quan_bias_combined_test.py score
"""
import os, sys, csv, argparse, datetime

# structure x flow weights for the bias_combined REFERENCE blend (untuned).
W_S, W_F, BAND = 1.0, 1.5, 0.10

COLS = ["date", "anchor",
        "bias_vote", "cascade_only", "pgrav_lean", "latent_path", "tension", "headline_read",
        "bias_combined", "path_conv", "path_conv_str",
        "coherence", "entropy",
        "bias_score", "cds", "cdir", "tier", "regime", "outcome", "notes"]

# directional lenses scored on their own
ATOMIC = [("bias_vote",     "wall geometry (G)"),
          ("cascade_only",  "cascade (CDS)"),
          ("pgrav_lean",    "pressure->gravity"),
          ("latent_path",   "SOP latent path (P/Q/R)"),
          ("tension",       "fold tension"),
          ("headline_read", "headline (your read)")]
# blends kept only as reference (do they beat their best atomic component?)
BLEND  = [("bias_combined", "structure x flow [blend]"),
          ("path_conv",     "path convergence [blend]")]
DEFAULT_LEDGER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bias_combined_ledger.csv")


def _combined(bias_vote, cdir, composite):
    bv = (bias_vote or "").upper()
    S = 1.0 if "BULL" in bv else (-1.0 if "BEAR" in bv else 0.0)
    try: F = float(cdir)
    except (TypeError, ValueError): F = 0.0
    try: conv = float(composite)
    except (TypeError, ValueError): conv = 0.0
    score = W_S * S + W_F * conv * F
    return ("BEAR" if score < -BAND else "BULL" if score > BAND else "NEUTRAL"), score


def _pgrav_lean(pgmap, anchor):
    try: anc = float(anchor)
    except (TypeError, ValueError): return ""
    below = above = 0
    for it in (pgmap or "").split(","):
        if not it or ":" not in it: continue
        try: s = float(it.split(":")[0])
        except ValueError: continue
        if s < anc: below += 1
        elif s > anc: above += 1
    if below == above: return "NEUTRAL"
    return "BEAR" if below > above else "BULL"


def _path_lenses(chain, anchor):
    """Crack the path convergence into its atomic lenses (read-only, fast — no Book recalc)."""
    from quan_engine import ingest_chain
    import quan_realization as R2, quan_paths as PA
    fr = ingest_chain(chain)
    sp = PA.session_paths(R2.realization_waves(fr, float(anchor)))
    L = sp.get("lenses", {})
    def _dir(v): return "BULL" if v == "UP" else ("BEAR" if v == "DOWN" else "NEUTRAL")
    latent = _dir((L.get("latent_path", {}) or {}).get("direction", ""))
    tread = (L.get("tension", {}) or {}).get("read", "")
    tension = "BULL" if tread == "RELEASING_UP" else ("BEAR" if tread == "RELEASING_DOWN" else "NEUTRAL")
    coherence = (L.get("coherence", {}) or {}).get("read", "")
    entropy = (L.get("entropy", {}) or {}).get("read", "")
    conv = (sp.get("convergence") or {}).get("direction", {}) or {}
    return {"latent_path": latent, "tension": tension, "coherence": coherence, "entropy": entropy,
            "path_conv": _dir(conv.get("verdict", "")),
            "path_conv_str": f"{conv.get('agree','')}@{conv.get('strength','')}"}


def _parse_payload(text):
    kv = {}
    for part in text.strip().split("|"):
        if "=" in part:
            k, v = part.split("=", 1); kv[k.strip()] = v.strip()
    tp = (kv.get("TIER", "") or "").split(":")
    tier = tp[0]; composite = tp[1] if len(tp) > 1 else ""
    call, score = _combined(kv.get("BIAS_VOTE", ""), kv.get("CDIR", ""), composite)
    try: _cds = float(kv.get("CDS", "nan"))
    except ValueError: _cds = float("nan")
    return {
        "anchor": kv.get("ANCHOR", ""),
        "bias_vote": kv.get("BIAS_VOTE", ""),
        "cascade_only": "BULL" if _cds > 0 else ("BEAR" if _cds < 0 else "NEUTRAL"),
        "pgrav_lean": _pgrav_lean(kv.get("PGMAP", ""), kv.get("ANCHOR", "")),
        "bias_combined": call, "bias_score": f"{score:.3f}",
        "cds": kv.get("CDS", ""), "cdir": kv.get("CDIR", ""),
        "tier": tier, "regime": kv.get("REGIME", ""),
    }


def _read(ledger):
    if not os.path.exists(ledger): return []
    with open(ledger, newline="") as f: return list(csv.DictReader(f))


def _write(ledger, rows):
    with open(ledger, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader()
        for r in rows: w.writerow({c: r.get(c, "") for c in COLS})


def cmd_append(a):
    text = open(a.payload).read() if os.path.exists(a.payload) else a.payload
    fields = _parse_payload(text)
    date = a.date or datetime.date.today().isoformat()
    rows = _read(a.ledger)
    if any(r["date"] == date for r in rows):
        sys.exit(f"row for {date} already exists — edit it or use `outcome`.")
    row = {"date": date, "outcome": "", "notes": (a.notes or "")}
    row.update(fields)
    if a.chain and a.anchor:
        try: row.update(_path_lenses(a.chain, a.anchor))
        except Exception as e: print(f"(path lenses skipped: {e})")
    if a.headline_read:
        hr = a.headline_read.upper()
        if hr not in ("BULL", "BEAR", "NEUTRAL"): sys.exit("--headline-read must be BULL/BEAR/NEUTRAL")
        row["headline_read"] = hr
    rows.append(row); rows.sort(key=lambda r: r["date"]); _write(a.ledger, rows)
    print(f"appended {date}  (outcome blank):")
    print("  atomic lenses:")
    for c, lab in ATOMIC:
        if row.get(c, ""): print(f"    {lab:26} {row[c]}")
    print("  shape context:  coherence={}  entropy={}".format(row.get("coherence","-"), row.get("entropy","-")))
    print("  blends (ref):")
    for c, lab in BLEND:
        if row.get(c, ""):
            extra = f"  [{row.get('path_conv_str','')}]" if c == "path_conv" and row.get("path_conv_str") else ""
            print(f"    {lab:26} {row[c]}{extra}")


def cmd_outcome(a):
    rows = _read(a.ledger); hit = [r for r in rows if r["date"] == a.date]
    if not hit: sys.exit(f"no row for {a.date} — append it first.")
    o = a.value.upper()
    if o not in ("UP", "DOWN", "FLAT"): sys.exit("outcome must be UP, DOWN, or FLAT.")
    hit[0]["outcome"] = o; _write(a.ledger, rows); print(f"set {a.date} outcome = {o}")


def _correct(call, outcome):
    c = (call or "").upper()
    if "BULL" in c: return outcome == "UP"
    if "BEAR" in c: return outcome == "DOWN"
    return None


def _rate(rows, field):
    s = [_correct(r.get(field, ""), r["outcome"]) for r in rows]
    s = [x for x in s if x is not None]
    return (sum(s) / len(s), len(s)) if s else (None, 0)


def _block(directional, items, header):
    print(f"\n{header}")
    n = 0
    for col, lab in items:
        rate, cnt = _rate(directional, col)
        if rate is not None:
            n += 1; print(f"  {lab:30} {rate:5.1%}  (n={cnt})")
    return n


def cmd_score(a):
    rows = [r for r in _read(a.ledger) if r.get("outcome") in ("UP", "DOWN", "FLAT")]
    directional = [r for r in rows if r["outcome"] in ("UP", "DOWN")]
    flat = [r for r in rows if r["outcome"] == "FLAT"]
    print(f"\nPer-lens forward test — ledger: {a.ledger}")
    print(f"rows with an outcome: {len(rows)}   (directional UP/DOWN: {len(directional)}, FLAT: {len(flat)})")
    if not directional:
        print("\nNo directional outcomes recorded yet. Nothing to score — keep logging.\n"); return
    ups = sum(1 for r in directional if r["outcome"] == "UP")
    base = ups / len(directional)
    print(f"\nbase rate (always-BULL):   {base:5.1%}  ({ups}/{len(directional)} up days)")
    na_ = _block(directional, ATOMIC, "ATOMIC LENSES (each on its own):")
    nb = _block(directional, BLEND, "REFERENCE BLENDS (do they beat their best atomic part?):")
    print("\n--- days a lens DISAGREED with the wall vote (bias_vote) ---")
    any_dis = False
    for col, lab in ATOMIC + BLEND:
        if col == "bias_vote": continue
        dis = [r for r in directional if r.get(col) in ("BULL", "BEAR") and r.get(col) != r.get("bias_vote")]
        if dis:
            any_dis = True
            dr, _ = _rate(dis, col); bvr, _ = _rate(dis, "bias_vote")
            print(f"  {lab}: {len(dis)} day(s) — it right {dr:.0%}, wall vote right {bvr:.0%}")
    if not any_dis:
        print("  none yet — every lens has agreed with the wall vote on scored days.")
    print(f"\n[!] Scoring {na_ + nb} calls. With this many lenses and small n, some WILL clear base rate by")
    print("    luck. A real edge holds across MANY disagreement days, out-of-sample. Descriptive, not significant.\n")


def main():
    ap = argparse.ArgumentParser(description="Per-lens forward-test ledger + scorer.")
    ap.add_argument("--ledger", default=DEFAULT_LEDGER)
    sub = ap.add_subparsers(dest="cmd", required=True)
    pa = sub.add_parser("append"); pa.add_argument("payload")
    pa.add_argument("--date", default=None); pa.add_argument("--chain", default=None)
    pa.add_argument("--anchor", default=None)
    pa.add_argument("--headline-read", dest="headline_read", default=None)
    pa.add_argument("--notes", default=None); pa.set_defaults(func=cmd_append)
    po = sub.add_parser("outcome"); po.add_argument("date"); po.add_argument("value")
    po.set_defaults(func=cmd_outcome)
    ps = sub.add_parser("score"); ps.set_defaults(func=cmd_score)
    a = ap.parse_args(); a.func(a)


if __name__ == "__main__":
    main()
