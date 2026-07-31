# ASIL HCM — Master Remediation Plan
**Authored:** 2026-07-24 by Claude (Fable 5) after a full three-track codebase audit.
**Executor:** Cursor Composer 2.5, one session per file in `.agents/sessions/`, in the order listed below.
**Owner:** MD (Shezad). Non-technical checkpoints are marked `[MD GATE]`.

---

## Why this plan exists

Payroll has never run a single month through ASIL HCM. The audit found the root cause is NOT that the system is unsalvageable — it is that **two half-complete payroll systems coexist with no bridge**:

- **World A (legacy):** `frontend/src/PayrollSheet.jsx` computes payroll **in the browser** (`payrollUtils.js`, its own divergent copy of tax/EOBI/SESSI math), POSTs finished numbers to `POST /api/payroll/:year/:month` (server.js ~3283) which stores them blindly in `payroll_transactions`. It ignores attendance and every contract policy. BUT it owns the only working **payment path**: AP queue → `payment_batches` → `payment_ledger` (server.js ~4410–4582).
- **World B (July-2026 restructure):** `backend/src/modules/payrollrun/` computes **server-side** from `attendance_records` + `monthly_attendance_overrides` + `employee_claims` (status `focal_approved`), applies `contract_policies` via the constraints module, calculates through `prSheetEngine.js` + `taxEngine.js` (Excel-parity-validated by `backend/tests/payrollParity.test.js`), locks runs, allocates costs, generates client invoices and payslips. BUT it has **no disbursement path** — it can never pay an employee.

The strategy is **strangler-fig consolidation onto World B**: build the missing disbursement bridge, funnel all claims into `employee_claims`, prove zero variance against the payroll team's Excel on one pilot contract, cut contracts over one by one, then retire World A's compute path. A greenfield rebuild was considered and rejected: it would discard the only Excel-validated engine, the working payment half, working claims/attendance/portal/Xero plumbing, and all import tooling.

## Other verified defects this plan fixes

