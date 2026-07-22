# Agentic SB2: Charting Systems Research — Summary

**Date:** 2026-07-22  
**Status:** ✅ Complete  
**Phase:** Design (Week 2) → Implementation Ready (Week 3)

---

## Overview

Completed comprehensive analysis of Apache ECharts (5.x) and Grafana charting architectures to design a **lightweight, real-time charting engine for Qu'an terminal**.

### Deliverables

| Document | Lines | Purpose | Commit |
|----------|-------|---------|--------|
| `wiki/charting/echarts-architecture-analysis.md` | 803 | Deep-dive into ECharts plugin system, patterns, chart types | `7549b20` |
| `wiki/charting/charting-engine-framework.md` | 690 | Qu'an charting engine design (specs, roadmap, API) | `ced4bc7` |

---

## Key Findings

### ECharts Architecture (Apache Licensed)

**Core (125 KB):**
- Plugin system: `use([renderer, chart, component])`
- Model-View separation (6-file per chart type)
- Diff-based updates (O(n) not O(n²))
- Staged processors (Preprocess → Coordinate → Visual → Render → Animate)
- Coordinate abstraction (Cartesian2D, Polar, Geo, Calendar)
- Two-mode rendering (normal elements vs large canvas batch)

**25+ Chart Types:**
- Financial: candlestick, boxplot
- Time series: line, bar, scatter
- Distribution: heatmap, histogram
- Network: graph, sankey, chord
- Hierarchical: tree, treemap, sunburst

**Lessons for Qu'an:**
- ✅ Adopt plugin system (minimal core, tree-shakeable)
- ✅ Adopt model-view (decouple logic from rendering)
- ✅ Adopt diff updates (streaming data support)
- 🔄 Adapt processor pipeline (Pyodide integration)
- ❌ Skip theming, locale, mobile touch

### Grafana Real-Time Architecture

**Key Insight:** Uses **uPlot** (lightweight time-series library, not ECharts)

**Why uPlot?**
- Minimal size (fits in edge compute)
- Real-time streaming optimized
- Canvas-first (batch rendering for 1000s of points)
- WebSocket subscriptions (live data)

**Applied Patterns:**
- Incremental append (not batch replace)
- Circular buffers (memory efficient)
- Throttled renders (16.6ms per frame)
- Two-render-mode (normal vs large)

---

## Qu'an Charting Engine Design

### Specs

| Spec | Value |
|------|-------|
| Core size | ~40 KB (vs 125 KB echarts) |
| Full minified | ~200 KB (vs 1 MB echarts) |
| Gzipped | ~70 KB |
| Performance | 60 FPS with 10K ticks |
| Update latency | <50ms (Tick Engine → canvas) |

### Architecture

```
Vue 3 Components (ChartTab, BookmapTab, etc.)
  ↓
useChart(type, options) API
  ↓
Core Rendering Engine (TypeScript)
  - Plugin system (use pattern)
  - Model-View per chart type
  ↓
Processor Pipeline
  - Preprocess (validate)
  - Coordinate (layout)
  - Visual (colors from Greeks)
  - Render (canvas)
  - Animate (transitions)
  ↓
Canvas Renderer
  - Batch rendering for perf
  - Element mapping (for click/hover)
  ↓
SeriesData (efficient storage)
  - Typed arrays
  - Diff algorithm (O(n) updates)
  - Graphics element mapping
  ↓
Coordinate Systems
  - Cartesian2D (price vs time/strike)
  - Polar (Greeks pentagon)
  - Custom (Bookmap 2D)
```

### Real-Time Integration

```
Tick Engine (WebSocket)
  ↓ tick {timestamp, last, bid, ask, size, ...}
  ↓
ChartTab.vue (subscribed)
  ↓ chart.appendData({x: tick.timestamp, y: tick.last})
  ↓
SeriesData.diff()
  ↓ (detects new tick, updated only)
  ↓
Render Pipeline
  ↓ (layout → visual → canvas)
  ↓ (60 FPS batch)
  ↓
Visual Output (~50ms latency end-to-end)
```

### Greeks Integration (Pyodide → Visuals)

```
Pyodide Worker
  ↓ computeGreeks({spot, strikes, iv, dte})
  ↓ returns [{strike, delta, gamma, vega, theta}, ...]
  ↓
Heatmap Chart
  ↓ color = delta (green/red intensity)
  ↓ size = |gamma| (convexity)
  ↓ opacity = theta decay
  ↓
Canvas Render
```

### MVP Charts (Weeks 3-4)

| Chart | Size | Data | Purpose |
|-------|------|------|---------|
| **Line** | 15 KB | (time, price) | Price history |
| **Candlestick** | 18 KB | (time, O, H, L, C) | OHLC bars |
| **Scatter** | 10 KB | (strike, IV, vol) | IV bubbles |
| **Heatmap** | 12 KB | (strike, delta) | Greeks surface |

**Subtotal:** ~144 KB

### Phase 2 Charts (Weeks 5-6)

| Chart | Size | Data | Purpose |
|-------|------|------|---------|
| **Bookmap** | 25 KB | (price, volume, time) | 2D order book heat |
| **Gauge** | 6 KB | (single value) | IV percentile |
| **Radar** | 10 KB | (Greeks) | Greeks pentagon |
| **Markup** | 8 KB | (annotations) | Time State bands |

**Subtotal:** ~229 KB (final)

### Implementation Timeline

| Week | Deliverable | Size |
|------|-------------|------|
| **3** | Core + Line, Candlestick, Axis, Grid | 88 KB |
| **4** | Scatter, Heatmap, Legend, Tooltip | 182 KB |
| **5** | Bookmap (custom), Animation polish | 215 KB |
| **6** | SVG export, performance tuning, docs | 229 KB |

