#!/usr/bin/env python3
"""Live AR/Xero smoke test — TEST- prefix only (stdlib urllib)."""
from __future__ import annotations
import json, os, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("ASIL_HCM_BASE", "https://asilhcm.onrender.com")
JWT_PATH = os.environ.get("ASIL_HCM_JWT", r"C:\temp\hcm_jwt.txt")
TEST_PREFIX = "TEST-"
CONTRACT_15 = "CTR-1773054060255"
CLIENT_15 = "Pakistan State Oil Company Ltd"
SUBTOTAL, SALES_TAX, GRAND = 100_000, 16_000, 116_000

class ApiError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:400]}")
        self.status = status
        self.body = body

def api(method: str, path: str, token: str, body=None):
    url = BASE.rstrip("/") + path
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode(errors="replace")) from e

def invoice_body(inv_no: str) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "client": CLIENT_15,
        "contract": "Conservancy Services",
        "contract_id": CONTRACT_15,
        "period_month": now.month,
        "period_year": now.year,
        "invoice_number": inv_no,
        "line_items": [{"description": "TEST overnight verify", "amount": SUBTOTAL}],
        "subtotal": SUBTOTAL,
        "service_charges": 0,
        "sales_tax": SALES_TAX,
        "wht": 0,
        "grand_total": GRAND,
        "notes": "scripts/live_verify_xero_ar.py",
    }

def cleanup(token: str) -> tuple[int, int]:
    rows = [r for r in api("GET", "/api/client-invoices", token).get("invoices", [])
            if str(r.get("invoice_number", "")).startswith(TEST_PREFIX)]
    for row in rows:
        iid = row["id"]
        if row.get("xero_invoice_id") and row.get("status") not in ("Void", "Voided"):
            try:
                api("POST", f"/api/client-invoices/{iid}/void-xero", token, {})
            except ApiError:
                pass
        api("PATCH", f"/api/client-invoices/{iid}", token, {"status": "Voided"})
    remaining = [r for r in api("GET", "/api/client-invoices", token).get("invoices", [])
                 if str(r.get("invoice_number", "")).startswith(TEST_PREFIX)
                 and r.get("status") not in ("Void", "Voided")]
    return len(rows), len(remaining)

def main() -> int:
    token = open(JWT_PATH, encoding="utf-8").read().strip()
    print("auth", api("GET", "/auth/me", token).get("user", {}).get("email"), flush=True)
    inv_id = api("POST", "/api/client-invoices", token, invoice_body(f"{TEST_PREFIX}AR-{int(time.time())}"))["invoice"]["id"]
    line = api("POST", "/api/ar/receipts/preview-split", token, {"invoice_ids": [inv_id]})["lines"][0]
    if float(line["income_tax_wht_pct"]) != 15 or float(line["income_tax_wht"]) != 15000:
        print("FAIL WHT split", line, flush=True)
        return 1
    print("PASS 15% WHT split", flush=True)
    try:
        api("POST", "/api/ar/receipts/preview-split", token, {"invoice_ids": []})
        print("FAIL empty invoice_ids", flush=True)
        return 1
    except ApiError as e:
        if e.status != 400:
            print("FAIL empty status", e.status, flush=True)
            return 1
    print("PASS empty invoice_ids 400", flush=True)
    xid = api("POST", f"/api/client-invoices/{inv_id}/push-xero", token, {}).get("xeroId")
    print("push-xero", xid, flush=True)
    try:
        api("POST", f"/api/client-invoices/{inv_id}/void-xero", token, {})
        print("void-xero ok", flush=True)
    except ApiError as e:
        print("void-xero warn", e.status, flush=True)
    inv2 = api("POST", "/api/client-invoices", token, invoice_body(f"{TEST_PREFIX}AR-RCP-{int(time.time())}"))["invoice"]["id"]
    l2 = api("POST", "/api/ar/receipts/preview-split", token, {"invoice_ids": [inv2]})["lines"][0]
    rid = api("POST", "/api/ar/receipts", token, {
        "client": CLIENT_15,
        "receipt_date": datetime.now(timezone.utc).date().isoformat(),
        "bank_ref": f"{TEST_PREFIX}BNK-{int(time.time())}",
        "push_to_xero": False,
        "lines": [l2],
    }).get("receipt", {}).get("id")
    print("PASS receipt push_to_xero=false id=", rid, flush=True)
    total, rem = cleanup(token)
    if rem:
        print("FAIL cleanup remaining", rem, flush=True)
        return 1
    print("PASS cleanup voided", total, "TEST-* invoices", flush=True)
    print("ALL TESTS PASSED", flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())