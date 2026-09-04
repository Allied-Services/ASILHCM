# ASIL HCM — Built System Specification

**Audience:** another AI model taking over this codebase.  
**Date:** 2026-08-28  
**Workspace:** `C:\Projects\HCM\BPOFMSystem` → GitHub `shezad/ASILHCM`  
**Code is the source of truth.** If this file disagrees with code, trust the code and update this file.

---

## For the owner (plain English)

ASIL HCM is the live company system that holds our people, contracts, claims, bills, invoices, and pay. Staff at ASIL sign in with their work Google account. About 500 employees are paid from it today. The everyday pay path is the **Payroll Sheet**: numbers go onto the sheet, finance locks the month, Accounts Payable confirms a bank batch, then payslips can go out by email and SMS. A newer server-side payroll engine also exists and has been checked against Excel, but it has **not** paid a real production month yet. Do not treat the two engines as interchangeable.

The newest product we actually shipped and are running is **Portal Claims** (and the **Monthly Cycle** tab that wraps it). Each month we email the right person a magic link — a Focal, a Line Manager, or in some cases the employee or Sadia. That person fills OT, expense, and medical (on screen or via a personalised Excel), uploads receipts under the matching claim, and submits. If someone else must approve, they get their own link. After approval, finance can push amounts onto the Payroll Sheet **only if those four sheet columns are still empty**. SAMPLE mode sends every email to a test inbox and never writes pay. ACTUAL send to real people is gated and needs an explicit go-ahead.

The rest of the system is real and in production: employee records, client/contracts, Fixed Value / PSO site billing, attendance, bills and procurement, AR invoices, leave balances, an employee portal with OTP login, and ops tools. Several older claim doors (Wafi Gmail sessions, email intake, Claims Queue) still exist beside Portal Claims. Staging exists on Render but sleeps on the free tier. **Never push `main` from an agent folder without a PR.** The owner’s Cursor folder must not be used as a build directory — agents create their own worktree with `npm run wt:new -- <slug>`.

---

## 1. System identity

Enterprise HCM & payroll for **Allied Services International Limited (Pvt.) Ltd.** (~500 active employees; roster larger). Primary live client in claims/payroll work: **Wafi Energy**. Second product line: **Fixed Value / PSO conservancy** (North Zone + CORO SS94).

| Environment | Backend | Frontend |
|---|---|---|
| Production | https://asilhcm.onrender.com | https://asil-hcm-frontend.onrender.com |
| Staging | https://asil-hcm-staging.onrender.com | https://asil-hcm-frontend-staging.onrender.com |

- Every push to `main` auto-deploys production. Remediation / risky work uses `staging` then merge.
- Topology + secrets: `render.yaml`, `docs/STAGING_SETUP.md`, `backend/.env.example`.
- Soft cutover floor: UI/AP/payroll/invoices normally show period **≥ 2026-07**. Archive toggle: `GET/PUT /api/admin/cutover-settings` (superadmin + `huzaifa.rafaqat@asil.com.pk`). Helper: `backend/src/core/cutover.js`.

---

## 2. Stack and repo layout

| Layer | Fact |
|---|---|
| Backend | Node.js CommonJS (`require`). Express. Entry `backend/server.js` (~9,200 lines, **frozen for structural refactors**). |
| New domains | `backend/src/modules/<name>/` mounted from `backend/mountModules.js` (2-line wire from server.js). |
| Core | `backend/src/core/` — db helper, pg-boss, mailer, migrations runner, cutover, dateParse. |
| Worker | `backend/worker.js` — paid Render worker path; **not live**. `JOBS_RUNNER=web` (crons in the web process). |
| Frontend | React 19 + Vite ESM. All HTTP through `frontend/src/api.js` except **public magic-link pages** (Claims fill/approve call the API directly with a token). |
| DB | Neon PostgreSQL. Pool: `max: 10`, idle 30s, connect 5s. `ssl.rejectUnauthorized: true`. |
| DDL | **All new DDL** via `backend/migrations/` (node-pg-migrate). **Never** add `CREATE TABLE` to `server.js`. After prod migrate: regen `database/schema.sql` with `scripts/regen_schema.ps1`. |
| Tests | `backend/tests/` mocks `pg` (`npm test`). `backend/tests-int/` real Postgres on Neon **`ci-test`** only (`npm run test:int`; `TEST_DATABASE_URL` must contain `ci-test`). |

### Agent worktrees (mandatory)

Owner folder `C:\Projects\HCM\BPOFMSystem` belongs to the owner’s Cursor window. Agents:

