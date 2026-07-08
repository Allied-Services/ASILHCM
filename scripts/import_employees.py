#!/usr/bin/env python3
"""Build 2: Reconcile June 2026 payroll CSVs against live HCM employees."""
from __future__ import annotations
import argparse, csv, json, re, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parent.parent
CSV_MAIN = REPO / "Attachments" / "BPO FM Payroll & Invoice File - PR (1).csv"
CSV_PSO = REPO / "Attachments" / "BPO FM Payroll & Invoice File - PSO Operational PR.csv"
REPORT_PATH = REPO / "audit" / "employee_import_report.md"
LIVE_API = "https://asilhcm.onrender.com"
JWT_PATH = Path(r"C:\temp\hcm_jwt.txt")
MARKERS = ("to be added", "maintained manually", "pulled from the master")
COLUMN_MAP = [
    ("ASIL Employee Code", "id"), ("Employee Name", "name"), ("Active", "active"),
    ("Client", "client"), ("Client BU", "clientBU"), ("Department", "dept"),
    ("Designation", "designation"), ("Location", "location"), ("Province", "province"),
    ("CNIC", "cnic"), ("Bank", "bankName"), ("Account", "bankAccount"),
    ("Date of Joining", "doj"), ("New Salary", "salary"), ("Email Address", "email"),
    ("Total Medical Coverage (Self & Family)", "totalMedicalCoverage"),
]
CODE_RE = re.compile(r"^ASIL", re.I)

def read_jwt():
    return JWT_PATH.read_text(encoding="utf-8").strip()

def api_json(method, path, token, body=None, timeout=120):
    url = f"{LIVE_API}{path}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        raise RuntimeError(f"{method} {path} HTTP {e.code}: {e.read()[:300]!r}") from e

def load_csv(path: Path):
    for enc in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            with path.open("r", encoding=enc, newline="") as f:
                rows = list(csv.reader(f))
            break
        except OSError:
            rows = None
    if not rows:
        raise RuntimeError(f"unreadable: {path}")
    header = [c.strip() for c in rows[0]]
    out = []
    for row in rows[1:]:
        if not any(str(c).strip() for c in row):
            continue
        pad = row + [""] * max(0, len(header) - len(row))
        rec = {header[i]: str(pad[i]).strip() for i in range(len(header))}
        code = rec.get("ASIL Employee Code", "")
        if not code or any(m in code.lower() for m in MARKERS):
            continue
        if not CODE_RE.match(code):
            continue
        out.append(rec)
    return header, out

def union_files():
    h1, r1 = load_csv(CSV_MAIN)
    _, r2 = load_csv(CSV_PSO)
    by_id, sources, overlap = {}, {}, []
    for rec in r1:
        eid = rec["ASIL Employee Code"]
        by_id[eid] = rec
        sources[eid] = ["PR (1).csv"]
    for rec in r2:
        eid = rec["ASIL Employee Code"]
        if eid in by_id:
            overlap.append(eid)
            if "PSO Operational PR.csv" not in sources[eid]:
                sources[eid].append("PSO Operational PR.csv")
        else:
            by_id[eid] = rec
            sources[eid] = ["PSO Operational PR.csv"]
    return by_id, sources, sorted(set(overlap)), h1

def parse_salary(v):
    if not v:
        return None
    s = re.sub(r"[^\d.\-]", "", str(v).replace(",", ""))
    try:
        return float(s) if s else None
    except ValueError:
        return None

def csv_to_api(rec):
    emp = {}
    for csv_col, api_field in COLUMN_MAP:
        v = rec.get(csv_col, "").strip()
        if not v:
            continue
        if api_field == "salary":
            sal = parse_salary(v)
            if sal is not None:
                emp["salary"] = sal
        else:
            emp[api_field] = v
    loc = rec.get("Location", "").strip()
    if loc:
        emp.setdefault("site", loc)
    return emp

def quality(file_emps):
    blank_cnic, missing_bank, bad_doj = [], [], []
    cnic_n = Counter()
    for eid, rec in file_emps.items():
        c = rec.get("CNIC", "").strip()
        if not c:
            blank_cnic.append(eid)
        else:
            cnic_n[c] += 1
        if not rec.get("Bank", "").strip() or not rec.get("Account", "").strip():
            missing_bank.append(eid)
        doj = rec.get("Date of Joining", "").strip()
        if doj and not re.match(r"^\d{4}-\d{2}-\d{2}$|^\d{1,2}/[A-Za-z]{3}/\d{2,4}$|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$", doj):
            bad_doj.append(eid)
    dups = [c for c, n in cnic_n.items() if n > 1]
    return dict(blank_cnic=blank_cnic, missing_bank=missing_bank, bad_doj=bad_doj, dup_cnic=dups)

