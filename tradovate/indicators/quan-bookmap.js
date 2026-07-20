/* ============================================================================
   Qu'an Bookmap  —  native Tradovate custom indicator                (v5)
   ----------------------------------------------------------------------------
   A COMPLETE duplicate of the Qu'an terminal's Chart-tab Bookmap, inside
   Tradovate — driven by a baked PAYLOAD, not recomputed. The Tradovate twin of
   the TradingView / Pine payload. The payload carries EVERY heat metric, so the
   indicator exposes its own metric dropdown (parameter) exactly like the
   terminal's Bookmap metric select — switch it to recolor with no recompute.

   Philosophy:  Tradovate owns the chart. The Qu'an owns the mathematics.

   Rendering path: the declarative GRAPHICS API (map -> graphics.items).
     du/px/op MUST be imported (they are not globals):
       const { px, du, op } = require("./tools/graphics");
     - Instancing   -> heat cells (per-instance color = the bookmap column)
     - LineSegments -> PDSL / anchor / ATM structural levels
     - Text         -> level labels (global)

   Bar<->segment alignment: each segment carries t0 (session-start epoch, sec).
   Per bar we read d.timestamp() and pick the segment with the greatest
   t0 <= barEpoch (identical to the terminal's gridAt). No timezone math runs in
   the sandbox — the epochs are baked by the generator.
   ============================================================================ */
const predef = require("./tools/predef");
const { px, du, op } = require("./tools/graphics");
/* RENDER_MODE is baked by the terminal generator (Bookmap sidebar → Render).
   Both modes use the PROVEN graphics-return path (no custom plotter — the canvas
   drawHeatmap path blanks and even hides the price on this build):
     "bands" — translucent LineSegments bands. LineSegments is the one working
               primitive with a real alpha channel (lineStyle.opacity), so
               candles read THROUGH the field and the opacity control works.
     "cells" — opaque Instancing filled cells (du-scaled). Solid; draws over price. */
//QUAN_MODE_BEGIN
var RENDER_MODE = "bands";
//QUAN_MODE_END

/* The terminal generator replaces everything between the two sentinel lines
   below with `const PAYLOAD = {...}`. Shape (v2, all-metrics):
   { v:2, inst, defaultMetric, pdec,
     metrics: [[key, label], ...],           // populates the metric dropdown
     cols: ["k", metricKey1, metricKey2, ...],// row column order; k = price
     segments: [ { date, t0, anchor, atm,
                   rows: [[k, v1, v2, ...], ...],   // k ascending; values per cols
                   pdsl: [[price, "S"|"R"], ...] }, ... ] sorted by t0 asc }
   The sample below is illustrative so the file runs stand-alone. */
//QUAN_PAYLOAD_BEGIN
const PAYLOAD = {
    v: 2, inst: "SAMPLE", defaultMetric: "oi", pdec: 2,
    metrics: [["oi", "OI (C+P)"], ["vol", "Volume (C+P)"]],
    cols: ["k", "oi", "vol"],
    segments: [
        {
            date: "2026-07-13", t0: 1752444000, anchor: 110.50, atm: 110.50,
            rows: [
                [110.00, 320, 120], [110.25, 1400, 800], [110.50, 5200, 3100], [110.75, 2600, 1500],
                [111.00, 4100, 2600], [111.25, 900, 400], [111.50, 1800, 700], [111.75, 260, 90]
            ],
            pdsl: [[110.25, "S"], [111.00, "R"]]
        },
        {
            date: "2026-07-14", t0: 1752530400, anchor: 110.75, atm: 111.00,
            rows: [
                [110.25, 500, 260], [110.50, 2100, 1400], [110.75, 3300, 2000], [111.00, 6100, 3800],
                [111.25, 3800, 2200], [111.50, 2400, 1500], [111.75, 1200, 700], [112.00, 400, 180]
            ],
            pdsl: [[110.50, "S"], [111.50, "R"]]
        }
    ]
};
//QUAN_PAYLOAD_END

