# S2B — Integration tests for the World A payment path (this session UNFREEZES the AP routes)

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Objective
Give the frozen money routes real test coverage — WITHOUT modifying them (this session only reads them and writes tests). When these tests are green, AGENTS.md §2.2's freeze is lifted for these routes, which Phase 4 depends on for confidence (the bridge mirrors their behavior) and Phase 7 depends on for retirement.

## Steps
1. Fixture builder `tests-int/fixtures/worldA.js`: creates client, contract, bank, N employees (with bank_name/bank_account), and locked `payroll_transactions` rows for a given month with known `net` values. Use the app's own column set — read the INSERT in `POST /api/payroll/:year/:month` (server.js ~3283) to match columns exactly.
2. `tests-int/worldA.payment.test.js` — drive routes via supertest against the real app (require `server.js`'s exported app; if the app isn't exported, export it — an accepted minimal edit — while ensuring `app.listen` only runs outside test env):
   - `PATCH /api/payroll/:year/:month/lock` — role guard (payroll_initiator/superadmin ok, others 403), rows actually flip `locked=TRUE` in the DB, accruals object present (from S1D).
   - AP queue GET routes return the locked rows with expected totals.
   - **`POST /api/ap/payroll-queue/:year/:month/confirm` — exact-row assertions:** `payment_batches` row has `batch_type='PAYROLL'`, correct year/month/client/contract_name, `total_amount` = sum of fixture nets, `employee_count` = N, `status` as the code sets it; `payment_ledger` rows per employee: `payment_type='SALARY'`, `amount` = that employee's net, `reference` matches `PR{Mon}{yy}-{empId}`, `status='Paid'`, bank fields copied from employees.
   - **Idempotency/dedup:** call confirm twice; assert final batch/ledger state matches what the code intends (characterize the actual ON CONFLICT behavior — document what it DOES, don't force what it "should").
   - `PATCH /api/ap/batches/:batchId/fm-approve` — role guard (finance_manager/superadmin) + status transition on the batch row.
   - `POST /api/ap/bills/:id/confirm` — happy path with a fixture bill + batch/ledger assertions.
3. **Harness proof:** `tests-int/harness-proof.test.js` — run the OLD broken Wafi SQL (`INSERT INTO payroll_transactions (employee_id, month, year, ot, reimb, opd) ...`) against the real schema snapshot and assert it throws `column "ot" ... does not exist` **if** S0A's facts.md says prod lacks those columns; if prod HAS the legacy columns, instead assert the insert succeeds but no reader exists (grep-based note in the test comment). This test exists to prove the harness catches the class of bug the mocked tier cannot.
4. **Edit `.agents/AGENTS.md` §2.2:** move the three AP routes + payment INSERT logic from "OFF-LIMITS" to "covered — edits allowed while `npm run test:int` stays green (procedural gate: run it locally before every push touching these paths)."

## Verification checklist
- [ ] `npm run test:int` green, including exact-row assertions (paste summary: suites/tests count).
- [ ] `npm test` (mocked tier) still green; `node --check backend/server.js` clean (in case of the app-export edit).
- [ ] The diff contains NO changes to the three AP routes' logic (app-export refactor excepted). Paste `git diff --stat`.

## Rollback
Delete the new test files; revert the AGENTS.md unfreeze note.
