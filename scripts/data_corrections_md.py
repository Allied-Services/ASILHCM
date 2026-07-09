#!/usr/bin/env python3
"""MD Mandate §2 — protect CNIC-dupe employees; force-delete junk test rows.

Protected IDs (keep even if CNIC duplicates):
  ASIL/PSO-298/25, ASIL/SPL-418/21, ASIL/SPL-420/21

Junk IDs (delete after clearing FK deps):
  123, TEST, ASIL-1774260596303
"""
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
JWT_PATH = Path(r"C:\temp\hcm_jwt.txt")
LIVE_API = "https://asilhcm.onrender.com"
REPORT_PATH = REPO / "audit" / "data_corrections_report.md"
ROLLBACK_PATH = REPO / "audit" / "junk_delete_rollback.json"

PROTECTED_IDS = ("ASIL/PSO-298/25", "ASIL/SPL-418/21", "ASIL/SPL-420/21")
JUNK_IDS = ("123", "TEST", "ASIL-1774260596303")

# Child tables that may reference employees.id — cleared before DELETE
FK_CLEANUP_SQL_HINTS = [
    "payroll_run_rows",
    "payroll_transactions",
    "attendance_records",
    "employee_claims",
    "claims_inbox",
    "pf_ledger",
    "payroll_advances",
]


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
        with urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        raise RuntimeError(f"{method} {path} HTTP {e.code}: {e.read()[:500]!r}") from e


def main() -> int:
    global LIVE_API
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--api", default=LIVE_API)
    args = ap.parse_args()
    LIVE_API = args.api.rstrip("/")

    token = read_jwt()
    employees = api_json("GET", "/api/employees", token).get("employees", [])
    by_id = {e["id"]: e for e in employees}

    protected_status = []
    for pid in PROTECTED_IDS:
        emp = by_id.get(pid)
        protected_status.append({
            "id": pid,
            "exists": emp is not None,
            "cnic": (emp or {}).get("cnic"),
            "name": (emp or {}).get("name"),
            "action": "PROTECTED — do not delete/dedup-away",
        })
        print(f"PROTECT {pid}: {'found' if emp else 'MISSING'}")

    rollback: list[dict[str, Any]] = []
    delete_results = []
    for jid in JUNK_IDS:
        emp = by_id.get(jid)
        row: dict[str, Any] = {"id": jid, "exists": emp is not None}
        if not emp:
            row["action"] = "already_absent"
            delete_results.append(row)
            print(f"SKIP {jid}: not in HCM")
            continue
        rollback.append(emp)
        if args.dry_run:
            row["action"] = "would_delete"
            delete_results.append(row)
            print(f"DRY delete {jid} ({emp.get('name')})")
            continue
        try:
            # Prefer admin cascade endpoint if available; else standard delete
            try:
                res = api_json("POST", "/api/admin/purge-employee-cascade", token, {"employeeId": jid})
            except RuntimeError:
                res = api_json("DELETE", f"/api/employees/{jid}", token)
            row["action"] = "deleted"
            row["response"] = res
            row["ok"] = True
            print(f"DELETED {jid}")
        except RuntimeError as err:
            row["ok"] = False
            row["error"] = str(err)
            print(f"FAIL {jid}: {err}", file=sys.stderr)
        delete_results.append(row)

    if rollback and not args.dry_run:
        ROLLBACK_PATH.write_text(json.dumps(rollback, indent=2, default=str), encoding="utf-8")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "# Data corrections (MD Mandate §2)",
        "",
        f"Generated: {now}",
        f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}",
        "",
        "## Protected CNIC-duplicate employees",
        "",
    ]
    for p in protected_status:
        lines.append(f"- `{p['id']}` — exists={p['exists']} cnic={p.get('cnic')} name={p.get('name')}")
    lines += ["", "## Junk row deletions", ""]
    for d in delete_results:
        lines.append(f"- `{d['id']}` — {d.get('action')} ok={d.get('ok', 'n/a')}")
        if d.get("error"):
            lines.append(f"  - Error: `{d['error']}`")
    lines += [
        "",
        f"FK cleanup targets (server-side): {', '.join(FK_CLEANUP_SQL_HINTS)}",
        f"Rollback snapshot: `{ROLLBACK_PATH.relative_to(REPO) if ROLLBACK_PATH.exists() else 'n/a'}`",
        "",
    ]
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report: {REPORT_PATH}")
    fails = sum(1 for d in delete_results if d.get("ok") is False)
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
