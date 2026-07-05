"""DS / Difference-Sum payload runner — text in, payload line out. Mirrors quan_payload_runner.
The dashboard holds CSV *text*; ds_emit reads *paths*, so we tempfile-write and call it."""
import os, tempfile
from ds_emit import ds_emit

def run(chain_text, greeks_text=None, anchor=None):
    fd, cp = tempfile.mkstemp(suffix=".csv"); tmp = [cp]
    gp = None
    with os.fdopen(fd, "w") as f:
        f.write(chain_text)
    if greeks_text:
        gfd, gp = tempfile.mkstemp(suffix="_g.csv"); tmp.append(gp)
        with os.fdopen(gfd, "w") as f:
            f.write(greeks_text)
    try:
        line = ds_emit(cp, gp, float(str(anchor).replace(",", "")))
    finally:
        for p in tmp:
            try: os.remove(p)
            except OSError: pass
    return line.strip()
