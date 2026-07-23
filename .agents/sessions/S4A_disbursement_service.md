# S4A — Disbursement bridge: migration + service + integration tests (tests FIRST, no route yet)

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. The frozen AP routes are now test-covered (S2B) but this session does NOT touch them — the bridge is a new, parallel code path.
> 3. After ANY backend edit: `node --check backend/server.js` + `npm test` + `npm run test:int` green before push (this is a money path).
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs.

## Objective
Build the missing link: locked World B payroll run → `payment_batches` + `payment_ledger` — the exact artifacts World A's AP confirm emits, so every existing downstream AP/bank/ledger screen works unchanged. Prerequisite: `audit/groundtruth/facts.md` confirms `payroll_runs` exists on prod (if not, STOP and run migrations current first per S0A's flag).

## Design (implement exactly this)
New module `backend/src/modules/disbursement/service.js` exporting `disburseRun(pool, runId, opts, actor)`. `opts = {bank_id, bank_name, payment_date, reference_no, notes, allow_missing_bank=false}`.

**All checks and writes inside ONE transaction (`BEGIN`/`COMMIT`, `ROLLBACK` on any failure):**

Preconditions (each failure returns a typed `{ok:false, code, ...}` — never partial writes):
1. Run exists and `status IN ('locked','invoiced')`, else `RUN_NOT_DISBURSABLE` (409). Check `PAYROLL_RUN_STATUSES`/`canTransitionStatus` in `payrollrun/service.js` — if the transition map lacks locked→paid or invoiced→paid, extend it there (with a unit test in the module's existing test file or tests-int).
2. Resolve `client` name + `contract_name` via `contracts LEFT JOIN clients` on the run's `contract_id`.
3. **Guard A — no silent overwrite:** if a `payment_batches` row exists with `batch_type='PAYROLL'` and the same (year, month, client, contract_name) → `BATCH_EXISTS` (409) returning the existing batch id. Deliberately NO ON CONFLICT upsert on the batch.
4. **Guard B — no double-pay across worlds:** if locked `payroll_transactions` rows exist for the same contract/month (match on the employees belonging to this contract; check how World A scopes contract on payroll_transactions — likely via employees' contract linkage — and mirror that scoping) → `LEGACY_PAYROLL_LOCKED` (409). No override flag in v1.
5. Load run rows joined to `employees` (bank_name, bank_account, name). Rows whose employee lacks `bank_account` → `MISSING_BANK_DETAILS` (422) listing employee ids/names, unless `opts.allow_missing_bank` (then they're excluded from the batch and listed in the response as `excluded`).

Writes:
- `payment_batches`: `id = 'PB-' + year + '-' + String(month).padStart(2,'0') + '-' + bankSlug + '-' + Date.now()` (bankSlug = lowercased alphanumeric of bank_name — mirror World A's slug logic from server.js ~4464-4520 exactly); `batch_type='PAYROLL'`; year/month from the run period; `bank_id, bank_name, payment_date, reference_no` from opts; `total_amount = SUM((computed->>'netPay')::numeric)` over included rows; `employee_count`; `status='Confirmed'`; `created_by = actor`; `client`, `contract_name`; `notes = (opts.notes || '') + ' | source: payroll_run #' + runId`; `source_run_id = runId` (new column, see migration).
- `payment_ledger`: ONE bulk INSERT (UNNEST or multi-VALUES — no per-row queries in a loop, AGENTS.md §3.1) mirroring server.js ~4522-4539: per included row — `batch_id`, `employee_id`, `employee_name`, `payment_type='SALARY'`, `amount=(computed->>'netPay')::numeric`, `reference='PR' + MonthAbbr + yy + '-' + employee_id` (copy World A's exact month-abbreviation formatting), `bank_name`/`bank_account` from employees, `billable=TRUE`, `xero_account_code='200'`, `status='Paid'`, `ON CONFLICT (batch_id, employee_id) DO NOTHING`.
- `UPDATE payroll_runs SET status='paid' WHERE id=$1`.
- Success return: `{ok:true, batch_id, employee_count, total_amount, excluded:[...]}`.
- No Xero push in v1 (client invoicing already flows via `generateInvoiceFromRun`).

## Steps
1. Migration `backend/migrations/<timestamp>_payment_batches_source_run.js`: `ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS source_run_id INTEGER` (nullable, no FK — payment records must survive anything).
2. Extend the status transition map if needed (design point 1).
3. Implement `service.js` per the design. No route in this session.
4. `tests-int/disbursement.test.js` (reuse S2C's worldB fixture + S2B's helpers):
   - Happy path: compute → lock → disburse → EXACT-row assertions on the batch (type, totals, scope, status, source_run_id) and every ledger row (SALARY, netPay, reference format, Paid, bank fields).
   - Guard A: pre-insert a conflicting batch → 409/`BATCH_EXISTS`, zero new rows.
   - Guard B: pre-insert locked legacy `payroll_transactions` for the same contract-month → `LEGACY_PAYROLL_LOCKED`, zero new rows.
   - Missing bank: one employee without `bank_account` → `MISSING_BANK_DETAILS` listing them; retry with `allow_missing_bank=true` → batch excludes them, `excluded` lists them, totals exclude them.
   - Idempotence: second disburse of the same run → `RUN_NOT_DISBURSABLE` (status now 'paid').
   - Atomicity: force a failure mid-write (e.g. temporarily violate a constraint in the fixture) → NO batch, NO ledger rows, run status unchanged.
5. `scripts/rollback_disbursement.sql` — the documented manual rollback (ONLY valid before the bank file is transmitted): parameterized by batch id — delete its `payment_ledger` rows, delete the `payment_batches` row, `UPDATE payroll_runs SET status='locked' WHERE id=<source_run_id>`. Header comment stating when it must NOT be used.

## Verification checklist
- [ ] `npm run test:int` green including all disbursement cases (paste summary).
- [ ] `npm test` + `node --check backend/server.js` green.
- [ ] Diff shows zero changes to the World A AP confirm routes. Paste `git diff --stat`.

## Rollback
`git revert` (no route exposed yet, so nothing can call it in prod).
