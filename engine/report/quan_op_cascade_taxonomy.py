#!/usr/bin/env python3
"""
quan_op_cascade_taxonomy.py — Cascade-taxonomy producer operator.

Canonical Spec: classification originates in an operator (Invariant 9). This
operator migrates the skewness-convergence / kurtosis-intensity / cascade-grade /
wave-type classification OUT of presentation (where it violated Inv 9 / Clarif 11)
and into the producer, with NO change to methodology — the thresholds and sign
rules are preserved exactly as they were in mapBrief.

It consumes upstream producer values (the chronometric skew/kurtosis/JB fields and
the wave label) during the producer phase, and emits immutable, identity-addressed
states bound to producer-owned semantic versions (quan_semantics). It computes the
classification; it does NOT author the meaning of the labels — that is owned by the
semantic registry.

Pure Python, stdlib only. Deterministic. Provable feature-parity with the prior
presentation logic via test_operator_parity.py.
"""
import math
from dataclasses import dataclass, field
from typing import Optional, Dict, Tuple, List

import quan_semantics as sem

OPERATOR = "cascade_taxonomy"
OPERATOR_VERSION = "1.0.0"


@dataclass(frozen=True)
class TaxonomyState:
    """One immutable classification produced by this operator."""
    id: str
    operator: str
    dimension: str                  # skew_convergence | kurtosis_intensity | cascade_grade | wave_type
    label: Optional[str]            # the classification; None when inputs are unavailable
    semantic_version: Optional[str] # producer-owned meaning version this label binds to
    params: Tuple[Tuple[str, object], ...] = ()   # producer-supplied description params
    inputs: Tuple[Tuple[str, object], ...] = ()   # lineage: the values classified

    def param_dict(self) -> Dict[str, object]:
        return dict(self.params)


def _sign(x: float) -> int:
    return 1 if x > 0 else (-1 if x < 0 else 0)


# ---- classification methodology (verbatim migration of mapBrief thresholds) ---

def classify_skew_convergence(dids, dits, dr3s):
    sk = [dids, dits, dr3s]
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in sk):
        return None, {}
    sg = [_sign(x) for x in sk]
    all_same = sg[0] != 0 and sg[0] == sg[1] and sg[1] == sg[2]
    ab = [abs(x) for x in sk]
    mx, mn = max(ab), min(ab)
    gap = (mx / mn) if mn > 1e-9 else math.inf
    if not all_same:
        return "SIGN-DIVERGENT", {}
    if gap >= 2.0:
        # description shows gap to 1 decimal, exactly as the prior prose did
        return "MAGNITUDE-DIVERGENT", {"gap": f"{gap:.1f}"}
    return "CONVERGENT", {}


def classify_kurtosis_intensity(didk, ditk, dr3k):
    ku = [didk, ditk, dr3k]
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in ku):
        return None, {}
    km = (ku[0] + ku[1] + ku[2]) / 3.0
    kpk = max(ku)
    if km < 2:
        return "FLAT", {}
    if km < 10:
        return "CONCENTRATED", {}
    if km < 30:
        return "SHARP", {}
    return "SINGULAR", {"peak": f"{kpk:.0f}"}


def classify_cascade_grade(jbI, jbT, jbR):
    jb = [jbI, jbT, jbR]
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in jb):
        return None, {}
    jbmn = min(jb)
    if jbmn < 20:
        return "WEAK", {}
    if jbmn < 500:
        return "MODERATE", {}
    if jbmn < 1000:
        return "STRONG", {}
    return "MAXIMUM", {}


_WAVE_MAP = (("CONSTRUCT", "CONSTRUCTIVE"), ("FRACTUR", "FRACTURED"), ("DESTRUCT", "DESTRUCTIVE"))

def classify_wave_type(wave, zc_n=None):
    if not wave:
        return None, {}
    w = str(wave).upper()
    for needle, label in _WAVE_MAP:
        if needle in w:
            if label == "DESTRUCTIVE":
                return label, {"zc": ("?" if zc_n is None else str(zc_n))}
            return label, {}
    return None, {}


# ---- operator entry: consume payload fields -> emit immutable states -----------

def run(payload: Dict, id_prefix: str = "CT") -> List[TaxonomyState]:
    """Consume the upstream chronometric fields from `payload` and emit taxonomy
    states. Pure: identical payload -> identical states. Classification only;
    meaning is resolved from quan_semantics, never authored here."""
    b = payload
    plan = [
        ("skew_convergence",   classify_skew_convergence,
            (b.get("dids"), b.get("dits"), b.get("dr3s"))),
        ("kurtosis_intensity", classify_kurtosis_intensity,
            (b.get("didk"), b.get("ditk"), b.get("dr3k"))),
        ("cascade_grade",      classify_cascade_grade,
            (b.get("jbI"), b.get("jbT"), b.get("jbR"))),
        ("wave_type",          classify_wave_type,
            (b.get("wave"), b.get("zc_n"))),
    ]
    states: List[TaxonomyState] = []
    for i, (dim, fn, args) in enumerate(plan, start=1):
        label, params = fn(*args)
        ver = sem.definition(label).version if (label and sem.has(label)) else None
        input_names = {
            "skew_convergence": ("dids", "dits", "dr3s"),
            "kurtosis_intensity": ("didk", "ditk", "dr3k"),
            "cascade_grade": ("jbI", "jbT", "jbR"),
            "wave_type": ("wave", "zc_n"),
        }[dim]
        states.append(TaxonomyState(
            id=f"{id_prefix}{i:03d}",
            operator=OPERATOR,
            dimension=dim,
            label=label,
            semantic_version=ver,
            params=tuple(params.items()),
            inputs=tuple(zip(input_names, args)),
        ))
    return states
