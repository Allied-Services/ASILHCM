#!/usr/bin/env python3
"""Purge excel_import payroll runs, then re-import from master workbook with variance checks."""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
from import_payroll_history import (  # noqa: E402
    SHEET_PERIOD,
    WORKBOOK,
    WORKBOOK_FALLBACK,
    api_json,
    load_contracts,
    load_employees,
    load_sheet,
    read_jwt,
)

REPORT = REPO / "audit" / "payroll_reimport_audit.md"
LIVE_API = "https://asilhcm.onrender.com"


def purge_excel_imports(token: str, dry_run: bool) -> dict[str, Any]:
    """Call admin purge endpoint if present; else report SQL guidance."""
    try:
        if dry_run:
            return {"ok": True, "dry_run": True, "action": "would_purge_excel_import"}
        return api_json("POST", "/api/admin/purge-excel-payroll-imports", token, {"confirm": True})
    except RuntimeError as err:
        return {"ok": False, "error": str(err), "hint": "Deploy purge-excel-payroll-imports endpoint"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-purge", action="store_true")
    ap.add_argument("--sheets", nargs="*", default=None)
    ap.add_argument("--workbook", default=None)
    args = ap.parse_args()

    token = read_jwt()
    wb_path = Path(args.workbook) if args.workbook else WORKBOOK
    if not wb_path.exists():
        wb_path = WORKBOOK_FALLBACK
    if not wb_path.exists():
        print(f"Missing workbook: {WORKBOOK}", file=sys.stderr)
        return 1

    results: list[dict[str, Any]] = []
    if not args.skip_purge:
        purge = purge_excel_imports(token, args.dry_run)
        results.append({"step": "purge", **purge})
        print(f"Purge: {purge}")

    # Re-use import_payroll_history main path via subprocess-like call
    import import_payroll_history as iph  # noqa: E402

    # Monkey-patch workbook for this run
    iph.WORKBOOK = wb_path
    sheets = args.sheets or list(SHEET_PERIOD.keys())
    # Run import by invoking module main with argv
    argv = ["import_payroll_history.py"]
    if args.dry_run:
        argv.append("--dry-run")
    argv += ["--workbook", str(wb_path), "--sheets", *sheets]
    old = sys.argv
    try:
        sys.argv = argv
        code = iph.main()
    finally:
        sys.argv = old

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "# Payroll re-import audit",
        "",
        f"Generated: {now}",
        f"Workbook: `{wb_path}`",
        f"Purge: {json.dumps(results, default=str)}",
        f"Import exit code: {code}",
        "",
        "See also: `audit/payroll_import_report.md`",
        "",
    ]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report: {REPORT}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