/* ==========================================================================
   MODULE 1 — ColorEngine   (port of js/scalar-field.js colormaps)
   t in [0,1] -> color. rgb01 for Instancing, hex for lines/text.
   ========================================================================== */
const ColorEngine = (function () {
    function lerp(a, b, t) { return a + (b - a) * t; }
    function ramp(stops, t) {
        if (t <= 0) return stops[0][1];
        if (t >= 1) return stops[stops.length - 1][1];
        for (var i = 1; i < stops.length; i++) {
            if (t <= stops[i][0]) {
                var s0 = stops[i - 1], s1 = stops[i];
                var u = (t - s0[0]) / ((s1[0] - s0[0]) || 1);
                return [
                    Math.round(lerp(s0[1][0], s1[1][0], u)),
                    Math.round(lerp(s0[1][1], s1[1][1], u)),
                    Math.round(lerp(s0[1][2], s1[1][2], u))
                ];
            }
        }
        return stops[stops.length - 1][1];
    }
    /* thermal ramp mirrors the terminal's STOPS (chart-heat.js). Low ends are
       lifted off pure black so low-intensity strikes stay visible — the field
       reads as a continuous wash (like the terminal) instead of a few bright
       bands on black. */
    var MAPS = {
        thermal:   [[0, [22, 52, 96]], [0.25, [24, 88, 150]], [0.5, [30, 150, 210]], [0.72, [90, 210, 235]], [0.86, [230, 210, 120]], [1, [255, 120, 30]]],
        spectral:  [[0, [40, 44, 110]], [0.25, [30, 110, 200]], [0.45, [16, 170, 168]], [0.62, [120, 200, 60]], [0.8, [240, 190, 40]], [1, [220, 40, 32]]],
        ice:       [[0, [24, 44, 92]], [0.4, [26, 96, 170]], [0.7, [70, 180, 225]], [1, [224, 244, 255]]],
        mono:      [[0, [60, 62, 70]], [0.6, [150, 153, 162]], [1, [245, 245, 247]]],
        magma:     [[0, [60, 26, 74]], [0.35, [150, 40, 110]], [0.6, [224, 86, 90]], [0.82, [246, 170, 100]], [1, [252, 253, 191]]]
    };
    function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
    function shaped(t, g) { t = clamp01(t); return g === 1 ? t : Math.pow(t, g); }
    function hex2(n) { var s = (n | 0).toString(16); return s.length === 1 ? '0' + s : s; }
    return {
        clamp01: clamp01,
        rgb01: function (name, t, gamma) {
            var c = ramp(MAPS[name] || MAPS.thermal, shaped(t, gamma || 1));
            return { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 };
        },
        hex: function (name, t, gamma) {
            var c = ramp(MAPS[name] || MAPS.thermal, shaped(t, gamma || 1));
            return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
        },
        // 8-digit hex with alpha, for canvas.drawHeatmap true transparency
        hex8: function (name, t, gamma, alpha) {
            var c = ramp(MAPS[name] || MAPS.thermal, shaped(t, gamma || 1));
            return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]) + hex2(Math.round(255 * clamp01(alpha)));
        }
    };
})();

/* ==========================================================================
   MODULE 2 — PayloadModel   parse the baked payload for ONE selected metric
   Per segment: price-binned cells (edges at strike midpoints — terminal parity)
   normalized 0..1 by that segment's own max for the chosen metric column
   (strict session isolation). Switching the metric param rebuilds these.
   ========================================================================== */
function metricList(payload) {
    var out = (payload.metrics || []).slice();
    if (!out.length) { // derive from cols if metrics list absent
        for (var i = 1; i < (payload.cols || []).length; i++) out.push([payload.cols[i], payload.cols[i]]);
    }
    return out;
}
function colIndexOf(payload, metricKey) {
    var cols = payload.cols || ["k"];
    var idx = cols.indexOf(metricKey);
    return idx > 0 ? idx : (cols.length > 1 ? 1 : -1);   // fallback: first metric column
}

