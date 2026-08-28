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
| Compute | **Server:** `POST /api/payroll/:year/:month/calculate` → `payrollSheet/service.js` + `resolveInputs.js` + `prSheetEngine.js` + `taxEngine.js` (Payroll Sheet is display/input UI only; browser `payrollUtils.calcEmployeeRow` is not used for money). **Sheet columns are baseline:** Monthly Hub / attendance zeros must not wipe sheet OT; default `sourceMode=sheet_inputs` (idempotent recompute). `canonical` (UI **Merge approved Portal Claims**) also loads approved `portal_claim_*` rows whose **settlement month** is the Payroll Sheet month (July work → August pay) — not only `employee_claims` stamped with the pay month. | Server: `backend/src/modules/payrollrun/` + `prSheetEngine.js` + `taxEngine.js` |
| Storage | `POST /api/payroll/:year/:month` → `payroll_transactions`. **Write auth:** payroll roles (`finance_proposer`, `payroll_initiator`, `payroll`, `finance_manager`, `finance_approver`, `superadmin`) **or** User Management `payroll.edit` on `hcm_users.permissions` (JWT role alone is not enough when the tab was granted as a custom permission). Same guard on `POST .../calculate`. Lock/unlock stay `finance_approver`/`superadmin`. | `payroll_runs` + `payroll_run_rows` |
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
| Manual invoice adjustment | Invoice-step UI → `so_deductions` with `source='manual'`, `type='adjustment'`, free-text `note`, and required `line_id` on that location’s service-order line. **Signed amount:** `+` adds to net taxable, `−` deducts, both **before** provincial ST. Step 5: pick Location → Comment → Line item → amount. Print nests ADD/LESS under that SO line. Does not change payroll. |
| Invoice shortage attribution | Print nests absences under the matching SO line: stored `line_id` if it still matches, else **Excel map** `psoConservancyMap.js` (`Attachments/PSO_Conservancy_Services_by_Location.xlsx` — location + designation → item number), else role fuzzy-match. Fitter/Mechanical is Technical, not M&R. Orphans only when unmatched. |
| Payroll wages (Conservancy) | Model A: `salary × ((30 − sheet_absent) / 30)`; Absent column = explicit sheet `days_absent` (not WD − present) |
| Attendance ingest | Excel sheet `"{MonthName} {year}"` or Google Drive folder `DRIVE_ATTENDANCE_FOLDER_ID`; override stores `present_days` + `absent_days` |
| Single write path | `backend/src/modules/serviceOrders/contractCrud.js` (wizard, CORO seed, NZ re-sync) |
| SO line replace | `replaceLines` re-points `so_deductions.line_id` across delete/re-insert (FK is ON DELETE SET NULL) |

**Tax rule (critical):** Stamped invoice grand = net taxable + provincial ST only. Income WHT (policy default 15%) and ~20% ST withholding appear in the receivable section only — they do **not** reduce stamped grand. Persisted to `client_invoices`: `subtotal=net`, `sales_tax=PST`, `grand_total=net+PST`, `wht=incomeWht`, breakdown in `notes` JSON. Province defaults (Wafi portal aligned): Punjab **16%**, Sindh/KPK/Balochistan **15%**. Prefer `service_orders.meta.taxRate` / `meta.province` when set.

**Tarujabba verification:** Monthly line rates sum to **2,156,300**; KPK ST 15% = **323,445**; stamped grand **2,479,745**.

**CORO SS94 verification:** Monthly lines sum **4,136,919.94**; Punjab ST 16% = **661,907.19**; stamped grand **4,798,827.13**.

**Payroll run guard:** `generateInvoiceFromRun` returns **409 `USE_SO_INVOICE`** for Fixed Value / Conservancy contracts — use `/api/fixed-value/service-orders/:id/invoice/*` instead.

