#!/usr/bin/env python3
"""
quan_op_kelly_governance.py — Kelly-governance producer operator (PROVISIONAL).

Canonical Spec, Clarification 9: provisional methodology (position sizing) is
producer-owned and never sized in presentation; it is flagged provisional and is
excluded from the fidelity obligation until a dedicated operator owns it. This IS
that dedicated operator. It migrates the `KELLY_GOV` governor and the
`halfkelly * KELLY_GOV` arithmetic OUT of presentation (mapBrief AND the print
path, which each held an independent copy) into a single producer owner.

Methodology preserved exactly: governor = 0.10, applied = halfkelly * governor.
The operator marks its output provisional so presentation renders it as
provisional, never as a settled conclusion.

Pure Python, stdlib only. Deterministic.
"""
from dataclasses import dataclass
from typing import Optional, Tuple, Dict

import quan_semantics as sem

OPERATOR = "kelly_governance"
OPERATOR_VERSION = "1.0.0"

# the single, named governor — paper-validation cap (x1/10). One owner, one value.
KELLY_GOVERNOR = 0.10


@dataclass(frozen=True)
class KellyState:
    id: str
    operator: str
    label: Optional[str]
    semantic_version: Optional[str]
    provisional: bool
    raw_half_kelly: Optional[float]
    governor: float
    applied: Optional[float]
    params: Tuple[Tuple[str, object], ...] = ()

    def param_dict(self) -> Dict[str, object]:
        return dict(self.params)


def run(payload: Dict, id_prefix: str = "KG") -> KellyState:
    """Consume the provisional half-Kelly value and apply the producer-owned
    governor. Output is always flagged provisional (Clarification 9)."""
    hk = payload.get("halfkelly")
    if not isinstance(hk, (int, float)):
        return KellyState(
            id=f"{id_prefix}001", operator=OPERATOR, label=None,
            semantic_version=None, provisional=True,
            raw_half_kelly=None, governor=KELLY_GOVERNOR, applied=None,
        )
    applied = hk * KELLY_GOVERNOR
    label = "KELLY_GOVERNED"
    ver = sem.definition(label).version if sem.has(label) else None
    params = {
        "raw": f"{hk:.3f}",
        "gov": f"{KELLY_GOVERNOR:g}",
        "applied": f"{applied:.3f}",
    }
    return KellyState(
        id=f"{id_prefix}001", operator=OPERATOR, label=label,
        semantic_version=ver, provisional=True,
        raw_half_kelly=float(hk), governor=KELLY_GOVERNOR, applied=float(applied),
        params=tuple(params.items()),
    )
