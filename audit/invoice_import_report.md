# Invoice history import (Build 4 / 4b)

## Prior run (Build 4)

Generated: 2026-07-08T18:20:45Z

- Prepared: 200 (limited batch)
- Inserted: 200
- Skipped: 0
- Errors: 0

No rows were skipped in the first batch; ~456 additional paid invoices (2025+, wafi_invoices_clean.csv) were not attempted because of the 200-row limit. Dry-run with --limit 0 prepares **656** eligible paid rows.

## Build 4b attempt

Generated: 2026-07-09T11:35:00Z

- Command: python scripts/import_invoice_history.py (full batch, idempotent)
- Prepared: 656
- Inserted: 0 (run blocked before completion)
- Skipped: 0
- Errors: 0

**Blocked:** JWT 401 Token expired on batch 1 POST /api/admin/import-invoices. **Needs MD re-login**; refresh C:\temp\hcm_jwt.txt and re-run the same command.

## Live client_invoices count

Not queried this run (JWT expired). Last known on live: **218** (per audit/go_live_build_status.md: 200 historic imported + 18 pre-existing).

## Sample errors

[]