**Month close (FV):** Locking a World B payroll run for an FV contract atomically creates `payroll_close_packs` + `payroll_payables` (salary, EOBI, SESSI, PF, WHT, gratuity/bonus accrual, etc.) and writes `cost_allocations`. AP settles via `GET /api/ap/close-packs` and `POST .../payables/:type/settle`. P&L revenue counts `client_invoices` from **Finalized** onward (not Draft). Post-close edits require `MONTH_CLOSE_UNLOCK_CODE_HASH` via reopen endpoints. July PSO backfill: `node backend/scripts/repair_july_pso_close.js` (dry-run; `--apply` to write).

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
| Wafi 3P contact / focal | `node scripts/wafi_contact_focal_update.js --file "<csv-or-xlsx>" --dry-run --scope=file` — contact + Focal/LM only (no salary/bank). `--scope=file` = every code in the file (3P + FM). Default `--scope=wafi-3p` is Wafi BPO only. Apply only on staging with `STAGING_DATABASE_URL`. |
| Wafi claim routing | `claim_authority` → focal input; `line_manager_email` → LM approve; `GET/POST /api/wafi-claims/focal-action`, `lm-action` |
| Approval gate | `verify` / `stage-payroll` require `approval_state` ∈ `{ready_for_hcm, legacy_bypass}`; post-Jul-2026 sessions with null state blocked when chain enabled |
| Portal claims (Wafi) | **August rollout:** send audience is chosen on the Portal Claims filters (Month → Client → Contract → Department → Location). The old Wafi-minus-FM `claim_eligibility_rules` seed is deactivated. Routing matrix in `claimsEligibility.js`: **Focal+LM** → Focal fills, LM approves; **Focal only** → Focal fill is final; **Employee+LM** → employee Wafi or `asil.com.pk` mailbox fills, LM approves; **LM only** → LM fills and submit is final (no Focal, no Wafi/ASIL employee mailbox); **Employee+ASIL** → employee work mailbox, Huzaifa approves; **Setup needed** only when Focal, Wafi/ASIL mailbox, and LM are all missing — campaign emails `sadia.komal@asil.com.pk` with a `/?tab=claims_portal&setup_needed=1` link. **Never invite Gmail/Yahoo/personal mail to gather claims.** `portal_claim_periods.campaign_mode` = `sample` \| `actual` (SAMPLE redirects all mail to `CLAIMS_SAMPLE_EMAIL`, blocks payroll injection). Hub: `PortalClaimsHub.jsx` (Response / Request emails / Manual add) + `ClaimRequestCampaign.jsx`. Response loads periods by claim **or** campaign **or** settlement month. Desk access: finance roles **and** `operations_supervisor` (Rabia), plus anyone granted `claims_portal` in User Management. `GET /api/portal-claims/admin/response` returns the full campaign audience vs `payroll_transactions` for the pay month, with per-person To / sent time / mailer result / who acts now (Focal vs Employee vs LM vs ASIL; no-claims split from rejected). `POST /api/portal-claims/admin/chase` previews or sends invite / filler reminder / approver reminder for ticked `employeeIds` (SAMPLE redirects; ACTUAL needs `CLAIMS_ALLOW_ACTUAL_SEND`; finished rows skipped unless superadmin `force`). Auto-import (`POST /api/portal-claims/admin/import-if-empty` and LM approve) writes OT/medical/expense only when those four sheet columns are empty. **Review and push to payroll** (`POST /api/portal-claims/admin/push-payroll`) writes July work onto the August sheet and will replace those four columns when the operator confirms — used after a manual upload so the Response board numbers and the Payroll Sheet match. Payroll Sheet **Calculate** with **Merge approved Portal Claims** (`sourceMode=canonical`) also reads those approved July portal rows (settlement = August) so OT / expense / medical appear on the August sheet even when `employee_claims` was never stamped for August. The Response board prefers the work-month row that still has claim items (a later empty `in_payroll` row must not hide the upload). `POST /api/portal-claims/campaign/preview` returns flat `employees[]` plus per-recipient HTML. Live send `POST /api/portal-claims/campaign` accepts `onlyEmployeeIds`. Every portal-claims email CCs `CLAIMS_MONITOR_CC` (default `claims@asil.com.pk`) until `CLAIMS_MONITOR_CC_UNTIL` (default 2026-11-15). Filler submit (Employee / Focal / LM, including per-employee save and submit-all) emails the filler a confirmation with OT 2X/3X hours, expense and medical totals, and the line list they just submitted; SAMPLE still redirects to `CLAIMS_SAMPLE_EMAIL`. LM approve/reject does not send a second submit-record. Flush: `node backend/scripts/flush_portal_claims_sample.js`. E2E: `docs/PORTAL_CLAIMS_AUGUST_E2E.md`. Manual CSV (`POST /api/portal-claims/manual-override/import`) overwrites the **work-month** portal claim (July work) and settles on the following Payroll Sheet (August); it never writes the locked July salary sheet. Send to LM = Y replaces portal items and emails the LM to re-approve; Send to LM = N replaces portal items only (file 500 replaces portal 100) with no Focal or LM email. Excel thousand separators (`80,823`) import as 80823; template code `ASIL/SPL-001` is rejected. Legacy Wafi Gmail intake gated by `wafi_gmail_intake_enabled=false`. |
| Monthly Cycle hub | **2026-08-25:** Staff tab `monthly_cycle` → `MonthlyCycleHub.jsx` wraps the same Portal Claims engine with contract **pack** config on `contract_claim_policies` (`enabled_types`, `collection_mode`, `reviewer_required`) and people assignment (`claim_authority`, `line_manager_email`, `claims_reviewer_email`). Wafi seeded `{OT,EXPENSE,MEDICAL}`. Fill wizard steps and `saveSubmissionItems` reject disabled types. PSO attendance collection is configured but not live yet. Legacy tabs (Portal Claims, Email Claims, etc.) remain until a later hide pass. |

