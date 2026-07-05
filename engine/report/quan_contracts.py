"""quan_contracts.py — producer-owned contract specifications (additive engine module).

Single source of truth for per-instrument contract multipliers ($ per 1.00 price point).
Used to scale displayed dollar magnitudes (GEX, dollar-delta). It does NOT affect any
structural read: gamma-wall ranking is an argsort, the gamma-flip is a zero-crossing, and
direction comes from netDelta sign — all invariant to a global multiplier. Unknown symbols
resolve to the NQ default (20.0), which preserves the frozen-engine reference exactly.

Ownership: contract specs are methodology (producer). Presentation passes only the instrument
identity; the engine resolves identity -> multiplier here.
"""
import re

# CME contract multipliers ($ / 1.00 point). Keyed by symbol root.
MULTIPLIERS = {
    # index
    "nq": 20.0, "mnq": 2.0, "es": 50.0, "mes": 5.0, "rty": 50.0, "m2k": 5.0,
    "ym": 5.0, "mym": 0.5, "np": 20.0, "em": 50.0,
    # rates (treasuries — fractional notation)
    "zn": 1000.0, "zb": 1000.0, "zf": 1000.0, "zt": 2000.0, "tn": 1000.0, "ub": 1000.0,
    # metals
    "si": 5000.0, "gc": 100.0, "hg": 25000.0, "pl": 50.0, "pa": 100.0,
    # fx
    "6e": 125000.0, "6j": 12500000.0, "6b": 62500.0, "6a": 100000.0, "6c": 100000.0,
    "6s": 125000.0, "6n": 100000.0, "6m": 500000.0,
}
DEFAULT_MULTIPLIER = 20.0          # NQ — preserves the frozen reference for unknown/empty

# longest-first so '6e' matches before any 1-char fallback, 'mnq' before 'nq', etc.
_ROOTS = sorted(MULTIPLIERS.keys(), key=len, reverse=True)

def symbol_root(instrument):
    """Extract a symbol root from any instrument string (e.g. 'NQ', 'nqm26options...', 'ZN U26')."""
    if not instrument:
        return None
    s = str(instrument).strip().lower()
    for root in _ROOTS:
        if re.match(r"^" + re.escape(root) + r"(?![a-z0-9])", s) or s.startswith(root):
            return root
    return None

def resolve_multiplier(instrument, default=DEFAULT_MULTIPLIER):
    """Instrument identity -> contract multiplier. Unknown/empty -> default (20.0, NQ)."""
    root = symbol_root(instrument)
    return MULTIPLIERS.get(root, default) if root else default
