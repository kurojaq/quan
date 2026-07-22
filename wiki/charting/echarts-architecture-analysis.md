---
type: Reference Architecture
title: ECharts 5.x Architecture Analysis
description: Deep-dive into Apache ECharts source code; modular plugin system, rendering pipeline, chart type patterns, coordinate systems; learnings for proprietary qu-an charting engine
tags: [charting, echarts, architecture, design-patterns, rendering, canvas, svg]
citations:
  - echarts-master (source code analysis)
  - Agentic SB2/echarts-master (research folder)
---

# ECharts 5.x Architecture Analysis

**Source:** Apache ECharts v5.x (GitHub: echarts-master)  
**Language:** TypeScript  
**Rendering:** Canvas (default) + SVG (optional)  
**Pattern:** Plugin-based, modular, extensible

---

## 1. High-Level Architecture

ECharts is structured as a **plugin-driven rendering engine** with these layers:

```
┌─────────────────────────────────────────────────────┐
│  User API (init, setOption, on, off)                │
├─────────────────────────────────────────────────────┤
│  Global Model (settings, themes, state)             │
├─────────────────────────────────────────────────────┤
│  Series Manager + Component Manager                 │
│  (registers charts, axes, tooltips, legends)        │
├─────────────────────────────────────────────────────┤
│  Scheduler (task-based rendering pipeline)          │
├─────────────────────────────────────────────────────┤
│  Processor Pipeline                                 │
│  (preprocessor → data processing → visual → render) │
├─────────────────────────────────────────────────────┤
│  Renderer (Canvas/SVG abstraction layer)            │
├─────────────────────────────────────────────────────┤
│  ZRender (low-level graphics primitive library)     │
└─────────────────────────────────────────────────────┘
```

### Key Entry Point

**`src/echarts.ts`** (main export):
```typescript
export * from './export/core';
import { use } from './extension';
import { init } from './core/echarts';

// Plugin pattern: register canvas renderer + dataset by default
use([CanvasRenderer, DatasetComponent]);
use(installLabelLayout);

// Main API
export { init };  // echarts.init(dom, theme, options)
```

**`src/core/echarts.ts`** (125KB - core engine):
- Instance management (singleton per DOM element)
- Event dispatching (click, mouseover, etc.)
- Render scheduling
- Data/option management
- Lifecycle hooks

---

## 2. Plugin System (Extension API)

ECharts uses a **declarative plugin registration pattern** via `use()`:

### Registration Pattern

```typescript
// In src/extension.ts
function use(fns) {
  fns.forEach(fn => {
    fn(ec);  // Call plugin installer function
  });
}

// Plugin returns an install function
export const install = (ec) => {
  ec.registerSeriesModel(CandlestickSeriesModel);
  ec.registerChartView(CandlestickView);
  ec.registerLayout(candlestickLayout);
  ec.registerVisual(candlestickVisual);
  ec.registerPreprocessor(preprocessor);
};
```

### Built-in Plugins

| Type | Count | Examples |
|------|-------|----------|
| **Charts** | 25+ | Line, Bar, Pie, Scatter, Candlestick, Heatmap, Sankey, Tree, etc. |
| **Components** | 15+ | Axis, Grid, Tooltip, Legend, DataZoom, Calendar, Brush, etc. |
| **Renderers** | 2 | Canvas (default), SVG |
| **Layouts** | 5+ | Cartesian, Polar, Geo, Calendar, Funnel |

### Extensibility Points

1. **Chart types** - Register new series + view
2. **Components** - Axis, toolbar, legend, tooltip
3. **Renderers** - Canvas, SVG, or custom
4. **Processors** - Data transformation pipeline
5. **Coordinate systems** - Cartesian2D, Polar, Geo
6. **Visual mapping** - Color scales, sizing rules

---

## 3. Chart Type Architecture

Each chart (e.g., candlestick) is composed of 6 files:

### Pattern: Candlestick Chart Example

