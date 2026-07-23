/**
 * Doctrine Tab Enrichment
 *
 * Augments the existing Doctrine analysis with:
 * - Market morphology classification and interpretation
 * - Kalman filter confidence indicators on morphology probabilities
 * - Stochastic regime classification (TRENDING vs MEAN_REVERT)
 * - Tensor Greeks integration (condition number, principal Greeks)
 * - Engine contribution to structure scoring
 * - Executive summary with multi-engine signals
 *
 * ADDITIVE: Enhances existing doctrine output, doesn't replace.
 */

(function(global) {
  'use strict';

  const ENRICHMENT = global.__reportEnrichment;
  if (!ENRICHMENT) return;

  /* ========================================================================
     Market Morphology Interpretation for Doctrine
     ======================================================================== */

  function morphologyDoctrine(morphology) {
    /**
     * Translates market morphology classification into doctrine actions:
     * - IMPULSE → directional momentum plays (follow the trend)
     * - ACCUMULATION → structural accretion (watch accumulation levels)
     * - EXHAUSTION → reversal watch (prepare for structure inversion)
     * - MEAN_REVERSION → swing trades (revert to fair value)
     * - TRANSITION → neutral stance (watch for clarity)
     */
    if (!morphology || morphology.class === 'UNKNOWN') return null;

    const doctrine = {
      IMPULSE: {
        posture: 'MOMENTUM',
        stance: 'Follow momentum direction; scale into trending moves',
        playbook: [
          'Entry: Break above/below PDSL in direction of CDS signal',
          'Stop: Behind the last swing low/high (outside 3-bar range)',
          'Target: Next psychological level or Fibonacci extension',
          'Sizing: Base + 25% for trending regime bonus',
          'Exit: On-stop only or at 2:1 R:R, no reversal exceptions'
        ],
        caution: [
          'Gamma spikes near strikes → reduce position size',
          'Mean-reversion signals appearing → watch for exhaustion',
          'Kalman confidence < 60% → hold at base size only'
        ]
      },
      ACCUMULATION: {
        posture: 'STRUCTURAL',
        stance: 'Accumulation requires patience; scale into levels with low urgency',
        playbook: [
          'Entry: At tested support levels (PDSL floors) on low urgency',
          'Stop: Beneath structural support by 2 strikes',
          'Target: Next resistance (PDSL ceiling) or inventory exhaust',
          'Sizing: Base size; no momentum bonus (structure building is slow)',
          'Exit: On-stop or at 1.5:1 R:R (patient trade, lower reward)'
        ],
        caution: [
          'Watch for transaction/realization split (Layer 2 break) → exit immediately',
          'High kurtosis in DIT but low DR3 → dealers aren\'t following through',
          'Entropy rising → structure degrading into mean-reversion'
        ]
      },
      EXHAUSTION: {
        posture: 'REVERSAL_WATCH',
        stance: 'Expect inversion; stay neutral, watch for structure flip',
        playbook: [
          'Entry: NONE — observation mode only',
          'Setup: Watch for directional reversal in DR3S vs DIDS/DITS',
          'Trigger: Skew convergence reversal or breach-clock ZC in opposite direction',
          'Action: On confirmed reversal, enter small (1 contract) to test new direction',
          'Exit: Tight — at break of reversal structure if wrong'
        ],
        caution: [
          'Dealer positioning (ICF trend) may lag reversal → watch OI changes',
          'Gamma explosion risk at key strikes during inversion',
          'Ill-conditioned Greeks → reduce to micro sizes during flip'
        ]
      },
      MEAN_REVERSION: {
        posture: 'REVERSION',
        stance: 'Trade back to fair value; scale into extremes',
        playbook: [
          'Entry: When price deviates >1.5σ from parity mean',
          'Stop: At mean (parity center) if directional wrong',
          'Target: Mean price (parity center) or 50% of deviation',
          'Sizing: Base + 15% (mean reversion is high-probability)',
          'Exit: At mean on profit, or stop if parity quality <70%'
        ],
        caution: [
          'Check parity quality first — low parity → mean-reversion unreliable',
          'Regime trending → mean-reversion plays may fail (trend > reversion)',
          'Shannon entropy very high → reversion unclear which level'
        ]
      },
      TRANSITION: {
        posture: 'NEUTRAL',
        stance: 'Market in flux; size down, watch for structure clarity',
        playbook: [
          'Entry: NONE until morphology stabilizes',
          'Action: Observe; collect 3-5 more clock bars of data',
          'Setup: Watch which morphology crystallizes (impulse vs accum vs mean-revert)',
          'Re-evaluate: After ZC or major price swing, morphology may clear',
          'Size: 0 contracts — hold cash, don\'t force entries'
        ],
        caution: [
          'Avoid fighting unclear structure — false entries cost more than 0%',
          'Wait for Kalman filter confidence to rise >70%',
          'Check if regime just switched (Ornstein-Uhlenbeck transition) — wait for stability'
        ]
      }
    };

    return doctrine[morphology.class] || null;
  }

  /* ========================================================================
     Engine Signal Integration for Doctrine
     ======================================================================== */

  function engineSignalsForDoctrine(breakdown) {
    /**
     * Extracts actionable signals from active engines:
     * - Kalman filter: Confidence level on morphology classification
     * - Regime detector: TRENDING bonus vs MEAN_REVERT caution
     * - Tensor Greeks: Risk limits based on condition number
     */
    if (!breakdown || !breakdown.engines) return null;

    const signals = {
      kalmanConfidence: null,
      regimeClass: null,
      regimeImpact: '',
      tensorGeometry: null,
      tensorWarnings: [],
      overrideFlags: []
    };

    for (const engine of breakdown.engines) {
      if (engine.name.includes('Kalman')) {
        signals.kalmanConfidence = engine.confidence;
      } else if (engine.name.includes('Regime')) {
        signals.regimeClass = engine.regime;
        if (engine.regime === '↗ Trending') {
          signals.regimeImpact = 'Regime is TRENDING — momentum plays favored, reduce mean-reversion size';
        } else if (engine.regime === '↔ Mean-Reverting') {
          signals.regimeImpact = 'Regime is MEAN-REVERTING — reversion plays favored, avoid momentum chasing';
        }
      } else if (engine.name.includes('Tensor')) {
        signals.tensorGeometry = engine.geometry;
        if (engine.alerts && engine.alerts.length) {
          signals.tensorWarnings = engine.alerts;
          if (engine.geometry === 'DEGENERATE') {
            signals.overrideFlags.push('CRITICAL: Greeks degenerate — reduce position size by 50%');
          } else if (engine.geometry === 'STRESSED') {
            signals.overrideFlags.push('CAUTION: Greeks ill-conditioned — reduce position size by 30%');
          }
        }
      }
    }

    return signals;
  }

  /* ========================================================================
     Doctrine Executive Summary
     Synthesizes morphology + engines into one-liner action guidance
     ======================================================================== */

  function doctrineExecutiveSummary(morphology, engineSignals) {
    /**
     * One-line summary + action for traders:
     * Bridges morphology (market structure) + engine signals (confidence/regime/Greeks)
     */
    if (!morphology) return null;

    let summary = '';
    let confidence = morphology.confidence;
    let action = '';
    let sizeAdjustment = 0; // -50 to +50 scale

    // Base morphology posture
    if (morphology.class === 'IMPULSE') {
      summary = `Momentum phase (${Math.round(confidence * 100)}% confidence). Market trending ${morphology.signals[2] || '?'}.`;
      action = 'Follow trend; scale into momentum on PDSL touch.';
      sizeAdjustment = 20;
    } else if (morphology.class === 'ACCUMULATION') {
      summary = `Building structure (${Math.round(confidence * 100)}% confidence). Dealer accumulating position.`;
      action = 'Watch accumulation levels; low-urgency entries into tested support.';
      sizeAdjustment = 0;
    } else if (morphology.class === 'EXHAUSTION') {
      summary = `Exhaustion phase (${Math.round(confidence * 100)}% confidence). Structure inverting.`;
      action = 'NEUTRAL — observe reversal trigger, don\'t pre-guess direction.';
      sizeAdjustment = -50;
    } else if (morphology.class === 'MEAN_REVERSION') {
      summary = `Mean-reversion (${Math.round(confidence * 100)}% confidence). Price off-fair-value.`;
      action = 'Scale into extremes; revert to parity center.';
      sizeAdjustment = 15;
    } else {
      summary = `Market in transition (${Math.round(confidence * 100)}% confidence). Structure unclear.`;
      action = 'HOLD — wait for Kalman filter to converge and morphology to stabilize.';
      sizeAdjustment = -100; // 0 contracts
    }

    // Adjust for engine signals
    if (engineSignals) {
      if (engineSignals.kalmanConfidence !== null && engineSignals.kalmanConfidence < 50) {
        sizeAdjustment -= 15; // Low Kalman confidence → reduce size
        summary += ` [Kalman confidence low (${engineSignals.kalmanConfidence}%) — morphology may shift]`;
      }

      if (engineSignals.regimeImpact) {
        if (engineSignals.regimeClass === '↗ Trending' && morphology.class !== 'IMPULSE') {
          sizeAdjustment -= 20; // Regime trending but morphology isn't → wait for alignment
        }
        if (engineSignals.regimeClass === '↔ Mean-Reverting' && morphology.class === 'IMPULSE') {
          sizeAdjustment -= 20; // Regime reverting but morphology is impulse → conflict
        }
      }

      if (engineSignals.tensorWarnings.length) {
        sizeAdjustment -= (engineSignals.tensorGeometry === 'DEGENERATE' ? 30 : 15);
        summary += ` [Greeks: ${engineSignals.tensorWarnings[0]}]`;
      }

      if (engineSignals.overrideFlags.length) {
        action = `⚠ ${engineSignals.overrideFlags[0]} — Then: ${action}`;
      }
    }

    // Clamp size adjustment
    sizeAdjustment = Math.max(-100, Math.min(50, sizeAdjustment));

    return {
      summary: summary,
      action: action,
      sizeAdjustment: sizeAdjustment,
      baseSize: 1, // 1 contract
      adjustedSize: Math.max(0, 1 + (sizeAdjustment / 100))
    };
  }

  /* ========================================================================
     Enrich Doctrine Tab Output
     ======================================================================== */

  function enrichDoctrineBrief(brief) {
    /**
     * Augments the brief object with enrichment layers:
     * Adds morphology, engine signals, and doctrine recommendation.
     */
    if (!brief) return brief;

    brief.__enrichment = brief.__enrichment || {};

    // Morphology
    brief.__enrichment.morphology = ENRICHMENT.classifyMorphology(brief);

    // (Would need to hook in actual tensor Greeks / Kalman data from DB)
    // For now, structure is in place for integration

    brief.__enrichment.doctrineMorphology = morphologyDoctrine(brief.__enrichment.morphology);

    return brief;
  }

  /* ========================================================================
     Format Morphology Card for UI Display
     ======================================================================== */

  function formatMorphologyCard(morphology) {
    /**
     * Formats morphology as a visual card for the Doctrine tab
     */
    if (!morphology || morphology.class === 'UNKNOWN') return '';

    const badgeColors = {
      IMPULSE: '#6fa3ff',
      ACCUMULATION: '#5fd08a',
      EXHAUSTION: '#f5a623',
      MEAN_REVERSION: '#a78bfa',
      TRANSITION: '#8a877e'
    };

    const emoji = {
      IMPULSE: '📈',
      ACCUMULATION: '📦',
      EXHAUSTION: '📉',
      MEAN_REVERSION: '⟲',
      TRANSITION: '…'
    };

    const color = badgeColors[morphology.class] || '#8a877e';

    let html = `
      <div style="
        background: ${color}12;
        border: 1px solid ${color}40;
        border-radius: 8px;
        padding: 12px;
        margin: 8px 0;
        font-size: 11px;
      ">
        <div style="
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        ">
          <span style="font-size:16px">${emoji[morphology.class] || '?'}</span>
          <span style="
            font-weight: 600;
            font-size: 12px;
            color: ${color};
          ">${morphology.class}</span>
          <span style="
            color: #a9a39a;
            margin-left: auto;
            font-size: 10px;
          ">${Math.round(morphology.confidence * 100)}% confidence</span>
        </div>

        ${morphology.rationale ? `
          <div style="
            color: #c9c4b8;
            margin-bottom: 8px;
            line-height: 1.4;
          ">${morphology.rationale}</div>
        ` : ''}

        ${morphology.signals.length ? `
          <div style="
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
          ">
            ${morphology.signals.map(sig => `
              <span style="
                background: ${color}20;
                color: ${color};
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 9px;
              ">${sig}</span>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    return html;
  }

  /* ========================================================================
     Public API
     ======================================================================== */

  global.__doctineEnrichment = {
    morphologyDoctrine: morphologyDoctrine,
    engineSignals: engineSignalsForDoctrine,
    executiveSummary: doctrineExecutiveSummary,
    enrichBrief: enrichDoctrineBrief,
    formatCard: formatMorphologyCard
  };

})( typeof window !== 'undefined' ? window : global);