```
npm run wt:new -- <short-slug>   # creates C:\Projects\.agents\<slug> on agent/<slug> off origin/main
# work only there
npm run tidy                     # after PR merged
npm run wt                       # who holds what
```

Two agents in one folder silently destroy each other’s uncommitted work.

---

## 3. Auth, roles, permissions

**Staff app:** Google OAuth, domain **`@asil.com.pk` only**. JWT 8 hours in `localStorage` (`asil_hcm_token`). `requireAuth` = Bearer JWT. Cookie session is only for the OAuth handshake (`sameSite: lax`). Do not add cookie-auth state-changing `/api/*` routes.

**Employee portal:** `requirePortalAuth`, not `requireAuth`. OTP email/SMS. Do not mix the two middleware.

**Portal Claims magic links:** no login. Token in query `?asil_claims=fill&token=` or `?asil_claims=approve&token=` (also `/claims-fill`, `/claims-approve`). HMAC tokens: `CLAIMS_LINK_SECRET` || `SESSION_SECRET` || `JWT_SECRET`.

### Roles (nav keys in `frontend/src/App.jsx` `ROLE_NAV`)

| Role | Typical access |
|---|---|
| `superadmin` | Everything |
| `finance_manager` | Payroll, AP, claims campaign, AR, config |
| `finance_approver` | Payroll, invoices, claims view, no AP confirm |
| `finance_proposer` | Bills, invoices, FV, employees (limited) |
| `ap_team` | AP, billing, payroll_run, FV |
| `ar_team` | Invoices, FV, PO, compliance |
| `payroll_initiator` / `payroll` | Sheet, run, FV, employees, claims |
| `operations` / `operations_supervisor` / `operations_team` | Employees, attendance, claims, contracts, FV |
| `procurement_*` | Bills, vendors, inventory, bill verification |
| `bizdev` | Pipeline + clients |
| `supervisor` | Attendance + CMMS only |
| `pending` | No tabs |

Extra: User Management can grant `permissions.claims_portal` (view / campaign / export / `claims_manual_override`). Desk also allows `operations_supervisor` (Rabia).

**Hard rules:** write/delete/admin routes need `requireRole`. Never return `err.message` to the client. Parameterized SQL only. No `pool.query` inside a `for` loop.

---

## 4. Canonical tables (do not invent twins)

| Entity | Use | Do not use |
|---|---|---|
| Employees | `employees` | — |
| AR invoices | `client_invoices` | `invoices` (legacy) |
| Payroll history / World A pay | `payroll_transactions` | — |
| World B runs | `payroll_runs`, `payroll_run_rows` | — |
| Claims (engine + portal inject) | `employee_claims` | dead `payroll_transactions.ot/reimb/opd` as writers |
| Payments | `payment_batches`, `payment_ledger` | — |
| Bills | `bills` | — |
| Portal Claims cycle | `portal_claim_*` tables below | — |

IDs: employees `ASIL-<timestamp>` (also older `ASIL/...` codes exist); bills `BILL-<timestamp>`. Do not change formats.

---

## 5. The two payroll worlds (do not “fix” this casually)

| | **World A — pays people today** | **World B — new engine, not prod-paid** |
|---|---|---|
| UI | `PayrollSheet.jsx` tab `payroll` | `PayrollRun.jsx` tab `payroll_run` |
| Compute | **Server:** `POST /api/payroll/:year/:month/calculate` → `payrollSheet/service.js` + `resolveInputs.js` + `prSheetEngine.js` + `taxEngine.js`. Sheet columns are baseline. Default `sourceMode=sheet_inputs`. Hub zeros must **not** wipe sheet OT. | `POST /api/payroll-runs/compute` → `payrollrun/service.js` |
| Store | `payroll_transactions` | `payroll_runs` + `payroll_run_rows` |
| Pay | AP queue → `POST /api/ap/payroll-queue/:year/:month/confirm` → `payment_batches` + `payment_ledger` | `POST /api/payroll-runs/:id/disburse` (coded, tested, **unused in prod**) |
| Snapshot | `payroll_transactions.computed_json` is produced **only** by Sheet Calculate. Bank files, payslips, locked export **read** via `src/payroll/snapshotView.js`. Never recompute from raw inputs. | Row `computed` JSONB |

**Proration decree:** 30-day engine (`prSheetEngine.js`) is authoritative. Do not “align” frontend `payrollUtils.js` to it — that file is scheduled for deletion.

**Pilot contract (S5):** `CTR-1773048704450` — Facility Management, Wafi, 38 employees. Shadow month blocked on payroll-team Excel export.

**July 2026 Wafi note:** Calculate was wiping sheet OT when Monthly Hub had OT=0. Fix lives on `fix/payroll-sheet-calc-preserves-sheet-ot`. **Do not Calculate July Wafi on live** until that ships.

