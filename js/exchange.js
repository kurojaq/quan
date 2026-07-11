/* ==========================================================================
   exchange.js — global exchange context (CME ⇄ CBOE).

   Single source of truth for "which exchange is the terminal scoped to," and the
   per-exchange session clock. Mirrors engine quan_cboe.py EXCHANGE_HOURS so the
   JS Chronometer and the Python golden-reference agree on session boundaries.

     CME   index futures (Globex): 18:00 ET (prev day) → 17:00 ET = 82800 s (wraps midnight)
     CBOE  index options (RTH):    09:30 ET            → 16:15 ET = 24300 s

   window.__exchange           active exchange id ("CME" | "CBOE")
   QuanExchange.get()          -> "CME" | "CBOE"
   QuanExchange.set(id)        persist + dispatch 'quan:exchange' (detail={exchange})
   QuanExchange.hours(id?)     -> {open,close,span_s,wraps_midnight,tz,label}
   QuanExchange.sessionFraction(id?, date?) -> τ in [0,1] for that exchange's clock
   QuanExchange.marketClosed(id?, date?)    -> bool (weekend / outside RTH-ish)
   ========================================================================== */
(function (root) {
  "use strict";

  var HOURS = {
    CME:  { open: "18:00", close: "17:00", span_s: 82800, wraps_midnight: true,
            tz: "America/New_York", label: "CME Globex", openSod: 64800 },
    CBOE: { open: "09:30", close: "16:15", span_s: 24300, wraps_midnight: false,
            tz: "America/New_York", label: "CBOE RTH", openSod: 34200 }
  };

  var LS_KEY = "quan:exchange";
  var _active = "CME";
  try { var s = localStorage.getItem(LS_KEY); if (s && HOURS[s]) _active = s; } catch (_) {}
  root.__exchange = _active;

  var _fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false,
    weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  function etParts(date) {
    var P = {}, parts = _fmt.formatToParts(date || new Date());
    for (var i = 0; i < parts.length; i++) P[parts[i].type] = parts[i].value;
    var h = +P.hour; if (h >= 24) h -= 24;
    return { weekday: P.weekday, h: h, sod: h * 3600 + (+P.minute) * 60 + (+P.second) };
  }

  function hours(id) { return HOURS[(id || _active)] || HOURS.CME; }

  // τ in [0,1]: elapsed fraction of the exchange's session. CME opens 18:00 the
  // prior day (wraps midnight); CBOE is a same-day RTH window.
  function sessionFraction(id, date) {
    var H = hours(id), P = etParts(date), el;
    if (H.wraps_midnight) {
      // 18:00 ET open: after open counts from open; before, add the pre-midnight span (21600s = 6h)
      el = (P.h >= 18) ? (P.sod - H.openSod) : (P.sod + (86400 - H.openSod));
    } else {
      el = P.sod - H.openSod;
    }
    var t = el / H.span_s;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }

  function marketClosed(id, date) {
    var H = hours(id), P = etParts(date), d = P.weekday;
    if (H.wraps_midnight) {  // CME: closed Sat, Fri after 17:00, Sun before 18:00
      return d === "Sat" || (d === "Fri" && P.h >= 17) || (d === "Sun" && P.h < 18);
    }
    // CBOE RTH: closed on weekends and outside 09:30–16:15 ET
    if (d === "Sat" || d === "Sun") return true;
    return P.sod < H.openSod || P.sod > (H.openSod + H.span_s);
  }

  function set(id) {
    id = String(id || "").toUpperCase();
    if (!HOURS[id] || id === _active) return _active;
    _active = id; root.__exchange = id;
    try { localStorage.setItem(LS_KEY, id); } catch (_) {}
    try { root.dispatchEvent(new CustomEvent("quan:exchange", { detail: { exchange: id } })); } catch (_) {}
    return id;
  }
  function get() { return _active; }

  root.QuanExchange = {
    HOURS: HOURS, get: get, set: set, hours: hours,
    sessionFraction: sessionFraction, marketClosed: marketClosed
  };
})(typeof window !== "undefined" ? window : this);
