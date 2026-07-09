#!/usr/bin/env python3
"""MD Mandate §6 — send one live focal claim notification to laiba.mughal@asil.com.pk."""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parent.parent
JWT_PATH = Path(r"C:\temp\hcm_jwt.txt")
LIVE_API = "https://asilhcm.onrender.com"
REPORT_PATH = REPO / "audit" / "claims_flow_test.md"
FOCAL_EMAIL = "laiba.mughal@asil.com.pk"
ENV_PATH = REPO / "backend" / ".env"


def load_env_key(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    if not ENV_PATH.exists():
        return None
    for line in ENV_PATH.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == name:
            return v.strip().strip('"').strip("'")
    return None


def read_jwt() -> str:
    return JWT_PATH.read_text(encoding="utf-8").strip()


def api_json(method: str, path: str, token: str, body: dict | None = None) -> dict:
    url = f"{LIVE_API}{path}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        raise RuntimeError(f"{method} {path} HTTP {e.code}: {e.read()[:500]!r}") from e


def send_via_resend(to: str, subject: str, html: str) -> dict:
    key = load_env_key("RESEND_API_KEY")
    if not key:
        raise RuntimeError("RESEND_API_KEY not found in env or backend/.env")
    from_addr = load_env_key("SMTP_FROM") or "ASIL HR <hr@asil.com.pk>"
    payload = json.dumps({"from": from_addr, "to": [to], "subject": subject, "html": html}).encode("utf-8")
    req = Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    global LIVE_API
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--api", default=LIVE_API)
    args = ap.parse_args()
    LIVE_API = args.api.rstrip("/")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    result: dict = {"to": FOCAL_EMAIL, "at": now}
    subject = "[HCM] Focal claim notification test (MD Mandate 6)"
    html = (
        f"<p>This is a live focal claim notification loop test.</p>"
        f"<p>Sent at {now} to verify delivery to <b>{FOCAL_EMAIL}</b>.</p>"
        f"<p>Please reply-all if received so MD can close Mandate 6.</p>"
    )

    if args.dry_run:
        result["action"] = "would_send"
        print(f"DRY: would notify {FOCAL_EMAIL}")
    else:
        # 1) Prefer admin endpoint once deployed
        if JWT_PATH.exists():
            token = read_jwt()
            try:
                res = api_json("POST", "/api/admin/test-claim-notify", token, {
                    "to": FOCAL_EMAIL, "subject": subject, "html": html,
                })
                result["ok"] = True
                result["via"] = "admin/test-claim-notify"
                result["response"] = res
            except RuntimeError as err:
                result["admin_error"] = str(err)

        # 2) Direct Resend (works pre-deploy)
        if not result.get("ok"):
            try:
                res = send_via_resend(FOCAL_EMAIL, subject, html)
                result["ok"] = True
                result["via"] = "resend_direct"
                result["response"] = res
                print(f"OK via Resend -> {FOCAL_EMAIL} id={res.get('id')}")
            except Exception as err:
                result["ok"] = False
                result["error"] = str(err)
                print(f"FAIL: {err}", file=sys.stderr)
        else:
            print(f"OK notified {FOCAL_EMAIL} via {result['via']}")

    lines = [
        "# Claims flow live test (MD Mandate 6)",
        "",
        f"Generated: {now}",
        f"Target: `{FOCAL_EMAIL}`",
        f"Result: {json.dumps(result, indent=2, default=str)}",
        "",
    ]
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report: {REPORT_PATH}")
    return 0 if result.get("ok") or args.dry_run else 1


if __name__ == "__main__":
    raise SystemExit(main())
