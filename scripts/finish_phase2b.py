#!/usr/bin/env python3
"""Finish Build 2 phase 2b: backfill blanks, cleanup junk rows, canonicalize client names."""
from __future__ import annotations

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
from import_employees import (  # noqa: E402
    REPORT_PATH,
    api_json,
    read_jwt,
    union_files,
)

ROLLBACK_PATH = REPO / "audit" / "phase2b_rollback.json"
JUNK_IDS = ("123", "TEST", "ASIL-1774260596303")
CLIENT_RENAMES = {
    "Pakistan State Oil Company Ltd": "Pakistan State Oil Company Limited",
    "Wafi Energy Pakistan Pvt Ltd": "Wafi Energy Pakistan Limited",
}
BATCH_SIZE = 40

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATE_FIELDS = (
    "doj", "dob", "cnicIssue", "cnicExpiry", "lastWorkingDay",
    "contractDate", "contractStartDate", "lastUniformIssueDate",
    "lastPpeIssueDate", "gatePassExpiry",
)

def is_empty_hcm(val):
    return val is None or val == "" or val == 0

def blank_backfill_fields(file_rec, hcm_row):
    patch = {}
    if file_rec.get("Bank", "").strip() and is_empty_hcm(hcm_row.get("bankName")):
        patch["bankName"] = file_rec["Bank"].strip()
    if file_rec.get("Account", "").strip() and is_empty_hcm(hcm_row.get("bankAccount")):
        patch["bankAccount"] = file_rec["Account"].strip()
    if file_rec.get("Email Address", "").strip() and is_empty_hcm(hcm_row.get("email")):
        patch["email"] = file_rec["Email Address"].strip()
    if file_rec.get("Province", "").strip() and is_empty_hcm(hcm_row.get("province")):
        patch["province"] = file_rec["Province"].strip()
    med = file_rec.get("Total Medical Coverage (Self & Family)", "").strip()
    if med and is_empty_hcm(hcm_row.get("totalMedicalCoverage")):
        patch["totalMedicalCoverage"] = med
    return patch

def sanitize_employee(emp):
    out = dict(emp)
    for key in DATE_FIELDS:
        val = out.get(key)
        if val is None or val == "":
            continue
        if not ISO_DATE.match(str(val).strip()):
            out[key] = None
    return out


def bulk_update(token: str, employees: list[dict[str, Any]]) -> dict[str, Any]:
    cleaned = [sanitize_employee(e) for e in employees]
    return api_json("POST", "/api/employees/bulk", token, {"employees": cleaned, "notifyNew": False})


def delete_employee(token: str, eid: str) -> dict[str, Any]:
    return api_json("DELETE", f"/api/employees/{eid}", token)


