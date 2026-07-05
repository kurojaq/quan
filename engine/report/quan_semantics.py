#!/usr/bin/env python3
"""
quan_semantics.py — Producer-owned, versioned semantic definitions.

Canonical Spec, Clarification 5/6 + Semantic Versioning:
  - The producer defines what every analytical label MEANS.
  - Each label resolves to a Semantic Definition carrying a version id and a
    canonical description (a template). A definition is NEVER mutated in place;
    a methodology change publishes a NEW version and leaves prior versions intact.
  - Presentation binds to a semantic version and RENDERS the description. It may
    reword (language replaceable) but never authors meaning (meaning immutable).
  - Dynamic values inside a description (e.g. a magnitude gap) are producer-
    supplied PARAMETERS, not presentation-authored prose.

This module is the single owner of analytical meaning for the migrated operators.
Stdlib only; pure data; immutable.
"""
from dataclasses import dataclass
from typing import Tuple, Mapping, Dict

REGISTRY_VERSION = "1.0.0"   # the migration baseline: meaning as it existed in
                             # presentation, now owned and versioned by the producer.


@dataclass(frozen=True)
class SemanticDefinition:
    """Immutable canonical meaning of one analytical label, at one version."""
    label: str
    version: str
    description: str               # canonical template; {param} = producer value
    params: Tuple[str, ...] = ()   # named producer-supplied parameters, if any

    def render(self, values: Mapping[str, object] = None) -> str:
        """Realize the canonical description with producer-supplied parameter
        values. Presentation calls this; it supplies no meaning of its own."""
        if not self.params:
            return self.description
        v = dict(values or {})
        missing = [p for p in self.params if p not in v]
        if missing:
            raise KeyError(f"{self.label}@{self.version} missing params: {missing}")
        return self.description.format(**v)


def _d(label, description, params=()):
    return label, SemanticDefinition(label, REGISTRY_VERSION, description, tuple(params))


# ---- canonical meanings, migrated verbatim from the prior presentation prose --
# (meaning preserved exactly; only ownership moved from presentation to producer)
_DEFINITIONS: Dict[str, SemanticDefinition] = dict([
    # skewness convergence ----------------------------------------------------
    _d("SIGN-DIVERGENT",
       "at least one domain is sign-opposed \u2014 the structural source of a CONFLICTED read"),
    _d("MAGNITUDE-DIVERGENT",
       "signs agree but magnitudes diverge {gap}\u00d7 \u2014 the weakest domain is "
       "\u201cowed\u201d a move; convergent in direction, contested in intensity",
       params=("gap",)),
    _d("CONVERGENT",
       "all three domains aligned in sign and magnitude \u2014 directional bias is "
       "consistent across structure, flow and realization"),
    # kurtosis intensity ------------------------------------------------------
    _d("FLAT",
       "near-mesokurtic \u2014 the chronometric surface is broad, dealer positioning is diffuse"),
    _d("CONCENTRATED",
       "moderate excess kurtosis \u2014 positioning concentrates at specific strikes"),
    _d("SHARP",
       "high excess kurtosis \u2014 the surface is sharply peaked, positioning is mechanically dominant"),
    _d("SINGULAR",
       "extreme excess kurtosis (peak {peak}) \u2014 the surface spikes; strike observables "
       "(Mass, Jerk, LR) carry maximum precision",
       params=("peak",)),
    # cascade grade (JB) ------------------------------------------------------
    _d("WEAK",
       "a domain is approximately normal (JB<20) \u2014 its CDS contribution is diffuse; "
       "treat the classification as provisional"),
    _d("MODERATE",
       "all domains reject normality (JB 20\u2013500) \u2014 positioning is concentrated, "
       "signal is statistically real but not extreme"),
    _d("STRONG",
       "all domains strongly non-normal (JB 500\u20131000) \u2014 positioning is mechanically significant"),
    _d("MAXIMUM",
       "all three domains reject normality at extreme significance (JB>1000) \u2014 the cascade "
       "is grounded in real non-Gaussian structure, not noise"),
    # wave type ---------------------------------------------------------------
    _d("CONSTRUCTIVE",
       "gradient and curvature of pressure reinforce \u2014 path efficiency high, the "
       "structural move amplifies"),
    _d("FRACTURED",
       "no dominant pressure pattern \u2014 severe incoherence; no directional position is "
       "structurally grounded"),
    _d("DESTRUCTIVE",
       "SOPG and SOPC oppose \u2014 the product sign-flips ({zc} zero-crosses); chop/reversing "
       "arc, no momentum layers",
       params=("zc",)),
    # spacetime separation (only TIMELIKE had an authored gloss to migrate) ----
    _d("TIMELIKE",
       "sub-luminal / causal separation \u2014 no tachyonic break"),
    # kelly governance (provisional) ------------------------------------------
    _d("KELLY_GOVERNED",
       "half-Kelly {raw} governed \u00d7{gov} \u2192 {applied} \u2014 provisional sizing, "
       "paper-validation cap until 50+ logged trades",
       params=("raw", "gov", "applied")),
    # ---- section narratives (migrated verbatim from buildPrintBrief) ----------
    # producer owns the template (meaning); presentation supplies formatted params
    _d("NARR.chronometric_speeds",
       "Intent leads (SoI {soi}) while realization is near-static (SoR {sor}). "
       "Lorentz &gamma;_T {lorentz}&asymp;1 with a {tii} separation &mdash; "
       "sub-luminal/causal, no tachyonic break.",
       params=("soi", "sor", "lorentz", "tii")),
    _d("NARR.iv_surface",
       "ATM IV {atmiv} (IV_Mid = (callIV+putIV)/2); 25&Delta; risk-reversal {rr25} = "
       "IV_25C &minus; IV_75C (Book convention: &gt;0 = call-side richer). 25&Delta; "
       "butterfly {bf25} convexity. Smile slope {smile} d&sigma;/dK per strike-pt "
       "(OLS over IV_Mid).",
       params=("atmiv", "rr25", "bf25", "smile")),
    _d("NARR.risk_engine",
       "Delta VaR = |DDE$|&middot;Z/100 (Z = 1.645 / 2.326). CF VaR applies the "
       "Cornish-Fisher z-adjustment using the Realization-cascade skew (DR3S) and "
       "<b>excess</b> kurtosis (DR3K, used directly &mdash; the engine's KURT already "
       "returns excess, so the Book's literal &minus;3 would double-subtract). Stress "
       "P&amp;L = DDE$&middot;&Delta;F + 0.5&middot;GEX&middot;&Delta;F&sup2;. Vega terms "
       "are zero (the Book's net-vega summary cell is unpopulated)."),
    _d("NARR.info_field",
       "H {hnorm} normalized &mdash; the premium field is highly dispersed (near-max "
       "entropy). Intent and transaction are strongly coupled (&rho; {corrIT}); "
       "realization decouples (&rho; {corrIR}).",
       params=("hnorm", "corrIT", "corrIR")),
    _d("NARR.cascade_fallback",
       "All three phases reject normality (high JB) &mdash; the CDS signal is "
       "statistically real."),
])


def definition(label: str) -> SemanticDefinition:
    """Return the producer-owned semantic definition for a label, or raise."""
    d = _DEFINITIONS.get(label)
    if d is None:
        raise KeyError(f"no producer-owned semantics for label {label!r}")
    return d


def has(label: str) -> bool:
    return label in _DEFINITIONS


def all_labels() -> Tuple[str, ...]:
    return tuple(_DEFINITIONS.keys())
