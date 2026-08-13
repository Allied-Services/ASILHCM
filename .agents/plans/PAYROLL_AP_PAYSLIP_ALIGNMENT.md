# PLAN — Payroll → AP → Payslip alignment (lock scope freeze, per-employee paid, payslip gate)

**Authored:** 2026-08-12
**Owner:** MD (Shezad) · **Executor:** GROK (Build), one session at a time
**Branch discipline:** each session on its own branch off `main`; PR; merge only after its verification checklist passes.

---

## Rules header — RE-READ BEFORE EVERY SESSION

> 1. Read `.agents/AGENTS.md` first. Its guardrails apply in full. `ARCHITECTURE.md` for orientation.
> 2. All new DDL goes in `backend/migrations/` (node-pg-migrate). **Never** add CREATE TABLE/ALTER to `server.js` (§2.8).
> 3. `/api/ap/*`, `/api/payroll*`, `payment_*` are money paths. After ANY edit to them: `node --check backend/server.js`, `npm test`, **and** `npm run test:int` green before push (§2.2, §2.10).
> 4. No `err.message` in HTTP responses (§2.5). No hardcoded credentials or env fallbacks (§2.4).
> 5. Parameterized queries only. No `pool.query` inside a `for` loop — use UNNEST or bulk VALUES (§3.1).
> 6. Every new endpoint: `requireAuth` + `requireRole` on writes, added to `frontend/src/api.js`, documented in `ARCHITECTURE.md`.
> 7. **Never mutate the existing `payroll_transactions.net` column.** Money already paid must stay byte-identical. New columns only.
> 8. Execute ONE session file section per run. Blocked after 3 attempts → write `BLOCKED.md` and STOP.
> 9. End each session by pasting actual command outputs into the verification checklist.

---

## Problem statement (verified against the code, 2026-08-12)

The payroll math is correct and per-employee amounts already agree between Payroll and AP — AP only does `SUM(pt.net)`, it never recomputes. Three structural defects make the screens disagree and make payslip gating unreliable:

**D1 — AP derives scope from live `employees`, not from the locked row.**
`payroll_transactions` has no `client` / `contract_name` column (confirmed in `database/schema.sql` ~3333). The AP queue joins `employees` and groups by `e.client, e.contract_name` (`backend/server.js` ~4323-4342). Consequence: a roster edit (the Wafi refresh changed `client` / `contract_name`) silently re-buckets payroll months that were locked long ago, and an employee whose `contract_name` is blank becomes their own AP row. The inner `JOIN employees` also drops any locked payroll row whose employee record was deleted or re-keyed.

**D2 — "Paid" is month-wide, not per-employee.**
`isMonthPaid` (`backend/src/modules/payslip/service.js` ~41-50) returns true if *any* Confirmed / FM Approved PAYROLL batch exists for the month. Batches are per-bank per-contract, so confirming one bank marks the whole month paid. AP confirm compounds it by marking every locked row Paid regardless of batch scope (`backend/server.js` ~4453-4457). Per-employee proof already exists and is unused: `payment_ledger` gets one row per employee (`payment_type='SALARY'`, `status='Paid'`).

**D3 — The two totals answer different questions.**
Payroll Sheet's footer (`frontend/src/PayrollSheet.jsx` ~1267) sums every **visible** row (locked *and* unlocked, after the client/contract/location/lock filters plus DOJ/LWD exclusion at ~1163-1180). AP sums **locked only**, with no date logic and a cutover period floor the confirm route does not apply. Legacy pre-`computed_json` months can also carry fractional `net`, so decimal sums drift from rounded displays.

## Target end state

Payroll computes → payroll locks (freezing scope + rounded amount onto the row) → AP confirms who was actually paid (per-employee ledger) → payslips go **only** to employees who are both locked and paid, honouring the operator's selection.

## Session order

| Session | Scope | Risk |
|---|---|---|
| **P1** | Freeze `client` / `contract_name` / `locked_net` on the payroll row at lock time + backfill | Low (additive columns) |
| **P2** | AP reads frozen columns; narrow the Paid update to batch scope; fix cutover/index asymmetry | **High — money path, int-test gated** |
| **P3** | Per-employee paid gate for payslip readiness + send; per-row status in the UI | Medium |
| **P4** | Reconciliation view + "AP view" subtotal on the Payroll Sheet | Low (read-only) |