- **Wafi claims never reach payroll.** `POST /api/wafi-claims/sessions/:id/stage-payroll` (server.js ~7065 and ~7739) computes OT payout *amounts* and INSERTs into `payroll_transactions` columns `ot/reimb/opd` — dead legacy columns from `setup-db.js` that nothing reads (or, on a fresh DB, don't exist and crash). Fixed in S1B by routing staged items into `employee_claims`.
- Reachable runtime crashes: `BillingProcurement.jsx:729-734` (undefined `CLIENTS/CONTRACTS/SITES`), `PayrollSheet.jsx:1390` (undefined `netPay`), relative-origin fetch at `PayrollSheet.jsx:894`. Fixed in S1A.
- Portal OTP dead-ends with a silent 404 when an employee's contact data is incomplete. Fixed in S1C.
- Payroll-lock PF/gratuity accruals are fire-and-forget (`.catch(()=>{})`) — silent money errors. Fixed in S1D.
- Backend tests mock `pg.Pool` entirely, so SQL/column bugs are invisible. Fixed by the Phase 2 real-Postgres harness.
- Three contradictory schema sources and three contradictory blueprint docs. Fixed in S0C and S3.
- No staging environment; every push to `main` deploys straight to production. Fixed in S0B.

## Phase and session index (execute strictly in this order)

| Phase | Sessions | Outcome |
|---|---|---|
| 0 — Ground truth & safety | S0A, S0B, S0C | Prod snapshot + backup, staging env + render.yaml, dead files & fake docs deleted |
| 1 — Surgical fixes | S1A, S1B, S1C, S1D | Crashes fixed; Wafi claims flow into `employee_claims`; World A keeps paying people throughout |
| 2 — Real-DB test harness | S2A, S2B, S2C | Integration tests against real Postgres; AP payment routes gain coverage and are **unfrozen** |
| 3 — Schema governance | S3 | One schema source of truth; all new DDL via node-pg-migrate |
| 4 — Disbursement bridge | S4A, S4B | `POST /api/payroll-runs/:id/disburse` — World B can finally pay employees |
| 5 — **MILESTONE 1** | S5A, S5B `[MD GATE]`, S5C `[MD GATE]` | Pilot contract: shadow month at zero variance, then a real month paid through HCM |
| 6 — Payroll UI | S6A, S6B | PayrollRun workbench; per-contract engine flag prevents double entry |
| 7 — Cutover & retirement | S7 (repeat per contract), S7R | All contracts on World B; World A compute retired (410) |
| 8 — Claims consolidation | S8A, S8B | One claims store, one approval queue |
| 9 — Backlog | S9 | PSO deliverable billing, medical tiers, frontend restructure, server.js decomposition, paid worker |

### Parallel operational programme (July 2026 — not a replacement for Phases 5–7)

**July 2026 soft cutover + Wafi master refresh** is a separate MD-approved plan: `.agents/plans/JULY_2026_CUTOVER_AND_WAFI_REFRESH.md`. It governs (a) UI/AP/payroll visibility floor at 2026-07 with a superadmin + huzaifa archive toggle, and (b) in-place Wafi roster upsert from `ASIL_Master_Roster (1).csv`. Implementation sessions: `J26A`–`J26E` (stubs to be added when execution starts). Does not retire World A compute.

## Cross-phase invariants

- **World A must keep working** (it is how ~500 people get paid) until Phase 7 retirement — every earlier session is additive or isolated.
- **Never deleted, ever:** `payroll_transactions` history, `wafi_claims_*` provenance, `payment_batches`/`payment_ledger` money records.
- Money-touching changes are verified three ways before production: integration tests with exact-row assertions, staging end-to-end walkthrough, and the shadow-month zero-variance gate against the payroll team's Excel.
- `scripts/backup_prod.ps1` (created in S0A) is re-run before every risky phase and before every cutover month.
- The proration dispute (26 working days vs 30 calendar days) is settled by decree: **the backend 30-day engine (`prSheetEngine.js`), which is Excel-parity-validated, is authoritative.** The frontend `payrollUtils.js` math is scheduled for deletion in S7R and must not be "fixed" to match anything.

## Ground-truth reference (verified 2026-07-24 against the code; S0A re-verifies against prod)

- `payment_batches` (server.js ~8874): `id TEXT PK, batch_type, year, month, source_bill_id, bank_id, bank_name, payment_date, reference_no, total_amount NUMERIC(14,2), employee_count, notes, status DEFAULT 'Pending', xero_ref, created_by, created_at, updated_at, client, contract_name`, `UNIQUE(batch_type, year, month, client, contract_name)`.
- `payment_ledger` (server.js ~8903): `id SERIAL, batch_id, employee_id, employee_name, payment_type, amount NUMERIC(12,2), reference, bank_name, bank_account, billable DEFAULT TRUE, xero_account_code DEFAULT '200', xero_ref, status DEFAULT 'Pending', created_at`, `UNIQUE(batch_id, employee_id)`.
- World A AP-confirm behavior (the contract the bridge mirrors): batch id `PB-{yr}-{mm}-{bankSlug}-{Date.now()}`; ledger rows `payment_type='SALARY'`, `amount = net`, `reference = PR{Mon}{yy}-{empId}`, `status='Paid'`, bank fields copied from `employees`.
- `employee_claims` (migration 20260705100500): `id SERIAL, intake_message_id, employee_id TEXT→employees, claim_type TEXT ('overtime'|'medical'|'expense'), period_month INT, period_year INT, claimed_items JSONB [], status TEXT default 'received', focal_email, focal_token_hash, focal_approved_at, focal_rejected_at, compliance_notes, created_at, updated_at`. `claimed_items` item shapes consumed by `aggregateClaimInputs` (payrollrun/service.js:57): overtime → `{ot1, ot2, ot3}` **hours**; medical/expense → `{amount}`.
- `payroll_runs`/`payroll_run_rows` (migration 20260706120000): `contract_id TEXT` FK→contracts; statuses draft→locked→invoiced/paid; `UNIQUE(contract_id, period_month, period_year)`; rows carry `computed JSONB` incl. `netPay`.
- `computeRunForContract` (payrollrun/service.js:237): refuses locked/invoiced/paid runs; resets `in_payroll_run` claims to `focal_approved` on recompute; reads claims `WHERE status='focal_approved' AND period_month=$2 AND period_year=$3`.

## Session protocol for Composer 2.5

1. Open exactly one file from `.agents/sessions/`, lowest unfinished ID first.
2. Obey the NON-NEGOTIABLE RULES block at the top of that file (identical in all files).
3. Execute the steps in order. Run the Verification checklist. Paste real command outputs in your report.
4. Append a dated entry to `.agents/AGENTS.md` Section 10 (the session changelog) describing what changed.
5. If blocked 3 times on one step: write `BLOCKED.md`, stop, do not improvise.
