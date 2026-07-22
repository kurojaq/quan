---
type: Design Framework
title: Qu'an Proprietary Charting Engine Framework
description: Synthesis of ECharts + Grafana patterns; design decisions for real-time quantitative terminal charting
tags: [charting, architecture, design, qu-an, real-time, rendering]
citations:
  - echarts-architecture-analysis.md
  - Agentic SB2 (ECharts, Grafana source code)
---

# Qu'an Proprietary Charting Engine Framework

**Status:** Design Phase (Week 3 prep)  
**Timeline:** 12-week roadmap, charting as foundational layer (Weeks 3-5)  
**Target:** Lightweight, real-time, integrated with Tick Engine + Greeks compute

---

## Executive Summary

Build a **lightweight charting engine** (150-250 KB) optimized for quantitative trading:
- **Real-time data** from Tick Engine (live ticks, Greeks updates)
- **Multiple charts per terminal** (Chart tab, Bookmap, Greeks surface, Doctrine heatmap)
- **Performance first** - 60 FPS with 10K+ ticks
- **Integrated compute** - Greeks calculated in Pyodide, visuals (color/size) data-driven
- **Canvas rendering** - batch efficiency over individual element control
- **Plugin extensibility** - custom chart types (Bookmap, VolatilitySurface)

### Key Differences from Generic Charting

| Feature | Generic (ECharts) | Qu'an (Ours) |
|---------|---|---|
| Data | Batch uploads | Streaming ticks from Tick Engine |
| Compute | Built-in (colors, sizes) | Offloaded to Pyodide |
| Responsiveness | Reflow on resize | CSS media queries (separate instances) |
| Interaction | Hover tooltips, selection | Click-to-execute, real-time Greeks feed |
| Export | PNG, PDF | PNG screenshot |
| Theming | Global theme system | CSS variables (light/dark) |

---

## 1. Architecture Overview

### 1a. Layered Stack (Bottom-Up)

```
┌─────────────────────────────────────────────────────┐
│  Vue 3 Components (ChartTab, BookmapTab, etc.)      │
├─────────────────────────────────────────────────────┤
│  Qu'an Chart API (vue-chartjs-like wrapper)        │
│  - useChart(type, options)                         │
│  - onUpdate(data) subscription model                │
├─────────────────────────────────────────────────────┤
│  Core Rendering Engine (TypeScript)                │
│  - Model-View per chart type                       │
│  - Plugin system (use pattern)                      │
├─────────────────────────────────────────────────────┤
│  Processor Pipeline                                │
│  - Preprocess (validate)                           │
│  - Coordinate (layout)                             │
│  - Visual (color, size from Greeks)               │
│  - Animate (state transitions)                     │
├─────────────────────────────────────────────────────┤
│  Rendering Backend (Canvas-first)                  │
│  - Canvas batch rendering                         │
│  - Element mapping (hover, click)                  │
├─────────────────────────────────────────────────────┤
│  Data Layer (SeriesData-like)                      │
│  - Efficient storage (typed arrays)                │
│  - Diff algorithm (O(n) updates)                   │
│  - Graphics element mapping                       │
├─────────────────────────────────────────────────────┤
│  Coordinate Systems                                │
│  - Cartesian2D (main: price vs time/strike)        │
│  - Polar (greeksradiobutton tab: Greeks by strike)  │
│  - Custom (Bookmap 2D: price x volume)            │
└─────────────────────────────────────────────────────┘
```

### 1b. Module Breakdown

| Module | Source | Size Estimate | Purpose |
|--------|--------|---|---|
| **core** | New | 40 KB | init, scheduling, state management |
| **chart/line** | Adapt ECharts | 15 KB | Continuous price lines |
| **chart/candlestick** | Adapt ECharts | 18 KB | OHLC bars |
| **chart/scatter** | Adapt ECharts | 10 KB | Greeks IV points, bubbles |
| **chart/heatmap** | Adapt ECharts | 12 KB | Greeks surface (delta/gamma by strike) |
| **chart/bookmap** | New (custom) | 25 KB | 2D price x volume |
| **component/axis** | Adapt ECharts | 10 KB | X/Y axes with labels |
| **component/grid** | Adapt ECharts | 8 KB | Cartesian frame |
| **component/tooltip** | Adapt ECharts | 8 KB | Hover info |
| **component/legend** | Adapt ECharts | 6 KB | Series visibility |
| **renderer** | Adapt ECharts | 20 KB | Canvas backend |
| **data** | New | 15 KB | SeriesData, diff algorithm |
| **utils** | Mix | 10 KB | Colors, transforms, helpers |
| **coord** | Adapt ECharts | 15 KB | Cartesian2D, Polar |
| **animation** | Adapt ECharts | 10 KB | Transitions |

