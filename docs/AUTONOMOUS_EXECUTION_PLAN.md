# ASIL HCM — 30-Day Autonomous Execution Plan
**Date:** 2026-08-01  
**Branch:** `feat/chief-owner-board-morning`  
**Audience:** Agents working while owner travels  
**Governing docs:** `.agents/REMEDIATION_PLAN.md`, `.agents/AGENTS.md`, `OWNER_BOARD.md`

---

## Non-negotiable rules for all agents

1. **Never push to `main` without staging proof** — walkthrough URL, test output, or screenshot in PR description.
2. **Do NOT interfere with BPO contract matching work on staging** — any active work on Fixed Value / PSO / contract-policy alignment in `C:\Projects\ASILHCM-Staging` or `fv/pso-conservancy` branch stays separate. Merge only after explicit coordination. This plan's payroll-pilot work uses pilot contract `CTR-1773048704450` (Wafi FM, 38 employees), not PSO June reconciliation unless owner says `Go red: merge June work`.
3. **World A must keep paying** until S5C succeeds — do not break `PayrollSheet.jsx` AP confirm path.
4. **Money routes:** `npm test` + `npm run test:int` green before push (use `C:\temp\BPOFMSystem-backend` or CI if GDrive `node_modules` corrupt).
5. **Red approval** = owner phrase `Go red: [what]` for: production disbursement, prod DB data fixes, OAuth credential changes, disabling World A for any contract.

---

## Week 1 — Unblock proof (shadow month)

**Owner-visible outcome:** "We can show the MD a report where HCM matches Excel for the pilot contract for one month."

| # | Task | Files / areas | Tests | Staging proof | Red? |
|---|---|---|---|---|---|
| 1.1 | Wake staging; verify deploy | `render.yaml`, `docs/STAGING_SETUP.md` | — | `/health` 200 on staging | No |
| 1.2 | Confirm pilot inputs in staging DB | attendance import, `employee_claims` | — | Row counts for `CTR-1773048704450` | No |
| 1.3 | Run variance report | `scripts/variance_report.js`, `scripts/VARIANCE_INPUT_FORMAT.md` | `backend/tests/varianceCompare.test.js` | CLI exit 0 or delta CSV attached | No |
| 1.4 | Triage deltas per S5B | `contract_policies`, `contract_rate_cards`, `prSheetEngine.js` | `payrollParity.test.js` first for engine fixes | Updated `audit/pilot/shadow_month_M.md` | Engine fixes: no; prod compute: yes |
| 1.5 | MD sign-off package | `audit/pilot/` | — | Written sign-off filed | **Red** — MD must sign |

**Session files:** `.agents/sessions/S5B_shadow_month.md`  
**Blocked on:** Payroll team Excel CSV export (`BLOCKED.md`)

**Do not start:** S5C, S6B engine flag flip on prod, S7R World A retirement.

---

## Week 2 — Pay one month through new engine (pilot only)

**Owner-visible outcome:** "38 Facility Management employees paid from HCM bank file; Excel was shadow check only."

| # | Task | Files / areas | Tests | Staging proof | Red? |
|---|---|---|---|---|---|
| 2.1 | Staging dry-run full lifecycle | `PayrollRun.jsx`, `payrollrun/routes.js`, `disbursement/` | `tests-int/disbursement.test.js`, `worldB.engine.test.js` | compute→lock→invoice→disburse on staging | No |
| 2.2 | Prod backup | `scripts/backup_prod.ps1` | — | Backup file listed | **Red** |
| 2.3 | Prod compute + variance (no lock) | `POST /api/payroll-runs/compute` | variance exit 0 | Report in `audit/pilot/` | **Red** if first prod compute |
| 2.4 | Lock + invoice + disburse | `disbursement/service.js`, `payment_batches` | `npm run test:int` | Batch id `PB-...` recorded | **Red** — MD authorizes bank file |
| 2.5 | Bank file + reconciliation | AP screens, `payment_ledger` | — | `audit/pilot/cutover_M+1.md` | **Red** |

**Session file:** `.agents/sessions/S5C_pilot_cutover.md`  
**Rollback:** `scripts/rollback_disbursement.sql` before bank transmission.

---

## Week 3 — Prevent double entry + portal payslips

**Owner-visible outcome:** "Pilot contract can't be edited in old Payroll Sheet; employees see their payslip in the portal."

| # | Task | Files / areas | Tests | Staging proof | Red? |
|---|---|---|---|---|---|
| 3.1 | Per-contract engine flag | migration, `contract_policies.payroll_engine`, `PayrollSheet.jsx`, `ClientInformation.jsx` | extend `tests-int/worldA.payment.test.js` | Flag `runs` → sheet read-only | No |
| 3.2 | Flip pilot to `runs` | UI toggle | — | Staging then prod | **Red** for prod flip |
| 3.3 | Portal payslips from World B | `server.js` `/api/portal/me`, `/api/payslip/...` | `portalAuth.test.js` | Portal login shows latest run payslip | No |
| 3.4 | Payslip branding | `payrollrun/payslip.js`, `server.js` payslip HTML | — | Logo + company block visible | No |
| 3.5 | PayrollRun workbench polish | `PayrollRun.jsx`, `api.js` | `npm run build` | S6A checklist screenshots | No |

