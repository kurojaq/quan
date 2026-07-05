"""
quan_store_reader - the canonical read interface for the Chronometric Store.

Step 2 of the Chronometric architecture. This is the SINGLE read boundary that every consumer
- HTML report, PDF generation, timeline, dashboard, DS, SWF, API, session replay - goes through.
No consumer traverses the store dictionaries directly. If the underlying storage representation
ever evolves, only this module changes; every consumer stays insulated behind one interface.

This mirrors what Step 1 accomplished on the producer side: Step 1 defined the canonical producer
(the engine + immutable object model); Step 2 defines the canonical consumer (this reader).

CONTRACT - this module is demonstrably incapable of creating analytical meaning:
  * no classification - it never computes a label; it only reads existing `label` fields
  * no recomputation  - it imports NO analytical code; its entire import set is the stdlib
  * no mutation       - it never writes to the store; every read returns a deep copy
  * no inference      - it filters, resolves lineage, and summarizes existing facts only

The engine (producer) classifies. This reader (consumer) exposes. The separation is absolute.

It reads the canonical AnalysisResult store: a JSON-serializable dict
    {measurements: {id: measurement}, states: {id: state}, events: [event, ...]}
where each measurement/state/event is itself a plain dict (the serializable object model).
"""

from copy import deepcopy

# Sentinel so that label=None is a *real* filter value (breach states legitimately carry label=None)
# rather than being indistinguishable from "no label filter supplied".
_UNSET = object()


class StoreReader:
    """Read-only view over a Chronometric Store. Construct from a store dict or an AnalysisResult."""

    def __init__(self, store):
        if not isinstance(store, dict) or not {"measurements", "states", "events"} <= set(store):
            raise ValueError(
                "StoreReader expects an AnalysisResult store dict "
                "{measurements, states, events}"
            )
        # Hold references for reads; this class never assigns into them (no-mutation contract).
        self._m = store["measurements"]   # {id: measurement-dict}
        self._s = store["states"]         # {id: state-dict}
        self._e = list(store["events"])   # [event-dict]  (own list; never mutated)

    @classmethod
    def from_result(cls, analysis_result):
        """Wrap an AnalysisResult by reading its `.store`."""
        return cls(analysis_result.store)

    # ------------------------------------------------------------------ measurements
    def measurement(self, measurement_id):
        """One measurement by id, or None."""
        m = self._m.get(measurement_id)
        return deepcopy(m) if m is not None else None

    def measurements(self, operator=None, module=None):
        """All measurements, optionally filtered by operator and/or module."""
        out = [
            m for m in self._m.values()
            if (operator is None or m.get("operator") == operator)
            and (module is None or m.get("module") == module)
        ]
        return deepcopy(out)

    # ------------------------------------------------------------------ states
    def state(self, state_id):
        """One state by id, or None."""
        s = self._s.get(state_id)
        return deepcopy(s) if s is not None else None

    def states(self, label=_UNSET):
        """All states, optionally filtered by label. Pass label=None to select unlabeled
        (breach) states; omit the argument to select all."""
        out = [s for s in self._s.values() if (label is _UNSET or s.get("label") == label)]
        return deepcopy(out)

    def state_of(self, measurement_id):
        """The state that classifies a given measurement (states reference a measurement id)."""
        for s in self._s.values():
            if s.get("measurement") == measurement_id:
                return deepcopy(s)
        return None

    def states_for_operator(self, operator):
        """States whose underlying measurement belongs to `operator` (pure id resolution)."""
        mids = {m.get("id") for m in self._m.values() if m.get("operator") == operator}
        return deepcopy([s for s in self._s.values() if s.get("measurement") in mids])

    # ------------------------------------------------------------------ events
    def event(self, event_id):
        """One event by id, or None."""
        ev = next((e for e in self._e if e.get("id") == event_id), None)
        return deepcopy(ev) if ev is not None else None

    def events(self, type=None, provisional=None):
        """All events, optionally filtered by type and/or provisional flag."""
        out = [
            e for e in self._e
            if (type is None or e.get("type") == type)
            and (provisional is None or bool(e.get("provisional")) == bool(provisional))
        ]
        return deepcopy(out)

    # ------------------------------------------------------------------ lineage
    def lineage(self, event_id):
        """Resolve an event to its before/after states and each state's measurement.
        Pure id resolution - the reader follows references; it does not interpret them."""
        ev = next((e for e in self._e if e.get("id") == event_id), None)
        if ev is None:
            return None

        def resolve(state_id):
            if state_id is None:
                return None
            st = self._s.get(state_id)
            if st is None:
                return {"state": None, "measurement": None}
            return {"state": deepcopy(st), "measurement": self.measurement(st.get("measurement"))}

        return {
            "event": deepcopy(ev),
            "before": resolve(ev.get("before")),
            "after": resolve(ev.get("after")),
        }

    # ------------------------------------------------------------------ provisional
    def provisional(self):
        """Lineage flagged provisional: the provisional events plus the states they reference.
        States do not carry the flag themselves; provisional-ness is read off the events."""
        prov_events = [deepcopy(e) for e in self._e if e.get("provisional")]
        ref_ids = set()
        for e in prov_events:
            for k in ("before", "after"):
                if e.get(k) is not None:
                    ref_ids.add(e[k])
        prov_states = [deepcopy(self._s[i]) for i in sorted(ref_ids) if i in self._s]
        return {"events": prov_events, "states": prov_states}

    # ------------------------------------------------------------------ audit / vocabulary
    def operators(self):
        """The operator vocabulary actually present in the store."""
        return sorted({m.get("operator") for m in self._m.values() if m.get("operator") is not None})

    def labels(self):
        """The state-label vocabulary actually present (None included if any state carries it)."""
        return sorted({s.get("label") for s in self._s.values()}, key=lambda x: (x is None, x))

    def event_types(self):
        """The event-type vocabulary actually present."""
        return sorted({e.get("type") for e in self._e if e.get("type") is not None})

    def summary(self):
        """An audit view of what the store contains - counts and present vocabulary only.
        Reports what IS there; it draws no conclusion about what it means."""
        return {
            "n_measurements": len(self._m),
            "n_states": len(self._s),
            "n_events": len(self._e),
            "operators": self.operators(),
            "labels": self.labels(),
            "event_types": self.event_types(),
            "n_provisional_events": sum(1 for e in self._e if e.get("provisional")),
        }
