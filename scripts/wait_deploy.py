#!/usr/bin/env python3
"""Poll /health until Render reports the expected git commit."""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request

LIVE_API = "https://asilhcm.onrender.com"


def health() -> dict:
    with urllib.request.urlopen(f"{LIVE_API}/health", timeout=30) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("commit", help="Expected short or full git commit SHA")
    ap.add_argument("--timeout", type=int, default=900, help="Max wait seconds")
    ap.add_argument("--interval", type=int, default=20, help="Poll interval seconds")
    args = ap.parse_args()
    want = args.commit.strip()
    deadline = time.time() + args.timeout
    last = None
    while time.time() < deadline:
        try:
            h = health()
            got = h.get("commit") or ""
            last = got
            print(f"health ok migrations={h.get('migrations')} commit={got or '(none)'}", flush=True)
            if got and (got == want or got.startswith(want) or want.startswith(got[: len(want)])):
                print("deploy ready", flush=True)
                return 0
        except Exception as err:
            print(f"poll error: {err}", flush=True)
        time.sleep(args.interval)
    print(f"timeout waiting for commit {want}; last seen {last!r}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
