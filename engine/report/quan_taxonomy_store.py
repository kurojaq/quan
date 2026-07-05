#!/usr/bin/env python3
"""
quan_taxonomy_store.py - Phase 2/3: populate the immutable store from operators,
in the schema the FROZEN reader already understands.

Engineering decision (logged in MIGRATION_LEDGER.md): conform the store fragment
to the frozen reader's canonical schema rather than extend the reader. The reader
resolves a state to its operator via a singular `measurement` reference, and reads
provisional-ness off EVENTS. So each operator emits, per dimension, ONE composite
measurement and ONE state that references it; Kelly's provisional-ness is carried
as a provisional event. Result: the frozen reader exposes every migrated state
with NO reader modification (verified in test_reader_integration.py).

Pure Python, stdlib only. Deterministic.
"""
import json
from typing import Dict

import quan_op_cascade_taxonomy as ct
import quan_op_kelly_governance as kg


def build_fragment(payload: Dict) -> Dict:
    """Deterministic, immutable, reader-conformant store fragment."""
    measurements: Dict[str, Dict] = {}
    states: Dict[str, Dict] = {}
    events = []

    # ---- cascade taxonomy: one composite measurement + one state per dimension
    for st in ct.run(payload):
        mid = f"M.{st.operator}.{st.dimension}"
        measurements[mid] = {
            "id": mid,
            "operator": st.operator,
            "module": "cascade_taxonomy",
            "name": st.dimension,
            "value": {k: v for k, v in st.inputs},   # composite input value (lineage)
        }
        states[st.id] = {
            "id": st.id,
            "operator": st.operator,
            "dimension": st.dimension,
            "measurement": mid,                       # singular ref the reader resolves
            "label": st.label,
            "semantic_id": st.label,
            "semantic_version": st.semantic_version,
            "params": dict(st.params),
            "owner": "producer",
        }

    # ---- kelly governance: measurement + state + PROVISIONAL EVENT -------------
    k = kg.run(payload)
    mid = "M.kelly_governance.halfkelly"
    measurements[mid] = {
        "id": mid, "operator": k.operator, "module": "kelly_governance",
        "name": "halfkelly", "value": k.raw_half_kelly,
    }
    states[k.id] = {
        "id": k.id, "operator": k.operator, "dimension": "kelly_governance",
        "measurement": mid, "label": k.label, "semantic_id": k.label,
        "semantic_version": k.semantic_version, "params": dict(k.params),
        "owner": "producer", "governor": k.governor, "applied": k.applied,
    }
    # provisional-ness lives on an event (Clarif 9; frozen reader reads it here)
    events.append({
        "id": "KGE001", "type": "sizing", "provisional": True,
        "before": None, "after": k.id,
    })

    return {"measurements": measurements, "states": states, "events": events}


def canonical_json(fragment: Dict) -> str:
    return json.dumps(fragment, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


if __name__ == "__main__":
    pay = {"dids": 0.0886, "dits": -2.5970, "dr3s": 1.7492,
           "didk": -4.867, "ditk": 6.631, "dr3k": 3.01,
           "jbI": 600, "jbT": 600, "jbR": 600, "wave": "DESTRUCTIVE",
           "zc_n": 4, "halfkelly": 0.42}
    f1, f2 = build_fragment(pay), build_fragment(pay)
    ok = canonical_json(f1) == canonical_json(f2)
    print(f"states={len(f1['states'])} measurements={len(f1['measurements'])} events={len(f1['events'])}")
    print("PASS: deterministic." if ok else "FAIL: non-deterministic.")
    raise SystemExit(0 if ok else 1)
