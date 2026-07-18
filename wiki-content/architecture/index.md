# Architecture

* [Presentation layer](presentation-layer.md) - static pages + `js/` modules wired by globals and events.
* [Pyodide engines](pyodide-engines.md) - four diverged in-browser Python engine copies.
* [Data plane](data-plane.md) - Cloudflare Pages Functions, Workers, and stores.
* [Client warehouse](client-warehouse.md) - the `STORE[inst].sess[date]` cache feeding every tab.
* [Instrument registry](instrument-registry.md) - single source of truth for instrument symbols.
* [Tick Engine (planned)](tick-engine.md) - the planned canonical market-data subsystem.
* [Tradovate Market Data API](tradovate-market-data-api.md) - capability inventory behind the Tick Engine design.
