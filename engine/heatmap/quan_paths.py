"""
quan_paths — WITHIN-SESSION multi-lens path finder.

NOT a cross-session fit. For ONE session's chain, it computes each Book graph/lens INDEPENDENTLY
(by its framework meaning) and reports where they CONVERGE on the same path. Convergence among
independent lenses, read fresh from this session alone, is the within-session evidence of a path.

Lenses (each frozen by framework meaning, no outcome tuning):
  1. latent_path   — SOP Folding Euler-integrated trajectory (P/Q/R cols). THE framework's own
                     projected path: Q[i]=Q[i-1]+SOPG[i-1]*0.1 (rows 3-4), then SOPG/SOPC*0.1 (rows 5+).
  2. coherence     — fold zero-cross count (Book coherence-break detector). many breaks => fractured.
  3. tension       — product tension accumulator sign (compression vs release direction).
  4. entropy       — normalized fold entropy (concentration=pinned vs uniform=dispersed).
  5. tensor_geom   — (optional, passed in) COMPRESSION/TRAJECTORY + UP/DOWN from the real Book recalc.

Rollover/expiry note: a weekly-expiry chain near 0DTE concentrates OI/gamma at the pin strike;
that pinning shows up as HIGH concentration (low entropy) + COMPRESSION — a within-session feature,
read as-is, not a cross-session artifact.
"""
import numpy as np


def _latent_paths(sopG, sopC):
    """
    The THREE framework latent paths (SOP_Folding cols P/Q/R), Euler-integrated dt=0.1.
    They are INDEPENDENT lenses (verified corr Q~P=-0.55, Q~R=-0.49, P~R=+0.07 on 6/1) — each
    integrates a different component, so the true within-session path is where they CONVERGE.
      Q (SOPG_Latent): Q[i]=Q[i-1]+SOPG[i-1]*0.1 (rows<5), then +(SOPG/SOPC)*0.1   (formula change at row 5)
      P (SOPc_Latent): P[i]=P[i-1]+SOPC[i-1]*0.1
      R (SOPC_Latent): R[i]=R[i-1]+P[i-1]*0.1                                        (position from P)
    """
    n = len(sopG)
    Q = [0.0] * n; P = [0.0] * n; R = [0.0] * n
    for i in range(1, n):
        if i < 3:
            Q[i] = Q[i-1] + sopG[i-1] * 0.1
        else:
            ratio = (sopG[i-1] / sopC[i-1]) if sopC[i-1] not in (0, None) else 0.0
            Q[i] = Q[i-1] + ratio * 0.1
        P[i] = P[i-1] + sopC[i-1] * 0.1
        R[i] = R[i-1] + P[i-1] * 0.1
    return {"Q": Q, "P": P, "R": R}


def _path_read(path):
    net = path[-1] - path[0] if path else 0.0
    dirs = np.sign(np.diff(path))
    dir_changes = int(np.sum(np.abs(np.diff(dirs[dirs != 0])) > 0)) if len(dirs[dirs != 0]) > 1 else 0
    return {"net_drift": round(net, 3),
            "direction": "UP" if net > 0 else "DOWN" if net < 0 else "FLAT",
            "shape": "TREND" if dir_changes <= 2 else "CHOP",
            "dir_changes": dir_changes,
            "path": [round(x, 3) for x in path]}


