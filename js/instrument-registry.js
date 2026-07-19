/* instrument-registry.js — the single source of truth for instrument identity.
 *
 * Every place the engine previously kept its own instrument table (detector
 * dropdown groups, heatmap multiplier map, ingest-worker ROOT_MAP, auto-pull
 * contract builder, adapter family regexes) derives from this registry, so an
 * instrument added or corrected here is correct everywhere at once.
 *
 * Loaded three ways, one file:
 *   - classic <script> in app.html / heatmap.html   → window.QuanInstruments
 *   - ESM side-effect import in Workers (wrangler)  → globalThis.QuanInstruments
 *   - node (tests)                                  → module.exports
 *
 * Per instrument: [group, symbol, contractMultiplier, family, barchartRoots].
 * `barchartRoots` are the lowercase filename roots Barchart uses (first entry is
 * the primary — the one auto-pull builds contract symbols from). Roots equal to
 * the lowercased symbol may be omitted; they are implied.
 */
(function (g) {
  'use strict';

  // A page may supply its own instrument set BEFORE this script runs (the CBOE
  // clone sets g.__QUAN_INSTRUMENTS__ to a list of tickers). Defaults to the CME
  // futures universe below, so app.html / heatmap.html are unaffected.
  var DEF = g.__QUAN_INSTRUMENTS__ || [
    // group          sym     mult      family    extra barchart roots
    ['Equity Index', 'ES',       50, 'INDEX', []],
    ['Equity Index', 'MES',       5, 'INDEX', ['em']],
    ['Equity Index', 'NQ',       20, 'INDEX', []],
    ['Equity Index', 'MNQ',       2, 'INDEX', []],
    ['Equity Index', 'YM',        5, 'INDEX', []],
    ['Equity Index', 'MYM',     0.5, 'INDEX', []],
    ['Equity Index', 'RTY',      50, 'INDEX', ['er']],
    ['Equity Index', 'M2K',       5, 'INDEX', []],
    ['Rates',        'ZT',     2000, 'RATES', []],
    ['Rates',        'ZF',     1000, 'RATES', []],
    ['Rates',        'ZN',     1000, 'RATES', []],
    ['Rates',        'ZB',     1000, 'RATES', []],
    ['Rates',        'UB',     1000, 'RATES', []],
    ['Rates',        'SR3',    2500, 'RATES', []],
    ['FX',           '6E',   125000, 'FX',    ['e6']],
    ['FX',           '6B',    62500, 'FX',    ['b6']],
    ['FX',           '6J', 12500000, 'FX',    ['j6']],
    ['FX',           '6A',   100000, 'FX',    ['a6']],
    ['FX',           '6C',   100000, 'FX',    ['d6']],
    ['FX',           '6S',   125000, 'FX',    ['s6']],
    ['FX',           '6N',   100000, 'FX',    ['n6']],
    ['Metals',       'GC',      100, 'METAL', []],
    ['Metals',       'MGC',      10, 'METAL', []],
    ['Metals',       'SI',     5000, 'METAL', []],
    ['Metals',       'SIL',    1000, 'METAL', []],
    ['Metals',       'HG',    25000, 'METAL', []],
    ['Metals',       'PL',       50, 'METAL', []],
    ['Metals',       'PA',      100, 'METAL', []],
    ['Energy',       'CL',     1000, 'ENERGY', []],
    ['Energy',       'QM',      500, 'ENERGY', []],
    ['Energy',       'NG',    10000, 'ENERGY', []],
    ['Energy',       'RB',    42000, 'ENERGY', []],
    ['Energy',       'HO',    42000, 'ENERGY', []],
    ['Energy',       'BZ',     1000, 'ENERGY', []],
    ['Ags',          'ZC',       50, 'AGS',   []],
    ['Ags',          'ZW',       50, 'AGS',   []],
    ['Ags',          'ZS',       50, 'AGS',   []],
    ['Ags',          'ZM',      100, 'AGS',   []],
    ['Ags',          'ZL',      600, 'AGS',   []],
    ['Ags',          'KE',       50, 'AGS',   []],
    ['Ags',          'ZO',       50, 'AGS',   []],
    ['Ags',          'ZR',     2000, 'AGS',   []],
    ['Livestock',    'LE',      400, 'LIVESTOCK', []],
    ['Livestock',    'GF',      500, 'LIVESTOCK', []],
    ['Livestock',    'HE',      400, 'LIVESTOCK', []],
    ['Dairy',        'DC',     2000, 'DAIRY', []],
    ['Crypto',       'BTC',       5, 'CRYPTO', ['bt']],
    ['Crypto',       'MBT',     0.1, 'CRYPTO', []],
    ['Crypto',       'ETH',      50, 'CRYPTO', ['et']]
  ];

  var BY_SYM = {}, BY_ROOT = {}, GROUP_ORDER = [], GROUPS = {};
  for (var i = 0; i < DEF.length; i++) {
    var d = DEF[i];
    // Explicit Barchart roots come FIRST (they are the primary — what auto-pull
    // builds contract symbols from); the implied lowercase symbol root follows.
    var rec = { group: d[0], sym: d[1], mult: d[2], family: d[3], roots: d[4].concat(d[1].toLowerCase()) };
    BY_SYM[rec.sym] = rec;
    for (var r = 0; r < rec.roots.length; r++) {
      // first definition of a root wins — keeps root→symbol resolution deterministic
      if (!(rec.roots[r] in BY_ROOT)) BY_ROOT[rec.roots[r]] = rec.sym;
    }
    if (!GROUPS[rec.group]) { GROUPS[rec.group] = []; GROUP_ORDER.push(rec.group); }
    GROUPS[rec.group].push(rec.sym);
  }

  // Futures month codes (F=Jan … Z=Dec), as used in Barchart contract names.
  var MONTH_CODES = 'fghjkmnquvxz';
  var CONTRACT_RE = new RegExp('^([a-z0-9]+?)([' + MONTH_CODES + '])(\\d{1,2})(?!\\d)');

  /* Parse a leading Barchart contract token out of a filename or symbol,
   * e.g. "e6u26-volatility-greeks-…" → {inst:'6E', root:'e6', month:'u', year:'26'}.
   * Returns null when no contract token is recognizable. */
  function parseContract(name) {
    if (!name) return null;
    var base = String(name).toLowerCase().split(/[\/\\]/).pop();
    var m = base.match(CONTRACT_RE);
    if (!m) return null;
    return { inst: fromRoot(m[1]), root: m[1], month: m[2], year: m[3] };
  }

  /* Barchart filename root → UI symbol. Unknown roots pass through uppercased so
   * new instruments degrade gracefully instead of vanishing. */
  function fromRoot(root) {
    root = String(root || '').toLowerCase();
    return BY_ROOT[root] || root.toUpperCase();
  }

  /* UI symbol → primary Barchart root (for building contract names). */
  function rootOf(sym) {
    var rec = BY_SYM[String(sym || '').toUpperCase()];
    return rec ? rec.roots[0] : String(sym || '').toLowerCase();
  }

  /* Build a Barchart contract symbol, e.g. ('6E','M','25') → 'E6M25'. */
  function contractFor(sym, monthCode, yy) {
    return (rootOf(sym) + String(monthCode || '') + String(yy || '')).toUpperCase();
  }

  /* Add an instrument at runtime (the CBOE clone creates a ticker per uploaded
   * dataset). Idempotent; returns the record. Defaults suit options: 100
   * shares/contract, INDEX family (decimal strikes, no fractional handling). */
  function register(sym, group, mult, family) {
    sym = String(sym || '').toUpperCase(); if (!sym) return null;
    if (BY_SYM[sym]) return BY_SYM[sym];
    var rec = { group: group || 'Uploaded', sym: sym, mult: mult || 100,
                family: family || 'INDEX', roots: [sym.toLowerCase()] };
    BY_SYM[sym] = rec;
    if (!(rec.roots[0] in BY_ROOT)) BY_ROOT[rec.roots[0]] = sym;
    if (!GROUPS[rec.group]) { GROUPS[rec.group] = []; GROUP_ORDER.push(rec.group); }
    GROUPS[rec.group].push(sym);
    return rec;
  }

  function get(sym) { return BY_SYM[String(sym || '').toUpperCase()] || null; }
  function mult(sym) { var r = get(sym); return r ? r.mult : null; }
  function family(sym) { var r = get(sym); return r ? r.family : 'OTHER'; }

  /* Dropdown-shaped groups: [[groupLabel, [[sym, sym], …]], …] (detector format). */
  function groups() {
    return GROUP_ORDER.map(function (gname) {
      return [gname, GROUPS[gname].map(function (s) { return [s, s]; })];
    });
  }

  /* All lowercase roots belonging to a family — for name-based family detection. */
  function familyRoots(fam) {
    var out = [];
    for (var s in BY_SYM) if (BY_SYM[s].family === fam) out = out.concat(BY_SYM[s].roots);
    return out;
  }

  var api = {
    DEF: DEF, MONTH_CODES: MONTH_CODES,
    get: get, mult: mult, family: family, groups: groups, familyRoots: familyRoots, register: register,
    fromRoot: fromRoot, rootOf: rootOf, contractFor: contractFor, parseContract: parseContract,
    symbols: function () { return Object.keys(BY_SYM); }
  };

  g.QuanInstruments = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