**File Structure:**
```
src/chart/candlestick/
├── CandlestickSeries.ts        [Data model + configuration]
├── CandlestickView.ts           [Rendering logic + animation]
├── candlestickLayout.ts         [Coordinate calculation]
├── candlestickVisual.ts         [Color + styling rules]
├── preprocessor.ts              [Data validation + preparation]
└── install.ts                   [Plugin registration]
```

### 3a. Series Model (Data Layer)

**`CandlestickSeriesModel`** - Extends `SeriesModel<CandlestickSeriesOption>`

```typescript
class CandlestickSeriesModel extends SeriesModel<CandlestickSeriesOption> {
  static readonly type = 'series.candlestick';
  static readonly dependencies = ['xAxis', 'yAxis', 'grid'];

  // Dimension schema
  defaultValueDimensions = [
    {name: 'open', defaultTooltip: true},
    {name: 'close', defaultTooltip: true},
    {name: 'lowest', defaultTooltip: true},
    {name: 'highest', defaultTooltip: true}
  ];

  // Default styling
  static defaultOption: CandlestickSeriesOption = {
    z: 2,
    coordinateSystem: 'cartesian2d',
    itemStyle: {
      color: '#eb5454',      // up/positive
      color0: '#47b262',     // down/negative
      borderWidth: 1
    },
    barMaxWidth: null,
    large: true,             // Optimize rendering for 600+ items
    progressive: 3e3,        // Chunk size
    animationEasing: 'linear',
    animationDuration: 300
  };

  // Custom methods
  getShadowDim() { return 'open'; }
  brushSelector(dataIndex, data, selectors) { /*...*/ }
}
```

**Key Pattern:**
- Type registration (series.{name})
- Declare dependencies (coordinate systems, axes)
- Define dimensions (data schema)
- Default options (inline styling)
- Instance methods (domain-specific logic)
- Mixin support (shared behavior)

### 3b. Chart View (Rendering Layer)

**`CandlestickView`** - Extends `ChartView`

```typescript
class CandlestickView extends ChartView {
  static readonly type = 'candlestick';

  private _isLargeDraw: boolean;
  private _data: SeriesData;
  private _progressiveEls: Element[];

  // Three rendering modes
  render(seriesModel, ecModel, api) {
    this._updateDrawMode(seriesModel);
    this._isLargeDraw
      ? this._renderLarge(seriesModel)
      : this._renderNormal(seriesModel);
  }

  incrementalPrepareRender(seriesModel, ecModel, api) {
    this._clear();
    this._updateDrawMode(seriesModel);
  }

  incrementalRender(params, seriesModel, ecModel, api) {
    this._isLargeDraw
      ? this._incrementalRenderLarge(params, seriesModel)
      : this._incrementalRenderNormal(params, seriesModel);
  }

  // Normal mode: render all elements
  _renderNormal(seriesModel) {
    const data = seriesModel.getData();
    const oldData = this._data;
    
    // Efficient diff-based updates
    data.diff(oldData)
      .add((newIdx) => {
        const el = createNormalBox(itemLayout, newIdx, transPointDim, true);
        group.add(el);
        data.setItemGraphicEl(newIdx, el);
      })
      .update((newIdx, oldIdx) => {
        let el = oldData.getItemGraphicEl(oldIdx);
        graphic.updateProps(el, {shape: {points: itemLayout.ends}}, seriesModel);
      })
      .remove((oldIdx) => {
        group.remove(oldData.getItemGraphicEl(oldIdx));
      });
  }

  // Large mode: use canvas + batch rendering
  _renderLarge(seriesModel) {
    // Render 1000s of elements efficiently
    // Uses canvas for performance instead of individual SVG elements
  }
}
```

**Key Pattern:**
- Two rendering modes: normal (element per item) + large (batch canvas)
- Incremental rendering (for streaming data)
- Diff-based updates (only render changed items)
- Lifecycle hooks (render, incrementalPrepareRender, incrementalRender)
- Element tracking (setItemGraphicEl, getItemGraphicEl)

### 3c. Layout Logic

**`candlestickLayout.ts`** - Calculate item positions

