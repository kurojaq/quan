"""
quan_brief — upgraded pre-session brief generator, built on quan_analyze.analyze().

Produces a markdown brief from the five-layer engine read. Upgraded vs the hand-written v3 format:
folds in the regime classifier, wave-type (expected path-shape), flip-watch (Tier-2 imminent-flip),
and the per-strike liquidity/watermark profile — none of which existed in the old hand briefs.
Keeps the locked structure spirit (read -> corridor/levels -> strategy -> honest caveats) and the
honest-edge discipline (no overclaiming on n=4-5).

Usage:  python3 quan_brief.py <chain.csv> <anchor> [T_days] [out.md]
"""
import sys, datetime as _dt
import quan_analyze as _QA


def _fmt(x, nd=2):
    try: return f"{float(x):,.{nd}f}"
    except Exception: return str(x)


def build_brief(csv_path, anchor, T_days=1.0, graphs_dir=None, with_tensor=False):
    r = _QA.analyze(csv_path, anchor=anchor, T_days=T_days)
    sig, fld, gk = r["signal"], r["field"], r["greeks"]
    dyn, sp, syn = r["dynamic"], r["spatial"], r["synthesis"]
    reg = (fld.get("regime") or {})
    wt = (dyn.get("wave_type") or {})
    fw = (dyn.get("flip_watch") or {})
    liq = (sp.get("liquidity") or {})
    lv = (sp.get("levels") or {})
    kl = syn.get("key_levels", {})
    now = _dt.datetime.now().strftime("%Y-%m-%d %H:%M")

    # render the prediction graphs (fold-coherence / SOP folding) if a dir is given
    graph_paths = []
    tensor_paths = []
    tensor_meta = None
    extra_meta = {}
    if graphs_dir:
        try:
            import os as _os
            from quan_engine import ingest_chain as _ing
            import quan_realization as _R, quan_brief_graphs as _G
            rw = _R.realization_waves(_ing(csv_path), anchor)
            _os.makedirs(graphs_dir, exist_ok=True)
            prefix = _os.path.join(graphs_dir, "brief_graph")
            graph_paths = _G.render_fold_graphs(rw, prefix, anchor=anchor)
        except Exception:
            graph_paths = []
        # the Book Tensor Surface (real recalc) — optional, slow (~60s) — plus latent paths + pressure→gravity
        if with_tensor:
            try:
                import os as _os, shutil as _sh
                import quan_tensor as _TS, quan_brief_graphs as _G
                import quan_paths as _PA, quan_perstrike as _PS, quan_liquidity as _LQ, quan_pressure_path as _PP
                from quan_engine import ingest_chain as _ing
                _fr = _ing(csv_path)
                tmpl = "/mnt/project/nqm26optionsthursdayweeklyoptionsexp04_09_26showallsidebysideintraday04092026_Book.xlsx"
                work = _os.path.join(graphs_dir, "_tensor_recalc.xlsx")
                _sh.copy(tmpl, work)
                _TS.inject_pressure(_fr, anchor, work, source="intent")
                _TS.recalc(work)
                tensor_meta = _TS.extract(work)
                prefix = _os.path.join(graphs_dir, "brief_graph")
                tensor_paths = _G.render_tensor_graphs(tensor_meta, prefix)
                # three latent paths (P/Q/R) — the hidden-path convergence
                import quan_realization as _R2
                _sp = _PA.session_paths(_R2.realization_waves(_fr, anchor), tensor_meta=tensor_meta)
                _paths = _sp["lenses"]["latent_path"].get("_paths")
                if _paths:
                    tensor_paths += _G.render_latent_paths(_paths, prefix)
                    extra_meta["paths"] = _sp
                # pressure → gravity spatial map
                _d = _PS.per_strike(_fr); _liq = _LQ.liquidity_profile(_d)
                _walls = (gk or {}).get("gamma_walls", [])
                _pp = _PP.pressure_path(_d, _liq, anchor, span=700, gamma_walls=_walls, tensor_meta=tensor_meta)
                tensor_paths += _G.render_pressure_gravity(_pp, prefix)
                extra_meta["pressure_path"] = _pp
            except Exception as e:
                tensor_paths = []; tensor_meta = {"_err": str(e)}

    L = []
    L.append(f"# Pre-Session Brief — anchor {_fmt(anchor,2)}  (T={T_days}d)")
    L.append(f"_Generated {now} from quan_analyze (five-layer engine). Honest edge 10-15%, "
             f"direction discrimination UNPROVEN (n=4-5)._\n")

    # §1 SIGNAL
    c = sig["cascade"]
    L.append("## §1 Signal (Book_Stats_CDS)")
    L.append(f"- **CDS {_fmt(sig['CDS'],3)} → {sig['BIAS']}** (tier: {sig.get('tier')})")
    L.append(f"- Cascade skews: DIDS={_fmt(c['DIDS'],3)}, DITS={_fmt(c['DITS'],3)}, "
             f"DR3S={_fmt(c['DR3S'],3)}")
    sigblk = sig.get("significance") or {}
    if sigblk.get("dominant"):
        L.append(f"- Dominant axis: {sigblk.get('dominant')}; "
                 f"all significant: {sigblk.get('all_significant')}")
    # marginal-axis honest flag (the 05/15 lesson)
    skews = {"DIDS": c["DIDS"], "DITS": c["DITS"], "DR3S": c["DR3S"]}
    try:
        dom = max(abs(v) for v in skews.values() if v == v)
        marg = [k for k, v in skews.items() if v == v and abs(v) < 0.10 * dom]
        if marg:
            L.append(f"- ⚠ **Marginal axis on its sign line: {', '.join(marg)}** — a sign cross would "
                     f"upgrade the regime. Recompute intraday; do not trust the morning snapshot alone.")
    except Exception:
        pass
    L.append("")

    # §2 FIELD + REGIME
    L.append("## §2 Field state & regime (Book_Globals)")
    L.append(f"- Regime: **{reg.get('regime')} / {reg.get('direction')}** — field type "
             f"{reg.get('field_type')}")
    ro = reg.get("readout")
    if isinstance(ro, dict):
        # render the structured readout as prose, coercing numpy scalars to plain floats
        def _g(k, nd=2):
            v = ro.get(k)
            try: return f"{float(v):,.{nd}f}"
            except Exception: return str(v)
        L.append(f"- TP {_g('TP',3)} ({ro.get('tp_read')}); spacetime {ro.get('spacetime')}; "
                 f"horizon {ro.get('horizon')}")
    elif ro:
        L.append(f"- Readout: {ro}")
    inert = fld.get("inertia") or {}
    tl = fld.get("trend_length") or {}
    L.append(f"- Cs (field curvature): {_fmt(fld.get('Cs'),2)}; "
             f"inertia R={_fmt(inert.get('R'),1)}; intentTL={_fmt(tl.get('intent'),1)}")
    L.append("")

    # §3 EXPECTED PATH (wave-type)
    L.append("## §3 Expected path-shape (SOP folding / wave-type)")
    L.append(f"- Wave-type: **{wt.get('wave')}** → expected path: {wt.get('expected_path')} "
             f"(efficiency ~{wt.get('expected_efficiency')})")
    if wt.get("note"): L.append(f"- {wt.get('note')}")
    L.append("")

    # §3.5 PREDICTION GRAPHS (the fold-coherence graphs the wave-type read is built from)
    if graph_paths:
        import os as _os
        L.append("## §3.5 Prediction graphs (fold-coherence / SOP folding)")
        L.append("_These are the graphs the wave-type read is derived from. Zero-crosses on the fold "
                 "curve = the Book's coherence-break detector; many breaks = fractured/destructive path._")
        labels = {"_compass.png": "**Time State Compass — SOPG×SOPC product tension.** The white curve (product) is the coherence signal; red=curvature, gold=gradient, green=envelope. Smooth spline curves on the −1..+1 chronometer axis. Sharp dives + sign flips = fractured/destructive path.",
                  "_waves.png": "**Pressure gradient (purple) & curvature (gold)** — the two smoothed wave factors whose product builds the compass curve above."}
        for gp in graph_paths:
            base = _os.path.basename(gp)
            suffix = "_" + base.split("_")[-1]
            cap = labels.get(suffix, base)
            L.append(f"\n{cap}\n")
            L.append(f"![{base}]({base})")
        # Book Tensor Surface (real recalc) — context, with honest caveat
        if tensor_paths:
            tslabels = {
                "_tensor.png": None,  # handled below with full caveat
                "_latent.png": ("**Three latent paths (P/Q/R)** — the framework's own Euler-integrated "
                                "trajectories, each an independent lens (verified near-zero/negative "
                                "correlation). The hidden path is where they converge: shape + majority direction."),
                "_pressure_gravity.png": ("**Pressure → gravity (by strike)** — where pressure accumulates "
                                          "(intent/transaction PG, liquidity-gated) vs the gravitational points "
                                          "(watermarks = dashed red, gamma walls = dotted) it releases toward."),
            }
            for tp in tensor_paths:
                tg = _os.path.basename(tp); suf = "_" + tg.split("brief_graph_")[-1]
                if suf == "_tensor.png":
                    geo = (tensor_meta or {}).get("geometry"); dr = (tensor_meta or {}).get("direction")
                    mig = (tensor_meta or {}).get("peak_migration")
                    L.append(f"\n**Book Tensor Surface** (real recalc) — geometry **{geo}**, direction **{dr}** "
                             f"(peak migration {mig}). _Caveat: tensor pins peaks at offset 0 and tends to read "
                             f"COMPRESSION across most sessions — NOT a proven discriminator; shown as context. "
                             f"Surface Jerk (Δ²) here IS the correct release-timing lens (not AM Lag/Speed)._\n")
                    L.append(f"![{tg}]({tg})")
                else:
                    L.append(f"\n{tslabels.get(suf, tg)}\n")
                    L.append(f"![{tg}]({tg})")
        elif with_tensor and tensor_meta and tensor_meta.get("_err"):
            L.append(f"\n_(Tensor/path graphs skipped: {tensor_meta['_err'][:80]})_")
        L.append("")

    # §3.6 WITHIN-SESSION PATH CONVERGENCE (multi-lens, this session only)
    sp_meta = extra_meta.get("paths")
    if sp_meta and sp_meta.get("convergence"):
        cv = sp_meta["convergence"]; lz = sp_meta.get("lenses", {})
        L.append("## §3.6 Within-session path convergence (multi-lens)")
        L.append("_Each Book lens read independently from THIS session, then checked for agreement. "
                 "Not fitted across sessions. High agreement = stronger within-session evidence; "
                 "a split = honest uncertainty._")
        L.append(f"- **PATH SHAPE: {cv['shape']['verdict']}** — lenses agree {cv['shape']['agree']} "
                 f"(strength {cv['shape']['strength']})")
        L.append(f"- **DIRECTION: {cv['direction']['verdict']}** — lenses agree {cv['direction']['agree']} "
                 f"(strength {cv['direction']['strength']})")
        lp = lz.get("latent_path", {})
        if lp.get("per_path"):
            pp_s = "; ".join(f"{k}:{v['dir']}/{v['shape']}" for k, v in lp["per_path"].items())
            L.append(f"- Latent paths (P/Q/R): {pp_s} → majority {lp.get('direction')} ({lp.get('dir_agreement')})")
        pp_meta = extra_meta.get("pressure_path")
        if pp_meta and pp_meta.get("path"):
            L.append(f"- Pressure→gravity: {pp_meta['path'].get('reading')}")
        # fold coherence (entropy) + asymmetry — the "folding dimensions" read
        try:
            import quan_realization as _R3
            from quan_engine import ingest_chain as _ing3
            _rw = _R3.realization_waves(_ing3(csv_path), anchor)
            _en = _rw.get("entropyNorm"); _as = _rw.get("fold_asym")
            if _en is not None:
                coh = ("concentrated/coherent" if _en < 0.4 else
                       "moderate" if _en < 0.7 else "dispersed/noisy")
                L.append(f"- **Fold coherence (entropy {_en:.2f} → {coh}):** how focused the pressure-fold "
                         f"energy is. Low = pressure concentrated at few strikes (directional/conviction setup); "
                         f"high = smeared across strikes (choppy). This is the *coherence* read, the reliable part.")
            if _as is not None:
                lean = "upside" if _as > 0 else "downside" if _as < 0 else "balanced"
                L.append(f"- Fold asymmetry (below-ATM vs above-ATM): {_as:+.2f} → {lean}-heavy "
                         f"_(logged as a lens — asymmetry-as-direction tested 2/4, coin-flip; NOT a signal)._")
            # EXHAUSTION / COIL — where the fold energy sits (spent at extremes vs loaded near ATM)
            _ex = _rw.get("exhaustion"); _com = _rw.get("fold_com"); _of = _rw.get("fold_outer_frac")
            if _ex is not None:
                ex_read = {"EXHAUSTED": "energy spent at the extremes — the move is largely priced/positioned out there; "
                                        "expect a SMALLER range, mean-revert bias",
                           "COILED": "energy loaded near the ATM — stored tension at current price; "
                                     "expect a LARGER range, release/expansion bias",
                           "MID": "energy mixed between center and extremes — neutral range bias"}.get(_ex, "")
                L.append(f"- **Exhaustion/coil: {_ex}** (fold-energy center {_com}/10, outer share {_of:.0%}) — {ex_read}. "
                         f"_Orthogonal to √MRW in testing (adds range info beyond it) but n=4 — promising, not proven._")
        except Exception:
            pass
        L.append("")
    L.append("## §4 Flip-watch (Tier-2 imminent-flip)")
    if fw.get("flip_imminent"):
        L.append(f"- ⚠ **IMMINENT** — {fw.get('directive')}")
    else:
        L.append("- No imminent flip flagged on the morning snapshot. (Still recompute as flow develops.)")
    L.append("")

    # §5 GREEKS
    L.append("## §5 Greeks surface")
    if gk:
        L.append(f"- GEX {_fmt(gk.get('gex'),0)} ({gk.get('direction')}); "
                 f"net delta {_fmt(gk.get('netDelta'),0)}; matched {gk.get('n_matched')} strikes")
        gw = gk.get("gamma_walls")
        if gw: L.append(f"- Gamma walls: {gw if not isinstance(gw,(list,tuple)) else gw[:5]}")
    else:
        L.append("- (No anchor supplied → greeks not computed.)")
    L.append("")

    # §6 LEVELS + LIQUIDITY (spatial)
    L.append("## §6 Levels & liquidity (Book_Strike_Level)")
    L.append(f"- Anchor {_fmt(kl.get('anchor'),2)} — nearest floor "
             f"**{_fmt(kl.get('nearest_floor'),2)}**, nearest ceiling "
             f"**{_fmt(kl.get('nearest_ceiling'),2)}**")
    for key, lbl in [("DFLOOR", "Daily floor"), ("DCEIL", "Daily ceiling"),
                     ("SFLOOR", "Strong floor"), ("SCEIL", "Strong ceiling")]:
        v = lv.get(key)
        if isinstance(v, (int, float)): L.append(f"- {lbl}: {_fmt(v,2)}")
    if isinstance(liq, dict) and "n_watermarks" in liq:
        L.append(f"- **Liquidity watermarks: {liq['n_watermarks']}** stuck strikes "
                 f"(|T|≥20), sign lean **{liq.get('watermark_sign_lean')}**, "
                 f"cluster count {liq.get('watermark_cluster',{}).get('count')}")
        if liq.get("n_watermarks", 0) >= 15:
            L.append(f"  - ⚠ **Saturation** — heavy dealer inventory parked; structural, watch for "
                     f"flip/release. (Pattern n=3, not gated.)")
        wms = liq.get("watermark_strikes", [])[:5]
        if wms:
            L.append("  - Top stuck strikes: " +
                     ", ".join(f"{int(w['strike'])}(T={w['T']},{w['sign']})" for w in wms))
    L.append("")

    # §7 SYNTHESIS — the call
    L.append("## §7 Synthesis — the read")
    L.append(f"- **Bias {syn.get('bias')}** | regime action: {syn.get('regime_action')}")
    L.append(f"- Expected path: {syn.get('expected_path')}")
    if syn.get("warnings"):
        L.append("- **Warnings:**")
        for w in syn["warnings"]:
            L.append(f"  - {w}")
    else:
        L.append("- No structural warnings (clean read).")
    L.append("")

    # §9 EXECUTION — where to look (paper-trade practice entries from the framework's own trigger logic)
    try:
        import quan_execution as _EX
        c = sig["cascade"]
        tc = _EX.triple_confirm(sig["CDS"], c["DIDS"], c["DITS"], c["DR3S"])
        lv = (sp.get("levels") or {})
        liq = (sp.get("liquidity") or {})
        kl = syn.get("key_levels", {})
        a = kl.get("anchor")
        L.append("## §9 Execution — where to look (paper)")
        state_word = {"GO": "ENTER (full)", "SLOW": "SCALE-IN (light/half)", "STAND": "STAND DOWN"}.get(tc["state"], tc["state"])
        L.append(f"- **Engine state: {tc['state']} → {state_word}** | tier {tc['tier']} | "
                 f"co-signed: {'yes' if tc['cosigned'] else 'no'} | half-Kelly {tc['kellyHalf']} "
                 f"(use 1/10-Kelly cap during validation)")
        bias_dir = "LONG" if (sig.get("CDS") or 0) > 0 else "SHORT" if (sig.get("CDS") or 0) < 0 else "NEUTRAL"
        # the structural levels to watch, framed as interaction setups
        floor = kl.get("nearest_floor"); ceil = kl.get("nearest_ceiling")
        dfloor = lv.get("DFLOOR"); dceil = lv.get("DCEIL"); sfloor = lv.get("SFLOOR")
        L.append(f"- Bias lean: **{bias_dir}** (honest: direction unproven — treat these as *zones to watch*, "
                 f"not signals to fire blind):")
        # floor / support setups
        if dfloor is not None:
            L.append(f"  - **{int(dfloor)} (dealer floor / dominant wall):** if price holds above on a test → "
                     f"long-side practice entry toward the upside zones; if it breaks and retests from below → "
                     f"the wall flips to resistance (short-side / stand-aside).")
        if sfloor is not None and sfloor != dfloor:
            L.append(f"  - **{int(sfloor)} (strong floor):** deeper support; a tap-reject here is the "
                     f"higher-conviction long zone if the session sells off into it.")
        # ceiling / resistance setups
        if dceil is not None:
            L.append(f"  - **{int(dceil)} (dealer ceiling):** tap-reject = fade back into the corridor; "
                     f"a confirmed break-and-hold above = momentum continuation (only with state GO/SLOW).")
        # watermarks as gravity
        wms = liq.get("watermark_strikes", [])[:3]
        if wms:
            wmtxt = ", ".join(f"{int(w['strike'])}" for w in wms)
            L.append(f"  - **Watermarks (dealer-pinned gravity): {wmtxt}** — price tends to get pulled toward / "
                     f"pinned at these; fade extremes that overshoot them, expect stalls/reversals on first touch.")
        # corridor as the day's expected envelope
        if a is not None:
            try:
                import quan_relativistic as _REL2
                mrw = abs(_REL2.compute_relativistic(_QA._E.ingest_chain(csv_path), sig["CDS"]).get("MRW", 0.0))
                if mrw > 0:
                    rproj = 3.9 * (mrw ** 0.5)
                    L.append(f"  - **√MRW corridor {a-rproj/2:.0f} – {a+rproj/2:.0f} (~{rproj:.0f}pt):** the projected "
                             f"session envelope. Mean-revert setups near the edges; a close outside it is the "
                             f"exception worth noting (range projection only, not direction).")
            except Exception:
                pass
        # execution gating reminder tied to state
        if tc["state"] == "STAND":
            L.append(f"  - ⚠ **State is STAND DOWN** (axes not co-signed) — no entries; watch only, recompute intraday.")
        L.append(f"- Sizing: half-Kelly {tc['kellyHalf']} → during validation cap at **1/10 Kelly**; "
                 f"flat by session close unless a swing thesis is explicit.")
        # ---- STANDOUT ZONES: volume spikes + gamma flip + confluence the standard levels miss ----
        try:
            import quan_greeks as _GK2
            from quan_engine import ingest_chain as _ing2, apex_basis as _ab2
            _fr = _ing2(csv_path)
            _gk = (gk or {})   # greeks layer from analyze() result (already in scope as gk)
            stand = []
            # volume spikes near anchor (TODAY's active positioning, not OI)
            if a is not None and {"callVol", "putVol"}.issubset(_fr.columns):
                _v = _fr[(_fr["strike"] >= a - 400) & (_fr["strike"] <= a + 400)].copy()
                _v["tv"] = _v["callVol"].fillna(0) + _v["putVol"].fillna(0)
                top = _v.reindex(_v["tv"].sort_values(ascending=False).index).head(3)
                med = _v["tv"].median() or 1
                for r in top.itertuples():
                    if r.tv >= max(3 * med, 300):
                        sidev = "call-heavy" if (r.callVol or 0) > (r.putVol or 0) else "put-heavy"
                        stand.append(f"**{int(r.strike)}** — volume spike {int(r.tv)} ({sidev}); today's active positioning, watch for a reaction here")
            # gamma flip line (regime pivot)
            gflip = _gk.get("gamma_flip")
            if gflip:
                stand.append(f"**{int(gflip)} (gamma flip)** — above = dealers stabilize (mean-revert/pin); below = dealers amplify (trend/extend). The regime pivot.")
            # confluence: a strike that is wall + gamma + flip together
            walls = [int(s) for s, _ in (_gk.get("gamma_walls") or [])[:3]]
            if dfloor is not None and int(dfloor) in walls and gflip and abs(int(dfloor) - int(gflip)) <= 25:
                stand.append(f"**{int(dfloor)} = triple confluence** (dominant OI wall + top gamma wall + gamma flip) — the single most important level to watch.")
            if stand:
                L.append("- **Standout zones (beyond the standard levels):**")
                for s in stand:
                    L.append(f"  - {s}")
        except Exception:
            pass
    except Exception as e:
        L.append("## §9 Execution — where to look (paper)")
        L.append(f"- (execution readout unavailable: {str(e)[:80]})")
    L.append("")

    # §8 HONEST CAVEATS
    L.append("## §8 Honest caveats")
    L.append(f"- {syn.get('honest_note')}")
    L.append("- This brief is a DESCRIPTION of the dealer field's morning state, not a prediction. "
             "Tier-2 reads (greeks gamma-flip, flip-watch, watermark migration) sharpen live; "
             "the morning snapshot is the initial read only.")
    L.append("- Paper-only until 50+ trades show a statistical differential (D2). Kelly 1/10 during validation.")
    return "\n".join(L)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: python3 quan_brief.py <chain.csv> <anchor> [T_days] [out.md]")
        sys.exit(1)
    import os as _os
    out = None
    for a in sys.argv[4:]:
        if a.endswith(".md"): out = a
    with_tensor = "--tensor" in sys.argv
    gdir = (_os.path.dirname(out) or ".") if out else None
    txt = build_brief(sys.argv[1], float(sys.argv[2]),
                      float(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].replace('.','').isdigit() else 1.0,
                      graphs_dir=gdir, with_tensor=with_tensor)
    if out:
        open(out, "w").write(txt); print(f"brief written -> {out}  (graphs in {gdir}{', +tensor' if with_tensor else ''})")
    else:
        print(txt)