---

## API Design

### Vue 3 Composable

```typescript
const { setOption, getInstance, updateData, dispose } = useChart('line', {
  responsive: true,
  theme: 'dark'
});

// Initial setup
setOption({
  xAxis: { type: 'time' },
  yAxis: { type: 'value' },
  series: [{ type: 'line', data: [[timestamp, price], ...] }]
});

// Real-time update
updateData('line-series-0', {
  append: [[newTimestamp, newPrice]]
});

// Events
getInstance().on('click', (params) => {
  execute({strike: params.value[0], qty: params.value[1]});
});
```

---

## Key Design Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| **Core library** | Build proprietary | ECharts too heavy (1 MB); need Tick Engine integration |
| **Rendering** | Canvas-first | Performance for 10K+ ticks; 60 FPS requirement |
| **Data model** | Streaming append | Live ticks, not batch uploads |
| **Animation** | Selective | Only state transitions, skip decorative |
| **Theming** | CSS variables | Static per session, simpler than ECharts theme system |
| **Charts included** | 6 MVP + 3 Phase 2 | Focus on quantitative, exclude geo/calendar |
| **Interaction** | Click-to-execute | Trading-specific, not generic hover/select |
| **Export** | PNG only | Screenshot, not full export suite |

---

## Performance Strategy

### Two-Mode Rendering

```typescript
if (data.length > 600) {
  // Large mode: batch canvas
  // - 1000s of points at 60 FPS
  // - No hover (group-level)
  // - Lower memory
} else {
  // Normal mode: SVG elements
  // - Smooth hover, click
  // - Easy animations
  // - Better debugging
}
```

### Optimization Techniques

1. **Diff-based updates** — O(n) instead of O(n²)
2. **Circular buffers** — Keep 10K ticks max
3. **Throttled renders** — 16.6ms per frame
4. **Canvas batching** — One call per 100 items
5. **Lazy layout** — Calculate only when visible
6. **Memoized visuals** — Cache color/size

---

## Integration Checklist (Week 3 Kickoff)

- [ ] Wire Tick Engine WebSocket (data feed)
- [ ] Export Pyodide Greeks (visual mapping)
- [ ] Bootstrap Vue 3 component
- [ ] Implement core + plugin system
- [ ] Port line + candlestick from ECharts
- [ ] Test diff updates with real ticks
- [ ] Benchmark 60 FPS target
- [ ] Document API (composable)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Performance under load** | Two-mode rendering, diff updates, circular buffers |
| **Real-time latency** | Frame throttling, batch canvas, avoid layout thrashing |
| **Browser compatibility** | Canvas + SVG fallback |
| **Memory bloat** | Circular buffer (10K max), lazy layout |
| **Code bloat** | Plugin system (tree-shake unused) |

---

## Research Sources

**Agentic SB2 Folder Structure:**
```
Quan Brain One/raw/Agentic SB2/
├── echarts-master/           [Apache ECharts v5.x source]
│   ├── src/
│   │   ├── chart/            [25+ chart types]
│   │   ├── component/        [axis, tooltip, legend, etc.]
│   │   ├── core/             [125 KB engine]
│   │   ├── renderer/         [canvas, svg]
│   │   ├── data/             [SeriesData, diff]
│   │   └── coord/            [coordinate systems]
│   └── ...
└── grafana-main/             [Grafana open source]
    ├── apps/
    │   ├── live/             [real-time streaming]
    │   ├── dashboard/        [panel system]
    │   └── plugins/          [plugin SDK]
    └── ...
```

**Key Files Reviewed:**
- `echarts-master/src/echarts.ts` (125 KB core entry)
- `echarts-master/src/chart/candlestick/` (6-file pattern)
- `echarts-master/src/core/Scheduler.ts` (task orchestration)
- `grafana-main/package.json` (discovered uPlot dependency)
- `grafana-main/AGENTS.md` (architecture guide)

---

## Next Steps

### Week 3: Core Implementation

1. **Core engine** (40 KB)
   - init() + plugin system
   - Scheduler (task pipeline)
   - Event dispatch
   - Options management

2. **Data layer** (15 KB)
   - SeriesData class
   - Diff algorithm
   - Graphics element mapping

3. **Renderer** (20 KB)
   - Canvas backend
   - Batch rendering
   - Element tracking

4. **Charts** (33 KB)
   - Line (15 KB, adapted from ECharts)
   - Candlestick (18 KB, adapted from ECharts)

5. **Components** (26 KB)
   - Axis + Grid (18 KB)
   - Tooltip (8 KB)

6. **Coordinates** (10 KB)
   - Cartesian2D with scales

**Total Week 3:** ~144 KB (minified ~45 KB)

### Week 4-6: Expansion + Polish

- Week 4: Scatter, Heatmap, Legend (182 KB cumulative)
- Week 5: Bookmap custom chart (215 KB)
- Week 6: SVG export, perf tuning, docs (229 KB final)

---

## Conclusion

ECharts + Grafana research provided battle-tested patterns for building Qu'an's charting engine. Key decisions:

1. **Plugin system** minimizes core, enables tree-shaking
2. **Model-View** decouples logic from rendering
3. **Diff-based updates** enable streaming data support
4. **Two-mode rendering** ensures 60 FPS performance
5. **Greeks integration** via Pyodide (visual mapping)

Target: **~200 KB minified, 60 FPS real-time, tightly integrated with Tick Engine + Greeks compute**.

Ready to begin Week 3 implementation.

---

**Created:** 2026-07-22  
**Commits:** 7549b20, ced4bc7  
**Status:** ✅ Design phase complete, implementation ready