```typescript
export function candlestickLayout(ecModel: GlobalModel) {
  ecModel.eachSeriesByType('candlestick', (seriesModel) => {
    const data = seriesModel.getData();
    const xAxis = seriesModel.coordinateSystem.getAxis('x');
    const yAxis = seriesModel.coordinateSystem.getAxis('y');

    data.each((dataIndex) => {
      const [open, close, low, high] = data.getValues(['open', 'close', 'low', 'high'], dataIndex);

      // Convert data values to pixel coordinates
      const xVal = data.get('x', dataIndex);
      const xPix = xAxis.dataToPixel(xVal);
      const openPix = yAxis.dataToPixel(open);
      const closePix = yAxis.dataToPixel(close);
      const lowPix = yAxis.dataToPixel(low);
      const highPix = yAxis.dataToPixel(high);

      // Calculate bar width (context-aware)
      const barWidth = calculateBarWidth(seriesModel, data, dataIndex);

      // Store layout info for renderer
      data.setItemLayout(dataIndex, {
        ends: [
          [xPix - barWidth/2, openPix],
          [xPix + barWidth/2, closePix],
          // ... whisker points
        ],
        brushRect: {...}
      });
    });
  });
}
```

**Key Pattern:**
- Separate layout from rendering
- Convert data space → pixel space
- Cache layout results (setItemLayout)
- Calculate derived properties (bar width, whisker coords)

### 3d. Visual Mapping

**`candlestickVisual.ts`** - Determine colors + styling

```typescript
export function candlestickVisual(ecModel: GlobalModel) {
  ecModel.eachSeriesByType('candlestick', (seriesModel) => {
    const data = seriesModel.getData();
    const positiveColor = seriesModel.get(['itemStyle', 'color'], true);
    const negativeColor = seriesModel.get(['itemStyle', 'color0'], true);
    const dojiColor = seriesModel.get(['itemStyle', 'borderColorDoji'], true);

    data.each((dataIndex) => {
      const [open, close] = data.getValues(['open', 'close'], dataIndex);

      // Select color based on OHLC
      let color = close >= open ? positiveColor : negativeColor;
      if (close === open) color = dojiColor || color;

      data.setItemVisual(dataIndex, 'color', color);
      data.setItemVisual(dataIndex, 'borderColor', borderColor);
    });
  });
}
```

**Key Pattern:**
- Separate visual styling from layout
- Access model options (seriesModel.get())
- Store visuals per data point (setItemVisual)
- Conditional logic (up/down/doji colors)

### 3e. Preprocessor (Data Validation)

**`preprocessor.ts`** - Validate + prepare data

```typescript
export function candlestickPreprocessor(option: OptionPreprocessorParams) {
  // Validate required dimensions
  if (option.series) {
    option.series.forEach(series => {
      if (series.type === 'candlestick') {
        series.data?.forEach(item => {
          // Ensure [open, close, low, high] format
          if (Array.isArray(item.value)) {
            const [o, c, l, h] = item.value;
            // Validate: low should be min, high should be max
            if (l > Math.min(o, c) || h < Math.max(o, c)) {
              console.warn('Invalid candlestick data');
            }
          }
        });
      }
    });
  }
}
```