**August 2026 bonus (shipped):** 213 people, Rs. 1,087,717 in the bonus column. OT/claims/net not changed until Calculate folds bonus into take-home.

Pakistan constants: EOBI Rs. 400 flat; gratuity 1/26 × basic × years (min 1 year); payslip split hardcoded 60/20/10/7/3. Tax/SESSI only via `taxEngine.js`.

### World A money path (frozen-unless-tested)

Covered by `backend/tests-int/worldA.payment.test.js`. Before changing, run `npm test` **and** `npm run test:int`.

- `PATCH /api/payroll/:year/:month/lock`
- `POST /api/ap/payroll-queue/:year/:month/confirm` — optional `employee_ids[]` for partial pay; skip already-paid SALARY ledger rows
- `POST /api/ap/bills/:id/confirm`
- `PATCH /api/ap/batches/:batchId/fm-approve`

Reconciliation: `GET /api/payroll/:year/:month/reconciliation`.

### Payslips (World A)

Module `backend/src/modules/payslip/`. Gate: row **locked** + `payment_ledger` SALARY in a PAYROLL batch `status='Paid'`. Channels: email (Resend PDF, To employee **and** Focal; Focal-only if no mailbox — personal Gmail OK on slips) + SMS 7-day link (`/api/payslip/link/:token`, Jazz, `03XXXXXXXXX`). Remaining send: `onlyMissing: 'email'|'sms'`, chunks of 20. Portal payslips still read **World A only**.

---

## 6. Portal Claims — the product that is live (deep spec)

This is the August 2026 claims collection system. Staff hub: tab `claims_portal` → `PortalClaimsHub.jsx`. Public pages: `ClaimsFillPage.jsx`, `ClaimsApprovePage.jsx`.

### 6.1 Purpose

Collect monthly **OT**, **Expense**, **Medical** from the correct person, get LM (or self-final) decision, then optionally write hours/amounts onto World A `payroll_transactions` columns:

| Portal | Sheet column |
|---|---|
| OT 2× hours | `ot2_hrs` |
| OT 3× hours | `ot3_hrs` |
| Medical PKR | `opd_claim` |
| Expense PKR | `reimbursement` |

Also upserts `employee_claims` (`source_kind='portal'`, status `focal_approved`) for World B. **SAMPLE periods never write either.**

Write rule (`writePortalAmountsToSheet`): if the sheet row is **locked** → block `PAYROLL_LOCKED`. If any of those four columns already have values → block `SHEET_HAS_OTHER_DATA` (desk: OTHER DATA / Needs Review). Empty sheet + approved portal → write.

### 6.2 Time model (PKT = UTC+5)

Default Wafi: claims for month **M** are collected in month **M+1** (`following_month`) and pay with **M+1** salary.

| Window | Default |
|---|---|
| Fill open | Day **1** 09:00 PKT of claim month (`CLAIMS_FILL_OPEN_DAY`) |
| Fill close | Day **18** 23:59:59 PKT (`CLAIMS_FILL_CLOSE_DAY`; policy `submit_deadline_day`) |
| Approve close | Day **22** 23:59:59 PKT (`CLAIMS_APPROVE_CLOSE_DAY`) |

`same_month` policy: settlement = claim month.

**July 2026 trial:** fill + approve held open through **27 Aug 2026 23:59 PKT**. A later campaign must not rewind that close (`effectiveCloseAt` takes max of stored vs trial floor). SAMPLE periods ignore close locks.

Period identity: `portal_claim_periods` unique on `(campaign_month, campaign_year)`. Also stores `claim_*`, `settlement_*`, `fill_*`, `approve_close_at`, `campaign_mode` (`sample`|`actual`).

### 6.3 Routing (source of truth: `claimsEligibility.js` `resolveClaimsRouting`)

Employee fields:

- `claim_authority` — Focal email, or `SELF`, or empty/`N/A`
- `line_manager_email` — LM (fallback `supervisor_email`)
- `email` — employee mailbox
- `claims_reviewer_email` — Monthly Cycle reviewer (stored; not the live approver yet)
- `active` — leavers (`Active = No`) are not invited

**Never invite Gmail/Yahoo/Hotmail/etc. as a claims filler.** Official employee filler domains: `@wafi-energy.com`, `@asil.com.pk` (`isClaimsWorkMailbox`). Personal mail is OK for **payslips**, not for gathering claims.

