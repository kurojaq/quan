"""
quan_tensor_field.py — Tensor Surface integration layer (pure-Python, connects to the in-engine SOP fold).

Distinct from quan_tensor.py (which recalcs via LibreOffice/parser as an oracle). This version builds the
surface directly from quan_realization's fold so the whole stack is one connected pipeline, and is verified
against the Book's cached Tensor Surface values.

Book 'Tensor Surface': TensorSurface[pair r, x] = ABS(O[r]) * EXP(-(x-Q[r])^2), x = -50..+50 step 0.5.
  O: O2=0; O3=O2/L2; O[r>=4]=O[r-1]-L[r-1];  L = Product Curvature = J[r+1]-J[r], J = fold = SOPG*SOPC
  Q: Q2=F2; Q3=Q2+F2*0.1; Q[r>=4]=Q[r-1]+H[r-1]*0.1;  F = SOPG, H = SOPG/SOPC = F/G
Surface Velocity = TS[r+1]-TS[r] down pairs; Surface Jerk = Vel[r+1]-Vel[r].
"""
import numpy as np

X_MIN, X_MAX, X_STEP = -50.0, 50.0, 0.5
X_AXIS = np.round(np.arange(X_MIN, X_MAX + X_STEP / 2, X_STEP), 2)


def _sop_OQ(sopG, sopC):
    n = len(sopG)
    F = np.asarray(sopG, float); G = np.asarray(sopC, float); J = F * G
    L = np.zeros(n)
    for r in range(n - 1):
        L[r] = J[r + 1] - J[r]
    H = np.nan_to_num(np.where(G != 0, F / np.where(G == 0, np.nan, G), 0.0))
    O = np.zeros(n); O[0] = 0.0
    if n > 1:
        O[1] = (O[0] / L[0]) if L[0] != 0 else 0.0
    for r in range(2, n):
        O[r] = O[r - 1] - L[r - 1]
    Q = np.zeros(n); Q[0] = F[0]
    if n > 1:
        Q[1] = Q[0] + F[0] * 0.1
    for r in range(2, n):
        Q[r] = Q[r - 1] + H[r - 1] * 0.1
    return O, Q


def tensor_surface(sopG, sopC):
    O, Q = _sop_OQ(sopG, sopC)
    n = len(O); x = X_AXIS
    surface = np.zeros((n, x.size))
    for r in range(n):
        surface[r, :] = abs(O[r]) * np.exp(-np.power(x - Q[r], 2))
    velocity = np.zeros_like(surface)
    for r in range(n - 1):
        velocity[r, :] = surface[r + 1, :] - surface[r, :]
    jerk = np.zeros_like(surface)
    for r in range(n - 1):
        jerk[r, :] = velocity[r + 1, :] - velocity[r, :]
    ridge = surface.sum(axis=0)
    peak_x = float(x[int(np.argmax(ridge))]) if ridge.max() > 0 else 0.0
    return dict(x_axis=x.tolist(), surface=surface, velocity=velocity, jerk=jerk,
                O=O.tolist(), Q=Q.tolist(), ridge=ridge.tolist(), peak_offset=peak_x)
