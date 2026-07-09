# HCM Go-Live Build Status

Generated: 2026-07-09T12:00:00Z  
**main:** `fca440a`

## Done (Builds 1–6)

| Build | Status |
|---|---|
| 1–5 | Complete (see `audit/go_live_progress.md`) |
| 6 Team onboarding | `692ccbb` — 5 role guides + `docs/team_accounts_setup.md` |

## Blocked

| Task | Blocker | Action |
|---|---|---|
| **4b** Remaining invoices (~456) | JWT expired | MD re-login → save `C:\temp\hcm_jwt.txt` → `python scripts/import_invoice_history.py` |
| Roster in `team_accounts_setup.md` | Same JWT | Run snippet in that doc after re-login |

## Next (MD gates)

| Build | Task |
|---|---|
| 7 | Parallel July 2026 month-end + variance report |
| 8 | First live HBL payment |
