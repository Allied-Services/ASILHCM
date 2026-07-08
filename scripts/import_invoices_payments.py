#!/usr/bin/env python3
"""Build 4: Import historic Wafi invoices from audit/out CSV (Paid rows, 2025+)."""
from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parent.parent
CSV_PATH = REPO / "audit" / "out" / "wafi_invoices_clean.csv"
LIVE_API = "https://asilhcm.onrender.com"
JWT_PATH = Path(r"C:\temp\hcm_jwt.txt")
REPORT_PATH = REPO / "audit" / "invoice_import_report.md"
BATCH = 40
NUM = re.compile(r"[^\d.\-]")
WAFFI_CLIENT = "Wafi Energy Pakistan Limited"
WAFFI_CONTRACT = "CTR-1773046722553"


def read_jwt() -> str:
    return JWT_PATH.read_text(encoding="utf-8").strip()


def api_json(method: str, path: str, token: str, body=None):
    url = f"{LIVE_API}{path}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        raise RuntimeError(f"{method} {path} HTTP {e.code}: {e.read()[:400]!r}") from e


def parse_money(v) -> float:
    if v is None:
        return 0.0
    s = NUM.sub("", str(v).strip())
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def parse_date(v) -> str | None:
    if not v:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d %b %Y", "%d-%m-%y"):
        try:
            return datetime.strptime(s[:11], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def load_invoices(min_year: int = 2025, limit: int | None = None):
    out = []
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            status = (row.get("status") or row.get("Status") or "").strip()
            if status.lower() != "paid":
                continue
            inv_no = (row.get("inv") or "").strip()
            if not inv_no:
                continue
            inv_date = parse_date(row.get("inv_date"))
            if inv_date and int(inv_date[:4]) < min_year:
                continue
            gross = parse_money(row.get("gross") or row.get("Gross"))
            if gross <= 0:
                gross = parse_money(row.get("Gross"))
            pay_date = parse_date(row.get("pay_date"))
            period_year = int(inv_date[:4]) if inv_date else None
            period_month = int(inv_date[5:7]) if inv_date and len(inv_date) >= 7 else None
            contact = (row.get("contact") or "").strip()
            out.append({
                "invoice_number": inv_no,
                "client": WAFFI_CLIENT,
                "contract": contact or "Historic Wafi",
                "contract_id": WAFFI_CONTRACT,
                "period_month": period_month,
                "period_year": period_year,
                "subtotal": round(gross / 1.18, 2) if gross else 0,
                "sales_tax": round(gross - gross / 1.18, 2) if gross else 0,
                "grand_total": gross,
                "status": "Paid",
                "payment_received_at": pay_date or inv_date,
                "due_date": parse_date(row.get("due_date")),
                "notes": f"source=excel_import; contact={contact}",
            })
            if limit and len(out) >= limit:
                break
    return out


def chunked(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--min-year", type=int, default=2025)
    args = ap.parse_args()
    invoices = load_invoices(min_year=args.min_year, limit=args.limit)
    print(f"Prepared {len(invoices)} invoices (min_year={args.min_year})")
    if args.dry_run:
        print(json.dumps(invoices[:3], indent=2))
        return
    token = read_jwt()
    totals = {"inserted": 0, "skipped": 0, "errors": 0}
    batch_results = []
    for i, batch in enumerate(chunked(invoices, BATCH), 1):
        print(f"Batch {i} ({len(batch)})...", flush=True)
        res = api_json("POST", "/api/admin/import-invoices", token, {"invoices": batch})
        totals["inserted"] += res.get("inserted", 0)
        totals["skipped"] += res.get("skipped", 0)
        totals["errors"] += len(res.get("errors", []))
        batch_results.append(res)
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    REPORT_PATH.write_text(
        "\n".join([
            "# Invoice history import (Build 4)", "", f"Generated: {now}", "",
            f"- Prepared: {len(invoices)}", f"- Inserted: {totals['inserted']}",
            f"- Skipped: {totals['skipped']}", f"- Errors: {totals['errors']}", "",
            "## Sample errors", json.dumps(
                [e for r in batch_results for e in r.get("errors", [])][:10], indent=2
            ),
        ]),
        encoding="utf-8",
    )
    print(json.dumps(totals, indent=2))
    print(f"Report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
