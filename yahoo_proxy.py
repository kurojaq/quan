"""
yahoo_proxy.py -- tiny local CORS-enabled proxy for Yahoo Finance quotes + history.

Why this exists: Yahoo Finance's quote endpoints don't send CORS headers, so a
browser page (like Quan Terminal Baseline.html) can't fetch them directly.
This script fetches quotes/history server-side (no CORS restriction there) and
re-serves the result locally with permissive CORS headers.

Run it, then leave it running in the background while you use the terminal's
"Live" anchor toggle and/or the price Chart tab:

    python yahoo_proxy.py

It listens on http://localhost:8791 by default.

Endpoints:
  GET /quote?symbol=NG=F
      -> {"symbol":"NG=F","price":3.245,"previousClose":3.196,"time":1234567890}
  GET /history?symbol=NG=F&range=5d&interval=5m
      -> {"symbol":"NG=F","bars":[{"time":1234567890,"open":..,"high":..,"low":..,"close":..},...]}
      (range/interval follow Yahoo's own chart API conventions, e.g. range=1d|5d|1mo|6mo|1y,
       interval=1m|5m|15m|1h|1d -- Yahoo restricts fine intervals to short ranges, e.g. 1m only
       within the last ~7 days.)
"""
import json
import sys
import time
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8791
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def _fetch_chart(symbol, rang=None, interval=None):
    url = YAHOO_URL.format(symbol=urllib.parse.quote(symbol))
    params = {}
    if rang:
        params["range"] = rang
    if interval:
        params["interval"] = interval
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        err = (data.get("chart") or {}).get("error")
        raise ValueError(f"no data for symbol {symbol!r} ({err})")
    return result[0]


def fetch_quote(symbol):
    result = _fetch_chart(symbol)
    meta = result.get("meta") or {}
    price = meta.get("regularMarketPrice")
    if price is None:
        raise ValueError(f"no regularMarketPrice for symbol {symbol!r}")
    return {
        "symbol": symbol,
        "price": price,
        "previousClose": meta.get("previousClose"),
        "currency": meta.get("currency"),
        "exchangeName": meta.get("exchangeName"),
        "marketTime": meta.get("regularMarketTime"),
        "time": int(time.time()),
    }


def fetch_history(symbol, rang, interval):
    result = _fetch_chart(symbol, rang, interval)
    ts = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [{}])[0])
    o, h, l, c = quote.get("open") or [], quote.get("high") or [], quote.get("low") or [], quote.get("close") or []
    bars = []
    for i, t in enumerate(ts):
        if i >= len(o) or i >= len(h) or i >= len(l) or i >= len(c):
            break
        if o[i] is None or h[i] is None or l[i] is None or c[i] is None:
            continue
        bars.append({"time": int(t), "open": o[i], "high": h[i], "low": l[i], "close": c[i]})
    meta = result.get("meta") or {}
    return {"symbol": symbol, "bars": bars, "currency": meta.get("currency"), "exchangeName": meta.get("exchangeName")}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stdout.write("[yahoo_proxy] " + (fmt % args) + "\n")

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        symbol = (qs.get("symbol") or [""])[0]
        if not symbol:
            self._send_json(400, {"error": "missing ?symbol="})
            return
        try:
            if parsed.path == "/quote":
                self._send_json(200, fetch_quote(symbol))
            elif parsed.path == "/history":
                rang = (qs.get("range") or ["5d"])[0]
                interval = (qs.get("interval") or ["5m"])[0]
                self._send_json(200, fetch_history(symbol, rang, interval))
            else:
                self._send_json(404, {"error": "unknown endpoint, use /quote?symbol=NG=F or /history?symbol=NG=F&range=5d&interval=5m"})
        except Exception as e:
            self._send_json(502, {"error": str(e)})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("localhost", PORT), Handler)
    print(f"yahoo_proxy listening on http://localhost:{PORT}  (Ctrl+C to stop)")
    print(f"try it: http://localhost:{PORT}/quote?symbol=NG=F")
    print(f"     or: http://localhost:{PORT}/history?symbol=NG=F&range=5d&interval=5m")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping.")
