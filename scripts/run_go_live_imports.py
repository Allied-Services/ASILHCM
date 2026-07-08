#!/usr/bin/env python3
"""Run Build 3 payroll + Build 4 invoice imports after deploy is live."""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REPORT = REPO / "audit" / "go_live_import_run.md"


def run(cmd: list[str]) -> tuple[int, str]:
    print("+", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    if out.strip():
        print(out[-4000:], flush=True)
    return proc.returncode, out


def main() -> int:
    steps: list[tuple[str, int, str]] = []
    for label, cmd in [
        ("payroll_history", [sys.executable, str(REPO / "scripts" / "import_payroll_history.py")]),
        ("invoice_history", [sys.executable, str(REPO / "scripts" / "import_invoices_payments.py"), "--limit", "200"]),
    ]:
        code, out = run(cmd)
        steps.append((label, code, out[-1500:]))
        if code != 0:
            break

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = ["# Go-live import run", "", f"Generated: {now}", ""]
    for label, code, tail in steps:
        lines += [f"## {label}", f"- exit: {code}", "", "```", tail.strip(), "```", ""]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report: {REPORT}", flush=True)
    return 1 if any(c for _, c, _ in steps) else 0


if __name__ == "__main__":
    raise SystemExit(main())
