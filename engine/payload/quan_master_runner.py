"""Master runner — front chain (+ optional survivors / just-expired as JSON) -> payload line.
Wraps quan_payload_runner so the browser passes only strings (no JS->Py proxies)."""
import json
import quan_payload_runner as PR

def run(chain_text, anchor, greeks_text="", survivors_json="", just_expired_json=""):
    survivors = json.loads(survivors_json) if survivors_json else None
    just_expired = json.loads(just_expired_json) if just_expired_json else None
    return PR.run(chain_text, anchor, greeks_text or None, survivors, just_expired)
