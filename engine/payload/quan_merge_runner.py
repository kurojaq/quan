"""Prior-merge runner — fold a just-expired payload line into today's master line.
Wraps merge_payloads (GWALLS/WMARKS/SNAP union + GWPROV/WMPROV/PRIORMERGE)."""
import merge_payloads as M

def run(prior_line, today_line, sband="today"):
    merged, *_ = M.merge(M.parse(prior_line), M.parse(today_line), sband)
    return M.emit(merged)
