# ASIL HCM — Owner Vision Audit
**Date:** 2026-08-01  
**Branch audited:** `feat/chief-owner-board-morning`  
**Audience:** Owner (plain English)  
**Method:** Code inspection, test inventory, live health checks, remediation session status — not marketing claims.

---

## TOP LINE (draft for OWNER_BOARD.md)

**You have a serious payroll engine and many working parts — but no single path yet that takes a contract from setup to paid employees with payslips sent automatically. Two payroll systems still run in parallel; only the older one has actually paid people. Staging is live but was asleep when we checked; production API is healthy.**

---

## What you have

ASIL HCM is a real, deployed system (~500 employees, production URLs live). Over months of work it has accumulated:

- Employee records, contracts, clients, attendance import, bills/procurement, AR invoicing, Wafi claims, a staff portal, SMS/email plumbing, and a **new server-side payroll engine** validated against Excel formulas.
- A **staging environment** (asil-hcm-staging.onrender.com) so changes can be tested before production.
- A written remediation programme (`.agents/REMEDIATION_PLAN.md`) and 26 session files that describe how to finish consolidation.
- Automated tests for money paths (28 integration tests on a real Postgres test database) — when they can be run.

What you do **not** have yet is one trustworthy, automatic pipeline that does everything you described in one flow.

---

## Why it feels broken (the real reasons)

### 1. Two payroll brains, one bank account

The system literally has **two ways to calculate pay**:

| | **Old (World A)** | **New (World B)** |
|---|---|---|
| Where it runs | In the browser (Payroll Sheet screen) | On the server (Payroll Run screen) |
| What it reads | Mostly what someone typed in the sheet | Attendance, contract rules, approved claims |
| Can pay people? | **Yes — this is how ~500 people get paid today** | **Code exists (disbursement bridge built Aug 2026) but no contract has been paid through it in production** |
| Math | Different rules (26 working days) | Excel-validated rules (30-day basis) |

Until one pilot month is proven at **zero difference** vs your payroll team's Excel, and then paid through the new path, the owner experience is: "I enter data in five places and I'm not sure which number is right."

### 2. Claims and OT arrive through four doors

Overtime and expenses can enter via: Wafi email sessions, portal Excel uploads, email intake, and manual staff entry. They land in different tables. The new engine only reliably reads **`employee_claims` with status `focal_approved`**. Some older paths still write to legacy payroll columns that the new engine ignores. That is why claims "disappear" from pay.

### 3. Portal shows old payslips, not new ones

The employee portal login (OTP by email/SMS) **works in code**, but payslips shown there come from the **old** `payroll_transactions` table. Anyone paid only through the new Payroll Run engine would see **no payslip** in the portal until that is wired.

### 4. "Automatic" still means many manual steps

Even on the new engine, a month requires: import attendance → ensure claims approved → click Compute → review → Lock → Invoice → Disburse → export bank file → send payslips. Nothing schedules or chains these without a human.

### 5. External services are optional — and often unset

| Service | What breaks without it |
|---|---|
| `RESEND_API_KEY` | Payslip emails silently skip employees |
| `JAZZ_SMS_*` + `JAZZ_HTTPS_PROXY` | SMS (portal OTP fallback, payroll SMS) fails |
| `OPENAI_API_KEY` | Bill OCR returns "not configured" |
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` + OAuth connect | Xero stays disconnected |

### 6. Staging cold starts

Render free tier sleeps services. Staging `/health` **timed out** during this audit (production returned 200). That makes staging feel broken when nobody has used it recently.

---

## What actually works today (with proof)

| Capability | Status | Evidence |
|---|---|---|
| Production API up | **Works** | `GET https://asilhcm.onrender.com/health` → 200, migrations ok, commit `32abcad` |
| Pay ~500 staff via old Payroll Sheet | **Works** | World A path: `PayrollSheet.jsx` → `POST /api/payroll/:year/:month` → AP confirm → `payment_batches` / `payment_ledger` (integration tests in `backend/tests-int/worldA.payment.test.js`) |
| New payroll compute (server) | **Works in code** | `POST /api/payroll-runs/compute`, Excel parity tests in `backend/tests/payrollParity.test.js`, engine tests in `backend/tests-int/worldB.engine.test.js` |
| Disbursement bridge (new engine → bank batch) | **Built, not proven in prod** | `backend/src/modules/disbursement/`, route `POST /api/payroll-runs/:id/disburse`, UI button in `PayrollRun.jsx`, 28/28 integration tests per `BLOCKED.md` |
| Portal OTP login | **Works in code** | `POST /api/portal/request-otp`, `verify-otp`; tests `backend/tests/portalAuth.test.js` |
| Portal contact / change requests | **Works in code** | `POST /api/portal/change-request`, office locations in `EmployeePortal.jsx` |
| Payslip HTML generation | **Works** | `GET /api/payslip/:employeeId/:month/:year` (World A), `GET /api/payroll-runs/:id/payslip/:employeeId` (World B) |
| Payslip email (staff action) | **Works if Resend configured** | `POST /api/payroll/:year/:month/send-payslips`, `POST /api/payroll-runs/:id/send-payslips` |
| Payroll SMS batch | **Works if Jazz configured** | `POST /api/sms/payroll-batch` in `server.js` |
| Bill OCR endpoint | **Works if OpenAI configured** | `POST /api/bills/ocr` (GPT-4o vision), rate-limited |
| Xero OAuth + bill import scaffolding | **Partial** | Routes in `server.js` ~4228+, module `backend/src/modules/xeroBillImport/`, scheduled sync jobs in `mountModules.js` |
| Fixed Value / PSO contract wizard | **Works** | `FixedValueContractWizard.jsx`, CORO seed Aug 2026 per `ARCHITECTURE.md` |
| Variance comparison tool | **Works** | `scripts/variance_report.js`, pilot contract `CTR-1773048704450` selected in S5A |