function buildSegments(payload, ci) {
    if (ci < 0) return [];
    var segs = (payload.segments || []).slice().sort(function (a, b) { return a.t0 - b.t0; });
    var out = [];
    for (var s = 0; s < segs.length; s++) {
        var seg = segs[s];
        var rows = (seg.rows || []).slice().sort(function (a, b) { return a[0] - b[0]; });
        var n = rows.length, i, max = 1e-9, cells = [];
        for (i = 0; i < n; i++) { var vv = rows[i][ci]; if (vv > max) max = vv; }
        for (i = 0; i < n; i++) {
            var k = rows[i][0], lo, hi;
            if (n === 1) { lo = k - 0.5; hi = k + 0.5; }
            else if (i === 0) { lo = k - (rows[1][0] - k) / 2; hi = (k + rows[1][0]) / 2; }
            else if (i === n - 1) { lo = (rows[n - 2][0] + k) / 2; hi = k + (k - rows[n - 2][0]) / 2; }
            else { lo = (rows[i - 1][0] + k) / 2; hi = (rows[i + 1][0] + k) / 2; }
            cells.push({ pLow: lo, pHigh: hi, t: (rows[i][ci] || 0) / max });
        }
        // sorted level ladder (anchor + atm + pdsl) for the color-flip mechanic
        var levels = [], pd = seg.pdsl || [], pi;
        if (isFinite(seg.anchor)) levels.push(seg.anchor);
        if (isFinite(seg.atm)) levels.push(seg.atm);
        for (pi = 0; pi < pd.length; pi++) if (isFinite(pd[pi][0])) levels.push(pd[pi][0]);
        levels.sort(function (a, b) { return a - b; });
        out.push({ date: seg.date, t0: seg.t0, anchor: seg.anchor, atm: seg.atm, pdsl: pd, cells: cells, levels: levels });
    }
    return out;
}

/* pick the segment governing a bar epoch: greatest t0 <= epoch (terminal gridAt) */
function segmentAt(segs, epoch) {
    if (!segs.length) return null;
    var g = segs[0];
    for (var i = 0; i < segs.length; i++) { if (segs[i].t0 <= epoch) g = segs[i]; else break; }
    return g;
}

/* ==========================================================================
   MODULE 3 — ScalarFieldRenderer   segment column -> Instancing cells
   Uses the PROVEN Instancing primitive (batched, per-instance color) so it
   always renders. Instancing carries no alpha, so "opacity" is faked by
   blending each cell colour toward the dark chart background: at opacity 1 the
   colour is full; lower values fade it toward the backdrop so candles/price
   read clearly. One GPU-batched rectangle per price bin; position is the cell's
   lower-left corner (Instancing convention), size in domain units so cells tile.
   ========================================================================== */
var FIELD_BG = { r: 0.05, g: 0.055, b: 0.065 };   // ~Tradovate dark pane background
function fieldItem(index, seg, cfg) {
    var inst = [], al = cfg.opacity;   // NOTE: not `op` — that's the coord helper
    for (var i = 0; i < seg.cells.length; i++) {
        var c = seg.cells[i];
        if (c.t < cfg.minValue) continue;
        var col = ColorEngine.rgb01(cfg.palette, c.t, cfg.gamma);
        inst.push({
            position: { x: op(du(index), '-', du(0.5)), y: du(c.pLow) },
            size: { width: du(1), height: du(c.pHigh - c.pLow) },
            color: {
                r: FIELD_BG.r + (col.r - FIELD_BG.r) * al,
                g: FIELD_BG.g + (col.g - FIELD_BG.g) * al,
                b: FIELD_BG.b + (col.b - FIELD_BG.b) * al
            }
        });
    }
    return inst.length ? { tag: 'Instancing', key: 'quanField', instances: inst } : null;
}

