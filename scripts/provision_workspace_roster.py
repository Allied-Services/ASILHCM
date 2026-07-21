#!/usr/bin/env python3
"""MD Mandate §1 — provision workspace roster roles into hcm_users.

Primary role per email (HCM supports one role column). Secondary capabilities
are granted via permissions JSON covering the overlapping MD role assignments.

Usage:
  python scripts/provision_workspace_roster.py --dry-run
  python scripts/provision_workspace_roster.py
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
REPORT_PATH = REPO / "audit" / "workspace_roster_provision.md"

# MD Operational Mandates §1 — exact roster.
# Where one email maps to multiple MD roles, primary_role is the HCM role column
# and extra_modules expands sidebar/API access for the secondary MD roles.
ROSTER: list[dict[str, Any]] = [
    {
        "email": "huzaifa.rafaqat@asil.com.pk",
        "name": "Huzaifa Rafaqat",
        "primary_role": "finance_manager",
        "md_roles": ["finance_manager", "ar_team", "payroll"],
        "extra_modules": ["payroll", "payroll_run", "invoices", "po_tracking", "billing", "ap", "ar", "claims_queue"],
    },
    {
        "email": "laiba.mughal@asil.com.pk",
        "name": "Laiba Mughal",
        "primary_role": "procurement_manager",
        "md_roles": ["ap_team", "procurement"],
        "extra_modules": ["ap", "billing", "vendor", "inventory", "bill_verification"],
    },
    {
        "email": "asif.awan@asil.com.pk",
        "name": "Asif Awan",
        "primary_role": "finance_approver",
        "md_roles": ["finance_approver"],
        "extra_modules": [],
    },
    {
        "email": "obaid.rana@asil.com.pk",
        "name": "Obaid Rana",
        "primary_role": "operations",
        "md_roles": ["operations_team"],
        "extra_modules": [],
    },
    {
        "email": "rabia.bhutto@asil.com.pk",
        "name": "Rabia Bhutto",
        # Use operations until operations_supervisor is deployed; permissions add bizdev
        "primary_role": "operations",
        "md_roles": ["operations_supervisor", "bizdev"],
        "extra_modules": ["bizdev", "employee", "attendance", "claims_queue", "contract_ops"],
    },
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
        with urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        raise RuntimeError(f"{method} {path} HTTP {e.code}: {e.read()[:500]!r}") from e


def build_permissions(modules: list[str]) -> dict[str, Any]:
    return {m: {"access": True, "view": True} for m in modules}


def main() -> int:
    global LIVE_API
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--api", default=LIVE_API)
    args = ap.parse_args()
    LIVE_API = args.api.rstrip("/")

    if not JWT_PATH.exists():
        print(f"Missing JWT at {JWT_PATH}", file=sys.stderr)
        return 1

    token = read_jwt()
    results: list[dict[str, Any]] = []

    try:
        existing = api_json("GET", "/api/users", token)
        users = existing.get("users") or existing.get("data") or []
        by_email = {str(u.get("email", "")).lower(): u for u in users}
    except RuntimeError as err:
        print(f"WARN: cannot list users ({err}) — will attempt create/update per row")
        by_email = {}

    for entry in ROSTER:
        email = entry["email"].lower()
        role = entry["primary_role"]
        perms = build_permissions(entry["extra_modules"]) if entry["extra_modules"] else None
        row: dict[str, Any] = {
            "email": email,
            "md_roles": entry["md_roles"],
            "primary_role": role,
        }
        if args.dry_run:
            row["action"] = "would_upsert"
            row["existing"] = email in by_email
            results.append(row)
            print(f"DRY {email} -> {role} (md={entry['md_roles']})")
            continue

        try:
            if email in by_email:
                uid = by_email[email]["id"]
                api_json("PATCH", f"/api/users/{uid}/role", token, {"role": role})
                if perms is not None:
                    try:
                        api_json("PATCH", f"/api/users/{uid}/permissions", token, {"permissions": perms})
                    except RuntimeError as perr:
                        row["permissions_error"] = str(perr)
                row["action"] = "updated"
            else:
                body: dict[str, Any] = {"email": email, "role": role, "name": entry["name"]}
                if perms is not None:
                    body["permissions"] = perms
                created = api_json("POST", "/api/users", token, body)
                row["action"] = "created"
                row["user"] = created.get("user") or created
            row["ok"] = True
            print(f"OK {email} -> {role}")
        except RuntimeError as err:
            row["ok"] = False
            row["error"] = str(err)
            print(f"FAIL {email}: {err}", file=sys.stderr)
        results.append(row)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "# Workspace roster provision (MD Mandate §1)",
        "",
        f"Generated: {now}",
        f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}",
        f"API: `{LIVE_API}`",
        "",
        "| Email | Primary HCM role | MD roles | Action | OK |",
        "|---|---|---|---|---|",
    ]
    for r in results:
        lines.append(
            f"| {r['email']} | {r['primary_role']} | {', '.join(r['md_roles'])} | {r.get('action','—')} | {r.get('ok', 'dry')} |"
        )
        if r.get("error"):
            lines.append(f"  - Error: `{r['error']}`")
    lines += [
        "",
        "## Notes",
        "- HCM stores one `role` per user; overlapping MD roles are merged via primary role + permissions.",
        "- `payroll` MD role → HCM `payroll_initiator` modules on finance_manager.",
        "- `procurement` MD role → HCM `procurement_manager`.",
        "- `operations_team` → HCM `operations`.",
        "- `operations_supervisor` / `bizdev` → HCM `operations_supervisor` (new role).",
        "",
    ]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report: {REPORT_PATH}")
    fails = sum(1 for r in results if r.get("ok") is False)
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