| Condition | `profile` | Category | Filler | Approver | Submit is final? |
|---|---|---|---|---|---|
| Focal and LM exist and differ | `focal_then_lm` | Focal + LM | Focal | LM | No |
| Focal exists, no LM, or Focal === LM | `focal_only` | Focal only | Focal | Focal | **Yes** |
| No Focal, LM exists | `lm_only` | LM only | LM | LM | **Yes** |
| No Focal, no LM, official Wafi/ASIL mailbox | `employee_then_asil` | Employee + ASIL | Employee | `sadia.komal@asil.com.pk` | No |
| No Focal, no LM, no official mailbox | `lm_only` | ASIL only | `sadia.komal@asil.com.pk` | Sadia | **Yes** |

If `fillerEmail` is missing, category becomes **Setup needed** and campaign mail goes to Sadia with `/?tab=claims_portal&setup_needed=1`. Current resolver almost always assigns Sadia rather than leaving filler empty.

Huzaifa fallback constant still exists in file (`huzaifa.rafaqat@asil.com.pk`) but the no-focal/no-LM official path now uses **Sadia**.

Eligibility rules table `claim_eligibility_rules`: unmatched employees are **eligible** (send-screen filters decide). Seeded “Wafi BPO — exclude FM” rule is **deactivated** (migration `20260815120000`).

### 6.4 Tables

```
portal_claim_periods
  campaign_month/year, claim_month/year, settlement_month/year
  fill_open_at, fill_close_at, approve_close_at, status, campaign_mode
  eligibility_snapshot, august_reopen_ran_at

portal_claim_batches          UNIQUE(period_id, filler_email)
  filler_email, invite_token_hash, invite_sent_at, invite_opened_at
  invite_delivered, reminder_count, last_reminder_at, status
  routing_profile, cohort_type

portal_claim_approver_packs   UNIQUE(period_id, approver_email)
  invite_token_hash, invite_sent_at, reminder_count, last_reminder_at, status

portal_claim_submissions      UNIQUE(period_id, employee_id)
  batch_id, filler_email, approver_email, status, channel
  submitted_at, approved_at, rejected_at, approver_comment
  approved_snapshot, submit_snapshot, routing_profile
  no_claims_kind, lm_reopen_count, lm_reopen_at, payroll_pushed_at, payroll_pushed_by

portal_claim_items
  claim_type OT|EXPENSE|MEDICAL, claim_date, ot_hours, ot_multiplier, ot_multiplier_factor
  amount, description, expense_type, patient_name, time_from, time_to, nature, active

portal_claim_attachments      per-employee files (expense_support / medical_support / …)
portal_claim_batch_attachments UNIQUE(batch_id, category)  pack-level zips (legacy)

claim_manual_overrides
claim_eligibility_rules
contract_claim_policies
```

`employees.claim_authority`, `employees.line_manager_email`, `employees.claims_reviewer_email`.

### 6.5 Submission status machine

`invited` → `draft` / `in_progress` → `submitted` → `approved` | `rejected` | `no_claims` → `in_payroll`

- `no_claims_kind`: `confirmed` (filler tapped No Claims) | `auto_closed` (no response) | unverified
- Fill mutations allowed until status is `approved` or `in_payroll`, **and** fill window still open (`canMutateFillSubmission` / `isFillMutationLocked`)
- Final profiles (`focal_only`, `lm_only`): submit auto-approves (`autoApproveSelfFinal`)
- Approver can only decide from `submitted`
- August one-time LM reopen: rejected → `submitted`, `lm_reopen_count=1` → desk **Final LM review**. Second reject is final.

### 6.6 Fill wizard (public)

Route: `GET /` with `asil_claims=fill&token=…`  
API: `GET /api/portal-claims/fill/:token`

Steps from `enabled_types` (`claimsFillHelpers.buildWizardSteps`): OT → Expense → Medical → **Supports** (if expense or medical enabled) → Review.

- OT: date in claim month; **OT Start + OT End required** (overtime span only, not full shift); hours computed from times; 2× default; 3× **only** gazetted PK holidays; 1× forbidden on Sunday/holiday; if user enters 2× on a gazetted day, server **upgrades to 3×**; hours > 12 = warning
- Expense / Medical: date in claim month; amount > 0 PKR
- Supports: files listed **under that upload** with Remove. `DELETE /api/portal-claims/fill/:token/attachment/:id?employeeId=`
- Confirm No Claims allowed
- Excel: download personalised workbook (`GET .../fill/:token/template.xlsx`), upload (`POST .../import-excel`)
- Batch submit all employees on the token: `POST .../batch-submit`
- Disabled types rejected in `saveSubmissionItems` (`CLAIM_TYPE_DISABLED`)

### 6.7 Approve wizard (public)