/* ==========================================================================
   MODULE 3b — BandRenderer   segment cells -> translucent LineSegments bands
   Each price bin becomes a horizontal Line (bandPx thick) spanning the bar, so
   adjacent bars tile into continuous horizontal bands across the whole session.
   LineSegments' lineStyle.opacity gives TRUE transparency — the one graphics
   primitive with a working alpha channel on this build — so candles read
   through and the opacity control has real effect. One LineSegments group per
   colour bucket keeps the object count low.
   ========================================================================== */
var BAND_BUCKETS = 14;
function bandItems(index, seg, cfg) {
    var buckets = {}, i, bi, c;
    for (i = 0; i < seg.cells.length; i++) {
        c = seg.cells[i];
        if (c.t < cfg.minValue) continue;
        bi = Math.round(c.t * (BAND_BUCKETS - 1));
        if (bi < 0) bi = 0; else if (bi > BAND_BUCKETS - 1) bi = BAND_BUCKETS - 1;
        var mid = (c.pLow + c.pHigh) / 2;
        (buckets[bi] || (buckets[bi] = [])).push({
            tag: 'Line',
            a: { x: op(du(index), '-', du(0.5)), y: du(mid) },
            b: { x: op(du(index), '+', du(0.5)), y: du(mid) }
        });
    }
    var out = [], k;
    for (k in buckets) {
        if (!buckets.hasOwnProperty(k)) continue;
        out.push({
            tag: 'LineSegments', key: 'qb' + k,
            lines: buckets[k],
            lineStyle: { lineWidth: cfg.bandPx, color: ColorEngine.hex(cfg.palette, (+k) / (BAND_BUCKETS - 1), cfg.gamma), opacity: cfg.opacity }
        });
    }
    return out;
}

/* ==========================================================================
   MODULE 4 — LevelRenderer   PDSL / anchor / ATM -> LineSegments + Text
   ========================================================================== */
function levelItems(index, seg, pdec) {
    var out = [], i;
    function line(id, price, color) {
        out.push({
            tag: 'LineSegments', key: 'lvl_' + id,
            lines: [{ tag: 'Line', a: { x: du(0), y: du(price) }, b: { x: du(index), y: du(price) }, infiniteStart: true, infiniteEnd: true }],
            lineStyle: { lineWidth: 1, color: color }
        });
    }
    function label(id, price, text, color) {
        out.push({
            tag: 'Text', key: 'lbl_' + id,
            point: { x: op(du(index), '-', px(4)), y: op(du(price), '-', px(2)) },
            text: text, style: { fontSize: 11, fontWeight: 'bold', fill: color },
            textAlignment: 'rightMiddle', global: true
        });
    }
    if (isFinite(seg.anchor)) { line('anchor', seg.anchor, '#ffd24a'); label('anchor', seg.anchor, 'ANCHOR ' + seg.anchor.toFixed(pdec), '#ffd24a'); }
    if (isFinite(seg.atm) && seg.atm !== seg.anchor) { line('atm', seg.atm, '#c0c8d4'); label('atm', seg.atm, 'ATM ' + seg.atm.toFixed(pdec), '#c0c8d4'); }
    for (i = 0; i < seg.pdsl.length; i++) {
        var price = seg.pdsl[i][0], side = seg.pdsl[i][1];
        var isSup = (side === 'S' || side === 'support');
        var col = isSup ? '#1aa179' : '#d65a1e';
        line('pd' + i, price, col);
        label('pd' + i, price, (isSup ? 'S ' : 'R ') + price.toFixed(pdec), col);
    }
    return out;
}

/* dropdown set built from the baked payload — the indicator's metric selector
   mirrors the terminal's Bookmap metric list exactly. */
var METRICS = metricList(PAYLOAD);
var METRIC_SET = {};
for (var _mi = 0; _mi < METRICS.length; _mi++) METRIC_SET[METRICS[_mi][0]] = METRICS[_mi][1];
if (!METRICS.length) { METRIC_SET = { oi: "OI" }; }
var DEFAULT_METRIC = PAYLOAD.defaultMetric || (METRICS[0] && METRICS[0][0]) || "oi";

