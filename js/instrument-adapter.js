/* instrument-agnostic ingestion adapter (Steps 1,2,5) */
/* quan_instrument_adapter.js — instrument-agnostic reporting ingestion (Steps 1,2,5).
 *
 * Scope: reporting-tab ingestion + normalization + UI routing ONLY.
 * Does NOT touch engine, operators, Kelly, cascade, multiplier, or _clean.
 *
 * Step 1 detectInstrument()  -> INDEX | RATES | FX | METAL | OTHER (filename + data)
 * Step 2 normalize()         -> instrument-aware price normalization (no rounding,
 *                               fractional rates -> decimal, precision preserved)
 * Step 5 bindParser()        -> selected dropdown instrument drives the mode; if the
 *                               detected type disagrees, the binding is explicit and
 *                               surfaced (NO silent fallback to an index parser).
 */
(function (root) {
  "use strict";

  var FRAC = /^(-?)(\d+)-(\d{1,3})(\+?)(s?)$/;          // 13-01, 0-01s, 110-16+
  // Family detection roots come from the shared registry when it's loaded, so a
  // root added there (or a Barchart alias like e6/d6) is recognized here too.
  // The literal regexes remain both as fallback and for roots the registry
  // doesn't model (tn, ge, zq, m6, e7, j7, qo, qi).
  var FAMILY = (function () {
    var base = [
      [/^(nq|es|rty|ym|np|em)/i, "INDEX"],
      [/^(zn|zb|zf|zt|ub|tn|ge|sr|zq)/i, "RATES"],
      [/^(6e|6j|6b|6a|6c|6s|6n|6m|6l|m6|e7|j7)/i, "FX"],
      [/^(si|gc|hg|pl|pa|qo|qi)/i, "METAL"]
    ];
    var REG = (typeof window !== "undefined" && window.QuanInstruments) || null;
    if (!REG) return base;
    return ["INDEX", "RATES", "FX", "METAL"].map(function (fam, i) {
      var roots = REG.familyRoots(fam), extra = base[i][0].source.match(/\(([^)]*)\)/)[1].split("|");
      extra.forEach(function (r) { if (roots.indexOf(r) < 0) roots.push(r); });
      // longest-first so "sil" wins over "si", "sr3" over "sr"
      roots.sort(function (a, b) { return b.length - a.length; });
      return [new RegExp("^(" + roots.join("|").replace(/[^a-z0-9|]/g, "") + ")", "i"), fam];
    });
  })();

  function isFractional(s) { return FRAC.test(String(s).trim()); }
  function parseCSVLine(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) { var c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ""; } else cur += c; }
    out.push(cur); return out;
  }
  function toCSVLine(f) { return f.map(function (x) { return (/[",\n]/.test(x)) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(","); }
  function num(s) { var t = String(s).replace(/,/g, "").replace(/s$/, "").trim(); var v = parseFloat(t); return isFinite(v) ? v : null; }

  // ---- Step 1: deterministic detection ---------------------------------------
  function detectFromName(name) {
    if (!name) return null;
    var base = String(name).split(/[\/\\]/).pop().toLowerCase();
    for (var i = 0; i < FAMILY.length; i++) if (FAMILY[i][0].test(base)) return FAMILY[i][1];
    return null;
  }
  function detectFromData(text) {
    var rows = String(text).replace(/\r\n/g, "\n").split("\n");
    if (rows.length < 2) return "OTHER";
    var header = parseCSVLine(rows[0]).map(function (h) { return h.toLowerCase().trim(); });
    var strikeCol = header.indexOf("strike"); if (strikeCol < 0) strikeCol = 5;
    var anyFrac = false, strikes = [], maxDec = 0;
    for (var r = 1; r < rows.length && strikes.length < 80; r++) {
      if (!rows[r]) continue;
      var f = parseCSVLine(rows[r]);
      for (var c = 0; c < f.length; c++) if (isFractional(f[c].trim())) anyFrac = true;
      var sv = num(f[strikeCol]);
      if (sv != null) { strikes.push(Math.abs(sv));
        var dm = String(f[strikeCol]).split(".")[1]; if (dm) maxDec = Math.max(maxDec, dm.replace(/0+$/, "").length); }
    }
    if (anyFrac) return "RATES";
    if (!strikes.length) return "OTHER";
    strikes.sort(function (a, b) { return a - b; });
    var med = strikes[Math.floor(strikes.length / 2)];
    if (med < 5) return "FX";
    if (med >= 1000 && maxDec === 0) return "INDEX";
    if (maxDec >= 3) return "METAL";       // mid-magnitude high-precision
    if (med >= 1000) return "INDEX";
    return "OTHER";
  }
  function detectInstrument(text, filename) {
    return { byName: detectFromName(filename), byData: detectFromData(text) };
  }

  // ---- Step 2: instrument-aware normalization --------------------------------
  function detectDivisor(maxTick) { return maxTick < 32 ? 32 : maxTick < 64 ? 64 : 128; }
  function convertFrac(s, divisor) {
    var m = FRAC.exec(String(s).trim()); if (!m) return s;
    var sign = m[1] === "-" ? -1 : 1, whole = +m[2], ticks = +m[3], half = m[4] === "+" ? 0.5 : 0;
    return (sign * (whole + (ticks + half) / divisor)).toFixed(8).replace(/\.?0+$/, "");
  }
  function normalizeCSV(text, opts) {            // RATES fractional -> decimal; others pass-through (precision preserved)
    opts = opts || {};
    var rows = String(text).replace(/\r\n/g, "\n").split("\n");
    var maxTick = 0, anyFrac = false;
    for (var r = 1; r < rows.length; r++) { if (!rows[r]) continue; var f = parseCSVLine(rows[r]);
      for (var c = 0; c < f.length; c++) if (isFractional(f[c].trim())) { anyFrac = true; var t = +FRAC.exec(f[c].trim())[3]; if (t > maxTick) maxTick = t; } }
    if (!anyFrac) return { text: text, converted: 0, divisor: null };
    var divisor = opts.divisor || detectDivisor(maxTick), converted = 0;
    for (var r2 = 1; r2 < rows.length; r2++) { if (!rows[r2]) continue; var ff = parseCSVLine(rows[r2]);
      for (var c2 = 0; c2 < ff.length; c2++) if (isFractional(ff[c2].trim())) { ff[c2] = convertFrac(ff[c2], divisor); converted++; }
      rows[r2] = toCSVLine(ff); }
    return { text: rows.join("\n"), converted: converted, divisor: divisor };
  }

  // post-normalization guard: no price/strike cell should be unparseable (NaN collapse)
  function nanCheck(text) {
    var rows = String(text).replace(/\r\n/g, "\n").split("\n");
    var header = parseCSVLine(rows[0]).map(function (h) { return h.toLowerCase().trim(); });
    var cols = []; ["strike", "premium", "premium.1", "latest", "latest.1"].forEach(function (k) { var i = header.indexOf(k); if (i >= 0) cols.push(i); });
    var bad = 0;
    for (var r = 1; r < rows.length; r++) { if (!rows[r]) continue; var f = parseCSVLine(rows[r]);
      for (var ci = 0; ci < cols.length; ci++) { var v = f[cols[ci]]; if (v == null) continue; var s = String(v).trim();
        if (s === "" || /n\/?a/i.test(s)) continue; if (num(s) == null && !isFractional(s)) bad++; } }
    return bad;
  }

  // ---- Step 5: explicit dropdown -> parser binding (no index fallback) --------
  function bindParser(text, opts) {
    opts = opts || {};
    var det = detectInstrument(text, opts.filename);
    var selected = opts.selected ? (detectFromName(opts.selected) || String(opts.selected).toUpperCase()) : null;
    var detected = det.byName || det.byData;        // name preferred, data confirms
    var bound = selected || detected;                // selection drives the mode; never default-to-index silently
    var warnings = [];
    if (selected && det.byData && selected !== det.byData && !(selected === "RATES" && det.byData === "RATES"))
      warnings.push("selected=" + selected + " but data looks like " + det.byData + " — using explicit selection (no fallback)");
    var norm = normalizeCSV(text, opts);             // conversion is notation-driven (safe for every type)
    return { text: norm.text, instrument_type: bound, detected: detected, selected: selected,
             byName: det.byName, byData: det.byData, converted: norm.converted, divisor: norm.divisor,
             nan_residual: nanCheck(norm.text), warnings: warnings };
  }

  var api = { detectInstrument: detectInstrument, detectFromName: detectFromName, detectFromData: detectFromData,
              normalizeCSV: normalizeCSV, bindParser: bindParser, isFractional: isFractional,
              convertFrac: convertFrac, nanCheck: nanCheck };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.QuanInstrumentAdapter = api;
})(typeof window !== "undefined" ? window : this);


window.__qnorm=function(t){ try{ if(t && window.QuanInstrumentAdapter){ return window.QuanInstrumentAdapter.normalizeCSV(t).text; } }catch(_e){} return t; };