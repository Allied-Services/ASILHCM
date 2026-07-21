# Go-live progress (Build 2-5)

Generated: 2026-07-09T09:50:00Z

## Build 4b - Remaining Wafi invoices (blocked)

**Attempted:** 2026-07-09 - full import of 656 paid rows (2025+); prior run imported 200 with 0 skipped.

| Metric | Value |
|---|---|
| CSV eligible (dry-run) | 656 |
| Imported (Build 4) | 200 |
| Live client_invoices (last known) | 218 |
| Build 4b run | Blocked - JWT expired (401), 2 tries |

**Next:** Copy fresh sil_hcm_token from browser localStorage into C:\\temp\\hcm_jwt.txt, then python scripts/import_invoice_history.py (skips duplicates).

Live: https://asilhcm.onrender.com

## Build 5 – Dashboards (complete)

**Git main:** 79dee67 (includes 4c62f4 Build 5 dashboards)  
**Live verified:** 2026-07-09 – /api/pnl/contracts?year=2026&month=5, /api/ar/aging, /api/dashboard/summary (data_period May 2026)

- P&L UNION view (cost_allocations + client_invoices periods); revenue without matching costs
- Cashflow week 0 includes overdue unpaid invoices
- Dashboard summary: exclude Voided outstanding; payroll KPI from cost_allocations with payroll_runs fallback; data_period
- AR aging API (GET /api/ar/aging) + AR dashboard table
- Dashboard P&L defaults May 2026 (sync from summary data_period)
- Jest: 147 passed (C:\temp\bpofm-backend and backend/ in clone)

## Phase status

| Phase | Status |
|---|---|
| Build 5 dashboards | Complete |
| Build 6 team onboarding | Complete |
| Build 4b invoice remainder | Blocked (JWT) |

## Build 6 – Team onboarding pack (complete)

**Git main:** 692ccbb  
**Deliverables:** docs/team_guide_*.md, docs/team_accounts_setup.md

- Role one-pagers: finance_manager, ar_team, ap_team, procurement_proposer, payroll_initiator
- Account setup: User Management flow, VALID_ROLES matrix, MD roster template
- Live user list: skipped (JWT in C:\\temp\\hcm_jwt.txt returned 401)