/* ==========================================================================
   CALCULATOR — wires the payload into Tradovate's map lifecycle
   ========================================================================== */
class quanBookmap {
    init() {
        this.pdec = (PAYLOAD.pdec != null) ? PAYLOAD.pdec : 2;
        this.mode = RENDER_MODE;
        var ci = colIndexOf(PAYLOAD, this.props.metric);
        this.segs = buildSegments(PAYLOAD, ci);
        this.cfg = { palette: this.props.palette, gamma: this.props.gamma, minValue: this.props.minValue, opacity: this.props.opacity, bandPx: this.props.bandPx };
        this.colorFlip = this.props.colorFlip !== false;
        this.flipPalette = this.props.flipPalette;
    }

    // effective palette for a bar: flips to flipPalette each time price crosses a
    // level (parity of levels below price), so the field recolours as price
    // traverses the ladder — the color-flip mechanic.
    _cfgFor(seg, price) {
        var pal = this.cfg.palette;
        if (this.colorFlip && seg.levels && seg.levels.length) {
            var below = 0, li;
            for (li = 0; li < seg.levels.length; li++) if (seg.levels[li] < price) below++;
            if (below % 2 === 1) pal = this.flipPalette;
        }
        if (pal === this.cfg.palette) return this.cfg;
        return { palette: pal, gamma: this.cfg.gamma, minValue: this.cfg.minValue, opacity: this.cfg.opacity, bandPx: this.cfg.bandPx };
    }

    map(d) {
        if (!this.segs.length) return {};
        var epoch = Math.floor(d.timestamp().getTime() / 1000);
        var seg = segmentAt(this.segs, epoch);
        if (!seg) return {};

        var cfg = this._cfgFor(seg, d.value());
        var items = [];
        if (this.mode === 'bands') {
            var b = bandItems(d.index(), seg, cfg);
            for (var bx = 0; bx < b.length; bx++) items.push(b[bx]);
        } else {
            var f = fieldItem(d.index(), seg, cfg);
            if (f) items.push(f);
        }
        if (d.isLast()) {
            var lv = levelItems(d.index(), seg, this.pdec);
            for (var i = 0; i < lv.length; i++) items.push(lv[i]);
        }
        return { graphics: { items: items } };
    }
}

module.exports = {
    name: "quanBookmap",
    description: "Qu'an Bookmap — terminal payload (" + (PAYLOAD.inst || "") + ")",
    calculator: quanBookmap,
    tags: ["Qu'an"],
    inputType: "any",     // works on any chart: time bars, tick, renko, range, volume…
    areaChoice: "overlay",
    // No custom plotter — both modes render from map()'s graphics (proven path).
    params: {
        metric: predef.paramSpecs.enum(METRIC_SET, DEFAULT_METRIC),   // <- the Bookmap metric dropdown
        palette: predef.paramSpecs.enum(
            { thermal: "Thermal", spectral: "Spectral", ice: "Ice", mono: "Mono", magma: "Magma" },
            "thermal"
        ),
        colorFlip: predef.paramSpecs.bool(true),                   // flip palette as price crosses levels
        flipPalette: predef.paramSpecs.enum(
            { thermal: "Thermal", spectral: "Spectral", ice: "Ice", mono: "Mono", magma: "Magma" },
            "magma"
        ),
        opacity: predef.paramSpecs.percent(0.72, 0.05, 0.05, 1),   // TRUE transparency in bands mode
        bandPx: predef.paramSpecs.number(26, 1, 2),                // band thickness in px (bands mode)
        gamma: predef.paramSpecs.number(0.55, 0.05, 0.1),          // <1 boosts low values → fuller field
        minValue: predef.paramSpecs.percent(0, 0.01, 0, 1)         // 0 = colour every strike (continuous wash)
    }
};