---

## Payslip delivery (World A — Aug 2026)

| Item | Detail |
|---|---|
| Module | `backend/src/modules/payslip/` — single PDF per employee/month, CNIC password, ASIL logo |
| Layout | OT 2X/3X hours + PKR amounts, medical & expense reimbursements, tax vs other deductions, net payable |
| Gate | Per employee: payroll row **locked** and a `payment_ledger` SALARY row in a PAYROLL batch for that year/month with `status='Paid'`. Send is refused until every selected employee is both locked and paid. Roles: **finance_manager**, **finance_approver**, **payroll_initiator**, **superadmin**. |
| Channels | Email (PDF attach via Resend) **To: employee and focal** (focal only when the employee has no mailbox — personal Gmail is OK on the slip). SMS (7-day PDF link `/api/payslip/link/:token` via Jazz), portal download. SMS requires a valid `employees.primary_contact` (03XXXXXXXXX). Placeholder `N/A` email/phone is skipped. Send result stays in the modal with per-employee email + SMS confirmation. Superadmin may pass `destEmail` / `destPhone` for a one-off delivery. |
| Month status | `GET /api/payroll/:year/:month/payslip-readiness` returns `emailSentCount`, `smsSentCount`, `remainingEmail[]`, `remainingSms[]`, and per-employee `emailStatus` / `smsStatus` for the selected month. Payroll Sheet shows Email/SMS chips on each row and in the send modal. |
| Remaining send | `POST /api/payroll/:year/:month/send-payslips` accepts `onlyMissing: 'email' \| 'sms'`. Sends only that channel to people who have not yet got it (does not re-send the other channel). Frontend sends remaining IDs in chunks of 20 so a 300-person month cannot sit on one 10-minute request. |
| QA test run | `POST /api/payslip/test-run` (superadmin) or `scripts/send_july_payslip_test_run.js` — 5 sample July slips to override email/SMS |
| Support | `POST /api/payslip/support-case` → ops-support@asil.com.pk; resolve notifies employee email+SMS |
| Migration | `20260810180000_payslip_delivery.js` — run `npm run migrate` on staging before deploy |

### AP partial payroll payment
`POST /api/ap/payroll-queue/:year/:month/confirm` accepts an optional `employee_ids[]`, so AP can pay part of a locked contract batch (e.g. 10 of 305). Anyone already holding a paid SALARY `payment_ledger` row for that month is skipped and returned in `skipped_already_paid` — never paid twice. The batch header (`total_amount`, `employee_count`) is recomputed from its own ledger after each confirm, so repeat partial confirms accumulate instead of overwriting. `409 ALREADY_PAID` when nothing remains and no batch exists. Confirm upserts `payment_batches` with SELECT-then-INSERT/UPDATE (not expression `ON CONFLICT`) because Postgres cannot infer unique indexes on `COALESCE(client,'')`. `bank_id` is INTEGER (`banks.id`); the AP modal's `hbl`/`nbp` slugs are resolved via `resolvePaymentBatchBankId` (or stored null) so they are never written into that column.

`GET /api/ap/payroll-queue` returns `paid_count` and `unpaid_net_pay` per client/contract group; the detail route returns a per-employee `paid` flag. The AP UI groups cards under a month roll-up header (all locked employees + net for the month) because each card is only one client/contract slice of that month.

### Payroll vs AP reconciliation (P4)
`GET /api/payroll/:year/:month/reconciliation` (`backend/src/modules/payrollReconciliation/`) returns sheetTotal / lockedTotal (frozen `locked_net`) / apTotal / paidTotal plus named exception lists (unlocked, orphans, blankScope, excludedByDates, lockedNotPaid, paidNotLocked). Roles: finance_manager, finance_approver, payroll_initiator, ap_team, superadmin. Payroll Sheet shows a Locked (AP view) subtotal and Reconcile panel.

---

## Further reading

- `.agents/REMEDIATION_PLAN.md` — session order, milestones, MD gates
- `.agents/AGENTS.md` — coding guardrails, frozen routes, changelog
- `audit/groundtruth/facts.md` — production snapshot (S0A)
