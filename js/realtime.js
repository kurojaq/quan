/* ==========================================================================
   Realtime client (Phase 4). Thin WebSocket wrapper over the realtime Worker.

   Inert unless js/realtime-config.js provides a `base` — when empty, enabled is
   false and callers fall back to their existing behavior (polling). Both helpers
   auto-reconnect with backoff and return a handle with .close().

     window.__quanRealtime.enabled
     window.__quanRealtime.connectPrice(symbol, onTick(price,msg), onStatus(state)) -> { close }
     window.__quanRealtime.connectDesk(room, name, onMsg(obj), onStatus(state))     -> { send(obj), close }
   ========================================================================== */
(function () {
  'use strict';
  var CFG = window.__QUAN_RT || {};
  var BASE = (CFG.base || '').replace(/\/+$/, '');
  var ENABLED = !!BASE;

  function token() { return (window.__authToken && window.__authToken()) || ''; }

  // shared reconnecting-socket factory
  function makeSocket(pathAndQuery, handlers) {
    var ws, closedByUser = false, backoff = 1000, handle = {};
    function open() {
      try { ws = new WebSocket(BASE + pathAndQuery()); }
      catch (e) { if (handlers.status) handlers.status('error'); return; }
      ws.onopen = function () { backoff = 1000; if (handlers.status) handlers.status('open'); };
      ws.onmessage = function (ev) { if (handlers.message) { try { handlers.message(JSON.parse(ev.data)); } catch (_) {} } };
      ws.onerror = function () { try { ws.close(); } catch (_) {} };
      ws.onclose = function () {
        if (closedByUser) return;
        if (handlers.status) handlers.status('reconnecting');
        setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15000);
      };
    }
    open();
    handle.send = function (obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {} };
    handle.close = function () { closedByUser = true; try { if (ws) ws.close(); } catch (_) {} };
    return handle;
  }

  window.__quanRealtime = {
    get enabled() { return ENABLED; },

    connectPrice: function (symbol, onTick, onStatus) {
      if (!ENABLED || !symbol) return null;
      return makeSocket(
        function () { return '/price?symbol=' + encodeURIComponent(symbol) + '&token=' + encodeURIComponent(token()); },
        {
          message: function (m) { if (m && m.type === 'price' && typeof m.price === 'number') onTick(m.price, m); },
          status: onStatus
        }
      );
    },

    connectDesk: function (room, name, onMsg, onStatus) {
      if (!ENABLED || !room) return null;
      return makeSocket(
        function () { return '/desk?room=' + encodeURIComponent(room) + '&name=' + encodeURIComponent(name || 'seat') + '&token=' + encodeURIComponent(token()); },
        { message: onMsg, status: onStatus }
      );
    }
  };
})();
