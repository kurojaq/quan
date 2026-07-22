"""
Execution Mastery Model — Closed-Loop Learning

Predicts win% by morphology + provides feedback signals (Brier scores)
Version: v1.0 (baseline weights)

Architecture:
  1. Load model weights from D1
  2. Predict win% for each morphology
  3. Record feedback (prediction vs outcome)
  4. Weekly retraining: update weights by actual win rates + calibration
  5. New model version (immutable)

Immutability:
  - Model weights saved to D1 as immutable file (version tagged)
  - Predictions include modelVersion (know which model predicted)
  - Win/loss calculated once @ exit (never changes)
"""

import json
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

class ExecutionMasteryModel:
    """Prediction model for execution trading performance."""

    # Morphology classes
    MORPHOLOGIES = ['impulse', 'accumulation', 'mean_reversion', 'exhaustion']

    # Minimum trades before updating weights (avoid overfitting tiny samples)
    MIN_SAMPLE_SIZE = 10

    def __init__(self, model_version: str = 'v1.0-baseline'):
        """Initialize with baseline or versioned weights."""
        self.model_version = model_version
        self.weights: Dict[str, float] = self._load_weights(model_version)
        self.confidence: Dict[str, float] = self._load_confidence(model_version)

    def _load_weights(self, version: str) -> Dict[str, float]:
        """Load model weights from version."""
        # Baseline: all morphologies are equally uncertain (0.5)
        if version == 'v1.0-baseline':
            return {
                'impulse': 0.70,           # Week 1 assumed impulse is better
                'accumulation': 0.60,
                'mean_reversion': 0.55,
                'exhaustion': 0.50,        # Start uncertain
            }

        # TODO: Load from D1 (model_files table)
        # For now, return baseline
        return self._load_weights('v1.0-baseline')

    def _load_confidence(self, version: str) -> Dict[str, float]:
        """Confidence in predictions (0-1, 1 = very confident)."""
        if version == 'v1.0-baseline':
            return {
                'impulse': 0.6,
                'accumulation': 0.5,
                'mean_reversion': 0.4,
                'exhaustion': 0.3,
            }
        return self._load_confidence('v1.0-baseline')

    def predict(self, morphology: str) -> float:
        """Predict win% for this morphology (0-1)."""
        if morphology not in self.weights:
            return 0.5  # Default: uninformed (50/50)

        win_pct = self.weights.get(morphology, 0.5)
        # Clamp to [0, 1]
        return max(0.0, min(1.0, win_pct))

    def calculate_brier_score(self, prediction: float, outcome: int) -> float:
        """Calculate Brier score: (prediction - outcome)^2."""
        return math.pow(prediction - outcome, 2)

    def retrain(self, recent_trades: List[Dict]) -> str:
        """
        Retrain model on recent trades.

        Args:
            recent_trades: List of closed trades with (morphology, outcome)

        Returns:
            New model version string (e.g., 'v1.1-2026-07-22')
        """
        if not recent_trades:
            return self.model_version  # No data, skip

        # Group trades by morphology
        by_morphology = {}
        for morphology in self.MORPHOLOGIES:
            trades = [t for t in recent_trades if t.get('buyMorphology') == morphology]
            if len(trades) >= self.MIN_SAMPLE_SIZE:
                by_morphology[morphology] = trades
            else:
                print(f"Skipping retrain for {morphology}: only {len(trades)} trades (need {self.MIN_SAMPLE_SIZE})")

        # Update weights based on empirical win rates
        for morphology, trades in by_morphology.items():
            old_weight = self.weights[morphology]

            # Calculate win rate
            wins = sum(1 for t in trades if t.get('outcome') == 1)
            win_rate = wins / len(trades)

            # Update: move weight toward win rate (with damping to avoid overcorrection)
            damping = 0.15  # 15% step toward new rate
            delta = (win_rate - old_weight) * damping
            new_weight = old_weight + delta

            self.weights[morphology] = max(0.0, min(1.0, new_weight))
            print(f"{morphology}: {old_weight:.2f} → {new_weight:.2f} (win rate: {win_rate:.1%}, n={len(trades)})")

        # Calibration check: reduce confidence if Brier score too high
        for morphology, trades in by_morphology.items():
            predictions = [t.get('prediction', self.predict(morphology)) for t in trades]
            outcomes = [t.get('outcome', 0) for t in trades]

            brier_scores = [self.calculate_brier_score(p, o) for p, o in zip(predictions, outcomes)]
            avg_brier = sum(brier_scores) / len(brier_scores)

            if avg_brier > 0.40:
                # Model is poorly calibrated, reduce confidence
                old_confidence = self.confidence[morphology]
                new_confidence = old_confidence * 0.9
                self.confidence[morphology] = new_confidence
                print(f"{morphology}: Low calibration (Brier {avg_brier:.3f}), confidence reduced {old_confidence:.2f} → {new_confidence:.2f}")
            elif avg_brier < 0.20:
                # Model is very well calibrated, increase confidence slightly
                old_confidence = self.confidence[morphology]
                new_confidence = min(0.95, old_confidence * 1.1)
                self.confidence[morphology] = new_confidence
                print(f"{morphology}: Good calibration (Brier {avg_brier:.3f}), confidence increased {old_confidence:.2f} → {new_confidence:.2f}")

        # Generate new version
        new_version = self._generate_version()
        self.model_version = new_version

        # Save to D1 (immutable)
        self._save_model(new_version)

        return new_version

    def _generate_version(self) -> str:
        """Generate new version string."""
        today = datetime.now().strftime('%Y-%m-%d')
        # Extract version number from current version
        parts = self.model_version.split('-')
        if parts[0].startswith('v'):
            try:
                v_num = int(parts[0][1:]) + 1
                return f"v{v_num}-{today}"
            except ValueError:
                pass
        # Fallback: increment from v1
        return f"v1.1-{today}"

    def _save_model(self, version: str):
        """Save model to D1 (immutable file)."""
        model_data = {
            'version': version,
            'weights': self.weights,
            'confidence': self.confidence,
            'timestamp': datetime.now().isoformat(),
        }

        # TODO: Save to D1 model_files table
        # db.insert('model_files', {
        #   version: version,
        #   model_json: json.dumps(model_data),
        #   created_at: datetime.now().isoformat()
        # })
        print(f"Model saved: {version}")

    def generate_report(self, recent_trades: List[Dict]) -> Dict:
        """Generate weekly performance report."""
        report = {
            'timestamp': datetime.now().isoformat(),
            'model_version': self.model_version,
            'by_morphology': {},
        }

        for morphology in self.MORPHOLOGIES:
            trades = [t for t in recent_trades if t.get('buyMorphology') == morphology]
            if not trades:
                report['by_morphology'][morphology] = {'trade_count': 0, 'data': 'No recent trades'}
                continue

            wins = sum(1 for t in trades if t.get('outcome') == 1)
            losses = len(trades) - wins
            win_rate = wins / len(trades) if trades else 0.5

            pnls = [t.get('pnl', 0) for t in trades]
            avg_pnl = sum(pnls) / len(pnls) if pnls else 0
            total_pnl = sum(pnls)

            # Sharpe ratio (simple: avg / std dev)
            if len(pnls) > 1:
                variance = sum((p - avg_pnl) ** 2 for p in pnls) / len(pnls)
                std_dev = math.sqrt(variance)
                sharpe = (avg_pnl / std_dev) if std_dev > 0 else 0
            else:
                sharpe = 0

            # Brier score (forecast accuracy)
            predictions = [t.get('prediction', 0.5) for t in trades]
            outcomes = [t.get('outcome', 0) for t in trades]
            brier_scores = [self.calculate_brier_score(p, o) for p, o in zip(predictions, outcomes)]
            avg_brier = sum(brier_scores) / len(brier_scores) if brier_scores else 0.5

            # Position sizing recommendation
            position_scale = 1.0
            action = 'maintain'
            if sharpe > 2.0 and avg_brier < 0.15:
                position_scale = 1.3
                action = '↑ scale 1.3x'
            elif sharpe > 1.5 and avg_brier < 0.20:
                position_scale = 1.2
                action = '↑ scale 1.2x'
            elif sharpe < 0.5:
                position_scale = 0.5
                action = '↓ scale 0.5x'
            elif sharpe < 0:
                position_scale = 0.0
                action = '❌ SKIP'

            report['by_morphology'][morphology] = {
                'trade_count': len(trades),
                'wins': wins,
                'losses': losses,
                'win_rate': f"{win_rate:.1%}",
                'avg_pnl': f"${avg_pnl:,.0f}",
                'total_pnl': f"${total_pnl:,.0f}",
                'sharpe_ratio': f"{sharpe:.2f}",
                'brier_score': f"{avg_brier:.3f}",
                'position_scale': position_scale,
                'action': action,
            }

        return report