P1 must land before P2. P3 depends only on P2's ledger semantics being unchanged (it reads `payment_ledger`), so P3 may run in parallel with P4.

---

# P1 — Freeze scope and amount on the locked payroll row

## Objective
Make the locked payroll row self-describing so no downstream consumer has to re-derive scope from the current roster. Additive only; nothing reads the new columns yet.

## Design
Three new nullable columns on `payroll_transactions`:

- `client text` — the employee's client **at lock time**
- `contract_name text` — the employee's contract name **at lock time**
- `locked_net numeric(12,2)` — `ROUND(net)` captured at lock time, in whole rupees

`net` is never touched. `locked_net` is the figure every downstream money screen will use.

## Steps
1. **Migration** `backend/migrations/<timestamp>_payroll_transactions_lock_scope.js`:
   - `ADD COLUMN IF NOT EXISTS client text`
   - `ADD COLUMN IF NOT EXISTS contract_name text`
   - `ADD COLUMN IF NOT EXISTS locked_net numeric(12,2)`
   - Index: `CREATE INDEX IF NOT EXISTS payroll_transactions_scope_idx ON payroll_transactions (year, month, client, contract_name)`
   - Idempotent; `down` drops the three columns and the index.
2. **`PATCH /api/payroll/:year/:month/lock`** (`backend/server.js` ~3372). In the existing lock UPDATE (both the scoped `employee_ids` branch and the whole-month branch), additionally set the three columns from the joined employee row. Use a single `UPDATE ... FROM employees e WHERE e.id = payroll_transactions.employee_id` — do **not** add a second query or a loop. Set `locked_net = ROUND(payroll_transactions.net)`.
   - Keep `locked`, `locked_by`, `locked_at` semantics exactly as they are.
   - Do not touch the accrual block that follows, or the S1D accruals response shape.
3. **Re-lock refresh:** locking an already-locked month must refresh all three columns (an operator unlocks, edits, re-locks — the frozen values must follow the newest lock).
4. **Unlock** (`~3462`): leave the frozen columns in place. They describe the last lock and are harmless when `locked=false`; clearing them would lose history if a re-lock fails.
5. **Backfill script** `scripts/backfill_lock_scope.js`:
   - Dry-run by default; `--apply` to write; `--year`/`--month` optional filters.
   - For rows where `locked = TRUE AND (client IS NULL OR locked_net IS NULL)`, fill from the current `employees` row and `ROUND(net)`.
   - Print a summary: rows updated, rows skipped, and **rows with no matching employee record** (these are the D1 orphans — list their `employee_id` and `net` explicitly; they are the AP shortfall).
   - Uses `DATABASE_URL` / `STAGING_DATABASE_URL` from the environment; never hardcode a connection string.
6. **Unit tests** `backend/tests/payrollLockScope.test.js` — the lock route's SQL sets the three columns in one statement for both the scoped and whole-month branches (mock-pool assertion on the query text and params, matching the style of `backend/tests/payroll.test.js`).

## Verification checklist
- [ ] `npx node-pg-migrate up` applies cleanly on the ci-test branch, and `down` reverses it.
- [ ] `node --check backend/server.js` clean.
- [ ] `npm test` green (paste totals; must be ≥ the pre-change count).
- [ ] `npm run test:int` green (lock behaviour is covered by `tests-int/worldA.payment.test.js`).
- [ ] Backfill dry-run output pasted, including the orphan list.
- [ ] `git diff --stat` shows only the migration, the lock route, the script, and the new test.

## Rollback
`git revert` + migration `down`. Nothing reads the columns yet, so revert is inert.

---

# P2 — AP reads the frozen row (money path)

## Objective
Make AP's grouping and totals immune to roster edits, and make "Paid" mean "in this batch".

## Design
Every AP payroll query stops grouping on live `employees` values and uses the frozen columns, with a fallback so pre-backfill rows still behave:

- scope: `COALESCE(pt.client, e.client)` and `COALESCE(pt.contract_name, e.contract_name)`
- money: `SUM(COALESCE(pt.locked_net, ROUND(pt.net)))`
- `JOIN employees` becomes `LEFT JOIN employees` so orphan payroll rows stay visible instead of vanishing

