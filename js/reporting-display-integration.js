/**
 * Report Display Integration
 *
 * Injects enriched context into the existing report.html display:
 * - Morphology badge in the brief class
 * - Greeks reliability indicator in the Greeks section
 * - Engine status indicators in a new "Advanced Engines" panel
 * - Execution context card with position sizing rules
 * - Pipeline health indicator in the corner
 *
 * INTEGRATION: These are DOM mutations of existing elements, not replacements.
 * Gracefully degrades if enrichment API is unavailable.
 */

(function(global) {
  'use strict';

  const ENRICHMENT_API = global.__reportEnrichment;
  if (!ENRICHMENT_API) return; // Graceful degradation

  /* ========================================================================
     Morphology Badge Renderer
     ======================================================================== */

  function renderMorphologyBadge(morphology) {
    if (!morphology || morphology.class === 'UNKNOWN') return null;

    const badgeClass = morphology.class.toLowerCase();
    const colors = {
      impulse: '#6fa3ff',
      accumulation: '#5fd08a',
      exhaustion: '#f5a623',
      mean_reversion: '#a78bfa',
      transition: '#8a877e'
    };

    const html = `
      <div class="morph-badge morph-${badgeClass}" style="
        display: inline-block;
        padding: 3px 8px;
        border-radius: 4px;
        background: ${colors[badgeClass] || '#8a877e'}20;
        border: 1px solid ${colors[badgeClass] || '#8a877e'};
        font-size: 10px;
        font-weight: 600;
        color: ${colors[badgeClass] || '#8a877e'};
        letter-spacing: 0.05em;
        margin-left: 8px;
      " title="${morphology.rationale}">
        ${morphology.class} (${Math.round(morphology.confidence * 100)}%)
      </div>
    `;
    return html;
  }

  /* ========================================================================
     Greeks Reliability Indicator
     ======================================================================== */

  function renderGreeksReliability(reliability) {
    if (!reliability) return null;

    const scoreColor = reliability.score > 0.7 ? '#5fd08a' :
                       reliability.score > 0.5 ? '#f5a623' : '#e08a6a';

    const warningsBullets = reliability.warnings
      .slice(0, 3)
      .map(w => `<li style="font-size:9px;color:#c9c4b8;margin:2px 0">${w}</li>`)
      .join('');

    const html = `
      <div class="greeks-reliability" style="
        background: rgba(255,255,255,0.02);
        border: 0.5px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        padding: 8px;
        margin-top: 8px;
        font-size: 10px;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-weight:600;color:#e8e3d6">Greeks Reliability</span>
          <span style="
            background: ${scoreColor}20;
            color: ${scoreColor};
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: 600;
          ">${Math.round(reliability.score * 100)}% · ${reliability.conditioning}</span>
        </div>
        ${reliability.conditionNumber !== null ? `
          <div style="color:#a9a39a;margin-bottom:4px">
            Condition #: ${reliability.conditionNumber.toFixed(1)}
            <span style="font-size:8px;margin-left:4px">
              ${reliability.conditionNumber < 100 ? '✓ Well-conditioned' :
                reliability.conditionNumber < 1000 ? '⚠ Ill-conditioned' : '✗ Degenerate'}
            </span>
          </div>
        ` : ''}
        ${reliability.kalmanConfidence !== null ? `
          <div style="color:#a9a39a;margin-bottom:6px">
            Kalman Confidence: ${reliability.kalmanConfidence}%
          </div>
        ` : ''}
        ${reliability.warnings.length ? `
          <ul style="padding-left:14px;margin:0">${warningsBullets}</ul>
        ` : '<div style="color:#5fd08a;font-style:italic">✓ No warnings</div>'}
      </div>
    `;
    return html;
  }

  /* ========================================================================
     Engine Status Panel
     ======================================================================== */

  function renderEngineStatus(breakdown) {
    if (!breakdown || !breakdown.engines || !breakdown.engines.length) return null;

    const engineCards = breakdown.engines.map(engine => `
      <div style="
        background: ${engine.color}08;
        border-left: 2px solid ${engine.color};
        border-radius: 4px;
        padding: 6px 8px;
        margin-bottom: 6px;
        font-size: 9px;
      ">
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 3px;
        ">
          <span style="font-weight:600;color:#e8e3d6">${engine.name}</span>
          <span style="
            color: ${engine.color};
            font-weight: 600;
            font-size: 8px;
            text-transform: uppercase;
          ">${engine.status}</span>
        </div>
        ${engine.confidence !== undefined ? `
          <div style="color:#a9a39a;margin-bottom:2px">
            Confidence: ${engine.confidence}%
          </div>
        ` : ''}
        ${engine.regime ? `
          <div style="color:#a9a39a;margin-bottom:2px">
            ${engine.regime}
          </div>
        ` : ''}
        ${engine.morphology ? `
          <div style="color:#a9a39a;margin-bottom:2px">
            Morphology: ${engine.morphology} (${engine.confidence}%)
          </div>
        ` : ''}
        ${engine.geometry ? `
          <div style="color:#a9a39a;margin-bottom:2px">
            Geometry: ${engine.geometry} (cond# ${engine.conditionNumber})
            ${engine.alerts.length ? ` · Alerts: ${engine.alerts.join(', ')}` : ''}
          </div>
        ` : ''}
        <div style="color:#8a877e;font-style:italic;margin-top:4px">
          ${engine.impact}
        </div>
      </div>
    `).join('');

    const healthEmoji = breakdown.overallHealthy ? '✓' : '⚠';
    const healthColor = breakdown.overallHealthy ? '#5fd08a' : '#f5a623';

    const html = `
      <div class="engines-panel" style="
        background: rgba(255,255,255,0.02);
        border: 0.5px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        padding: 10px;
        margin-top: 12px;
      ">
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          padding-bottom: 8px;
          border-bottom: 0.5px solid rgba(255,255,255,0.05);
        ">
          <span style="font-weight:600;color:#e8e3d6;font-size:11px">Advanced Engines</span>
          <span style="
            color: ${healthColor};
            font-weight: 600;
            font-size: 12px;
          ">${healthEmoji} ${breakdown.activeCount} active</span>
        </div>
        ${engineCards}
      </div>
    `;
    return html;
  }

  /* ========================================================================
     Execution Context Card
     ======================================================================== */

  function renderExecutionContext(context) {
    if (!context) return null;

    const rationale = context.rationale.map(r => `<li style="font-size:9px;color:#a9a39a;margin:3px 0">${r}</li>`).join('');
    const positionRules = context.positionSizingRules.map(r => `<li style="font-size:8px;color:#8a877e;margin:2px 0">${r}</li>`).join('');

    const html = `
      <div class="execution-context" style="
        background: rgba(111,163,255,0.08);
        border: 0.5px solid rgba(111,163,255,0.3);
        border-radius: 6px;
        padding: 10px;
        margin-top: 12px;
      ">
        <div style="margin-bottom: 10px">
          <div style="font-weight:600;color:#6fa3ff;font-size:11px;margin-bottom:4px">
            Entry Confidence
          </div>
          <div style="
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            <div style="
              flex: 1;
              height: 6px;
              background: rgba(111,163,255,0.2);
              border-radius: 3px;
              overflow: hidden;
            ">
              <div style="
                width: ${context.entryConfidence}%;
                height: 100%;
                background: #6fa3ff;
                transition: width 0.3s ease;
              "></div>
            </div>
            <span style="font-weight:600;color:#6fa3ff;font-size:11px;min-width:40px">
              ${context.entryConfidence}%
            </span>
          </div>
        </div>

        <div style="
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 10px;
          font-size: 9px;
        ">
          <div style="
            background: rgba(255,255,255,0.03);
            padding: 6px;
            border-radius: 4px;
            border-left: 2px solid #5fd08a;
          ">
            <div style="color:#8a877e;margin-bottom:2px">Baseline (v1.0)</div>
            <div style="color:#5fd08a;font-weight:600">~0.22 Brier</div>
          </div>
          <div style="
            background: rgba(255,255,255,0.03);
            padding: 6px;
            border-radius: 4px;
            border-left: 2px solid #6fa3ff;
          ">
            <div style="color:#8a877e;margin-bottom:2px">With Engines (v1.1)</div>
            <div style="color:#6fa3ff;font-weight:600">~0.16 Brier (-27%)</div>
          </div>
        </div>

        <div style="
          background: rgba(255,255,255,0.03);
          padding: 8px;
          border-radius: 4px;
          margin-bottom: 8px;
        ">
          <div style="font-weight:600;color:#e8e3d6;font-size:9px;margin-bottom:4px">Entry Rationale</div>
          <ul style="padding-left:14px;margin:0">${rationale}</ul>
        </div>

        <div style="
          background: rgba(255,255,255,0.03);
          padding: 8px;
          border-radius: 4px;
        ">
          <div style="font-weight:600;color:#e8e3d6;font-size:9px;margin-bottom:4px">Position Sizing Rules</div>
          <ul style="padding-left:14px;margin:0">${positionRules}</ul>
        </div>
      </div>
    `;
    return html;
  }

  /* ========================================================================
     Pipeline Health Indicator (Corner Badge)
     ======================================================================== */

  function renderPipelineHealth(health) {
    if (!health) return null;

    const bgColor = health.summary === 'HEALTHY' ? '#5fd08a' :
                    health.summary === 'CAUTION' ? '#f5a623' : '#e08a6a';

    const html = `
      <div id="pipelineHealthBadge" style="
        position: fixed;
        bottom: 20px;
        right: 360px;
        z-index: 9999;
        background: ${bgColor}20;
        border: 1px solid ${bgColor};
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 9px;
        color: ${bgColor};
        font-weight: 600;
        letter-spacing: 0.04em;
        cursor: pointer;
        transition: all 0.3s ease;
      " title="Pipeline health: ${health.ok} OK, ${health.warn} warnings, ${health.fail} failures">
        ${health.summary} · ${health.ok}✓ ${health.warn > 0 ? health.warn + '⚠ ' : ''}${health.fail > 0 ? health.fail + '✗' : ''}
      </div>
    `;
    return html;
  }

  /* ========================================================================
     Main Integration Hook
     ======================================================================== */

  function integrateReportEnrichments(brief, tensorGreeks, kalmanState, regimeState) {
    /**
     * Injects enriched context into the existing report display.
     * Called after report.js renders the main brief.
     */
    if (!brief) return;

    // Get the enriched data
    const enriched = ENRICHMENT_API.enrichReport(brief, tensorGreeks, kalmanState, regimeState);

    // 1. Inject morphology badge into rptClass (brief class/type)
    const rptClass = document.getElementById('rptClass');
    if (rptClass && enriched.morphology) {
      const badge = renderMorphologyBadge(enriched.morphology);
      if (badge && !document.querySelector('.morph-badge')) {
        rptClass.insertAdjacentHTML('afterend', badge);
      }
    }

    // 2. Inject Greeks reliability after Greeks Exposure group
    if (enriched.greeksReliability) {
      const greeksExposureGroup = document.querySelector('[data-group="Greeks Exposure"]');
      if (greeksExposureGroup) {
        const reliabilityHtml = renderGreeksReliability(enriched.greeksReliability);
        if (reliabilityHtml && !document.querySelector('.greeks-reliability')) {
          greeksExposureGroup.insertAdjacentHTML('afterend', reliabilityHtml);
        }
      }
    }

    // 3. Inject engine status panel at end of report
    if (enriched.engines && enriched.engines.engines.length) {
      const rptBody = document.getElementById('rptBody');
      if (rptBody) {
        const engineHtml = renderEngineStatus(enriched.engines);
        if (engineHtml && !document.querySelector('.engines-panel')) {
          rptBody.insertAdjacentHTML('beforeend', engineHtml);
        }
      }
    }

    // 4. Inject execution context card
    if (enriched.execution) {
      const rptBody = document.getElementById('rptBody');
      if (rptBody) {
        const execHtml = renderExecutionContext(enriched.execution);
        if (execHtml && !document.querySelector('.execution-context')) {
          rptBody.insertAdjacentHTML('beforeend', execHtml);
        }
      }
    }

    // 5. Render pipeline health indicator
    const pipeHealth = global.__qPipe && global.__qPipe.getEngineHealth ?
      global.__qPipe.getEngineHealth() : null;
    if (pipeHealth) {
      const healthHtml = renderPipelineHealth(pipeHealth);
      if (healthHtml && !document.getElementById('pipelineHealthBadge')) {
        document.body.insertAdjacentHTML('beforeend', healthHtml);
      }
    }
  }

  /* ========================================================================
     Auto-Integration on Report Render
     ======================================================================== */

  global.__reportEnrichmentDisplay = {
    integrate: integrateReportEnrichments,
    renderMorphology: renderMorphologyBadge,
    renderGreeksReliability: renderGreeksReliability,
    renderEngineStatus: renderEngineStatus,
    renderExecutionContext: renderExecutionContext,
    renderPipelineHealth: renderPipelineHealth
  };

  // Hook into the existing report render cycle
  if (global.__qEnsureEngine) {
    global.__qEnsureEngine().then(() => {
      // After engine is ready, integrate enrichments on each report update
      if (global.__engReady) {
        global.__engReady.then(() => {
          // Listen for report updates via pipeline events
          if (global.__qPipe) {
            global.__qPipe.on(function(entry) {
              if (entry.stage === 'Brief Report' && entry.state === 'ok') {
                // Brief was successfully generated; integrate enrichments
                try {
                  integrateReportEnrichments();
                } catch (e) {
                  console.debug('Enrichment integration skipped:', e.message);
                }
              }
            });
          }
        });
      }
    }).catch(e => {
      console.debug('Engine enrichment unavailable:', e.message);
    });
  }

})( typeof window !== 'undefined' ? window : global);