`asil_claims=approve&token=` → `GET/POST /api/portal-claims/approve/:token` / `.../decide`  
Body: `{ submissionId, decision: 'approve'|'reject', comment }`  
Approve injects claims + sheet write (ACTUAL only). SAMPLE: no `employee_claims`, no sheet write.

### 6.8 Staff hub surfaces

`PortalClaimsHub.jsx` + `ClaimRequestCampaign.jsx`:

1. **Response / Control desk** — full campaign audience vs `payroll_transactions` for the pay month. Filters: Month → Client → Contract → Department → Location. Per person: To, sent time, mailer result, who acts now, control status.
2. **Request emails** — preview then send. `POST /api/portal-claims/campaign/preview` and `POST /api/portal-claims/campaign` with `onlyEmployeeIds`.
3. **Chase / reminders** — `POST /api/portal-claims/admin/chase` (invite / filler reminder / approver reminder). Finished rows skipped unless superadmin `force`.
4. **Manual add / override** — `POST /api/portal-claims/manual-override` (+ Excel import).
5. **Import if empty** — `POST /api/portal-claims/admin/import-if-empty` (same empty-sheet rule).
6. **Push to payroll** — `POST /api/portal-claims/admin/push-payroll` (only `ready_for_payroll`).
7. **August reopen** — `POST /api/portal-claims/admin/reopen-august-rejected`.
8. **Flush SAMPLE** — superadmin; script `backend/scripts/flush_portal_claims_sample.js`.

Control statuses (`claimsDesk.js`): `not_invited`, `invite_sent`, `waiting_focal`, `waiting_lm`, `final_lm_review`, `ready_for_payroll`, `sent_to_payroll`, `no_claims_confirmed`, `no_claims_auto_closed`, `no_claims_unverified`, `rejected_closed`, `needs_review`. Action views: Needs action / Waiting / Closed.

### 6.9 Campaign send gates

| Mode | Mail | Payroll inject | Gate |
|---|---|---|---|
| `sample` | All To → `CLAIMS_SAMPLE_EMAIL` (banner shows intended To) | **Blocked** | Env must be set |
| `actual` | Real filler/approver | Allowed | `CLAIMS_ALLOW_ACTUAL_SEND=true` |

Every portal-claims email: CC `CLAIMS_MONITOR_CC` (default `claims@asil.com.pk`) until `CLAIMS_ALLOW_ACTUAL_SEND` date `CLAIMS_MONITOR_CC_UNTIL` (default **2026-11-15**). Reply-To `CLAIMS_REPLY_TO` (default `ops-support@asil.com.pk`). Empty `CLAIMS_MONITOR_CC=` disables CC.

Filler tokens are **stable HMAC** per `(periodId, fillerEmail)` so resend does not mint a new link.

### 6.10 Admin HTTP map (`portalRoutes.js`)

Public (token):

- `GET/POST /api/portal-claims/fill/:token` (+ `/save`, `/attachment`, `DELETE .../attachment/:id`, `/import-excel`, `/batch-submit`, `/batch-attachment`, `/template.xlsx`)
- `GET /api/portal-claims/approve/:token` + `POST .../decide`
- `GET /api/portal-claims/attachments/:id`
- `GET /api/portal-claims/template.xlsx`

Auth:

- `GET /api/portal-claims/eligible`
- `POST /api/portal-claims/campaign` + `/campaign/preview`
- `POST /api/portal-claims/notify-approvers`
- `GET /api/portal-claims/admin/list` + `/response` + `/tieout`
- `POST /api/portal-claims/admin/chase` + `/import-if-empty` + `/push-payroll` + `/reopen-august-rejected` + `/resend/:batchId` + `/auto-close` + `/reminders` + `/reset-sample` + `/flush-sample`
- `GET/PUT /api/portal-claims/eligibility-rules` + `GET .../:id/preview`
- `GET /api/portal-claims/employee/:employeeId/category`
- `GET/PUT /api/claims/policy/:contractId`
- `POST /api/portal-claims/people/bulk-update`
- `POST /api/portal-claims/manual-override` + `/import` + `GET .../template`

### 6.11 Key backend files

| File | Role |
|---|---|
| `portalService.js` | Periods, fill/save, attachments, Excel, approve, inject, reminders, push, reopen |
| `portalRoutes.js` | HTTP |
| `portalExcel.js` | Parse + personalised workbook |
| `claimsEligibility.js` | Routing + rules |
| `claimsCampaign.js` | Preview/send grouping |
| `claimsResponse.js` | Response board vs sheet |
| `claimsDesk.js` | Control/action labels |
| `claimsChase.js` | Chase/reminder plans |
| `claimsMail.js` | SAMPLE redirect, CC, tokens |
| `claimsPolicy.js` | `contract_claim_policies` |
| `claimsAccess.js` | Role + permission gate |
| `claimsReminders.js` | Copy + due logic |
| `employees/contactEmails.js` | Work vs personal mailbox |

