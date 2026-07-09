# Data corrections (MD Mandate §2)

Generated: 2026-07-09T12:35:33Z
Mode: LIVE

## Protected CNIC-duplicate employees

- `ASIL/PSO-298/25` — exists=True cnic=None name=Mohammad Zubair
- `ASIL/SPL-418/21` — exists=True cnic=None name=Shahzad Masih
- `ASIL/SPL-420/21` — exists=True cnic=None name=Rafae Kayani

## Junk row deletions

- `123` — None ok=False
  - Error: `DELETE /api/employees/123 HTTP 500: b'{"error":"Internal server error"}'`
- `TEST` — None ok=False
  - Error: `DELETE /api/employees/TEST HTTP 500: b'{"error":"Internal server error"}'`
- `ASIL-1774260596303` — None ok=False
  - Error: `DELETE /api/employees/ASIL-1774260596303 HTTP 500: b'{"error":"Internal server error"}'`

FK cleanup targets (server-side): payroll_run_rows, payroll_transactions, attendance_records, employee_claims, claims_inbox, pf_ledger, payroll_advances
Rollback snapshot: `audit\junk_delete_rollback.json`
