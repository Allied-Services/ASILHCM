# ASIL HCM — Architecture (Verified Facts)

**Last updated:** 2026-07-25 (S5A remediation)  
**Program:** See `.agents/REMEDIATION_PLAN.md` for the active multi-session remediation plan.

---

## What this system is

Enterprise HCM & payroll platform for Allied Services International Limited (~500 active employees). Stack: Node.js/Express backend (`backend/server.js` + `backend/src/modules/*`), React 19/Vite frontend, Neon PostgreSQL, Render hosting.

| Environment | Backend | Frontend |
|---|---|---|
| Production | https://asilhcm.onrender.com | https://asil-hcm-frontend.onrender.com |
| Staging | https://asil-hcm-staging.onrender.com | https://asil-hcm-frontend-staging.onrender.com |

Deploy topology and env vars: `render.yaml`, `docs/STAGING_SETUP.md`, `backend/.env.example` (authoritative env list).

---

## The two-world payroll problem (and fix)

Two payroll systems coexist; consolidation is in progress (strangler-fig onto World B):

| | **World A (legacy)** | **World B (2026 restructure)** |
|---|---|---|
| Compute | Browser: `PayrollSheet.jsx` + `payrollUtils.js` | Server: `backend/src/modules/payrollrun/` + `prSheetEngine.js` + `taxEngine.js` |
| Storage | `POST /api/payroll/:year/:month` → `payroll_transactions` | `payroll_runs` + `payroll_run_rows` |
| Disbursement | AP queue → `payment_batches` → `payment_ledger` ✅ | `POST /api/payroll-runs/:id/disburse` → same tables ✅ (S4B) |
| Status | Pays ~500 employees today | Excel-parity-validated engine; not yet paying |

**Direction:** Build disbursement bridge (S4), pilot one contract at zero variance (S5), cut over contracts (S7), retire World A compute (S7R). World A must keep working until Phase 7.

**Proration decree:** Backend 30-day engine (`prSheetEngine.js`) is authoritative. Do not "fix" frontend `payrollUtils.js` to match it — it is scheduled for deletion.

---

## Canonical data sources

| Entity | Use this table | Do not use |
|---|---|---|
| AR invoices | `client_invoices` | `invoices` (legacy) |
| Employees | `employees` | — |
| Payroll history | `payroll_transactions` (legacy + history) | — |
| Payroll runs (World B) | `payroll_runs`, `payroll_run_rows` | — |
| Claims (target) | `employee_claims` | scattered legacy writers (S8 consolidates) |
| Payments | `payment_batches`, `payment_ledger` | — |
| Bills | `bills` | — |

---

## Code layout

- **Monolith routes:** `backend/server.js` (~9,200 lines) — frozen for structural refactors; surgical edits only.
- **New domains:** `backend/src/modules/<name>/routes.js` mounted via `backend/mountModules.js`.
- **DDL:** `backend/migrations/` via node-pg-migrate — **no new CREATE TABLE in server.js**.
- **Frontend API:** All calls through `frontend/src/api.js`.
- **Tests:** `backend/tests/` (mocked pg); `npm run test:int` (real Postgres, S2A+) for money paths.

---

## Background jobs

`JOBS_RUNNER=web` (default): pg-boss crons run in the web process. See `.agents/AGENTS.md` §2.7 for ops limits and worker upgrade path.

---

## Further reading

- `.agents/REMEDIATION_PLAN.md` — session order, milestones, MD gates
- `.agents/AGENTS.md` — coding guardrails, frozen routes, changelog
- `audit/groundtruth/facts.md` — production snapshot (S0A)
