# Qu'an Tradovate Bookmap Engine

A native implementation of the Qu'an analytical visualization layer inside Tradovate's
**JavaScript Custom Indicator** environment (the in-platform *Code Explorer*).

This is **not** a chart. Tradovate already owns candles, time/price scaling, zoom, pan,
crosshair, sessions and drawing sync. This engine owns only the **mathematics** — it renders
proprietary Qu'an observables (dealer intent, vanna, gamma, charm, rolling interest, pressure)
as scalar/spectral fields and structural levels layered *on top of* Tradovate's native chart.

```
Tradovate Chart  ──►  Layer 1  Candles          (native)
                      Layer 2  Volume Profile    (native)
                      Layer 3  Qu'an Scalar Fields  ◄── this engine
                      Layer 4  Dealer Structure     ◄── this engine
                      Layer 5  Bookmap Density       ◄── this engine
                      Layer 6  Intent Labels         ◄── this engine
                      Layer 7  Interactive Observations
```

## How rendering actually works in Tradovate

We use the **declarative graphics API** — the current, first-class path documented in
Tradovate's *Graphics* tutorial (`.../pages/Tutorial/Graphics.html`, mirrored locally in
`Quan Brain One/raw/Tradovate Indicator API/`) with working screenshots.

- A calculator's `map(d, index, series)` returns `{ graphics: { items: [ ... ] } }`.
- **The critical detail that blanked earlier versions:** `du`/`px`/`op` are **not globals** —
  import them: `const { px, du, op } = require("./tools/graphics");`
  (This module exists in the product runtime even though it 404s on GitHub `master`.)
- `items` are `GraphicsObject`s. We use:
  - `Instancing` — GPU-batched rectangles with **per-instance color** → a true heatmap column
  - `LineSegments` — `infiniteStart/infiniteEnd` horizontal structural levels
  - `Text` — level labels (`global: true`)
- Coordinates: `du(v)` domain units (price on Y, bar index on X), `px(v)` pixels,
  `op(a, '+|-|*|/|min|max', b)` to mix — e.g. `op(du(3850), '-', px(40))`.
- A graphics-only indicator needs **no** `plots`/`plotter` (see `substantialGain` tutorial).

Field cell = one `Instancing` instance per price bin: `position` at the bin's low-price edge,
`size` `du(1)` wide × `du(binSize)` tall (tiles gaplessly, zoom-stable), `color` from the
colormap. `minValue` gates faint cells.

> **Paths we deliberately do NOT use:**
> - **Custom-plotter path** (`predef.plotters.custom(fn)` + `canvas.drawLine`/`drawPath`) — the
>   older tutorial path. Works for lines but has **no text primitive** and no per-cell color
>   control; the graphics API supersedes it for a heatmap.
> - `canvas.drawHeatmap` / `plotting.createHeatmap` — documented but **not implemented** in the
>   public `tools/plotting.js`.

### Smoke test first

`indicators/quan-smoketest.js` draws Text + a Circle + 5 colored `Instancing` rects at the last
bar. Load it before the bookmap to confirm the graphics pipeline (and `Instancing` specifically)
renders on the target build — it isolates pipeline problems from field-logic problems.

The engine runs in a **sandboxed CommonJS environment** — there is no `window`, no DOM, no
`fetch`. The Qu'an math from the web terminal (`js/scalar-field.js`, `js/chart-heat.js`) is
therefore **ported as pure functions**, not imported.

## Module map

Each module has a single responsibility (per the master spec). Source of truth lives in
`src/`; the pasteable indicators in `indicators/` inline what they need so a single file can
be dropped into Code Explorer.