## Steps
1. **`GET /api/ap/payroll-queue`** (~4319): frozen scope + frozen money + LEFT JOIN, per the design. Keep the cutover `periodFloor` and the `batch_count` subquery behaviour, but compare batch scope with the same COALESCE expressions.
2. **`GET /api/ap/payroll-queue/:year/:month`** (~4348): same substitutions for the `client` / `contract` query filters, so the detail list matches the summary row exactly. Return `locked_net` alongside `net` so the UI can show the figure AP will actually pay.
3. **`POST /api/ap/payroll-queue/:year/:month/confirm`** (~4375):
   - Totals query uses the frozen scope and `SUM(COALESCE(locked_net, ROUND(net)))`.
   - Apply the **same cutover period floor** the queue GET applies — today the GET filters and the confirm does not.
   - Ledger `amount` uses the same frozen figure, so `payment_batches.total_amount` always equals the sum of its ledger rows.
   - **Narrow the Paid update** (~4453): scope `UPDATE payroll_transactions SET paid_on, status='Paid'` to the employees in *this* batch (`employee_id = ANY(...)` from the rows just inserted), instead of every locked row for the month.
   - Delete the dead `lockedWhere` / `lockedParams` locals at ~4383-4384 (built, never used).
4. **Batch uniqueness** `backend/migrations/<timestamp>_payment_batches_scope_unique.js`: replace the `(batch_type, year, month, client, contract_name)` constraint with a unique index over `COALESCE(client,'')` / `COALESCE(contract_name,'')` so a blank-scope confirm can no longer create duplicate batches for one month. Keep the old constraint until the new index is verified, then drop it in the same migration. **Detect pre-existing duplicates first** — if the index cannot be created because duplicates already exist, STOP, list them, and write `BLOCKED.md`; do not delete payment records.
5. **Integration tests** — extend `backend/tests-int/worldA.payment.test.js`:
   - Lock two contracts in one month, confirm only contract A → batch total equals contract A's frozen sum; contract B's rows are **not** marked Paid.
   - Change an employee's `client` / `contract_name` after lock → the AP queue row and total are unchanged (this is D1's regression test).
   - A locked payroll row whose employee record is deleted → still counted, surfaced with a null client, not silently dropped.
   - A row with fractional `net` and a `locked_net` → batch total and ledger rows both use the rounded figure and tie exactly.
   - Blank-scope confirm twice → one batch, not two.

## Verification checklist
- [ ] `npm run test:int` green, including all five new cases (paste summary).
- [ ] `npm test` green; `node --check backend/server.js` clean.
- [ ] Manual staging check: AP queue totals per contract equal the Payroll Sheet's locked-only subtotal for the same contract.
- [ ] Confirm one bank/contract on staging → only those employees flip to Paid; `SELECT status, COUNT(*) FROM payroll_transactions WHERE year/month GROUP BY status` pasted before and after.
- [ ] `payment_batches.total_amount` equals `SUM(payment_ledger.amount)` for the new batch (paste the query result).

## Rollback
`git revert` restores the previous queries. The uniqueness migration has a `down` that recreates the old constraint. Ledger rows already written are untouched by a revert — that is intentional; use `scripts/rollback_disbursement.sql` semantics if a batch must be undone, and only before the bank file is transmitted.

---

# P3 — Payslips go to locked **and** paid employees

## Objective
Replace the month-wide paid check with per-employee payment evidence, and show that state per row so the operator can see who is eligible before selecting.

## Design
An employee is payslip-eligible for a period when **both** hold:
1. `payroll_transactions.locked = TRUE` for that employee/year/month (already enforced), and
2. a `payment_ledger` row exists for that employee in a PAYROLL batch for that year/month with `payment_type='SALARY'` and `status='Paid'`.

Replace `isMonthPaid` with `getPaidEmployeeIds(pool, year, month)` returning a Set, plus a thin `isMonthPaid` kept only for the "any payment exists" banner if the UI still needs it.

## Steps
1. **`backend/src/modules/payslip/service.js`**
   - Add `getPaidEmployeeIds(pool, year, month, ids = [])`: join `payment_ledger` to `payment_batches` on `batch_id` where `batch_type='PAYROLL'`, matching year/month, `payment_type='SALARY'`, `status='Paid'`; optional `employee_id = ANY($3::text[])` when scoped.
   - `getPayslipReadiness`: add `paidCount`, `notPaid: [{id, name}]`, and per-employee `paid` on the returned employee list. `canSend` becomes `scopeLocked && everyEmployeeInScopeIsPaid`. Keep the existing `paid` boolean for backward compatibility, now meaning "every employee in scope is paid".
   - `sendPayslips`: after the existing lock checks, verify every target is in the paid set. On failure throw `code='NOT_PAID'` with `err.detail = { unpaid: [ids] }`. The recipient SQL must additionally filter to the paid set, so a race cannot email an unpaid employee.
