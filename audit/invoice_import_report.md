# Invoice history import (Build 4 / 4b)

## Prior run (Build 4)

Generated: 2026-07-08T18:20:45Z

- Prepared: 200 (limited batch)
- Inserted: 200
- Skipped: 0
- Errors: 0

No rows were skipped in the first batch; ~456 additional paid invoices (2025+, wafi_invoices_clean.csv) were not attempted because of the 200-row limit. Dry-run with --limit 0 prepares **656** eligible paid rows.

## Build 4b attempt (2026-07-09, MD signed in)

Generated: 2026-07-09T09:50:00Z

- Command: python scripts/import_invoice_history.py (full batch, idempotent; repo C:\temp\bpofm-backend-clone, git pull already up to date)
- Prepared: **656**
- Inserted: **0** (blocked)
- Skipped: **0**
- Errors: **0** (import never completed)

**Blocked (2 tries):** C:\temp\hcm_jwt.txt still returns **401 Token expired** on GET /api/client-invoices and POST /api/admin/import-invoices (batch 1). Token JWT exp is **2026-07-09 06:02:50 UTC** (~8h before this run). MD re-login in the app does not refresh the file automatically — copy a fresh value from browser localStorage key **sil_hcm_token** into C:\temp\hcm_jwt.txt, then re-run the same command.

## Live client_invoices count

| When | Count |
|------|------:|
| Before (last known, Build 4) | **218** (200 historic + 18 pre-existing per go_live_build_status) |
| After this run | **218** (unchanged; no API writes) |

## P&L revenue

Not compared this run (no authenticated API access). Prior expectation: importing remaining Wafi paid invoices should increase recognized revenue for 2025–2026 months once imports succeed and P&L is refreshed.

## Sample errors

[]