Frontend: `PortalClaimsHub.jsx`, `ClaimRequestCampaign.jsx`, `ClaimsFillPage.jsx`, `ClaimsApprovePage.jsx`, `claimsFillHelpers.js`, `claimsTimeParse.js`, `claimsPeople.js`.

Tests: `backend/tests/portalClaims.test.js` (often Node `--test`, not always in Jest), `frontend/src/features/claims/claimsFillHelpers.test.js`, `claimsPeople.test.js`, `backend/tests/claimsEligibility.test.js`. E2E checklist: `docs/PORTAL_CLAIMS_AUGUST_E2E.md`.

---

## 7. Monthly Cycle hub

Tab `monthly_cycle` → `MonthlyCycleHub.jsx`. **Same Portal Claims engine**, not a second collector.

Sections: Setup · People · Collect · Track · Corrections · Payroll.

**Setup** writes `contract_claim_policies`:

- `enabled_types` — subset of `ATTENDANCE`, `OT`, `EXPENSE`, `MEDICAL` (default `{OT,EXPENSE,MEDICAL}`)
- `collection_mode` — `monthly_form` | `machine_file` | `daily_marks` | `mixed`
- `reviewer_required`
- `claims_pay_timing`, `submit_deadline_day` (1–28), `approve_deadline_day` (1–28)

**People:** bulk assign `claim_authority`, `line_manager_email`, `claims_reviewer_email`.

**Collect/Track/Payroll:** reuses Portal Claims campaign + desk.

Wafi contracts seeded: `CTR-1773048704450`, `CTR-1773048523696`, `CTR-1773046722553` with `{OT,EXPENSE,MEDICAL}`, `monthly_form`, submit 18 / approve 22, following-month pay.

**ATTENDANCE / PSO machine-file collection is configured in UI but not live.**

Legacy tabs remain: Portal Claims, Email Claims, Wafi Claims, Intake Hub, Claims Queue. Hide pass is later (S8B).

---

## 8. Other claims doors (still in the repo)

| Door | Where | Notes |
|---|---|---|
| Portal Claims | above | **Canonical for Wafi August+** |
| Wafi Gmail sessions | `server.js` `/api/wafi-claims/*`, `wafiClaims/approvalService.js` | Focal/LM magic links; `stage-payroll` now writes `employee_claims`. Gmail intake gated `wafi_gmail_intake_enabled=false` |
| Email intake | `backend/src/intake/`, tab `intake_hub` | IMAP hub; can create claims via `claims/service.js` |
| Claims Queue | tab `claims_queue` | Older staff queue |
| Manual override | portal-claims routes | Finance correction with notify to Huzaifa + Shezad |

World B engine consumes `employee_claims` where `status='focal_approved'` (`aggregateClaimInputs`: OT `{ot1,ot2,ot3}` hours; medical/expense `{amount}`).

Wafi roster/contact scripts (salary/bank **never** written):

- `scripts/wafi_roster_refresh.js`
- `scripts/wafi_contact_focal_update.js --file … --dry-run --scope=file`  
  Production apply only on explicit owner phrase `Go red: …`

---

## 9. Fixed Value / PSO

Module `backend/src/modules/serviceOrders/`. UI: `FixedValueContracts.jsx`, `FixedValueContractWizard.jsx`. Routes `/api/fixed-value/*`.

| Contract | Meaning |
|---|---|
| `CTR-PSO-NORTH-ZONE` | Multi-site conservancy |
| `CTR-PSO-CORO-MA` | CORO Masood Anwari, SO `4110036239`, site `SS94` |

Billing model: `service_order_deduction`. Absence: `(lineRate / roleCount) / 30 × absentDays` on `so_deductions.line_id`. Manual adjustments signed (+ adds / − deducts) **before** provincial ST. Stamped grand = net + PST only (Punjab 16%, others 15%). WHT does not reduce stamped grand.

Payroll wages (Conservancy): `salary × ((30 − sheet_absent) / 30)`.

**Do not** use World B `generateInvoiceFromRun` for FV — returns `409 USE_SO_INVOICE`.

Month close: lock FV World B run → `payroll_close_packs` + `payroll_payables` + `cost_allocations`. Reopen needs `MONTH_CLOSE_UNLOCK_CODE_HASH`.

---

## 10. Other live modules (enough to navigate)