2. **`backend/src/modules/payslip/routes.js`**: `NOT_PAID` message becomes actionable ("N selected employees are not yet marked paid in Accounts Payable"). `err.detail` is already forwarded — keep it.
3. **`frontend/src/PayrollSheet.jsx`**: show a per-row eligibility indicator (locked ✓ / paid ✓). In the Send Payslips modal, list unpaid selected employees by name and disable the confirm checkbox while any selected employee is unpaid. Do not add a bypass.
4. **Tests**
   - `backend/tests/payslipDelivery.test.js`: scoped send where one selected employee has no ledger row → `NOT_PAID` with that id in `detail.unpaid`; all paid → proceeds.
   - `backend/tests-int/`: new `payslipGate.test.js` — lock two employees, confirm a batch covering only one, assert readiness reports one paid / one not, and that a send scoped to the unpaid one is refused.

## Verification checklist
- [ ] `npm test` green; `npm run test:int` green (paste summaries).
- [ ] Staging: confirm one bank only → Send Payslips allows exactly those employees and names the rest as unpaid.
- [ ] Selecting 3 of 300 sends exactly 3 (check `payslip_delivery_log` row count for the batch).
- [ ] `ARCHITECTURE.md` updated: payslip eligibility rule stated as locked + per-employee paid.

## Rollback
`git revert`. Reverting restores the month-wide check, which is more permissive — safe direction for a revert.

---

# P4 — Reconciliation view and matching subtotal

## Objective
Make any Payroll-vs-AP difference self-explaining, so the next discrepancy is a named list of rows rather than an argument about numbers.

## Steps
1. **`GET /api/payroll/:year/:month/reconciliation`** — new route in a module (not `server.js`), `requireAuth` + `requireRole('finance_manager','finance_approver','payroll_initiator','ap_team','superadmin')`. Returns, for the month:
   - `sheetTotal` (all rows), `lockedTotal` (locked only, frozen figures), `apTotal` (sum of PAYROLL batches), `paidTotal` (sum of SALARY ledger rows)
   - `unlocked: [{id, name, net}]`
   - `orphans: [{employee_id, net}]` — locked rows with no employee record
   - `blankScope: [{id, name}]` — locked rows with null/blank frozen client or contract_name
   - `excludedByDates: [{id, name, doj, lwd}]` — employees the sheet's DOJ/LWD rules drop
   - `lockedNotPaid` / `paidNotLocked`
2. **`frontend/src/api.js`**: `getPayrollReconciliation(year, month)`.
3. **Payroll Sheet**: alongside the existing footer total, show a **Locked (AP view)** subtotal using the frozen figures, plus a "Reconcile" panel rendering the lists above. Vanilla CSS, dark theme, Lucide icons only (§4.2).
4. **Tests**: `backend/tests/payrollReconciliation.test.js` for the aggregation shape; one int test asserting `lockedTotal === apTotal` after a full-month confirm.

## Verification checklist
- [ ] `npm test` green; `npm run test:int` green.
- [ ] For a fully locked + fully confirmed month on staging: `lockedTotal === apTotal === paidTotal`, and every list is empty.
- [ ] For a partially locked month: the difference equals the sum of the `unlocked` list exactly.
- [ ] `ARCHITECTURE.md` documents the new route.

## Rollback
`git revert` (read-only feature).

---

## Out of scope for this plan

- The July-2026 hardwired bonus accrual (`backend/src/payroll/julyBonusAccrual.js`). It is a deliberate one-off; making the bonus source configurable is a separate task.
- World B (`payroll_runs`) consolidation and the World A retirement path — governed by `.agents/REMEDIATION_PLAN.md`.
- The hardcoded 60/20/10/7/3 payslip salary split (AGENTS.md §8 item 6).
- Any change to `net`, tax, EOBI, or OT math. The money math is correct and must not be touched by this plan.

## Env vars

None new. Data operations (backfill, staging verification) need `DATABASE_URL` or `STAGING_DATABASE_URL` in the shell only, and `TEST_DATABASE_URL` (Neon `ci-test` branch) for `npm run test:int`. Never commit any of them.
