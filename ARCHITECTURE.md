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

## Fixed Value / Conservancy (PSO service orders)

Module: `backend/src/modules/serviceOrders/` — mounted at `/api/fixed-value/*`.
UI: `frontend/src/features/fixedValue/FixedValueContracts.jsx` — stepped ops workflow (Period → Attendance → Payroll → Invoice → Statutory → Export) plus **create/edit wizard** (`FixedValueContractWizard.jsx`).

| Item | Detail |
|---|---|
| Contract (multi-site conservancy) | `CTR-PSO-NORTH-ZONE` — PSO North Zone Operations |
| Contract (CORO retail ops) | `CTR-PSO-CORO-MA` — CORO - Masood Anwari (SO `4110036239`, site `SS94`) |
| Service order IDs | Explicit `so_id` on create, or default `SO-PSO-{SITE_CODE}` |
| CORO SO | `SO-PSO-CORO-SS94` (not `SO-PSO-SS94`) |
| Billing model | `service_order_deduction` on `contract_policies` |
| Contract meta | `contracts.meta` JSONB — `fv_product`, external SO #, SLA/retention text, security deposit |
| Monthly qty default | `1` per service order line (annual months stored in meta) |
| Absence deduction (invoice) | `(lineRate / roleCount) / 30 × absentDays` → `so_deductions` |
| Payroll wages (Conservancy) | Model A: `salary × ((30 − sheet_absent) / 30)`; Absent column = explicit sheet `days_absent` (not WD − present) |
| Attendance ingest | Excel sheet `"{MonthName} {year}"` or Google Drive folder `DRIVE_ATTENDANCE_FOLDER_ID`; override stores `present_days` + `absent_days` |
| Single write path | `backend/src/modules/serviceOrders/contractCrud.js` (wizard, CORO seed, NZ re-sync) |

**Tax rule (critical):** Stamped invoice grand = net taxable + provincial ST only. Income WHT (policy default 15%) and ~20% ST withholding appear in the receivable section only — they do **not** reduce stamped grand. Persisted to `client_invoices`: `subtotal=net`, `sales_tax=PST`, `grand_total=net+PST`, `wht=incomeWht`, breakdown in `notes` JSON. Province defaults (Wafi portal aligned): Punjab **16%**, Sindh/KPK/Balochistan **15%**. Prefer `service_orders.meta.taxRate` / `meta.province` when set.

**Tarujabba verification:** Monthly line rates sum to **2,156,300**; KPK ST 15% = **323,445**; stamped grand **2,479,745**.

**CORO SS94 verification:** Monthly lines sum **4,136,919.94**; Punjab ST 16% = **661,907.19**; stamped grand **4,798,827.13**.

**Payroll run guard:** `generateInvoiceFromRun` returns **409 `USE_SO_INVOICE`** for Fixed Value / Conservancy contracts — use `/api/fixed-value/service-orders/:id/invoice/*` instead.

**Routes (summary):**
- Contract CRUD: `GET/POST /api/fixed-value/contracts`, `GET/PUT .../contracts/:id`, `POST .../CTR-PSO-NORTH-ZONE/resync-seed` (superadmin, `{confirm:true}`)
- Per site: attendance upload/drive/apply, invoice compute/persist, deductions, focal email
- Contract bulk: `POST .../contracts/:id/attendance/apply-all`, `GET .../attendance/status`, `POST .../invoices/compute-all`, `POST .../invoices/persist-all`
- Exports (ExcelJS): `GET .../exports/payroll.xlsx`, `GET .../exports/invoices.xlsx` (payroll workbook includes “Bank file (format TBD)” sheet)
- World B payroll: `POST /api/payroll-runs/compute` (entire contract); FV UI shows by-site summary
- Also: registry, print (`/invoices/:id/print?format=`), deprecated seed alias (`POST /seed-pso`)

**Seed / data ops:**
- North Zone: `node scripts/seed_pso_north_zone.js` or `POST .../resync-seed` (UI source of truth; seed is optional re-sync)
- CORO: `node scripts/seed_pso_coro_ma.js` (payload `seedData/pso_coro_ss94.json`)
- Assign CORO roster: `node scripts/assign_coro_employees.js --apply`
- PSO-085 CNIC expiry: `scripts/fix_pso085_cnic_expiry.sql`

---

## July 2026 soft cutover & Wafi routing

| Item | Detail |
|---|---|
| Cutover floor | Normal UI/AP/payroll/invoices show period ≥ **2026-07** |
| Archive toggle | `GET/PUT /api/admin/cutover-settings` — **superadmin** + **huzaifa.rafaqat@asil.com.pk** only; propagates via `X-Show-Archive: 1` / `?archive=1` |
| Helper | `backend/src/core/cutover.js` — `employeeVisibilityClause`, `applyPeriodFloor`, `resolveArchiveMode` |
| Wafi roster refresh | `node scripts/wafi_roster_refresh.js --csv "<path>" --dry-run` (apply only on staging with `STAGING_DATABASE_URL`) |
| Wafi claim routing | `claim_authority` → focal input; `line_manager_email` → LM approve; `GET/POST /api/wafi-claims/focal-action`, `lm-action` |
| Approval gate | `verify` / `stage-payroll` require `approval_state` ∈ `{ready_for_hcm, legacy_bypass}`; post-Jul-2026 sessions with null state blocked when chain enabled |
| Portal claims (Wafi) | Filler = `claim_authority`; approver = `line_manager_email` when both named (else `supervisor_email` legacy). No second focal-then-LM state machine — email Excel path is authoritative for Wafi |

---

## Further reading

- `.agents/REMEDIATION_PLAN.md` — session order, milestones, MD gates
- `.agents/AGENTS.md` — coding guardrails, frozen routes, changelog
- `audit/groundtruth/facts.md` — production snapshot (S0A)
