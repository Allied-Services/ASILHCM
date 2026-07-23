# S1A — Fix reachable frontend runtime crashes

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 3. After ANY backend edit: `node --check backend/server.js` and `npm test` (in `backend/`) must pass. Once Phase 2 lands: `npm run test:int` must also pass before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors. Out-of-scope problems go in your report, not in the diff.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Objective
Fix the three verified frontend defects that throw at runtime on reachable paths. These are ESLint `no-undef` findings that are genuine bugs, not style issues. Line numbers are approximate — locate by symbol, not by line.

## Steps
1. **`frontend/src/BillingProcurement.jsx` (~lines 729–734):** the bill "review" stage (`stage === 'review'`) references `CLIENTS`, `CONTRACTS`, and `SITES`, none of which exist in scope → ReferenceError whenever a user reaches the review stage. Find where the rest of this component sources client/contract/site lists (state populated from `api.getClients()` / `api.getContracts()` or props) and bind the review-stage markup to those real variables. Do NOT invent new fetches if the data is already loaded elsewhere in the component. Reproduce the crash first on staging (walk a bill to the review stage), then confirm the fix on the same path.
2. **`frontend/src/PayrollSheet.jsx` (~line 1390):** the Bulk-SMS modal help text contains JSX `{name}` / `{netPay}` intended as *literal placeholder text* for the SMS template. `netPay` is undefined → ReferenceError when the modal opens. Replace with escaped literals (e.g. `{'{name}'}` and `{'{netPay}'}`) so the text renders as `{name}`/`{netPay}`.
3. **`frontend/src/PayrollSheet.jsx` (~line 894):** a `fetch('/api/payroll/.../send-payslips', ...)` uses a relative path — it hits the static-site origin instead of the backend. Route it through the established pattern: add a named function to `frontend/src/api.js` following the existing `apiFetch` conventions (JWT header, base URL) and call that from the component.

## Deletions
None.

## Verification checklist
- [ ] `cd frontend && npx eslint src/ 2>&1 | grep -c "no-undef"` → 0 (was 4).
- [ ] `npm run build` succeeds.
- [ ] On staging: bill review stage renders (screenshot/console clean); Bulk-SMS modal opens showing literal `{name}`/`{netPay}` placeholders; send-payslips call hits `asil-hcm-staging.onrender.com` (verify in the network tab), even if it returns an error due to unset RESEND creds on staging — the point is the correct origin.

## Rollback
`git revert`.