**Total Estimate:** ~200 KB (minified, gzipped: ~60 KB)

---

## 2. Design Patterns (Adopted from ECharts)

### Pattern 1: Plugin System

```typescript
// core.ts
const echarts = { init, use };

// Bootstrap
use([
  CanvasRenderer,
  DatasetComponent,
  LineChart,
  CandlestickChart,
  CartesianCoord,
  AxisComponent,
  TooltipComponent
]);

// Custom chart example
const BookmapChart = (registers) => {
  registers.registerSeriesModel(BookmapSeriesModel);
  registers.registerChartView(BookmapView);
  registers.registerLayout(bookmapLayout);
};
use([BookmapChart]);
```

**Benefit:** Minimal core, tree-shakeable, custom builds (exclude unused charts).

### Pattern 2: Model-View Separation

Each chart = 6 files (adapted for Qu'an):

```
chart/line/
├── LineSeries.ts          [Data model: type, dimensions, options]
├── LineView.ts            [Rendering: canvas calls, animation]
├── lineLayout.ts          [Coordinate calculation: data → pixels]
├── lineVisual.ts          [Styling: colors, widths from Greeks]
├── linePreprocessor.ts    [Validation: type checking, defaults]
└── install.ts             [Registration: wire up to core]
```

**Example: LineView**

```typescript
class LineView extends ChartView {
  render(seriesModel, ecModel, api) {
    // Check if large mode (1000+ points)
    if (seriesModel.pipelineContext.large) {
      this._renderLarge(seriesModel);
    } else {
      this._renderNormal(seriesModel);
    }
  }

  _renderNormal(seriesModel) {
    const data = seriesModel.getData();
    const oldData = this._data;

    data.diff(oldData)
      .add(idx => {
        const point = data.getItemLayout(idx);
        this._drawPoint(point, data, idx);
      })
      .update((idx, oldIdx) => {
        const el = oldData.getItemGraphicEl(oldIdx);
        graphic.updateProps(el, {shape: point.shape}, seriesModel);
      })
      .remove(idx => {
        this.group.remove(oldData.getItemGraphicEl(idx));
      });
  }

  _renderLarge(seriesModel) {
    // Batch canvas rendering for 1000+ points
    const canvas = this._getCanvas();
    const ctx = canvas.getContext('2d');
    
    data.each(idx => {
      const point = data.getItemLayout(idx);
      ctx.fillStyle = data.getItemVisual(idx, 'color');
      ctx.fillRect(point.x, point.y, point.width, point.height);
    });
  }
}
```

**Benefit:** Decouple logic from rendering; support Canvas + SVG.

### Pattern 3: Diff-Based Updates

```typescript
// Only re-render changed items
data.diff(oldData)
  .add(newIdx => /* render new item */)
  .update((newIdx, oldIdx) => /* animate changed item */)
  .remove(oldIdx => /* remove deleted item */)
```

**Benefit:** O(n) updates instead of O(n²) re-render; streaming data support.

### Pattern 4: Staged Processors

```
Data Input
  ↓ [Preprocessor] — validate input, apply defaults
  ↓ [Coordinate] — convert data space → pixel space
  ↓ [Visual] — assign colors, sizes (from Greeks/morphology)
  ↓ [Render] — generate graphics
  ↓ [Animate] — transitions
  ↓
Visual Output
```

**Benefit:** Separation of concerns; debug individual stages.

---

## 3. Real-Time Integration with Tick Engine

### Data Flow

```
Tick Engine (Cloudflare Durable Object)
  ↓ WebSocket subscription
  ↓
Chart Controller (Vue 3 component)
  ↓ parseTickData()
  ↓
SeriesData (internal storage)
  ↓ diff() — detect changes
  ↓
Render Pipeline
  ↓ (layout, visual, render)
  ↓
Canvas Output
```

### Example: Real-Time Line Chart Update

```typescript
// Vue 3 component (ChartTab.vue)
<script setup>
import { useChart } from '@/charting/useChart';
import { useTickEngine } from '@/core/useTickEngine';

const { setOption, getInstance } = useChart('line');
const { subscribe } = useTickEngine();

onMounted(() => {
  // Initial chart
  setOption({
    series: [{
      type: 'line',
      data: []
    }]
  });

  // Subscribe to live ticks
  const unsubscribe = subscribe('ESZ26', (tick) => {
    // Append new tick efficiently
    getInstance().appendData('ESZ26', {
      x: tick.timestamp,
      y: tick.last,
      bid: tick.bid,
      ask: tick.ask
    });
  });

  onUnmounted(() => unsubscribe());
});
</script>
```

### Real-Time Options

| Option | Pros | Cons |
|--------|------|------|
| **Append** (our choice) | Efficient, stateless | Requires local buffer management |
| **Replace entire series** | Simple API | O(n) re-render on every tick |
| **Push to D1 + query** | Persistent | Network latency, not real-time |

**Decision:** Append + diff, maintain 10K tick buffer in memory.

---

## 4. Greeks Integration (Data-Driven Visuals)

### Concept

Greeks computed in **Pyodide**, charting engine consumes as **visual hints**.

```
Tick Engine
  ↓
Pyodide (Greeks calculation)
  ↓ {delta: 0.45, gamma: 0.02, theta: -0.03, ...}
  ↓
Visual Mapping (in chart engine)
  ↓ Color = delta (green=positive, red=negative)
  ↓ Size = |gamma| (larger = more convex)
  ↓ Opacity = theta decay (fading if theta is decaying)
  ↓
Canvas Render
```

### Example: Greeks Heatmap (Delta by Strike)

```typescript
// Data: [strike, delta, gamma, vega, theta]
// Visual: color by delta, size by |gamma|

class GreeksHeatmapView extends ChartView {
  render(seriesModel) {
    const data = seriesModel.getData();
    
    data.each((idx) => {
      const [strike, delta, gamma, vega, theta] = data.getValues(
        ['strike', 'delta', 'gamma', 'vega', 'theta'],
        idx
      );

      // Visual mapping (Pyodide provides the values)
      const color = delta > 0 
        ? gradient('#0a0', [0, delta, 0.5]) // green → darker
        : gradient('#f00', [0, -delta, 0.5]); // red → darker

      const size = Math.abs(gamma) * 50; // scale by gamma convexity

      data.setItemVisual(idx, 'color', color);
      data.setItemVisual(idx, 'size', size);
    });

    this._renderItemsAsRects(data);
  }
}
```

**Benefit:** Greeks computed once (Pyodide), reused across charts (heatmap, surface, bubbles).

---

## 5. Chart Type Roadmap

### MVP (Weeks 3-4)

| Chart | Data | Purpose | Complexity |
|-------|------|---------|-----------|
| **Line** | (time, price) | Price history, Greeks curves | 🟢 Low |
| **Candlestick** | (time, O, H, L, C) | OHLC bars | 🟢 Low |
| **Scatter** | (strike, IV, vol) | IV surface, bubble chart | 🟡 Medium |
| **Heatmap** | (strike, delta) | Greeks surface (delta/gamma) | 🟡 Medium |

### Phase 2 (Weeks 5-6)

| Chart | Data | Purpose | Complexity |
|-------|------|---------|-----------|
| **Bookmap** | (price, volume, time) | 2D order book heat | 🔴 High |
| **Radar** | (Greeks, IV rank) | Greeks pentagon | 🟡 Medium |
| **Gauge** | (single value) | IV percentile | 🟢 Low |
| **Custom Markup** | (annotations) | Time State bands | 🟡 Medium |

### Not Building (Defer or Exclude)

- 3D surface (too heavy for browser)
- Geographic maps (not quantitative)
- Network graphs (not needed)
- Sankey flows (not trading-relevant)

---

## 6. Performance Strategy

### Two-Mode Rendering

```typescript
if (data.length > 600) {
  // Large mode: batch canvas
  // - Render 1000s of points at 60 FPS
  // - No hover (group-level only)
  // - Lower memory
} else {
  // Normal mode: SVG elements
  // - Interactive (hover, click)
  // - Smooth animations
  // - Easier debugging
}
```

### Optimization Techniques

1. **Diff-based updates** — only redraw changed items (O(n) not O(n²))
2. **Circular buffers** — limit memory (keep last 10K ticks, drop old)
3. **Throttled renders** — batch updates per frame (16.6ms)
4. **Canvas batching** — group draw calls (one canvas call per 100 items)
5. **Lazy layout** — calculate positions only when visible (virtualization)
6. **Memoized visuals** — cache color/size computations

### Benchmarks (Target)

| Scenario | Target FPS | Data Points | Notes |
|----------|---|---|---|
| Live ticks (line chart) | 60 | 10K | Diff updates only |
| Heatmap grid | 45 | 1000 (50×20) | Recompute on Greeks change |
| Bookmap (volume layers) | 50 | 500 (price levels) | Canvas batch rendering |
| Multi-tab (Chart + Bookmap) | 40 | 10K + 500 | Shared rendering loop |

---

## 7. Integration Points

### 7a. Tick Engine Consumer

```typescript
// In ChartTab.vue
const tickEngine = env.TICK_ENGINE.get(`ESZ26:live`);
const socket = await tickEngine.fetch('/ws');

socket.addEventListener('message', (event) => {
  const tick = JSON.parse(event.data);
  
  // Update chart data
  chart.appendData({
    x: tick.timestamp,
    y: tick.last,
    volume: tick.size
  });
});
```

### 7b. Greeks Calculator (Pyodide)

```javascript
// In Pyodide worker
const quant = new QuantEngine();

// Pre-compute Greeks for full surface
const surface = quant.computeGreeks({
  spots: [5400, 5410, 5420, ...],
  strikes: [5300, 5350, 5400, 5450, 5500, ...],
  iv: 0.18,
  dte: 30
});

// Return as data for heatmap
postMessage({ surface });
```

### 7c. Morphology Engine (Classification)

```typescript
// Morphology feed: {morphology, strength, timestamp}
// Visualize as chart annotation

class MorphologyOverlay {
  addBand(morphology, startIdx, endIdx) {
    // Draw colored band (Impulse=blue, Accumulation=yellow, etc.)
  }
}
```

---

## 8. API Design (Vue 3 Composable)

### `useChart(type, options)`

```typescript
const { setOption, getInstance, updateData, dispose } = useChart('line', {
  responsive: true,
  theme: 'dark',
  onResize: () => { /* */ }
});

// Set initial data
setOption({
  xAxis: { type: 'time' },
  yAxis: { type: 'value' },
  series: [{
    type: 'line',
    data: [[timestamp, price], ...]
  }]
});

// Append tick (efficient)
updateData('line-series-0', {
  append: [[newTimestamp, newPrice]]
});

// Listen to chart events
getInstance().on('click', (params) => {
  console.log('Clicked:', params.dataIndex, params.value);
});

// Cleanup
onUnmounted(() => dispose());
```

### Event Bindings

```typescript
chart.on('click', (params) => {
  // Execute trade
  execute({
    strike: params.value[0],
    quantity: params.value[1]
  });
});

chart.on('mousemove', (params) => {
  // Update Greeks preview
  showGreeksPreview(params.dataIndex);
});
```

---

## 9. CSS + Responsiveness

### CSS Variable Theming

```css
/* Define in :root */
:root {
  --chart-bg: #fff;
  --chart-text: #000;
  --chart-grid: #e0e0e0;
  --chart-positive: #22ab94;
  --chart-negative: #e6423c;
  --chart-neutral: #7c8798;
  --chart-axis: #7c8798;
  --chart-tooltip-bg: rgba(0, 0, 0, 0.8);
  --chart-tooltip-text: #fff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --chart-bg: #1a1a1a;
    --chart-text: #e0e0e0;
    --chart-grid: #333;
    /* ... */
  }
}
```

### Responsive Layouts (Tab System)

```typescript
// Multi-chart terminal
const chartConfigs = {
  'chart-tab': { width: '100%', height: 400 },
  'bookmap-tab': { width: '50%', height: 400 },
  'greeks-tab': { width: '50%', height: 400 }
};

// Each chart is independent instance
each(tab => {
  const chart = echarts.init(tab.dom, null, { width, height });
  chart.setOption(config[tab.name]);
});

// Handle window resize
window.addEventListener('resize', () => {
  // Resize only active tabs
  getActiveCharts().forEach(chart => chart.resize());
});
```

---

## 10. Implementation Roadmap

### Week 3: Core Engine + MVP Charts

- [ ] Core (init, plugin system, scheduler) — 40 KB
- [ ] Data layer (SeriesData, diff) — 15 KB
- [ ] Renderer (canvas backend) — 20 KB
- [ ] Coordinates (Cartesian2D) — 10 KB
- [ ] Chart: Line — 15 KB
- [ ] Chart: Candlestick — 18 KB
- [ ] Component: Axis + Grid — 18 KB
- [ ] Component: Tooltip — 8 KB

**Subtotal:** ~144 KB

### Week 4: Scatter + Heatmap

- [ ] Chart: Scatter — 10 KB
- [ ] Chart: Heatmap — 12 KB
- [ ] Component: Legend — 6 KB
- [ ] Utilities (colors, transforms) — 10 KB

**Subtotal:** ~182 KB (cumulative)

### Week 5: Bookmap (Custom)

- [ ] Chart: Bookmap (2D volume map) — 25 KB
- [ ] Animation engine (optimized) — 8 KB

**Subtotal:** ~215 KB (cumulative)

### Week 6: Polish + Export

- [ ] SVG fallback renderer — 12 KB
- [ ] PNG export (canvas.toDataURL) — 2 KB
- [ ] Performance optimization pass — (no size change)
- [ ] Documentation + examples — (external)

**Final:** ~229 KB (minified, gzipped: ~70 KB)

---

## 11. Key Decisions vs ECharts

| Decision | ECharts | Qu'an | Rationale |
|----------|---------|-------|-----------|
| Core size | 125 KB | 40 KB | Exclude: theme system, locale, legacy compat |
| Animations | All transitions | Selective | Perf: skip non-essential (e.g., legend toggle) |
| Theming | Global config | CSS variables | Static per session, simpler |
| Data input | Config.option | Data feed + streaming | Live ticks from Tick Engine |
| Interaction | Hover, select, drill | Click to execute | Trading-specific events |
| Export | PNG, PDF, Excel | PNG only | Screenshot for sharing |
| Coordinate systems | 4 major (Cartesian, Polar, Geo, Calendar) | 2 (Cartesian, Polar) + custom | Geo/Calendar not trading-relevant |
| Charts included | 25+ | 6 MVP + 3 Phase 2 | Focus on quantitative charts |

---

## 12. Success Criteria

### Performance

- ✅ 60 FPS rendering with 10K ticks (line chart)
- ✅ 45 FPS heatmap with 1000 cells (Greeks surface)
- ✅ <50ms update latency (Tick Engine → canvas)

### Functionality

- ✅ Line, Candlestick, Scatter, Heatmap (MVP)
- ✅ Bookmap (custom chart, Weeks 5-6)
- ✅ Real-time streaming from Tick Engine
- ✅ Greeks-driven visuals (color, size, opacity)

### Integration

- ✅ Vue 3 composable API (useChart)
- ✅ Event bindings (click → execute)
- ✅ Morphology overlays (time bands)
- ✅ Multi-tab terminal support

### Quality

- ✅ TypeScript, fully typed
- ✅ Unit tests (rendering logic)
- ✅ E2E tests (chart interactions)
- ✅ Documentation (API, examples)

---

## 13. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **Performance under load** | Two-mode rendering (normal vs large), diff updates, circular buffers |
| **Real-time latency** | Batch updates per frame, canvas batching, avoid layout thrashing |
| **Browser compatibility** | Canvas supported everywhere; SVG fallback for export |
| **Memory bloat** | Circular tick buffer (10K max), lazy layout, memoized visuals |
| **Code bloat** | Plugin system (tree-shake unused charts), avoid monolithic core |
| **Dependency chain** | Minimal deps (only rendering, no data processing, no UI framework) |

---

## 14. Next Steps

1. **Week 3 kickoff** — Finalize core API, start core + chart implementation
2. **ECharts extraction** — Carefully port line/candlestick logic, adapt for Qu'an
3. **Tick Engine integration** — Wire data feed, test real-time updates
4. **Greeks integration** — Coordinate with Pyodide team, test heatmap
5. **Performance tuning** — Benchmark, optimize rendering pipeline
6. **Documentation** — API guide, examples, troubleshooting

---

**Framework Created:** 2026-07-22  
**Status:** Ready for Week 3 implementation  
**Expected Completion:** Week 6 (MVP) + Week 7 (polish)
