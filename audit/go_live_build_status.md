# HCM Go-Live Build Status

Generated: 2026-07-08T15:25:00Z  
Builder: Composer 2.5  
Plan: `C:\Users\Shoaib Siddique\.cursor\plans\hcm_go_live_master_plan.plan.md`

## Done

| Build | Status | Evidence |
|---|---|---|
| 1 — Data profile | **Complete** | `audit/data_migration_map.md`, `scripts/profile_historic_data.py` |
| 2 — Employee master | **Complete** | 682 employees in HCM, 666 matched to June CSV, 0 missing |
| Import APIs (code) | **Pushed** | `6870379`, `f71f42c` on `main` |

### MD verify employees (ready for your review)

| ID | Name | Client | Bank | Email |
|---|---|---|---|---|
| `ASIL/PSO-298/25` | Mohammad Zubair | Pakistan State Oil Company Limited | Allied Bank | — |
| `ASIL/SPL-418/21` | Shahzad Masih | Wafi Energy Pakistan Limited | HBL | Kanwar.Azhar@wafi-energy.com |
| `ASIL/SPL-420/21` | Rafae Kayani | Wafi Energy Pakistan Limited | Faysal Bank | R.Kayani-Contractor@wafi-energy.com |

Note: all three were imported with CNIC omitted due to duplicate CNIC on other active records (documented in `audit/employee_import_report.md`).

## Blocked — Render deploy not updating

Live API at `https://asilhcm.onrender.com` is **still running a build before `6870379`**:

- `POST /api/admin/import-payroll-history` → **404**
- `POST /api/admin/import-invoices` → **404**
- `/health` does not yet return `commit` field (added in `8741176`)

`GET /api/payroll-runs` works (older route). GitHub `main` is at **`f71f42c`** (import routes now also registered directly in `server.js`).

**Action needed:** In Render dashboard → **ASILHCM** web service → **Manual Deploy** → deploy latest commit from `main`. Auto-deploy appears stalled.

After deploy, run:

```powershell
python scripts/wait_deploy.py f71f42c --timeout 600
python scripts/run_go_live_imports.py
```

This loads Mar–May 2026 payroll history (Build 3) and up to 200 paid Wafi invoices (Build 4).

## Pending (after deploy)

| Build | Task |
|---|---|
| 3 | Payroll history import — script ready, blocked on 404 |
| 4 | Invoice history import — script ready, blocked on 404 |
| 5 | Dashboards with real data |
| 6 | Team onboarding guides |
| 7 | Parallel July 2026 month-end |
| 8 | First live HBL payment (MD sign-off) |

## Minor open items

- Junk employee rows (`123`, `TEST`, `ASIL-1774260596303`) — DELETE returns 500 (FK references); safe to leave until purge helper added
- `ASIL/PSO-085/25` backfill still fails with 500 on PUT