def session_paths(realization, tensor_meta=None):
    """
    realization = quan_realization.realization_waves output (one session).
    tensor_meta  = optional quan_tensor.extract output (one session).
    Returns each lens's independent read + a convergence summary. WITHIN-SESSION only.
    """
    if not realization:
        return {"error": "no realization data"}
    rw = realization
    sopG = [float(x) for x in rw.get("sopG", [])]
    sopC = [float(x) for x in rw.get("sopC", [])]
    fold = [float(x) for x in rw.get("fold", [])]
    cw = rw.get("cwAxis", [])

    lenses = {}

    # 1. LATENT PATHS — the THREE framework trajectories (P/Q/R), each an independent lens.
    paths = _latent_paths(sopG, sopC)
    reads = {k: _path_read(v) for k, v in paths.items()}
    # direction = majority vote across the three independent paths; shape = majority
    pdirs = [reads[k]["direction"] for k in ("Q", "P", "R")]
    pshapes = [reads[k]["shape"] for k in ("Q", "P", "R")]
    from collections import Counter
    dvote = Counter([d for d in pdirs if d != "FLAT"])
    svote = Counter(pshapes)
    latent_dir = dvote.most_common(1)[0][0] if dvote else "FLAT"
    latent_shape = svote.most_common(1)[0][0]
    lenses["latent_path"] = {
        "direction": latent_dir, "shape": latent_shape,
        "per_path": {k: {"dir": reads[k]["direction"], "shape": reads[k]["shape"],
                         "net": reads[k]["net_drift"]} for k in ("Q", "P", "R")},
        "dir_agreement": f"{dvote.most_common(1)[0][1] if dvote else 0}/3",
        "_paths": paths,  # kept for graphing
    }

    # 2. COHERENCE — fold zero-cross count
    zc = rw.get("totalZC", 0)
    lenses["coherence"] = {
        "zero_crosses": zc,
        "read": "FRACTURED" if zc >= 3 else "COHERENT",
    }

    # 3. TENSION — product tension accumulator (sum of fold); sign = net compression/release direction
    tens = sum(fold) if fold else 0.0
    lenses["tension"] = {
        "net_tension": round(tens, 1),
        "read": "RELEASING_UP" if tens > 0 else "RELEASING_DOWN" if tens < 0 else "NEUTRAL",
    }

    # 4. ENTROPY — normalized fold entropy: low = concentrated/pinned, high = dispersed
    en = rw.get("entropyNorm")
    lenses["entropy"] = {
        "norm_entropy": en,
        "read": ("PINNED" if (en is not None and en < 0.5) else
                 "DISPERSED" if en is not None else "n/a"),
    }

    # 5. TENSOR (optional)
    if tensor_meta and "geometry" in tensor_meta:
        lenses["tensor"] = {
            "geometry": tensor_meta.get("geometry"),
            "direction": tensor_meta.get("direction"),
        }

    # ---- CONVERGENCE (within-session): do the lenses agree on path-shape and direction? ----
    shape_votes = []
    if lenses["latent_path"]["shape"] == "CHOP": shape_votes.append("CHOP")
    elif lenses["latent_path"]["shape"] == "TREND": shape_votes.append("TREND")
    shape_votes.append("CHOP" if lenses["coherence"]["read"] == "FRACTURED" else "TREND")
    if "tensor" in lenses:
        shape_votes.append("CHOP" if lenses["tensor"]["geometry"] == "COMPRESSION" else "TREND")
    if lenses["entropy"]["read"] == "PINNED": shape_votes.append("CHOP")

    dir_votes = []
    dir_votes.append(lenses["latent_path"]["direction"])
    if lenses["tension"]["read"].endswith("UP"): dir_votes.append("UP")
    elif lenses["tension"]["read"].endswith("DOWN"): dir_votes.append("DOWN")
    if "tensor" in lenses: dir_votes.append(lenses["tensor"]["direction"])

    def _agree(votes):
        votes = [v for v in votes if v and v not in ("FLAT", "NEUTRAL")]
        if not votes: return ("none", 0, 0)
        from collections import Counter
        c = Counter(votes); top, n = c.most_common(1)[0]
        return (top, n, len(votes))

    shape_top, shape_n, shape_tot = _agree(shape_votes)
    dir_top, dir_n, dir_tot = _agree(dir_votes)

    convergence = {
        "shape": {"verdict": shape_top, "agree": f"{shape_n}/{shape_tot}",
                  "strength": round(shape_n / shape_tot, 2) if shape_tot else 0},
        "direction": {"verdict": dir_top, "agree": f"{dir_n}/{dir_tot}",
                      "strength": round(dir_n / dir_tot, 2) if dir_tot else 0},
        "note": ("Within-session convergence across independent Book lenses. Read fresh from THIS "
                 "session only — not fitted across sessions. High agreement = stronger within-session "
                 "evidence of the path; disagreement = honest uncertainty. Log forward, do not gate."),
    }

    return {"lenses": lenses, "convergence": convergence}
