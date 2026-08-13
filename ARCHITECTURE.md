# ASIL HCM — Architecture (Verified Facts)

**Last updated:** 2026-08-13 (P4 payroll vs AP reconciliation)  
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

| | **World A (legacy sheet + AP path)** | **World B (2026 restructure)** |
|---|---|---|
| Compute | **Server:** `POST /api/payroll/:year/:month/calculate` → `payrollSheet/service.js` + `resolveInputs.js` + `prSheetEngine.js` + `taxEngine.js` (Payroll Sheet is display/input UI only; browser `payrollUtils.calcEmployeeRow` is not used for money). **Sheet columns are baseline:** Monthly Hub / attendance zeros must not wipe sheet OT; default `sourceMode=sheet_inputs` (idempotent recompute). `canonical` only when UI pulls approved claims. | Server: `backend/src/modules/payrollrun/` + `prSheetEngine.js` + `taxEngine.js` |
| Storage | `POST /api/payroll/:year/:month` → `payroll_transactions` | `payroll_runs` + `payroll_run_rows` |
| Disbursement | AP queue → `payment_batches` → `payment_ledger` ✅ | `POST /api/payroll-runs/:id/disburse` → same tables ✅ (S4B) |
| Status | Pays ~500 employees today | Excel-parity-validated engine; not yet paying |

**Direction:** Build disbursement bridge (S4), pilot one contract at zero variance (S5), cut over contracts (S7), retire World A compute (S7R). World A must keep working until Phase 7.

**Proration decree:** Backend 30-day engine (`prSheetEngine.js`) is authoritative. Do not "fix" frontend `payrollUtils.js` to match it — it is scheduled for deletion.

**Snapshot decree (World A):** `payroll_transactions.computed_json` has exactly one producer — Payroll Sheet Calculate — and it is what the sheet UI shows and the bank file pays. Every other consumer (locked CSV export, HBL/IBFT bank files, payslip HTML, payslip PDF/email, invoice columns) **reads it via `src/payroll/snapshotView.js` and must never recompute payroll from raw inputs**. Independent recomputation in each consumer is what made the locked export disagree with the sheet (invented WHT on bonus-excluded rows; Rs. 155,559 across 305 employees, Jul-2026 Wafi). Rows predating the column (pre 2026-08-10) fall back to the legacy per-consumer math; that fallback is for history only — do not extend it. `backend/tests/payrollSnapshotParity.test.js` pins the invariant: export, payslip and snapshot must agree field for field and each document must balance.

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
| Absence deduction (invoice) | `(lineRate / roleCount) / 30 × absentDays` → `so_deductions` (with `line_id` linked to the matching manpower SO line) |
| Manual invoice adjustment | Invoice-step UI → `so_deductions` with `source='manual'`, `type='adjustment'`, free-text `note`. **Signed amount:** `+` adds to net taxable, `−` deducts, both **before** provincial ST. Step 5 defaults to **− Deduct**; type the PKR figure (no minus required). Parser accepts ASCII `-`, unicode `−`, commas, and `(n)`. Print: ADD / LESS Invoice Adjustments after service lines. Does not change payroll. |
| Invoice shortage attribution | Print nests absences under the matching SO line (`line_id`, else employee designation → line roles via `designationMatch.js`). Orphans only when unmatched. Unit Price stays gross; Amount PKR is net of that line's shortages. |
| Payroll wages (Conservancy) | Model A: `salary × ((30 − sheet_absent) / 30)`; Absent column = explicit sheet `days_absent` (not WD − present) |
| Attendance ingest | Excel sheet `"{MonthName} {year}"` or Google Drive folder `DRIVE_ATTENDANCE_FOLDER_ID`; override stores `present_days` + `absent_days` |
| Single write path | `backend/src/modules/serviceOrders/contractCrud.js` (wizard, CORO seed, NZ re-sync) |
| SO line replace | `replaceLines` re-points `so_deductions.line_id` across delete/re-insert (FK is ON DELETE SET NULL) |

**Tax rule (critical):** Stamped invoice grand = net taxable + provincial ST only. Income WHT (policy default 15%) and ~20% ST withholding appear in the receivable section only — they do **not** reduce stamped grand. Persisted to `client_invoices`: `subtotal=net`, `sales_tax=PST`, `grand_total=net+PST`, `wht=incomeWht`, breakdown in `notes` JSON. Province defaults (Wafi portal aligned): Punjab **16%**, Sindh/KPK/Balochistan **15%**. Prefer `service_orders.meta.taxRate` / `meta.province` when set.

**Tarujabba verification:** Monthly line rates sum to **2,156,300**; KPK ST 15% = **323,445**; stamped grand **2,479,745**.

