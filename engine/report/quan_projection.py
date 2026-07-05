#!/usr/bin/env python3
"""
quan_projection.py - Phase 4: the projection. Transport only.

Canonical Spec, Clarification 10: the projection MAY resolve references, organize,
group, filter, format, package. It MAY NEVER classify, infer, derive, compute an
analytical quantity, or combine fields into a conclusion not already a producer
label. This builder consumes ONLY the reader and the producer-owned semantic
registry; it resolves each producer label to its versioned canonical description
(reference resolution) and carries it. It makes no analytical decision.

Anything analytical in here would be an ownership leak (caught by the static gate).

Pure Python, stdlib only.
"""
from typing import Dict, List
import quan_semantics as sem


# delta-pressure label: ONE canonical source of truth, payload sign convention.
# Resolves ledger bug #9 by construction - the divergence (terminal BEARISH vs
# payload GDIR=+1 BULLISH) cannot recur because every surface reads this one map.
_GDIR_LABEL = {1: "BULLISH", -1: "BEARISH", 0: "NEUTRAL"}

def gdir_label(gdir) -> str:
    try:
        return _GDIR_LABEL.get(int(gdir), "\u2014")
    except (TypeError, ValueError):
        return "\u2014"


# formatting helpers (projection MAY format, Clarif 10) - mirror the report path
def _grp(t):
    s, out = t.split('.')[0], ''
    rest = t.split('.')[1:] 
    for i, ch in enumerate(reversed(s)):
        if i > 0 and i % 3 == 0:
            out = ',' + out
        out = ch + out
    return out + (('.' + rest[0]) if rest else '')

def _N(v, d=2):
    if v is None: return '\u2014'
    t = f"{float(v):.{d}f}"; neg = t.startswith('-')
    if neg: t = t[1:]
    return ('\u2212' if neg else '') + _grp(t)

def _P(v, d=2):
    if v is None: return '\u2014'
    return f"{float(v):.{d}f}".replace('-', '\u2212') + '%'


# narrative param formatting spec, per producer template (transport detail)
_NARRATIVE_PARAMS = {
    "NARR.chronometric_speeds": lambda p: {"soi": _N(p.get("soi"),1), "sor": _N(p.get("sor"),4),
                                           "lorentz": _N(p.get("lorentz"),4), "tii": p.get("tii")},
    "NARR.iv_surface": lambda p: {"atmiv": _P(p.get("atmiv"),1), "rr25": _P(p.get("rr25"),1),
                                  "bf25": _P(p.get("bf25"),1), "smile": _N(p.get("smile"),4)},
    "NARR.info_field": lambda p: {"hnorm": _N(p.get("hnorm"),3), "corrIT": _N(p.get("corrIT"),2),
                                  "corrIR": _N(p.get("corrIR"),2)},
    "NARR.risk_engine": lambda p: {},
}

def build_narratives(payload: Dict) -> Dict:
    """Resolve producer-owned narrative templates with formatted producer params.
    Reference resolution + formatting only; no authored meaning."""
    out = {}
    for nid, mk in _NARRATIVE_PARAMS.items():
        if sem.has(nid):
            out[nid] = sem.definition(nid).render(mk(payload))
    return out


def _project_state(s: Dict) -> Dict:
    """Resolve one producer state into a transport-ready projection field.
    Reference resolution + formatting only; no analytical decision."""
    label = s.get("label")
    field = {
        "dimension": s.get("dimension"),
        "label": label,
        "semantic_id": s.get("semantic_id"),
        "semantic_version": s.get("semantic_version"),
        "params": dict(s.get("params") or {}),
        "owner": s.get("owner"),
        "description": None,
    }
    # resolve the producer-owned description for this label@version (a reference
    # lookup into the producer's semantic registry - not authored here)
    if label and sem.has(label):
        field["description"] = sem.definition(label).render(field["params"])
    return field


def build_projection(reader, payload: Dict = None) -> Dict:
    """Build the report projection from the reader. Transport only."""
    payload = payload or {}
    taxonomy: List[Dict] = []
    for dim_order in ("skew_convergence", "kurtosis_intensity", "cascade_grade", "wave_type"):
        for s in reader.states_for_operator("cascade_taxonomy"):
            if s.get("dimension") == dim_order:
                taxonomy.append(_project_state(s))

    kelly = None
    for s in reader.states_for_operator("kelly_governance"):
        kelly = _project_state(s)
        kelly["provisional"] = True          # carried from the producer; not decided here
        kelly["applied"] = s.get("applied")
        kelly["governor"] = s.get("governor")

    # delta-pressure: carry the raw producer field and its canonical label (one source)
    delta_pressure = None
    if "gdir" in payload:
        delta_pressure = {"gdir": payload.get("gdir"), "label": gdir_label(payload.get("gdir"))}

    return {
        "taxonomy": taxonomy,          # list of resolved producer labels + descriptions
        "kelly": kelly,                # provisional, producer-sized, carried not computed
        "delta_pressure": delta_pressure,
        "narratives": build_narratives(payload),   # producer-owned section templates, resolved
        "vocabulary": {                # audit view, reference resolution only
            "operators": reader.operators(),
            "labels": reader.labels(),
        },
    }


if __name__ == "__main__":
    from quan_store_reader import StoreReader
    import quan_taxonomy_store as store
    pay = {"dids": 0.0886, "dits": -2.5970, "dr3s": 1.7492,
           "didk": -4.867, "ditk": 6.631, "dr3k": 3.01,
           "jbI": 600, "jbT": 600, "jbR": 600, "wave": "DESTRUCTIVE",
           "zc_n": 4, "halfkelly": 0.42, "gdir": 1}
    proj = build_projection(StoreReader(store.build_fragment(pay)), pay)
    import json
    print(json.dumps(proj, ensure_ascii=False, indent=1))