| Area | Location | What it does |
|---|---|---|
| Employees | `server.js` + `EmployeeInformation.jsx` / `EmployeeProfile.jsx` | Roster, Focal/LM fields, documents, leave tab |
| Leave | `modules/leave/` + existing `employee_leaves` / `employee_leave_balances` | Contract override `contract_leave_policies` (CL/ML/EL default 10/8/14). Portal leave still uses global default |
| Attendance | `modules/attendance/`, Monthly Hub | Import / overrides; hub OT must not overwrite sheet OT on Calculate |
| Clients / contracts | `ClientInformation.jsx`, `ContractOps.jsx` | Masters + `contract_policies` |
| Bills / procurement | `BillingProcurement.jsx`, `billApproval/`, `procurement/` | OCR (`POST /api/bills/ocr`, OpenAI, rate-limited). Unlock bills = superadmin |
| AP | `AccountsPayable.jsx` | Payroll queue, bill confirm, FM approve, FV close packs |
| AR | `modules/ar/`, `ARDashboard.jsx` | `client_invoices`; P&L revenue from **Finalized** onward |
| Inventory | `server.js` | Equipment |
| Documents | Document Generator | Offer / letters |
| CMMS | Maintenance tab | Work orders |
| BizDev | `modules/bizdev/` | Pipeline |
| Compliance | `modules/compliance/` | Ledger |
| P&L | `modules/pnl/` | Cost allocations |
| Intake | `modules/intake/` | IMAP email hub |
| Onboarding | `modules/onboarding/` | |
| Xero | `modules/xeroBillImport/` + server routes | OAuth/sync **scaffolded, not connected** without credentials |
| Employee portal | `EmployeePortal.jsx` `/api/portal/*` | OTP, contact, change requests, **old-table payslips only** |
| Users | User Management | Roles + `claims_portal` grants |
| Audit | `audit_log` via `logAudit` | Destructive routes should call it |
| Dashboard | MD view | KPIs; many still static |
| Cutover | `core/cutover.js` | Period floor 2026-07 |

---

## 11. Frontend public vs staff routing

`App.jsx` short-circuits **before** Google auth when:

- `?asil_claims=fill` or path `/claims-fill` → `ClaimsFillPage`
- `?asil_claims=approve` or path `/claims-approve` → `ClaimsApprovePage`
- Employee self-service portal when ESS query/path matches

Staff app: `/?tab=<nav key>&…` e.g. `/?tab=claims_portal&setup_needed=1`.

Styling: vanilla CSS + variables in `frontend/src/index.css`. Dark theme. Lucide icons only. No Tailwind / CSS-in-JS / layout `style={{}}`.

---

## 12. Environment variables (claims + money-adjacent)

Authoritative list: `backend/.env.example`. Fail hard if secrets missing — **no fallback defaults**.

| Var | Purpose |
|---|---|
| `JWT_SECRET` | Staff JWT |
| `DATABASE_URL` | Prod/staging Neon |
| `STAGING_DATABASE_URL` | Staging-only data scripts |
| `TEST_DATABASE_URL` | Must contain `ci-test` |
| `FRONTEND_URL` | Magic-link host (localhost coerced to prod frontend) |
| `RESEND_API_KEY` | Email |
| `JAZZ_SMS_*` + proxy | SMS |
| `CLAIMS_SAMPLE_EMAIL` | SAMPLE inbox (required for sample send) |
| `CLAIMS_ALLOW_ACTUAL_SEND` | Must be `true` for live claims email |
| `CLAIMS_MONITOR_CC` / `_UNTIL` | Ops CC (default on until 2026-11-15) |
| `CLAIMS_REPLY_TO` | Default ops-support@asil.com.pk |
| `CLAIMS_FILL_OPEN_DAY` / `FILL_CLOSE_DAY` / `APPROVE_CLOSE_DAY` | Calendar defaults 1 / 18 / 22 |
| `CLAIMS_LINK_SECRET` | HMAC for fill/approve tokens |
| `CLAIMS_APPROVER_NOTIFY_MODE` | `immediate` \| `daily` \| `day22` |
| `CLAIMS_OVERRIDE_NOTIFY_EMAILS` | Manual override notify |
| `MONTH_CLOSE_UNLOCK_CODE_HASH` | FV/payroll reopen |
| `OPENAI_API_KEY` | Bill OCR |
| `XERO_*` | Not connected until MD OAuth |

`server.js` does **not** load dotenv. Local: `node -r dotenv/config server.js`. Cloud VM extra: `NODE_EXTRA_CA_CERTS` for local PG SSL.

---

## 13. Owner operating rules (agents must obey)

