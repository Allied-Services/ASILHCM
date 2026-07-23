# S1D — Un-silence PF/gratuity accruals on payroll lock

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 3. After ANY backend edit: `node --check backend/server.js` and `npm test` (in `backend/`) must pass. Once Phase 2 lands: `npm run test:int` must also pass before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors. Out-of-scope problems go in your report, not in the diff.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Background
`PATCH /api/payroll/:year/:month/lock` (server.js ~3353) is the ONE frozen-area route that already has test coverage (`backend/tests/payroll.test.js`) and is therefore editable per AGENTS.md §2.2. After flipping `locked=TRUE` it inserts PF/gratuity accruals into `employee_pf_ledger`/`employee_gratuity_ledger` (~3405–3425) wrapped in `.catch(() => {})` — a failed accrual (money) disappears silently.

## Steps
1. Await both accrual insert paths inside try/catch. On failure: the lock still succeeds (do not block payroll), but the response gains `accruals: {ok: false, error_logged: true}` and the failure is logged via `console.error('[payroll-lock accruals]', err)` (no err.message in the response body, per AGENTS.md §2.5). On success: `accruals: {ok: true, pf_rows: N, gratuity_rows: N}`.
2. Write an `audit_log` entry via the existing `logAudit(req, ...)` helper (defined near requireAuth, ~line 158) recording lock + accrual outcome.
3. Extend `backend/tests/payroll.test.js`: accrual success shape; accrual failure shape (mock a rejected insert) — lock still 200, `accruals.ok === false`.
4. Touch NOTHING else in the route (scope, role guards, lock semantics unchanged).

## Verification checklist
- [ ] `npm test` green (incl. new cases); `node --check backend/server.js` clean.
- [ ] Staging: lock a scratch month (staging DB), response contains the `accruals` object; psql shows the ledger rows; then unlock/clean up the scratch month.

## Rollback
`git revert`.
