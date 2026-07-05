"""
quan_chronometric_objects.py - Step-1 analytical object model (engine-side).

Reporting-engine substrate: immutable Measurement -> State -> ChronometricEvent.
CONSTRUCTION ONLY. No classification thresholds are invented here. classify() reuses
EXISTING grounded bands:
  * Cascade  : quan_field_state.field_state -> field_type (ROTATIONAL/DIRECTIONAL/CONFLICTED).
  * Chronometer: wave-type label when supplied (grounded ZC-count arc); else None.
  * Breach   : NO grounded CL x CM band exists in the Golden Reference -> State.label=None,
               raw CL/CM shipped.
Direction-touching lineage (cascade bull/bear phase reads) -> provisional=True. Everything
grounded/structural -> provisional=False.

Consumes values ALREADY computed by the canonical engine (export_snapshot's cas / rw +
field_state(fr)); it never recomputes payload fields, so the flat payload line is untouched
(no drift vs REF_EXPECTED). Position(cw) -> Session(clock) mapping lives HERE, in the engine,
so every emitted object is self-contained (Quan point #2).
"""
from dataclasses import dataclass, asdict
from quan_field_state import field_state


# ---- Position -> Session projection (ported byte-faithfully from HTML clockOf/sessT) ----
# JS: sessT=cw=>(cw+1)/2 ; clockOf: mins=round(f*23*60); hh=(18*60+mins)%(24*60); 12h ET.
def session_from_cw(cw):
    if cw is None:
        return None
    f = (cw + 1) / 2.0
    mins = int(round(f * 23 * 60))
    tot = (18 * 60 + mins) % (24 * 60)
    H, Mn = divmod(tot, 60)
    ap = "AM" if H < 12 else "PM"
    h = H % 12 or 12
    return {"session_t": round(f, 4), "minutes": tot, "clock": "%d:%02d %s ET" % (h, Mn, ap)}


# ---- frozen objects (immutable snapshots; never mutated) ----
@dataclass(frozen=True)
class Measurement:
    id: str
    module: str
    operator: str
    values: dict
    position: object   # cw | None
    session: object    # {session_t,minutes,clock} | None
    def to_dict(self): return asdict(self)


@dataclass(frozen=True)
class State:
    id: str
    measurement: str   # lineage ref -> Measurement.id
    label: object      # str | None  (None where no grounded band)
    position: object
    session: object
    def to_dict(self): return asdict(self)


@dataclass(frozen=True)
class ChronometricEvent:
    id: str
    module: str
    operator: str
    type: str
    position: object
    session: object
    before: str        # lineage ref -> State.id
    after: str         # lineage ref -> State.id
    provisional: bool
    def to_dict(self): return asdict(self)


@dataclass(frozen=True)
class AnalysisResult:
    """Two parallel products of ONE analytical pass. Neither is derived from the other:
       payload = canonical flat line (legacy compatibility); store = Chronometric object model
       (future reporting surfaces). Engine stays stateless; the caller picks which it consumes."""
    payload: str
    store: object      # {measurements,states,events} | {"error":...} | None


# ---- classify(): grounded bands ONLY ----
def cascade_classify(field_state_out):
    """Grounded band = field_state field_type (ROTATIONAL/DIRECTIONAL/CONFLICTED)."""
    return field_state_out.get("field_type")

def chronometer_classify(wave_label):
    """Grounded ZC-count wave-type arc when available; else no grounded band -> None."""
    return wave_label or None

def breach_classify(_values):
    """No grounded CL x CM band in the Golden Reference -> raw, label=None."""
    return None

def _phase_dir(skew, inverse):
    """Grounded skewness->bias sign (DIDS/DITS INVERSE: neg=bull; DR3S CLASSIC: pos=bull)."""
    if skew is None or skew != skew or skew == 0:
        return None
    bull = (skew < 0) if inverse else (skew > 0)
    return "BULL" if bull else "BEAR"