| Module              | Responsibility                                                    | Status |
|---------------------|-------------------------------------------------------------------|--------|
| `ColorEngine`       | Colormaps (thermal/spectral/ice/mono/magma) → rgb01 + hex         | ✅ v5  |
| `PayloadModel`      | Parse all-metrics PAYLOAD, select 1 column → normalized cells      | ✅ v5  |
| `ScalarFieldRenderer` | Segment column → `Instancing` cells (graphics API)             | ✅ v5  |
| `LevelRenderer`     | `anchor`/`atm`/`pdsl` → `LineSegments` + `Text` labels             | ✅ v5  |
| metric dropdown     | indicator `metric` enum param, built from `PAYLOAD.metrics`        | ✅ v5  |
| generator (terminal)| `js/tradovate-payload.js` — snapshots → all-metrics payload → script| ✅ v5 |
| sidebar panel       | `js/tradovate-panel.js` + `#tvTab`/`#tvPanel` (twin of Payload eng)| ✅ v5  |
| `InterpolationEngine` | Bilinear + gaussian smoothing (port of scalar-field.js)         | ⏳ next |
| `ChronometerRenderer` | Normalized session-time projection                              | ⏳     |
| `ViewportEngine` / `AnimationEngine` | LOD, culling, incremental updates                | ⏳     |

## Indicators (pasteable)

| File                           | What it draws                                            |
|--------------------------------|----------------------------------------------------------|
| `indicators/quan-smoketest.js` | Pipeline check: Text + Circle + colored Instancing rects |
| `indicators/quan-bookmap.js`   | The terminal bookmap from a baked PAYLOAD (field + levels). Also the injection template — ships with a runnable sample payload. |

## Loading into Tradovate

1. In Tradovate Trader open **Chart → ⚙ (indicator) → Code Explorer**.
2. Create a new indicator, paste the full contents of an `indicators/*.js` file.
3. Save. It appears under the **`Qu'an`** tag in the indicator dropdown.
4. Add it to the chart (it auto-selects *overlay*). Tune via the parameter editor.

## Data model: the terminal payload (the Pine twin)

The indicator does **not** recompute anything. It renders a **baked PAYLOAD** — the Tradovate
equivalent of the TradingView / Pine payload. The terminal serializes the same heat snapshots
its Chart-tab Bookmap draws (`window.__getHeatSnapshots()`) into the PAYLOAD block, and hands
you a ready-to-paste indicator.

Pipeline:

```
terminal heat snapshots            js/tradovate-payload.js              tradovate/indicators/
{date, heatmap:{meta, rows}}  ──►  buildPayload() → injectPayload()  ──►  quan-bookmap.js
   __getHeatSnapshots()            (Bookmap "Tradovate" button)         (paste into Code Explorer)
```

PAYLOAD shape (v2 — **all metrics baked**, so the indicator has its own metric dropdown):

```js
{ v:2, inst, defaultMetric, pdec,
  metrics: [[key, label], ...],            // populates the indicator's metric param (dropdown)
  cols: ["k", metricKey1, metricKey2, ...],// row column order; k = price
  segments: [ { date, t0,                  // t0 = session-start epoch (baked; no TZ math in sandbox)
                anchor, atm,
                rows: [[k, v1, v2, ...], ...],   // k ascending; values per `cols`
                pdsl: [[price, "S"|"R"], ...] } ] }   // sorted by t0 asc
```

The indicator's **`metric` parameter is an enum built at load time from `PAYLOAD.metrics`** — the
exact same list as the terminal's Bookmap metric select. Switching it recolors from the baked
column with **no recompute** — a complete duplicate of the Bookmap view.

Per bar, the renderer reads `d.timestamp()`, picks the segment with the greatest `t0 ≤ barEpoch`
(identical to the terminal's `gridAt`), and draws that segment's price rows as heat cells —
normalized per segment per metric (strict session isolation). Levels (`anchor`/`atm`/`pdsl`) draw
once on the last bar.

**To regenerate:** in the terminal, Chart → **Bookmap** → open the **TRADOVATE** sidebar (edge
tab, or the Bookmap "Tradovate" button) → **Generate indicator**. It copies the full script to the
clipboard and offers a `.js` download. Paste into Code Explorer. All metrics are baked, so you do
*not* regenerate to change metric — switch it in the indicator's parameters.

The synthetic `FieldModel` from earlier milestones is retired — the payload *is* the data source.