**Key Pattern:**
- Runs before data processing
- Validates input (type, shape, ranges)
- Transforms data if needed (normalization, defaults)
- Logs warnings (doesn't fail)

### 3f. Plugin Registration

**`install.ts`** - Wire up all components

```typescript
export const install = (registers) => {
  registers.registerSeriesModel(CandlestickSeriesModel);
  registers.registerChartView(CandlestickView);
  registers.registerLayout(candlestickLayout);
  registers.registerVisual(candlestickVisual);
  registers.registerPreprocessor(candlestickPreprocessor);
};
```

**Key Pattern:**
- Single file declares all registrations
- Imported by main entry point
- Decoupled from core engine

---

## 4. Data Layer (SeriesData)

**`SeriesData`** class - Centralized data access

```typescript
class SeriesData {
  // Store: _rawData, _values, _visuals, _layouts, _graphicEls
  
  // Dimension-based access
  get(dimension, index): any;
  getValues(dimensions[], index): any[];
  each(callback);
  
  // Visual + layout storage
  setItemVisual(index, 'color', value);
  getItemVisual(index, 'color');
  
  setItemLayout(index, value);
  getItemLayout(index);
  
  // Graphic element mapping (for updates)
  setItemGraphicEl(index, element);
  getItemGraphicEl(index);
  
  // Efficient diffing for updates
  diff(oldData) → Diff {
    add(callback);
    update(callback);
    remove(callback);
  }
}
```

**Key Pattern:**
- Centralized data store
- Multiple value "views" (raw, visual, layout)
- Graphic element mapping (for update efficiency)
- Diff algorithm (skip unchanged items)

---

## 5. Coordinate Systems

**`src/coord/`** - Pluggable coordinate frameworks

### Types

| System | Use Case | Files |
|--------|----------|-------|
| **Cartesian2D** | Line, bar, scatter | Grid, Axis2D, CartesianAxis |
| **Polar** | Line in polar coords, radar | AngleAxis, RadiusAxis |
| **Geo** | Map, lines on map | Geo (geographic projection) |
| **Calendar** | Heatmap by date | Calendar |

### Cartesian2D Example

```typescript
class Cartesian2D extends CoordinateSystem {
  xAxis: Axis2D;
  yAxis: Axis2D;
  
  // Core methods
  dataToPoint(data) → [x, y];
  pointToData(point) → [dataX, dataY];
  getArea() → {x, y, width, height};
}

// Series declares dependency
static readonly dependencies = ['xAxis', 'yAxis', 'grid'];
```

**Key Pattern:**
- Abstract CoordinateSystem base
- Concrete implementations (Cartesian2D, Polar, etc.)
- Series declare dependencies
- Bidirectional conversion (data ↔ pixel)

---

## 6. Rendering Pipeline

**`src/core/Scheduler.ts`** - Task-based orchestration

### Pipeline Stages (in order)

1. **Preprocessor** - Validate + prepare data
2. **Data Processor** - Transform data (normalization, filtering)
3. **Coordinate Calculation** - Build axes, scales
4. **Data Processing** - Attach coordinates to data
5. **Visual Mapping** - Assign colors, sizes
6. **Render** - Generate graphic elements
7. **Animate** - Transition between states

### Task Scheduling

```typescript
class Scheduler {
  addTask(name, stage, handler, dependencies);
  
  // Execute pipeline
  run() {
    stages.forEach(stage => {
      stage.tasks.forEach(task => {
        task.handler();
      });
    });
  }
}
```

**Key Pattern:**
- Declarative task graph
- Dependencies resolved automatically
- Stages run sequentially (within stage: parallel)
- Incremental rendering (update only changed parts)

---

## 7. Component Architecture

Each major feature (axis, tooltip, legend) is a **component** with same pattern as charts:

| Component | Model | View | Purpose |
|-----------|-------|------|---------|
| **Axis** | AxisModel | AxisView | X/Y axes with labels |
| **Grid** | GridModel | GridView | Cartesian2D frame |
| **Tooltip** | TooltipModel | TooltipView | Hover info display |
| **Legend** | LegendModel | LegendView | Series visibility control |
| **DataZoom** | DataZoomModel | DataZoomView | Zoom + pan controls |
| **Brush** | BrushModel | BrushView | Selection tool |

**Pattern:**
- Model stores config + computed state
- View renders + handles interaction
- Separate concerns (MVC-like)

---

## 8. Key Design Patterns

### Pattern 1: Plugin-Based Extensibility

```typescript
// Core is minimal
const echarts = { init, use };

// Everything else is a plugin
use([
  CanvasRenderer,
  DatasetComponent,
  LineChart,
  BarChart,
  CartesianCoord,
  TooltipComponent,
  LegendComponent,
  AxisComponent
]);

// Custom plugin example
const MyChart = (registers) => {
  registers.registerSeriesModel(MySeriesModel);
  registers.registerChartView(MyChartView);
};
use([MyChart]);
```

**Benefit:**
- Minimal core
- Tree-shakeable
- Custom builds (include only needed charts)

### Pattern 2: Model-View Separation

Each chart/component has:
1. **Model** - Data + options (src/model/Series or Component)
2. **View** - Rendering + interaction (src/view/Chart or Component)
3. Lifecycle hooks - render, incrementalRender, updateTransform

**Benefit:**
- Decoupled logic
- Easy to test
- Multiple renderers (Canvas, SVG) support same Model

### Pattern 3: Efficient Diffing

```typescript
// Only update changed items
data.diff(oldData)
  .add(newIdx => /* render new */)
  .update((newIdx, oldIdx) => /* animate change */)
  .remove(oldIdx => /* remove */)
```

**Benefit:**
- O(n) update instead of O(n) re-render
- Smooth animations between data updates
- Streaming data support

### Pattern 4: Staged Processors

```
Data → Preprocess → Coordinate → Visual → Render → Animate
       ↑ Validation  ↑ Layout      ↑ Colors  ↑ Elements ↑ Transition
```

**Benefit:**
- Separation of concerns
- Easier debugging (isolate stage failures)
- Reusable (e.g., visual mapping used across charts)

### Pattern 5: Two-Mode Rendering

```typescript
if (data.length > 600) {
  // Large mode: batch canvas rendering
  // 1 canvas call per 1000 items
} else {
  // Normal mode: individual SVG/canvas elements
  // Easier hover, selection, animation
}
```

**Benefit:**
- Smooth 60 FPS with 10K+ data points
- Interactive at smaller scales

---

## 9. Rendering Backends

### Canvas Renderer (`src/renderer/installCanvasRenderer.ts`)

```typescript
export const install = (registers) => {
  registers.registerRenderer('canvas', CanvasRenderer);
};

class CanvasRenderer {
  // Low-level canvas primitives
  fillRect, drawLine, fillPath, etc.
  
  // Batching for performance
  beginBatch();
  endBatch();
  
  // Clipping support
  beginClip(path);
  endClip();
}
```

**Characteristics:**
- Single bitmap canvas (entire chart on one canvas)
- Batch rendering (many shapes in one draw call)
- No individual element hover (group-level only)
- Best for performance (10K+ points)

### SVG Renderer

```typescript
class SVGRenderer {
  // SVG elements per primitive
  createElement('circle', attrs);
  createElement('path', attrs);
  
  // Each element is selectable + hoverable
  // Native browser events work
}
```

**Characteristics:**
- One SVG element per shape
- Native browser interactions (hover, click)
- Smaller datasets (<600 items)
- Easier debugging (inspect in DevTools)

---

## 10. Chart Type Inventory

### Financial Charts
- **Candlestick** - OHLC bars
- **Boxplot** - Statistical quartiles + outliers

### Time Series
- **Line** - Continuous lines (with area fill option)
- **Bar** - Vertical/horizontal bars
- **Scatter** - Dots (point cloud)

### Distribution
- **Heatmap** - 2D matrix (color intensity)
- **Histogram** - Frequency bins
- **Density** - Kernel density estimation

### Network/Graph
- **Graph** - Nodes + edges (force-directed layout)
- **Sankey** - Flow diagram
- **Chord** - Circular relationships
- **Parallel** - Multidimensional axes

### Hierarchical
- **Tree** - Rooted trees (force-directed)
- **Treemap** - Nested rectangles
- **Sunburst** - Nested circles

### Specialized
- **Gauge** - Meter/speedometer
- **Funnel** - Top-to-bottom flow
- **Radar** - Multi-axis spiderweb
- **Map** - Geographic (with Geo component)
- **EffectScatter** - Scatter with ripple animation
- **ThemeRiver** - Stacked streaming
- **Calendar** - Grid by date

---

## 11. Key Learnings for Proprietary Engine

### ✅ Adopt These Patterns

1. **Plugin system** - Core minimal, features added via `use()`
2. **Model-View separation** - Decouple data from rendering
3. **Diff-based updates** - Only re-render changed items
4. **Staged processors** - Data → Coordinate → Visual → Render
5. **Coordinate abstraction** - Support multiple coordinate systems
6. **Two-mode rendering** - Normal (elements) + Large (canvas batch)
7. **Component pattern** - Reuse for axis, legend, tooltip

### 🔄 Adapt These Patterns

1. **Dimensions system** - ECharts uses nested arrays; consider column names
2. **Option API** - ECharts uses deeply-nested config; consider flatter structure
3. **Legend handling** - Series toggle in ECharts; consider series + group controls
4. **Animation** - ECharts animate all state; consider selective (performance)
5. **Responsive** - ECharts reflows on resize; consider CSS-based responsive

### ❌ Don't Copy These (Qu'an-specific)

1. **Global theme system** - ECharts has theming; build into Pyodide compute instead
2. **Locale support** - Not needed for quantitative terminal
3. **Mobile/touch** - Focus on desktop precision
4. **Async data loading** - Tick Engine provides data already

---

## 12. Architecture for Qu'an Terminal

### Proposed Qu'an Charting Stack

```
┌──────────────────────────────────────┐
│ Qu'an Chart API (Vue 3 components)   │
├──────────────────────────────────────┤
│ Core Rendering Engine (TS)           │
│ - Model-View for each chart type     │
│ - Plugin system (use pattern)         │
├──────────────────────────────────────┤
│ Processors (Pipeline)                │
│ - Preprocess (validate)              │
│ - Coordinate (layout)                │
│ - Visual (color, size)               │
│ - Animate (transitions)              │
├──────────────────────────────────────┤
│ Rendering (Canvas-first)             │
│ - Canvas backend (default)           │
│ - SVG backend (fallback/export)      │
├──────────────────────────────────────┤
│ Data Layer (SeriesData-like)         │
│ - Efficient storage (arrays)         │
│ - Diff algorithm (updates)           │
│ - Graphics element mapping           │
├──────────────────────────────────────┤
│ Coordinate Systems                   │
│ - Cartesian2D (primary)              │
│ - Polar (radar tab)                  │
└──────────────────────────────────────┘
```

### Chart Types for Qu'an

**MVP (Week 3-4):**
- Line (price history, Greeks)
- Candlestick (OHLC)
- Scatter (volatility surface)
- Heatmap (Greek surface)

**Phase 2 (Week 5+):**
- Bar (OI by strike)
- Gauge (current IV percentile)
- Custom (Bookmap, Time State)

### Key Qu'an Differences

1. **Real-time data** - Tick Engine pushes updates
2. **Greeks computation** - Pyodide calculates visuals (color, size)
3. **Multi-tab architecture** - Each tab is independent chart instance
4. **Live updates** - Not batch reload, incremental append
5. **Export** - PNG screenshot (canvas.toDataURL)

---

## 13. File Size Reference

| Component | Size | Purpose |
|-----------|------|---------|
| echarts.ts | 125 KB | Core engine (init, scheduling, state) |
| LineView.ts | 52 KB | Line chart rendering |
| echarts.all.ts | 8 KB | Export all built-ins |
| CandlestickView.ts | 15 KB | Candlestick rendering |
| Scheduler.ts | 26 KB | Task scheduling |
| Complete dist | ~1 MB | Full echarts.js (minified) |

**For Qu'an:** Target ~200-300 KB core (exclude unused charts, thememing).

---

## 14. Next Steps: Agentic SB2 Integration

This document will be **extended** after examining:
1. **Grafana** - Real-time streaming architecture
2. **D3.js** (if included) - Data-driven approach
3. **Plotly.js** (if included) - API design patterns

**Then:** Draft skill modules for Qu'an charting engine.

---

**Created:** 2026-07-22  
**Status:** Foundation Analysis Complete (echarts)  
**Next:** Grafana + secondary systems analysis