def chunked(items: list[Any], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> int:
    print("Loading CSV...", flush=True)
    token = read_jwt()
    file_emps, _, _, _ = union_files()
    print(f"CSV rows: {len(file_emps)}", flush=True)
    hcm = api_json("GET", "/api/employees", token).get("employees", [])
    hcm_by_id = {e["id"]: e for e in hcm}
    print(f"HCM rows: {len(hcm_by_id)}", flush=True)

    rollback: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "updates": [],
        "deletes": [],
    }
    backfill_batch: list[dict[str, Any]] = []
    backfill_skip = 0

    for eid in sorted(set(file_emps) & set(hcm_by_id)):
        rec = file_emps[eid]
        hcm_row = hcm_by_id[eid]
        patch = blank_backfill_fields(rec, hcm_row)
        if not patch:
            backfill_skip += 1
            continue
        rollback["updates"].append({"id": eid, "before": {k: hcm_row.get(k) for k in patch}})
        updated = dict(hcm_row)
        updated.update(patch)
        backfill_batch.append(updated)
        hcm_by_id[eid] = updated

    backfill_ok, backfill_fail = 0, []
    for i, batch in enumerate(chunked(backfill_batch, BATCH_SIZE), 1):
        print(f"Backfill batch {i} ({len(batch)})...", flush=True)
        try:
            res = bulk_update(token, batch)
            backfill_ok += res.get("saved", 0)
            for err in res.get("errors", []):
                backfill_fail.append((err.get("id"), err.get("error", "unknown")))
        except RuntimeError as err:
            backfill_fail.append((f"batch-{i}", str(err)))
        time.sleep(0.15)

    rename_batch: list[dict[str, Any]] = []
    for eid, hcm_row in hcm_by_id.items():
        client = (hcm_row.get("client") or "").strip()
        new_client = CLIENT_RENAMES.get(client)
        if not new_client:
            continue
        rollback["updates"].append({"id": eid, "before": {"client": client}})
        updated = dict(hcm_row)
        updated["client"] = new_client
        rename_batch.append(updated)
        hcm_by_id[eid] = updated

    rename_ok, rename_fail = 0, []
    for i, batch in enumerate(chunked(rename_batch, BATCH_SIZE), 1):
        print(f"Rename batch {i} ({len(batch)})...", flush=True)
        try:
            res = bulk_update(token, batch)
            rename_ok += res.get("saved", 0)
            for err in res.get("errors", []):
                rename_fail.append((err.get("id"), err.get("error", "unknown")))
        except RuntimeError as err:
            rename_fail.append((f"batch-{i}", str(err)))
        time.sleep(0.15)

    delete_ok, delete_fail = 0, []
    for eid in JUNK_IDS:
        if eid not in hcm_by_id:
            continue
        rollback["deletes"].append({"id": eid, "snapshot": hcm_by_id[eid]})
        try:
            delete_employee(token, eid)
            delete_ok += 1
        except RuntimeError as err:
            delete_fail.append((eid, str(err)))

    ROLLBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    ROLLBACK_PATH.write_text(json.dumps(rollback, indent=2, default=str), encoding="utf-8")

    hcm_after = api_json("GET", "/api/employees", token).get("employees", [])
    hcm_after_by_id = {e["id"]: e for e in hcm_after}
    matched = len(set(file_emps) & set(hcm_after_by_id))
    missing = sorted(set(file_emps) - set(hcm_after_by_id))
    extra = sorted(set(hcm_after_by_id) - set(file_emps))

    verify_ids = ["ASIL/PSO-298/25", "ASIL/SPL-418/21", "ASIL/SPL-420/21"]
    verify_lines = []
    for eid in verify_ids:
        e = hcm_after_by_id.get(eid)
        if e:
            cnic_note = e.get("cnic") or "(omitted — duplicate CNIC)"
            verify_lines.append(
                f"- `{eid}` {e.get('name')} | client={e.get('client')} | "
                f"bank={e.get('bankName')} | email={e.get('email')} | cnic={cnic_note}"
            )
        else:
            verify_lines.append(f"- `{eid}` **NOT FOUND**")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    appendix = [
        "",
        "## Phase 2b execution (finish_phase2b.py)",
        "",
        f"Finished: {now}",
        "",
        "| Action | Result |",
        "|---|---|",
        f"| Backfill bank/email | {backfill_ok} saved, skip {backfill_skip}, fail {len(backfill_fail)} |",
        f"| Client renames | {rename_ok} saved, fail {len(rename_fail)} |",
        f"| Junk deletes | {delete_ok} ok, fail {len(delete_fail)} |",
        f"| HCM count after | {len(hcm_after)} |",
        f"| MATCHED | {matched} |",
        f"| MISSING | {len(missing)} |",
        f"| EXTRA | {len(extra)} |",
        "",
        "### MD verify employees",
        "",
        *verify_lines,
        "",
        f"Rollback: `{ROLLBACK_PATH.relative_to(REPO)}`",
    ]
    if backfill_fail:
        appendix += ["", "### Backfill failures (first 10)", ""]
        appendix += [f"- `{eid}`: {msg}" for eid, msg in backfill_fail[:10]]

    text = REPORT_PATH.read_text(encoding="utf-8") if REPORT_PATH.exists() else ""
    marker = "## Phase 2b execution (finish_phase2b.py)"
    if marker in text:
        text = text.split(marker)[0].rstrip()
    REPORT_PATH.write_text(text + "\n".join(appendix), encoding="utf-8")

    print(f"backfill={backfill_ok} rename={rename_ok} delete={delete_ok}", flush=True)
    print(f"HCM={len(hcm_after)} MATCHED={matched} MISSING={len(missing)} EXTRA={len(extra)}", flush=True)
    print(f"Report: {REPORT_PATH}", flush=True)
    return 1 if (backfill_fail or delete_fail) else 0


if __name__ == "__main__":
    raise SystemExit(main())