Living scoreboard: `OWNER_BOARD.md`. Skills: `/chief` `/coach` `/morning` `/status` `/backlog` `/incident`.

**Ship without asking:** bug fixes, screens, reports, endpoints, tests, docs — with live verify + revert ready. Branch + PR + CI. Staging first for payroll/payments.

**Stop and ask — owner must say `Go red: …`:** posting/moving cash, bulk employee apply/delete, live SMS/email to real people, prod engine-flag flip, anything irreversible.

**Never touch:** PARKED items; World A pay path until cutover; BPO staging contract work without coordinating.

Owner words: `undo` · `Go red: …` · `Override lock: … — [why]` · `plan only`.

Remediation programme: `.agents/REMEDIATION_PLAN.md` + `.agents/sessions/S*.md`. Do not freelance a session that already has a file. Current mission: prove one pilot month at zero Excel variance, then pay through World B. Portal/claims work queued behind that unless it blocks pay — in practice Portal Claims was built in parallel for the August Wafi cycle.

---

## 14. What is built vs not built

### Works in production today

- Staff Google login; role nav
- Employee master + Focal/LM fields
- World A Payroll Sheet → lock → AP confirm → ledger → payslip email/SMS (if Resend/Jazz set)
- Portal Claims August cycle (SAMPLE + gated ACTUAL), fill/approve links, desk, chase, empty-sheet import
- Monthly Cycle pack + people UI
- Fixed Value / PSO wizard, attendance ingest, invoice print with per-line shortages
- Leave ledger on Employee Profile (contract override)
- Attendance import / Monthly Hub
- Bills, vendors, inventory, AR invoices, AP UI
- Soft cutover floor July 2026
- Staging Render services (may be asleep)

### Built in code, not proven as the live pay path

- World B compute + disbursement bridge
- Per-contract engine flag (S6B) — **not shipped**; both UIs can be used
- Portal payslips for World B rows
- Paid background worker
- Xero live sync
- Imprest workflow (bill type only)
- Automatic month-close chain (every step still needs a human click)
- PSO attendance collection via Monthly Cycle
- Unifying/hiding the four legacy claim tabs

### Do not do as a side effect

Leave, two-step AP (exists), Xero, portal OTP polish, PF/gratuity auto-accrual, payslip split configurability, dashboard live KPIs, inventory↔bills automation, document versioning, tax slab versioning — listed as known gaps in `.agents/AGENTS.md` §8. Several are partially done; do not “finish” them inside an unrelated PR.

---

## 15. Invariants for the next model

1. **Do not break World A pay.** ~500 people are paid through `payroll_transactions` + AP confirm.
2. **Sheet OT is baseline.** Monthly Hub / portal zeros must not clear typed OT on Calculate (`sourceMode=sheet_inputs`).
3. **`computed_json` has one producer** — Sheet Calculate. Consumers only read `snapshotView.js`.
4. **Portal never writes pay in SAMPLE.** `canInjectPayroll` is false.
5. **Portal never overwrites a sheet that already has OT/medical/expense values.** OTHER DATA / Needs Review.
6. **No personal Gmail as claims filler.** Payslips may use personal mail.
7. **LM-only and Focal-only submit is final.** Do not invent a second approver.
8. **Fill stays editable until approved/in_payroll**, unless the fill window closed.
9. **No new DDL in `server.js`.** Migrations only. No hardcoded secret fallbacks. No `err.message` in HTTP.
10. **Do not push `main`.** Worktree + PR. `Go red:` before live mail, SMS, or money movement.
11. **Do not build in the owner folder.**
12. After money-path edits: `npm test` and `npm run test:int`. After `server.js` edits: `node --check server.js`.
13. Update `ARCHITECTURE.md` when you add a route/table; update `OWNER_BOARD.md` when you ship; append `.agents/AGENTS.md` §10 changelog.

---

## 16. Reading order for a new model

1. This file  
2. `OWNER_BOARD.md` (what matters this week)  
3. `ARCHITECTURE.md` (verified facts; claims routing paragraph can lag code)  
4. `.agents/AGENTS.md` (guardrails + changelog)  
5. `.agents/REMEDIATION_PLAN.md`  
6. Claims: `claimsEligibility.js` → `portalService.js` → `portalRoutes.js` → `ClaimsFillPage.jsx`  
7. Pay: `payrollSheet/service.js` + `resolveInputs.js` + `prSheetEngine.js` + `snapshotView.js`  
8. `docs/PORTAL_CLAIMS_AUGUST_E2E.md` if changing the August cycle  

Do not treat `REMEDIATION_PLAN.md` World A “browser compute” sentences as current — Calculate is server-side as of August 2026 (`ARCHITECTURE.md`).