---

## What doesn't work yet (prioritised)

### P0 — Blocks trust in pay

1. **No pilot month at zero variance** — S5B shadow month blocked on payroll team Excel export (`BLOCKED.md`).
2. **No production pay through new engine** — S5C not started; disbursement never used for a real month.
3. **Two engines can both be used** — no per-contract "which engine" flag yet (S6B not built); risk of double entry or conflicting numbers.
4. **June 2026 reconciliation incomplete** — separate staging checkout (`C:\Projects\ASILHCM-Staging`) may be ahead; S5B1–S5B3 not finished in this repo.

### P1 — Blocks owner vision (after P0)

5. **Portal payslips don't follow new engine** — portal reads `payroll_transactions` only (`server.js` `/api/portal/me`).
6. **Claims not unified** — four intake paths; S8A/S8B not done; configurable "who can claim for whom" is roster-field based, not an admin UI.
7. **Payslips have no logo image** — company name text only in `payslip.js` / `server.js` HTML templates.
8. **No automatic month-close** — compute/lock/disburse/email not chained.

### P2 — Important but not payroll-critical

9. **Imprest** — only a bill *type* ("Debit Note / Imprest") and Xero classifier tag; no dedicated imprest workflow or employee imprest ledger beyond `employee_advances`.
10. **Xero "better than Xero"** — OAuth and sync code exist; not connected end-to-end for AR/AP automation without credentials and MD OAuth approval.
11. **OCR reliability** — depends on image quality and OpenAI; procurement verify path exists but not proven at scale.
12. **Background jobs on free tier** — crons (Xero sync, intake poll) only run while web dyno is awake.

---

## The path to everything working (weeks, not years)

This aligns with the existing remediation plan — we are **not** starting over.

| Phase | Weeks | Owner-visible outcome |
|---|---|---|
| **1. Prove one month** | 1–2 | Pilot contract (38 employees, Facility Management): HCM numbers match Excel exactly; MD sign-off filed |
| **2. Pay one month through HCM** | 1 | Same contract paid via new engine; bank file from HCM; old sheet still available as fallback |
| **3. Lock the switch** | 1 | Per-contract toggle: this contract uses new engine only; old sheet read-only for that contract |
| **4. Portal + payslips** | 1 | Employees on new engine see payslips in portal; email/SMS with correct branding |
| **5. Claims cleanup** | 1–2 | One approval queue; focal/LM rules documented; OT reaches pay reliably |
| **6. Next contracts** | Ongoing | Repeat cutover playbook per contract (S7 template) |
| **7. Imprest, Xero depth, OCR hardening** | 2–4 | After payroll trust established — dedicated sessions, not mixed with pay week |

**Realistic 30-day promise:** By end of month 1 you can have **one contract** paid correctly through HCM with proof, portal payslips for that contract, and a clear queue for everything else — not the full vision on every contract.

---

## Health checks run during this audit

| Check | Result |
|---|---|
| `npm test` (local GDrive checkout) | **Could not run** — corrupted `backend/node_modules/jest/package.json` (known GDrive issue; use `C:\temp\BPOFMSystem-backend` clone or CI) |
| Production `/health` | **200 OK** |
| Staging `/health` | **Timeout** (likely cold start / sleeping dyno) |
| `main` vs `staging` git | **Same tip** (`32abcad`) at audit time |

---

## Honest answer to "specify contract → candidates → payroll runs automatically"

**Today:** You can specify a contract and employees, but payroll does **not** run automatically. Staff must import attendance, approve claims, compute, lock, disburse, and send payslips — and choose which of two engines to trust.

**After Phase 1–3 (≈4 weeks focused work):** One contract can run: contract + roster + attendance + approved claims → Compute → Lock → Pay → Payslip, with the old path disabled for that contract.

**Full vision (all contracts, imprest, Xero superiority, configurable claims):** Achievable in **2–3 months** of disciplined execution if payroll proof stays the gate and we do not start unrelated features.

---

*This document is the owner-facing truth snapshot. Technical execution detail: `docs/AUTONOMOUS_EXECUTION_PLAN.md`. Living scoreboard: `OWNER_BOARD.md`.*