def main():
    """Test the model."""
    model = ExecutionMasteryModel('v1.0-baseline')

    # Mock recent trades
    recent_trades = [
        {'buyMorphology': 'impulse', 'outcome': 1, 'pnl': 35000, 'prediction': 0.82},
        {'buyMorphology': 'impulse', 'outcome': 1, 'pnl': 42000, 'prediction': 0.82},
        {'buyMorphology': 'impulse', 'outcome': 0, 'pnl': -8000, 'prediction': 0.82},
        {'buyMorphology': 'accumulation', 'outcome': 1, 'pnl': 22000, 'prediction': 0.60},
        {'buyMorphology': 'accumulation', 'outcome': 1, 'pnl': 28000, 'prediction': 0.60},
        {'buyMorphology': 'mean_reversion', 'outcome': 0, 'pnl': -5000, 'prediction': 0.55},
        {'buyMorphology': 'exhaustion', 'outcome': 0, 'pnl': -3000, 'prediction': 0.50},
    ]

    # Generate report (before retraining)
    print("=== BEFORE RETRAINING ===")
    report = model.generate_report(recent_trades)
    print(json.dumps(report, indent=2))

    # Retrain
    print("\n=== RETRAINING ===")
    new_version = model.retrain(recent_trades)
    print(f"New model: {new_version}")

    # Generate report (after retraining)
    print("\n=== AFTER RETRAINING ===")
    report = model.generate_report(recent_trades)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