**CORO SS94 verification:** Monthly lines sum **4,136,919.94**; Punjab ST 16% = **661,907.19**; stamped grand **4,798,827.13**.

**Payroll run guard:** `generateInvoiceFromRun` returns **409 `USE_SO_INVOICE`** for Fixed Value / Conservancy contracts — use `/api/fixed-value/service-orders/:id/invoice/*` instead.

**Routes (summary):**
- Contract CRUD: `GET/POST /api/fixed-value/contracts`, `GET/PUT .../contracts/:id`, `POST .../CTR-PSO-NORTH-ZONE/resync-seed` (superadmin, `{confirm:true}`)
- Per site: attendance upload/drive/apply, invoice compute/persist, deductions (list / add manual adjustment / delete manual only), focal email
- Contract bulk: `POST .../contracts/:id/attendance/apply-all`, `GET .../attendance/status`, `POST .../invoices/compute-all`, `POST .../invoices/persist-all`
- Exports (ExcelJS): `GET .../exports/payroll.xlsx`, `GET .../exports/invoices.xlsx` (payroll workbook includes “Bank file (format TBD)” sheet)
- World B payroll: `POST /api/payroll-runs/compute` (entire contract); FV UI shows by-site summary
- Also: registry, print (`/invoices/:id/print?format=`), deprecated seed alias (`POST /seed-pso`)

**Seed / data ops:**
- North Zone: `node scripts/seed_pso_north_zone.js` or `POST .../resync-seed` (UI source of truth; seed is optional re-sync)
- CORO: `node scripts/seed_pso_coro_ma.js` (payload `seedData/pso_coro_ss94.json`)
- Assign CORO roster: `node scripts/assign_coro_employees.js --apply`
- PSO-085 CNIC expiry: `scripts/fix_pso085_cnic_expiry.sql`
- Backfill orphaned shortage links: `node backend/scripts/backfill_so_deduction_lines.js [--apply] [--contract …] [--month …] [--year …]`

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
| Portal claims (Wafi) | **August rollout:** `claim_eligibility_rules` (UI-editable; seed: Wafi minus FM). Routing matrix in `claimsEligibility.js` — Focal+LM, Focal only, Employee+LM, Employee+ASIL (Huzaifa fallback). `portal_claim_periods.campaign_mode` = `sample` \| `actual` (SAMPLE redirects all mail to `CLAIMS_SAMPLE_EMAIL`, blocks payroll injection). Hub: `PortalClaimsHub.jsx`. Flush: `node backend/scripts/flush_portal_claims_sample.js`. E2E: `docs/PORTAL_CLAIMS_AUGUST_E2E.md`. Legacy Wafi Gmail intake gated by `wafi_gmail_intake_enabled=false`. |

---

## Payslip delivery (World A — Aug 2026)

| Item | Detail |
|---|---|
| Module | `backend/src/modules/payslip/` — single PDF per employee/month, CNIC password, ASIL logo |
| Layout | OT 2X/3X hours + PKR amounts, medical & expense reimbursements, tax vs other deductions, net payable |
| Gate | Per employee: payroll row **locked** and a `payment_ledger` SALARY row in a PAYROLL batch for that year/month with `status='Paid'`. Send is refused until every selected employee is both locked and paid. Roles: **finance_manager**, **finance_approver**, **payroll_initiator**, **superadmin**. |
| Channels | Email (PDF attach via Resend), SMS (7-day link `/p/:token` via Jazz), portal download |
| QA test run | `POST /api/payslip/test-run` (superadmin) or `scripts/send_july_payslip_test_run.js` — 5 sample July slips to override email/SMS |
| Support | `POST /api/payslip/support-case` → ops-support@asil.com.pk; resolve notifies employee email+SMS |
| Migration | `20260810180000_payslip_delivery.js` — run `npm run migrate` on staging before deploy |

### Payroll vs AP reconciliation (P4)
`GET /api/payroll/:year/:month/reconciliation` (`backend/src/modules/payrollReconciliation/`) returns sheetTotal / lockedTotal (frozen `locked_net`) / apTotal / paidTotal plus named exception lists (unlocked, orphans, blankScope, excludedByDates, lockedNotPaid, paidNotLocked). Roles: finance_manager, finance_approver, payroll_initiator, ap_team, superadmin. Payroll Sheet shows a Locked (AP view) subtotal and Reconcile panel.

---

## Further reading

- `.agents/REMEDIATION_PLAN.md` — session order, milestones, MD gates
- `.agents/AGENTS.md` — coding guardrails, frozen routes, changelog
- `audit/groundtruth/facts.md` — production snapshot (S0A)