**Session files:** `.agents/sessions/S6B_engine_flag.md`, `.agents/sessions/S6A_payrollrun_workbench.md`

---

## Week 4 — Claims trust + comms reliability

**Owner-visible outcome:** "OT submitted by focal reaches pay; payslip emails/SMS actually send."

| # | Task | Files / areas | Tests | Staging proof | Red? |
|---|---|---|---|---|---|
| 4.1 | Verify Wafi → `employee_claims` | `server.js` stage-payroll, `wafiClaims/approvalService.js` | `worldB.engine.test.js` claim consumption | Staged session → compute shows OT | No |
| 4.2 | Portal claims writer audit | `claims/portalService.js` | `portalClaims.test.js` | Approval → `employee_claims` | No |
| 4.3 | Document focal/LM rules | `employees.claim_authority`, `line_manager_email`, `attendance/clientFocals.js` | — | `docs/CLAIMS_PERMISSIONS.md` (new) | No |
| 4.4 | Resend + Jazz env verify | Render env, `backend/.env.example` | `portalAuth.test.js` (OTP) | Test email + SMS to superadmin | **Red** if adding prod secrets |
| 4.5 | Claims UI consolidation start | `S8B` scope only if S7R not required | — | Single admin queue prototype | No |

**Defer S8A** (portal writers → `employee_claims` only) until S7R or explicit owner override — it touches legacy writers.

**Session files:** `.agents/sessions/S8A_claims_writers.md`, `S8B_claims_ui_consolidation.md` (partial)

---

## Capability map (technical reference)

### A. Payroll automation
| Component | Path | Status |
|---|---|---|
| World A compute | `frontend/src/PayrollSheet.jsx`, `frontend/src/payrollUtils.js` | Live, pays people |
| World A save | `server.js` `POST /api/payroll/:year/:month` | Live |
| World A pay | `server.js` `POST /api/ap/payroll-queue/:year/:month/confirm` | Live, tested |
| World B engine | `backend/src/modules/payrollrun/service.js`, `prSheetEngine.js` | Built, Excel parity |
| World B UI | `frontend/src/features/payroll/PayrollRun.jsx` | Built, partial S6A |
| Disbursement | `backend/src/modules/disbursement/service.js`, `routes.js` | Built S4A/S4B |
| Engine flag | S6B migration | **Not built** |

### B. Payslip + delivery
| Component | Path | Env vars |
|---|---|---|
| World A payslip HTML | `server.js` `GET /api/payslip/:employeeId/:month/:year` | — |
| World B payslip HTML | `payrollrun/payslip.js` | — |
| Email (World A) | `server.js` `POST /api/payroll/:year/:month/send-payslips` | `RESEND_API_KEY` |
| Email (World B) | `payrollrun/routes.js` `POST .../send-payslips` | `RESEND_API_KEY` |
| SMS batch | `server.js` `POST /api/sms/payroll-batch` | `JAZZ_SMS_*`, `JAZZ_HTTPS_PROXY` |
| Logo | — | **Missing** — text header only |

### C. Employee portal
| Component | Path | Gap |
|---|---|---|
| OTP auth | `server.js` `/api/portal/request-otp`, `verify-otp` | Needs Resend/Jazz |
| Profile / advances | `/api/portal/me` | Works |
| Payslips | `/api/portal/me` → `payroll_transactions` | **No World B** |
| Change requests | `/api/portal/change-request` | Works |
| Leave | portal + `phase2Service.js` | Global defaults only |

### D. Claims
| Path | Table | Payroll consumer |
|---|---|---|
| Wafi sessions | `wafi_claims_*` → `employee_claims` (S1B) | World B |
| Portal Excel | `claims/portalService.js` | Partial / legacy writers |
| Email intake | `emailClaimsService.js` | Partial |
| Staff API | `claims/routes.js` | `employee_claims` |
| Permissions | `claim_authority`, `line_manager_email`, roles | Not UI-configurable |

### E. Imprest
| What exists | Gap |
|---|---|
| Bill type `Debit Note / Imprest` in `BillingProcurement.jsx` | No workflow |
| `xeroBillImport/classifier.js` `isWafiImprest` | Import tag only |
| `employee_advances` table + portal display | Advance recovery, not client imprest |

### F. Bills + OCR
| Component | Path | Env |
|---|---|---|
| OCR | `server.js` `POST /api/bills/ocr` | `OPENAI_API_KEY` |
| HITL flags | `GET /api/bills/hitl-flags` | — |
| Procurement verify | `procurement/routes.js` `verify-ocr` | — |

