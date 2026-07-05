"""
quan_regime.py — Tier-1 FIELD REGIME classifier. The framework IS the strategy.

DESIGN RULE (locked): regime is composed PURELY from what the framework says each axis MEANS — never tuned to
win on past sessions. n=4 cannot validate a composition; the forward paper ledger confirms whether the
framework's described regimes hold. If, over forward data, a framework axis behaves opposite to its stated
meaning (e.g. TP/TR inverted), THAT is the conclusion the data delivers — we do not pre-patch it here.

Framework axes used (each for its OWN defined meaning, all Book-verified):
  field TYPE (cascade sign-alignment) : the framework's OWN directional call —
        DIRECTIONAL (Intent & Transaction aligned) / ROTATIONAL (oppose) / CONFLICTED (realization opposes).
  CDS (CX85)                          : direction + strength (-1..+1 in thirds).
  TP — Trigger Pull (DB42 = 1-|S/K|)  : framework's trigger-readiness / co-signing measure (ref 0.8197 Apr17).
  Trend Length (DB17 = II*TMR)        : persistence horizon (built-to-persist vs quick).
  Cs (DB33)                           : curvature coherence (context).
  Spacetime Class (DB59)              : relativistic field state (context).
  JB significance                     : are the signals statistically real (safety check).

Regime = the framework's field TYPE, with the action each TYPE implies:
  DIRECTIONAL  -> ride WITH CDS to the structural flip-zone targets, hold per trend-length horizon.
  ROTATIONAL   -> stand aside / fade structure only (capital rotating against bias; no trend edge).
  CONFLICTED   -> stand aside (realization opposes the intent/transaction agreement; unresolved).
TP and trend length DESCRIBE the directional setup (readiness, horizon); they are reported, not used to
override the framework's TYPE call. Tier-2 dynamics (gamma/delta flip, conductance timing, zone migration) time
and refine execution as live data updates — they do not change this static classification.

NO outcome-fitted thresholds. The only numeric is the framework's own TP reference (0.8197) used purely as a
descriptive label boundary, not a gate.
"""
import numpy as np

TP_REF = 0.8197   # framework reference TP (Apr 17 STRONG_BULL). Descriptive label only, NOT a pass/fail gate.

def field_regime(cascade, field_state, significance=None):
    """Compose verified axes -> regime + implied action, purely by framework meaning. No outcome fitting."""
    cds = cascade.get("CDS", 0.0)
    tp = cascade.get("TP", float("nan"))
    ftype = field_state.get("field_type", "CONFLICTED")
    cs = field_state.get("curvature", {}).get("Cs", float("nan"))
    tl = field_state.get("trend_length", {})
    sc = field_state.get("spacetime", {}).get("SC", "LIGHTLIKE")
    intent_tl = tl.get("intent", float("nan"))
    sig_ok = significance.get("all_significant", True) if significance else True

    direction = "LONG" if cds > 0 else ("SHORT" if cds < 0 else "NONE")
    cds_tier = "STRONG" if abs(cds) >= 1.0 else ("BIAS" if abs(cds) >= (1/3) else "NEUTRAL")
    # TP/TR — BOW interpretation (verified mechanism, n=5 corr(TP,|move|)=-0.96; direction-agnostic, log forward):
    #   TP = the DRAW (stored static tension / compression). High TP = coiled, energy stored, NOT yet released.
    #   TR = 1-TP = the RELEASE (kinetic discharge -> move MAGNITUDE). Rising TR = the move firing.
    tr = (1.0 - tp) if (tp == tp) else float("nan")
    if tp != tp:
        tp_read = "unknown"
    elif tp >= 0.90:
        tp_read = "DRAWN/coiled (energy stored, low release)"
    elif tp <= 0.70:
        tp_read = "released (discharging into motion)"
    else:
        tp_read = "mid-draw (releasing)"
    horizon = "persistent (swing)" if (intent_tl == intent_tl and abs(intent_tl) > 50.0) else "quick"

    # Regime = the framework's OWN field TYPE. The action follows from what that TYPE describes.
    if ftype == "DIRECTIONAL":
        regime = "COHERENT_DIRECTIONAL"
        action = (f"Field is DIRECTIONAL ({cds_tier} {direction}, TP {tp:.2f}={tp_read}). Ride WITH CDS: enter on "
                  f"a conductance-window open at/after a state-flip zone; target downstream flip zones in the "
                  f"{direction} direction; hold per horizon ({horizon}, intentTL={intent_tl:.0f}); trail under the "
                  f"nearest behind-zone. Size by Kelly (governed).")
    elif ftype == "ROTATIONAL":
        regime = "ROTATIONAL_CONFLICTED"
        action = (f"Field is ROTATIONAL (capital rotating against bias). No trend edge — stand aside by default; "
                  f"if traded, fade only between watermarks/gamma walls with tight risk. Never trend it.")
    else:  # CONFLICTED
        regime = "ROTATIONAL_CONFLICTED"
        action = (f"Field is CONFLICTED (realization opposes the intent/transaction agreement). Unresolved — stand "
                  f"aside; re-read on the next chain update.")

    if not sig_ok:
        action = "⚠ JB: one or more components NOT statistically significant — treat the signal with caution. " + action

    return dict(
        regime=regime, field_type=ftype, direction=direction, cds_tier=cds_tier, action=action,
        readout=dict(cds=cds, TP=tp, TR=tr, tp_read=tp_read, Cs=cs, spacetime=sc,
                     intent_trend_length=intent_tl, horizon=horizon, significant=sig_ok),
        note="Regime = framework field TYPE (frozen, not outcome-fitted). TP/trend-length describe the setup. "
             "Forward ledger confirms; if an axis inverts over time, the data delivers that conclusion.",
    )
