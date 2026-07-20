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
    /* thermal ramp mirrors the terminal's STOPS (chart-heat.js) closely */
    var MAPS = {
        thermal:   [[0, [6, 12, 24]], [0.2, [10, 36, 70]], [0.45, [14, 90, 160]], [0.68, [30, 150, 210]], [0.84, [90, 210, 235]], [0.93, [255, 205, 70]], [1, [255, 120, 30]]],
        spectral:  [[0, [10, 10, 40]], [0.22, [24, 72, 180]], [0.42, [16, 170, 168]], [0.6, [120, 200, 60]], [0.8, [240, 190, 40]], [1, [220, 40, 32]]],
        ice:       [[0, [4, 6, 16]], [0.4, [16, 52, 120]], [0.7, [40, 150, 210]], [1, [224, 244, 255]]],
        mono:      [[0, [16, 17, 20]], [0.6, [110, 113, 122]], [1, [245, 245, 247]]],
        magma:     [[0, [6, 6, 10]], [0.35, [122, 20, 90]], [0.6, [224, 86, 90]], [0.82, [246, 160, 90]], [1, [252, 253, 191]]]
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
        out.push({ date: seg.date, t0: seg.t0, anchor: seg.anchor, atm: seg.atm, pdsl: seg.pdsl || [], cells: cells });
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
   MODULE 3 — ScalarFieldRenderer   segment column -> translucent heat cells
   Cells are Rectangles inside `Shapes` groups (FillStyle supports opacity, so
   the candles read through the field). Intensity is quantized into N buckets so
   each bar emits <= N Shapes groups (perf) instead of one object per cell. The
   whole column is wrapped in a Container with a negative ZIndex to push the
   field BEHIND the price where the platform honors it. Rectangle position is the
   CENTER of the cell (unlike Instancing's corner).
   ========================================================================== */
var FIELD_BUCKETS = 16;
function fieldItem(index, seg, cfg) {
    var buckets = {}, i, bi, c;
    for (i = 0; i < seg.cells.length; i++) {
        c = seg.cells[i];
        if (c.t < cfg.minValue) continue;
        bi = Math.round(c.t * (FIELD_BUCKETS - 1));
        if (bi < 0) bi = 0; else if (bi > FIELD_BUCKETS - 1) bi = FIELD_BUCKETS - 1;
        (buckets[bi] || (buckets[bi] = [])).push({
            tag: 'Rectangle',
            position: { x: du(index), y: du((c.pLow + c.pHigh) / 2) },   // Rectangle = centered
            size: { width: du(1), height: du(c.pHigh - c.pLow) }
        });
    }
    var groups = [], k;
    for (k in buckets) {
        if (!buckets.hasOwnProperty(k)) continue;
        groups.push({
            tag: 'Shapes', key: 'qf' + k,
            primitives: buckets[k],
            fillStyle: { color: ColorEngine.hex(cfg.palette, (+k) / (FIELD_BUCKETS - 1), cfg.gamma), opacity: cfg.opacity }
        });
    }
    if (!groups.length) return null;
    return { tag: 'Container', key: 'quanField', children: groups, transformOps: [{ tag: 'ZIndex', zIndex: -50 }] };
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
        var ci = colIndexOf(PAYLOAD, this.props.metric);
        this.segs = buildSegments(PAYLOAD, ci);
        this.cfg = { palette: this.props.palette, gamma: this.props.gamma, minValue: this.props.minValue, opacity: this.props.opacity };
    }

    map(d) {
        if (!this.segs.length) return {};
        var epoch = Math.floor(d.timestamp().getTime() / 1000);
        var seg = segmentAt(this.segs, epoch);
        if (!seg) return {};

        var items = [];
        var f = fieldItem(d.index(), seg, this.cfg);
        if (f) items.push(f);
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
    params: {
        metric: predef.paramSpecs.enum(METRIC_SET, DEFAULT_METRIC),   // <- the Bookmap metric dropdown
        palette: predef.paramSpecs.enum(
            { thermal: "Thermal", spectral: "Spectral", ice: "Ice", mono: "Mono", magma: "Magma" },
            "thermal"
        ),
        opacity: predef.paramSpecs.percent(0.5, 0.05, 0.05, 1),   // field transparency (candles read through)
        gamma: predef.paramSpecs.number(0.85, 0.05, 0.1),
        minValue: predef.paramSpecs.percent(0.04, 0.01, 0, 1)
    }
};
