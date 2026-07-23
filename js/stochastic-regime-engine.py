"""
Stochastic Regime Engine
Detects vol mean-reversion regimes via Ornstein-Uhlenbeck (OU) process fitting.

Fits: σ(t) = θ_0 + θ_1*σ(t-1) + ε(t)
Extracts: κ (mean-reversion speed), σ̄ (long-run mean), η (vol-of-vol)
Classifies: TRENDING (slow mean-revert), MEAN_REVERT (fast), NEUTRAL
"""

import numpy as np
from typing import Dict, List, Tuple
from collections import deque


class StochasticRegimeEngine:
    """
    Ornstein-Uhlenbeck regime detector.

    OU process: dσ(t) = κ(σ̄ - σ(t))dt + η*dW(t)
    - κ = mean reversion speed (1/days)
    - σ̄ = long-run vol mean
    - η = vol-of-vol

    Discrete: σ(t) = θ_0 + θ_1*σ(t-1) + ε(t)
    Where: κ = -ln(θ_1), σ̄ = θ_0 / (1 - θ_1), η = std(ε)
    """

    def __init__(self, window_size: int = 120):
        """
        Initialize regime engine.

        Args:
            window_size: Number of vol observations for fitting (default: 120 = 2 hours @ 1-min cadence)
        """
        self.window_size = window_size
        self.vol_history = deque(maxlen=window_size)

        # Current estimates
        self.kappa = 0.03  # Mean reversion speed
        self.sigma_bar = 0.20  # Long-run vol mean
        self.eta = 0.05  # Vol-of-vol
        self.regime = 'NEUTRAL'
        self.regime_confidence = 0.5

        # AR(1) parameters
        self.theta_0 = 0.0
        self.theta_1 = 0.97  # Persistence

        # Fit statistics
        self.r_squared = 0.0
        self.residual_stddev = 0.0

    def add_observation(self, vol: float) -> None:
        """Add a vol observation to the history."""
        if vol > 0:  # Only add positive vols
            self.vol_history.append(vol)

    def fit_ou_process(self) -> Dict:
        """
        Fit OU process to recent vol history using AR(1) regression.

        Returns:
            Dictionary with fitted parameters
        """
        if len(self.vol_history) < 10:
            return {'status': 'insufficient_data', 'data_points': len(self.vol_history)}

        vol_array = np.array(list(self.vol_history))

        # AR(1) regression: σ(t) = θ_0 + θ_1*σ(t-1) + ε(t)
        y = vol_array[1:]  # σ(t)
        X = vol_array[:-1]  # σ(t-1)

        # Add intercept
        X_with_intercept = np.column_stack([np.ones_like(X), X])

        try:
            # Solve via normal equations: (X^T X)^-1 X^T y
            XTX = X_with_intercept.T @ X_with_intercept
            XTy = X_with_intercept.T @ y
            coeffs = np.linalg.solve(XTX, XTy)

            self.theta_0 = coeffs[0]
            self.theta_1 = coeffs[1]

            # Compute residuals
            y_pred = X_with_intercept @ coeffs
            residuals = y - y_pred
            self.residual_stddev = float(np.std(residuals))

            # R-squared
            ss_res = np.sum(residuals ** 2)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            self.r_squared = float(1 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0

            # Extract OU parameters
            if abs(self.theta_1) < 1.0:
                # κ = -ln(θ_1) (mean reversion speed)
                self.kappa = -np.log(self.theta_1)

                # σ̄ = θ_0 / (1 - θ_1) (long-run mean)
                if abs(1 - self.theta_1) > 1e-6:
                    self.sigma_bar = self.theta_0 / (1 - self.theta_1)
                else:
                    self.sigma_bar = np.mean(vol_array)
            else:
                # Non-stationary (unit root)
                self.kappa = 0.0
                self.sigma_bar = np.mean(vol_array)

            # η = residual standard deviation (vol-of-vol)
            self.eta = self.residual_stddev

            # Classify regime
            self._classify_regime()

            return {
                'status': 'fitted',
                'kappa': float(self.kappa),
                'sigma_bar': float(self.sigma_bar),
                'eta': float(self.eta),
                'theta_0': float(self.theta_0),
                'theta_1': float(self.theta_1),
                'r_squared': float(self.r_squared),
                'residual_stddev': float(self.residual_stddev),
                'regime': self.regime,
                'regime_confidence': float(self.regime_confidence),
            }

        except np.linalg.LinAlgError:
            return {'status': 'fit_error', 'data_points': len(self.vol_history)}

    def _classify_regime(self) -> None:
        """Classify regime based on κ (mean reversion speed)."""
        if self.kappa > 0.05:
            # Fast mean reversion → vol clustering → good for mean-reversion strategies
            self.regime = 'MEAN_REVERT'
            self.regime_confidence = min(0.95, 0.5 + self.kappa)  # Higher κ = higher confidence
        elif self.kappa < 0.02:
            # Slow mean reversion → momentum dominates → trending regime
            self.regime = 'TRENDING'
            self.regime_confidence = min(0.95, 0.5 + (0.02 - self.kappa) / 0.02)
        else:
            # Intermediate
            self.regime = 'NEUTRAL'
            self.regime_confidence = 0.5 + abs(0.035 - self.kappa) / 0.015  # Peaks at kappa=0.035

    def get_current_regime(self) -> Dict:
        """Get current regime classification."""
        return {
            'regime': self.regime,
            'regime_confidence': float(self.regime_confidence),
            'kappa': float(self.kappa),
            'sigma_bar': float(self.sigma_bar),
            'eta': float(self.eta),
            'theta_1': float(self.theta_1),
            'persistence': float(self.theta_1),  # AR coefficient
            'mean_reversion_speed': float(self.kappa),
            'vol_of_vol': float(self.eta),
            'fit_quality': float(self.r_squared),
        }

    def get_diagnostics(self) -> Dict:
        """Get regime detection diagnostics."""
        return {
            'window_size': self.window_size,
            'data_points': len(self.vol_history),
            'mean_vol': float(np.mean(list(self.vol_history))) if self.vol_history else 0.0,
            'min_vol': float(np.min(list(self.vol_history))) if self.vol_history else 0.0,
            'max_vol': float(np.max(list(self.vol_history))) if self.vol_history else 0.0,
            'vol_volatility': float(np.std(list(self.vol_history))) if self.vol_history else 0.0,
            'r_squared': float(self.r_squared),
            'residual_stddev': float(self.residual_stddev),
            'kappa_interpretation': self._interpret_kappa(),
        }

    def _interpret_kappa(self) -> str:
        """English interpretation of κ value."""
        if self.kappa > 0.1:
            return f'Very fast mean reversion ({self.kappa:.3f}/day)'
        elif self.kappa > 0.05:
            return f'Fast mean reversion ({self.kappa:.3f}/day)'
        elif self.kappa > 0.02:
            return f'Moderate mean reversion ({self.kappa:.3f}/day)'
        elif self.kappa > 0.01:
            return f'Slow mean reversion ({self.kappa:.3f}/day)'
        else:
            return f'Very slow / trending ({self.kappa:.3f}/day)'


# Global instance
_global_engine = None


def initialize_engine(window_size: int = 120) -> None:
    """Initialize the global regime engine."""
    global _global_engine
    _global_engine = StochasticRegimeEngine(window_size)


def add_vol_observation(vol: float) -> None:
    """Add a volatility observation."""
    global _global_engine
    if _global_engine is None:
        initialize_engine()
    _global_engine.add_observation(vol)


def detect_regime() -> Dict:
    """
    Detect current regime.

    1. Fit OU process to vol history
    2. Classify as TRENDING / MEAN_REVERT / NEUTRAL
    3. Return regime + confidence

    Returns:
        Dictionary with regime classification and parameters
    """
    global _global_engine
    if _global_engine is None:
        initialize_engine()

    fit_result = _global_engine.fit_ou_process()

    if fit_result.get('status') != 'fitted':
        return {
            'regime': 'INSUFFICIENT_DATA',
            'regime_confidence': 0.0,
            'data_points': fit_result.get('data_points', 0),
        }

    return _global_engine.get_current_regime()


def get_regime_diagnostics() -> Dict:
    """Get detailed diagnostics for regime detection."""
    global _global_engine
    if _global_engine is None:
        initialize_engine()

    return {
        'regime': _global_engine.get_current_regime(),
        'diagnostics': _global_engine.get_diagnostics(),
    }
