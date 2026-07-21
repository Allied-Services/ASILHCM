#!/usr/bin/env python3
"""Pull ACCREC invoices from Xero via live HCM API and overwrite client_invoices."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parent.parent
LIVE_API = "https://asilhcm.onrender.com"
JWT_PATH = Path(r"C:\temp\hcm_jwt.txt")
REPORT = REPO / "audit" / "xero_ar_sync_report.md"


def read_jwt() -> str:
    return JWT_PATH.read_text(encoding="utf-8").strip()


def api_json(method: str, path: str, token: str, body: dict | None = None) -> dict[str, Any]:
    url = f"{LIVE_API}{path}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=300) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        raise RuntimeError(f"{method} {path} HTTP {e.code}: {e.read()[:600]!r}") from e


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Only check endpoint availability")
    args = ap.parse_args()

    token = read_jwt()
    if args.dry_run:
        print("Dry-run: would POST /api/ar/xero/sync-invoices")
        return 0

    result = api_json("POST", "/api/ar/xero/sync-invoices", token, {})
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "# Xero AR invoice sync",
        "",
        f"Generated: {now}",
        "",
        "```json",
        json.dumps(result, indent=2, default=str),
        "```",
        "",
    ]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(result, indent=2, default=str))
    print(f"Report: {REPORT}")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