def gaps(file_rec, hcm):
    out = []
    for csv_col, api in [("CNIC", "cnic"), ("Bank", "bankName"), ("Account", "bankAccount"), ("Email Address", "email"), ("Date of Joining", "doj")]:
        fv = file_rec.get(csv_col, "").strip()
        hv = hcm.get(api)
        if fv and (hv is None or hv == "" or hv == 0):
            out.append(api)
    return out

def write_report(file_emps, sources, overlap, headers, hcm_by_id, q, import_meta):
    fids, hids = set(file_emps), set(hcm_by_id)
    matched, missing, extra = fids & hids, sorted(fids - hids), sorted(hids - fids)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    L = [f"# Employee master reconciliation (Build 2)", "", f"Generated: {now}", "",
         "## Summary", "", "| Metric | Count |", "|---|---:|",
         f"| Unique in June CSV union | {len(fids)} |",
         f"| In both CSV files (overlap) | {len(overlap)} |",
         f"| MATCHED | {len(matched)} |", f"| MISSING in HCM | {len(missing)} |", f"| EXTRA in HCM | {len(extra)} |", ""]
    L += ["## MISSING in HCM", ""]
    if missing:
        L.append("| Code | Name | Client | Location | Active | Source |")
        L.append("|---|---|---|---|---|---|")
        for eid in missing:
            r = file_emps[eid]
            L.append(f"| {eid} | {r.get('Employee Name','')} | {r.get('Client','')} | {r.get('Location','')} | {r.get('Active','')} | {', '.join(sources[eid])} |")
    else:
        L.append("_None._")
    L += ["", "## EXTRA in HCM (sample 25)", ""]
    for eid in extra[:25]:
        e = hcm_by_id[eid]
        L.append(f"- `{eid}` {e.get('name','')} client={e.get('client','')} active={e.get('active','')}")
    L += ["", "## Column mapping", ""]
    hs = set(headers)
    L.append("| CSV | API field | In PR header |")
    L.append("|---|---|---|")
    for csv_col, api in COLUMN_MAP:
        L.append(f"| {csv_col} | `{api}` | {'yes' if csv_col in hs else 'no'} |")
    L += ["", "## Data quality", "",
           f"- Blank CNIC: {len(q['blank_cnic'])}", f"- Missing bank/account: {len(q['missing_bank'])}",
           f"- Bad DOJ: {len(q['bad_doj'])}", f"- Duplicate CNIC groups: {len(q['dup_cnic'])}", ""]
    gc, gs = 0, []
    for eid in sorted(matched):
        g = gaps(file_emps[eid], hcm_by_id[eid])
        if g:
            gc += 1
            if len(gs) < 15:
                gs.append(f"- `{eid}`: {', '.join(g)}")
    L += ["## Proposed updates (not applied)", "", f"Count: {gc}", ""] + (gs or ["_None_"]) + ["", "## Phase 2b", "", str(import_meta), ""]
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(L), encoding="utf-8")
    return len(matched), len(missing), len(extra)

def import_missing(token, file_emps, missing, before_ids):
    emps = []
    for eid in missing:
        body = csv_to_api(file_emps[eid])
        body["id"] = eid
        if body.get("name"):
            emps.append(body)
    if not emps:
        return {"saved": 0, "errors": [], "created_ids": []}
    res = api_json("POST", "/api/employees/bulk", token, {"employees": emps, "notifyNew": False})
    after = api_json("GET", "/api/employees", token)
    after_ids = {e["id"] for e in after.get("employees", [])}
    res["created_ids"] = sorted(after_ids - before_ids)
    return res

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--import-missing", action="store_true")
    ap.add_argument("--max-missing", type=int, default=20)
    args = ap.parse_args()
    file_emps, sources, overlap, headers = union_files()
    q = quality(file_emps)
    token = read_jwt()
    hcm = api_json("GET", "/api/employees", token).get("employees", [])
    hcm_by_id = {e["id"]: e for e in hcm}
    missing = sorted(set(file_emps) - set(hcm_by_id))
    meta = "Phase 2a report-only."
    if args.import_missing:
        if len(missing) > args.max_missing:
            meta = f"Import skipped: MISSING={len(missing)} > {args.max_missing}"
        else:
            res = import_missing(token, file_emps, missing, set(hcm_by_id))
            hcm_by_id = {e["id"]: e for e in api_json("GET", "/api/employees", token).get("employees", [])}
            meta = f"Imported saved={res.get('saved')} created={res.get('created_ids')}"
    elif len(missing) > args.max_missing:
        meta = f"No writes: MISSING={len(missing)} > {args.max_missing}"
    m, miss, ex = write_report(file_emps, sources, overlap, headers, hcm_by_id, q, meta)
    print(f"Report: {REPORT_PATH}")
    print(f"MATCHED={m} MISSING={miss} EXTRA={ex}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())