### G. Xero
| Component | Path | Status |
|---|---|---|
| OAuth | `server.js` `/api/xero/connect`, `callback`, `status` | Needs credentials + connect |
| Bill sync | `xeroBillImport/service.js`, job `xero.bills.sync` | Code complete |
| AR sync | `ar/xeroArSync.js`, job `xero.ar.sync` | Code complete |
| UI queue | `frontend/src/features/xero/BillReviewQueue.jsx` | Review UI |
| Tests | `xeroBillsSyncEnqueue.test.js`, `xeroArSync.test.js` | Unit |

### H. Contract → employee → payroll
| Step | Path | Auto? |
|---|---|---|
| Client/contract CRUD | `ClientInformation.jsx`, `contractCrud.js` | Manual |
| FV wizard | `FixedValueContractWizard.jsx` | Manual |
| Employee import | `EmployeeInformation.jsx`, `POST /api/employees/import` | Manual |
| Attendance | `modules/attendance/` | Import required |
| Policy/rate card | `contract_policies`, `contract_rate_cards` | Manual setup |
| Compute | `POST /api/payroll-runs/compute` | **Manual click** |

### I. Roles / permissions
| Layer | Path |
|---|---|
| JWT roles | `server.js` `requireRole`, 11+ roles in `AGENTS.md` |
| UI matrix | `frontend/src/UserManagement.jsx` `ROLE_META`, `MODULES` |
| Per-user permissions | `PATCH /api/users/:id/permissions` (superadmin) |
| Claims override | `claims_manual_override` permission in `portalRoutes.js` |

---

## Remediation session status

| Session | Status | Notes |
|---|---|---|
| S0A Ground truth | **DONE** | `audit/groundtruth/` |
| S0B Staging + IaC | **DONE** | `render.yaml`, staging live |
| S0C Dead weight + ARCHITECTURE | **DONE** | |
| S1A Frontend crashes | **DONE** | |
| S1B Wafi → employee_claims | **DONE** | Migration may need `npm run migrate` on env |
| S1C Portal OTP errors | **DONE** | |
| S1D Lock accruals | **DONE** | |
| S2A Int test skeleton | **DONE** | 28 tests |
| S2B World A payment tests | **DONE** | |
| S2C World B engine tests | **DONE** | |
| S3 Schema governance | **DONE** | |
| S4A Disbursement service | **DONE** | |
| S4B Disbursement route + UI | **DONE** | |
| S5A Variance tool | **DONE** | |
| S5B Shadow month | **NOT STARTED** | **BLOCKED** — `BLOCKED.md` |
| S5B1 June26 alignment | **NOT STARTED** | Separate checkout may be ahead |
| S5B2 Payroll UI alignment | **NOT STARTED** | |
| S5B3 Contract policy overhaul | **NOT STARTED** | |
| S5C Pilot cutover | **NOT STARTED** | Depends S5B |
| S6A PayrollRun workbench | **PARTIAL** | UI exists; S6A checklist unverified |
| S6B Engine flag | **NOT STARTED** | |
| S7 Contract cutover template | **NOT STARTED** | |
| S7R World A retirement | **NOT STARTED** | Parked until pilot proven |
| S8A Claims writers | **NOT STARTED** | After S7R |
| S8B Claims UI | **NOT STARTED** | |
| S9 Backlog | **NOT STARTED** | |

---

## Grep inventory (audit keywords)

| Term | Approx hits (repo) | Key locations |
|---|---|---|
| `disburse` | 50+ | `disbursement/`, `PayrollRun.jsx`, `tests-int/disbursement.test.js` |
| `payslip` | 50+ | `server.js`, `payrollrun/`, `EmployeePortal.jsx` |
| `portal` | 100+ | `server.js`, `EmployeePortal.jsx`, `claims/portalService.js` |
| `ocr` | 40+ | `server.js` `/api/bills/ocr`, `procurement/` |
| `xero` | 50+ | `server.js`, `xeroBillImport/`, `mountModules.js` |
| `sms` | 50+ | `server.js`, `lib/sms.js` |
| `imprest` | ~10 | Bill type + classifier only — no workflow module |

---

## Test commands (canonical)

```powershell
# Unit (use non-GDrive clone if jest corrupt)
cd backend
npm test

# Integration (requires TEST_DATABASE_URL with ci-test substring)
npm run test:int

# Syntax
node --check server.js
```

**Local GDrive checkout (2026-08-01):** `jest` package.json corrupt — tests could not run. AGENTS.md documents workaround via `C:\temp\BPOFMSystem-backend`. Last known green: **223/223** unit, **28/28** integration per `BLOCKED.md` / `AGENTS.md`.

---

## What agents should report weekly

1. Variance report status (pilot contract, which month).
2. Staging lifecycle screenshot (compute/lock/disburse).
3. Test counts (unit + int).
4. BLOCKED items needing owner/payroll team action.
5. Any drift from `C:\Projects\ASILHCM-Staging` — diff summary only, no silent merges.

---

*Owner summary: `docs/OWNER_VISION_AUDIT.md` · Scoreboard: `OWNER_BOARD.md`*