# ---- build the immutable store from already-computed engine values ----
def build_store(fr, anchor, cas, rw, ts=None, wave=None):
    meas = {}; states = {}; events = []
    n = {"M": 0, "S": 0, "E": 0}

    def add_M(module, operator, values, position):
        i = "M%03d" % n["M"]; n["M"] += 1
        meas[i] = Measurement(i, module, operator, values, position, session_from_cw(position))
        return i

    def add_S(measurement, label, position):
        i = "S%03d" % n["S"]; n["S"] += 1
        states[i] = State(i, measurement, label, position, session_from_cw(position))
        return i

    def add_E(module, operator, typ, position, before, after, provisional):
        i = "E%03d" % n["E"]; n["E"] += 1
        events.append(ChronometricEvent(i, module, operator, typ, position,
                                        session_from_cw(position), before, after, provisional))
        return i

    fs = field_state(fr)
    P = fs.get("primitives", {})
    DIDS, DITS, DR3S = P.get("DIDS"), P.get("DITS"), P.get("DR3S")

    # ===== CASCADE: three-phase skewness. classify=field_type (grounded, structural -> non-provisional).
    add_M("cascade", "three_phase_skewness",
          {"DIDS": DIDS, "DITS": DITS, "DR3S": DR3S,
           "DIDK": P.get("DIDK"), "DITK": P.get("DITK"), "DR3K": P.get("DR3K"),
           "CDS": cas.get("CDS"), "BIAS": cas.get("BIAS"), "PP": cas.get("PP")}, None)
    add_S("M000", cascade_classify(fs), None)             # field_type label
    # per-phase directional reads (bull/bear) -> provisional lineage (direction method not finalized)
    ph_states = []
    for name, sk, inv in (("intent", DIDS, True), ("transaction", DITS, True), ("realization", DR3S, False)):
        mp = add_M("cascade", "phase_" + name, {"skew": sk, "inverse": inv}, None)
        ph_states.append(add_S(mp, _phase_dir(sk, inv), None))
    add_E("cascade", "phase_cascade", "phase_transition", None, ph_states[0], ph_states[1], True)
    add_E("cascade", "phase_cascade", "phase_transition", None, ph_states[1], ph_states[2], True)

    # ===== CHRONOMETER: chronometric field summary. classify=wave-type (grounded) where supplied.
    chrono_vals = {"totalZC": rw.get("totalZC"),
                   "peak_offset": (ts or {}).get("peak_offset"),
                   "exhaustion": rw.get("exhaustion"),
                   "entropyNorm": rw.get("entropyNorm")}
    mch = add_M("chronometer", "chronometric_field", chrono_vals, None)
    add_S(mch, chronometer_classify(wave), None)

    # ===== BREACH: raw dual-phase tensions CL/CM (label=None) + SOP-fold coherence-break events.
    cwax = rw.get("cwAxis") or []
    CL = rw.get("tensionCL") or []; CM = rw.get("tensionCM") or []
    mbf = add_M("breach", "dual_phase_tension", {"tensionCL": CL, "tensionCM": CM, "cwAxis": cwax}, None)
    add_S(mbf, breach_classify(None), None)               # raw CL/CM, label=None

    # coherence-break events = SOP-fold zero-crosses. Re-walk the SAME fold array the engine
    # walked (read, not a payload recompute); positions taken from rw['crossings_cw'] in order.
    fold = rw.get("fold") or []
    cross_cw = rw.get("crossings_cw") or []
    jc = 0
    for i in range(1, len(fold)):
        if fold[i] == 0:
            continue
        if (fold[i] > 0) != (fold[i - 1] > 0):
            pos = cross_cw[jc] if jc < len(cross_cw) else None
            jc += 1
            mb = add_M("breach", "sop_fold",
                       {"fold_before": fold[i - 1], "fold_after": fold[i], "pair": [i - 1, i]}, pos)
            s_before = add_S(mb, breach_classify(None), pos)
            s_after = add_S(mb, breach_classify(None), pos)
            add_E("breach", "coherence_break", "zero_cross", pos, s_before, s_after, False)

    return {
        "measurements": {k: v.to_dict() for k, v in meas.items()},
        "states": {k: v.to_dict() for k, v in states.items()},
        "events": [e.to_dict() for e in events],
    }
