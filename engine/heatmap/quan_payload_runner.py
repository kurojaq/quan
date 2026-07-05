"""
quan_payload_runner.py — single canonical entry point for daily payload generation.
Wraps the REAL engine (quan_pine_export.export_snapshot). No payload logic lives here;
this only gates the input and routes it to the engine, so CLI and in-browser (Pyodide)
share one identical code path. Update the engine, not this file.

CLI:     python3 quan_payload_runner.py <chain.csv> <anchor>
Python:  from quan_payload_runner import run; line = run(csv_text, anchor)
"""
import sys, os, tempfile
from quan_pine_export import export_snapshot

REQUIRED = ["strike", "premium", "openint", "volume"]  # side-by-side intraday options export

def gate(csv_text):
    """Reject the wrong Barchart export (e.g. volatility-greeks) before it reaches the engine."""
    lines = [l for l in csv_text.splitlines() if l.strip()]
    if len(lines) < 6:
        raise ValueError("GATE: chain too short (%d rows) — truncated or empty." % len(lines))
    hdr = lines[0].replace(" ", "").replace('"', "").lower()
    missing = [c for c in REQUIRED if c not in hdr]
    if missing:
        raise ValueError(
            "GATE: missing %s — this looks like the wrong export. "
            "Need the Options side-by-side intraday CSV (Strike/Premium/Open Int/Volume), "
            "not the Volatility-&-Greeks export." % missing)
    return len(lines)

def run(csv_text, anchor, greeks_text=None, survivors=None):
    """csv_text: full Barchart side-by-side intraday CSV as text. anchor: prior session close.
    greeks_text (optional): Barchart volatility-greeks export as text for the front contract.
    survivors (optional): list of {"chain": csv_text, "greeks": greeks_text|None} for longer-dated
    expiries that outlive the front; when supplied the engine emits a SWALLS surviving-levels field."""
    rows = gate(csv_text)
    anchor = float(str(anchor).replace(",", ""))
    fd, path = tempfile.mkstemp(suffix=".csv")
    tmp = [path]
    gpath = None
    if greeks_text:
        gfd, gpath = tempfile.mkstemp(suffix="_greeks.csv")
        with os.fdopen(gfd, "w") as gf:
            gf.write(greeks_text)
        tmp.append(gpath)
    sv_paths = None
    if survivors:
        sv_paths = []
        for sv in survivors:
            ct = sv.get("chain") if isinstance(sv, dict) else None
            if not ct:
                continue
            cfd, cp = tempfile.mkstemp(suffix="_sv.csv"); tmp.append(cp)
            with os.fdopen(cfd, "w") as f:
                f.write(ct)
            gp = None
            gt = sv.get("greeks") if isinstance(sv, dict) else None
            if gt:
                sgfd, gp = tempfile.mkstemp(suffix="_svg.csv"); tmp.append(gp)
                with os.fdopen(sgfd, "w") as f:
                    f.write(gt)
            sv_paths.append({"chain": cp, "greeks": gp})
    try:
        with os.fdopen(fd, "w") as f:
            f.write(csv_text)
        line = export_snapshot(path, anchor, greeks_csv=gpath, survivors=sv_paths)
    finally:
        for p in tmp:
            if p:
                try: os.remove(p)
                except OSError: pass
    if not line or not line.startswith("ANCHOR="):
        raise RuntimeError("ENGINE: export_snapshot returned an unexpected payload.")
    return line.strip()

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: python3 quan_payload_runner.py <chain.csv> <anchor>", file=sys.stderr); sys.exit(2)
    txt = open(sys.argv[1]).read()
    print(run(txt, sys.argv[2]))
