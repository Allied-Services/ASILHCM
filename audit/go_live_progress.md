# Go-live progress (Build 2-5)

Generated: 2026-07-09T09:20:00Z
Live: https://asilhcm.onrender.com

## Build 5 — Dashboards (complete)

**Git main:** 79dee67 (includes 4c62f4 Build 5 dashboards)  
**Live verified:** 2026-07-09 — /api/pnl/contracts?year=2026&month=5, /api/ar/aging, /api/dashboard/summary (data_period May 2026)

- P&L UNION view (cost_allocations + client_invoices periods); revenue without matching costs
- Cashflow week 0 includes overdue unpaid invoices
- Dashboard summary: exclude Voided outstanding; payroll KPI from cost_allocations with payroll_runs fallback; data_period
- AR aging API (GET /api/ar/aging) + AR dashboard table
- Dashboard P&L defaults May 2026 (sync from summary data_period)
- Jest: 147 passed (C:\temp\bpofm-backend and ackend/ in clone)

## Phase status

| Phase | Status |
|---|---|
| Build 5 dashboards | Complete |
| Build 6 team onboarding | Complete |

## Build 6 — Team onboarding pack (complete)

**Git main:** 692ccbb  
**Deliverables:** docs/team_guide_*.md, docs/team_accounts_setup.md

- Role one-pagers: finance_manager, ar_team, ap_team, procurement_proposer, payroll_initiator
- Account setup: User Management flow, VALID_ROLES matrix, MD roster template
- Live user list: skipped (JWT in C:\\temp\\hcm_jwt.txt returned 401)

