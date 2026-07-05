"""
quan_wavetype.py — classify the EXPECTED daily wave-type from the FOLD-COHERENCE graphs.

Reframed 2026-06-01 (part 67): the Tensor Surface does NOT vary session-to-session in our data (Q converges
~0.15 daily) and does not discriminate wave-type. The wave-type lives in the FOLD graphs — the framework's own
coherence machinery:
  SOP Folding zero-crosses (totalZC)  = the Book's "Coherence break detector" (sign flips in the fold product).
  Compass destructive-node count      = pairs where |DIPLTR (O)| > |SoP (K)| (subtraction beats addition).
Together these measure whether the fold is COHERENT (mirror pairs reinforce, few breaks) or FRACTURED (pairs
cancel, many breaks). A second axis — ENERGY — distinguishes whether a coherent field actually MOVES.

Three-wave taxonomy (from n=5 mechanistic grouping; LOG FORWARD, not gated):
  ADDITIVE (coherent + energy)   : few/no destructive nodes, low ZC, energy present -> trend (high path eff).
  STILL    (coherent, no energy) : few/no destructive nodes, low ZC, low energy     -> flat/dead (tiny move).
  DESTRUCTIVE (fractured)        : many destructive nodes, high ZC                  -> chop/reversing (low eff).

Energy proxy: fold amplitude (Σ|fold|) — how much the constructive structure is "charged." Pairs with the bow
reframe (TR=release). A coherent fold with energy releases (trend); coherent without energy stays still.

Thresholds below are DESCRIPTIVE groupings from the observed split (0 vs 12-18 nodes), explicitly NOT tuned to
win/loss. If forward data redraws the boundaries, that is the data's conclusion.
"""
import numpy as np
import quan_realization as R
import quan_compass as CO

# Observed split was 0 nodes (coherent) vs 12-18 (fractured). Boundary set at the gap midpoint, descriptive only.
NODES_FRACTURED = 6      # >= this many destructive nodes => fractured fold
ZC_FRACTURED = 3         # >= this many fold zero-crosses => coherence broken

def _destructive_nodes(frame):
    pin = R._pressure_inputs(frame, 0)
    if pin is None:
        return None, None
    cw, cc, cd, meta = pin
    dfG, _ = CO.compass(cc); dfC, _ = CO.compass(cd)
    nodes = int(np.sum(np.abs(dfG["O"].values) > np.abs(dfG["K"].values)) +
                np.sum(np.abs(dfC["O"].values) > np.abs(dfC["K"].values)))
    return nodes, (dfG, dfC)

def classify_wave(frame):
    """Classify expected wave-type from fold-coherence + energy. frame = ingested chain."""
    rw = R.realization_waves(frame, 0)
    nodes, _ = _destructive_nodes(frame)
    if rw is None or nodes is None:
        return dict(wave="UNKNOWN", reason="no fold/compass (sparse chain)", expected_efficiency=None)
    zc = rw.get("totalZC", 0)
    fold = rw.get("fold", [])
    energy = float(np.sum(np.abs(fold))) if fold else 0.0
    ent = rw.get("entropyNorm", 0.0)

    fractured = (nodes >= NODES_FRACTURED) or (zc >= ZC_FRACTURED)
    # energy: coherent folds with low total amplitude are "still". Descriptive threshold from the data.
    low_energy = energy < 1.0

    if fractured:
        wave = "DESTRUCTIVE/FRACTURED"
        path = "chop / reversing (low path efficiency)"
        exp_eff = 0.20
    elif low_energy:
        wave = "COHERENT/STILL"
        path = "flat / dead (tiny move, coherent but uncharged)"
        exp_eff = 0.30
    else:
        wave = "ADDITIVE/COHERENT"
        path = "trend (coherent fold with energy to release)"
        exp_eff = 0.55

    return dict(
        wave=wave, expected_path=path, expected_efficiency=exp_eff,
        signature=dict(destructive_nodes=nodes, fold_zero_crosses=zc, fold_energy=round(energy, 3),
                       entropy_norm=ent, fractured=fractured, low_energy=low_energy),
        note="Expected wave-type from the FOLD-COHERENCE graphs (ZC = Book coherence-break detector; Compass "
             "destructive nodes = subtraction beats addition) + fold-energy axis. n=5 mechanistic grouping; "
             "compare to realized path efficiency, log forward, NOT gated.",
    )


def realized_wave(price_df, session_start=None, session_end=None):
    """Realized price wave from OHLC. efficiency = |net move|/gross hourly path. High=additive; low=destructive."""
    import pandas as pd
    df = price_df.copy()
    df["t"] = pd.to_datetime(df["time"], unit="s")
    if session_start is not None:
        df = df[df["t"] >= session_start]
    if session_end is not None:
        df = df[df["t"] < session_end]
    if len(df) < 3:
        return None
    o = float(df.iloc[0]["open"]); c = float(df.iloc[-1]["close"])
    hi = float(df["high"].max()); lo = float(df["low"].min())
    df["hr"] = df["t"].dt.floor("h")
    closes = df.groupby("hr")["close"].last().to_numpy()
    legs = np.diff(closes)
    net = abs(closes[-1] - closes[0]); gross = float(np.sum(np.abs(legs)))
    eff = (net / gross) if gross > 0 else 0.0
    nz = legs[legs != 0]
    dir_changes = int(np.sum(np.diff(np.sign(nz)) != 0)) if len(nz) > 1 else 0
    move_pct = (c - o) / o * 100
    if eff >= 0.40:
        realized = "ADDITIVE/TREND"
    elif abs(move_pct) < 0.30 and eff < 0.40:
        realized = "COHERENT/STILL"          # small net move regardless of path
    elif eff <= 0.25:
        realized = "DESTRUCTIVE/CHOP"
    else:
        realized = "MODULATED/MIXED"
    return dict(realized=realized, efficiency=round(eff, 3), net_move=round(c - o, 1),
                net_move_pct=round(move_pct, 2), range_pts=round(hi - lo, 1),
                direction_changes=dir_changes, open=o, close=c, high=hi, low=lo)
