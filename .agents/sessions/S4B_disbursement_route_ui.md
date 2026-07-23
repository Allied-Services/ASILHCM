# S4B — Disbursement bridge: route + api.js + PayrollRun UI

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. Frozen-then-unfrozen AP routes: untouched here.
> 3. After ANY backend edit: `node --check backend/server.js` + `npm test` + `npm run test:int` green before push (money path).
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs.

## Objective
Expose S4A's `disburseRun` service via a route and give AP/finance a button.

## Steps
1. `backend/src/modules/disbursement/routes.js`: `POST /api/payroll-runs/:id/disburse` — `requireAuth` + `requireRole('ap_team','finance_manager','superadmin')`; body validated ({bank_id, bank_name, payment_date, reference_no, notes, allow_missing_bank}); maps service result codes → HTTP (ok→200, BATCH_EXISTS/LEGACY_PAYROLL_LOCKED/RUN_NOT_DISBURSABLE→409, MISSING_BANK_DETAILS→422); catch → `console.error('[POST /api/payroll-runs/:id/disburse]', err)` + generic 500 (AGENTS.md §2.5). Wire `logAudit(req, 'DISBURSE', 'payroll_run', id)`. Mount via `backend/mountModules.js` following the existing register pattern.
2. `frontend/src/api.js`: `export`ed `disbursePayrollRun(runId, payload)` via the standard `apiFetch` pattern.
3. `frontend/src/features/payroll/PayrollRun.jsx`: for a run with status 'locked' or 'invoiced', show a **Disburse** button (rendered only for roles ap_team/finance_manager/superadmin per `currentUser.role` — AGENTS.md §4.4). Modal collects bank (from the existing banks list endpoint), payment date, reference, notes; shows computed total + employee count for confirmation; on 422 lists the missing-bank employees with an explicit "exclude and proceed" checkbox that sets `allow_missing_bank`; on success shows the batch id; on 409 shows the typed reason. Vanilla CSS per the existing dark design system.
4. Contract test in the mocked tier (`backend/tests/`) for role guards on the new route (follow the existing pattern in restructure.test.js).
5. Update `.agents/AGENTS.md` route documentation (Section 8/route map area) with the new endpoint.

## Verification checklist
- [ ] `npm test` + `npm run test:int` + `node --check backend/server.js` green; `cd frontend && npm run build` green.
- [ ] Staging end-to-end: compute → lock → Disburse via the UI → success shows batch id; the batch and ledger rows appear in the EXISTING AccountsPayable screens with correct totals (screenshot); second Disburse attempt → 409 surfaced in the modal.
- [ ] Role check: a non-AP staging user neither sees the button nor can call the route (403).

## Rollback
`git revert`; if a staging batch was created during testing, clean it with `scripts/rollback_disbursement.sql`.
