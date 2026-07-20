/* ============================================================================
   ColorEngine  —  Qu'an colormaps for the Tradovate sandbox
   ----------------------------------------------------------------------------
   Pure, window-free port of the colormap logic in js/scalar-field.js. Runs
   inside Tradovate's CommonJS Code Explorer sandbox (no DOM, no window).

   A colormap maps a scalar t in [0,1] to a color. Two output forms are needed
   by the Tradovate graphics API:
     rgb01(name)(t)  -> { r, g, b } in 0..1   (for Instancing / Dots colors)
     hex(name)(t)    -> "#rrggbb"             (for LineSegments / Text / fills)

   Single responsibility: color only. It knows nothing about fields or price.
   ============================================================================ */

function lerp(a, b, t) { return a + (b - a) * t; }

/* stops: [[position, [r,g,b]], ...] with position ascending in [0,1] */
function ramp(stops, t) {
    if (t <= 0) return stops[0][1].slice();
    if (t >= 1) return stops[stops.length - 1][1].slice();
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
    return stops[stops.length - 1][1].slice();
}

/* palettes ported verbatim from js/scalar-field.js COLORMAPS */
var COLORMAPS = {
    thermal:   [[0, [6, 6, 10]], [0.35, [122, 20, 10]], [0.6, [224, 86, 12]], [0.82, [246, 190, 54]], [1, [255, 250, 220]]],
    spectral:  [[0, [10, 10, 40]], [0.22, [24, 72, 180]], [0.42, [16, 170, 168]], [0.6, [120, 200, 60]], [0.8, [240, 190, 40]], [1, [220, 40, 32]]],
    viridis:   [[0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 145, 140]], [0.75, [94, 201, 98]], [1, [253, 231, 37]]],
    ice:       [[0, [4, 6, 16]], [0.4, [16, 52, 120]], [0.7, [40, 150, 210]], [1, [224, 244, 255]]],
    mono:      [[0, [10, 10, 12]], [1, [236, 236, 240]]],
    /* signed/diverging: 0.5 = zero (near-black), cold negative, hot positive */
    diverging: [[0, [64, 150, 238]], [0.3, [22, 48, 110]], [0.5, [12, 12, 16]], [0.7, [120, 40, 28]], [1, [244, 96, 58]]]
};

var NAMES = Object.keys(COLORMAPS);

function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }

/* apply an intensity gamma before the ramp (contrast shaping) */
function shaped(t, gamma) { t = clamp01(t); return gamma === 1 ? t : Math.pow(t, gamma); }

function stopsFor(name) { return COLORMAPS[name] || COLORMAPS.thermal; }

/* rgb01(name)(t[,gamma]) -> {r,g,b} in 0..1 for Instancing.color / Dot.color */
function rgb01(name) {
    var stops = stopsFor(name);
    return function (t, gamma) {
        var c = ramp(stops, shaped(t, gamma || 1));
        return { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 };
    };
}

function toHex2(n) { var s = (n | 0).toString(16); return s.length === 1 ? '0' + s : s; }

/* hex(name)(t[,gamma]) -> "#rrggbb" for LineSegments / Text / FillStyle */
function hex(name) {
    var stops = stopsFor(name);
    return function (t, gamma) {
        var c = ramp(stops, shaped(t, gamma || 1));
        return '#' + toHex2(c[0]) + toHex2(c[1]) + toHex2(c[2]);
    };
}

module.exports = {
    NAMES: NAMES,
    rgb01: rgb01,
    hex: hex,
    ramp: ramp,
    clamp01: clamp01
};
