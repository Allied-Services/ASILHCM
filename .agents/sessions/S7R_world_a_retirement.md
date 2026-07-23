# S7R — Retire World A compute (ONLY after all 10 contracts paid ≥1 full month via runs)

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. `node --check` + `npm test` + `npm run test:int` green before push.
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual outputs.

## Entry condition (verify, don't assume)
`audit/cutover/` contains a signed cutover record for EVERY active contract, and `SELECT DISTINCT contract_id FROM contract_policies WHERE payroll_engine='runs'` covers all of them. If any contract is missing: STOP.

## Steps
1. Backend — World A compute/lock/pay routes return **410 Gone** with a JSON message pointing to `/api/payroll-runs`: `POST /api/payroll/:year/:month` (save), `PATCH /api/payroll/:year/:month/lock`, `POST /api/ap/payroll-queue/:year/:month/confirm`. Keep ALL GET/history routes on `payroll_transactions` alive forever (history + payslip archive). Keep `POST /api/ap/bills/:id/confirm` and `PATCH /api/ap/batches/:batchId/fm-approve` (they serve bills and run-sourced batches too). Update the S2B integration tests to assert the 410s.
2. Frontend — `PayrollSheet.jsx` becomes read-only history viewer (month selector + saved rows from `payroll_transactions`; all calculation/edit/lock/SMS code removed), or is replaced by a smaller `PayrollHistory.jsx` if that's less code than gutting it. Delete the calculation functions in `payrollUtils.js` (calcEmployeeRow, calcWHT, the hardcoded slab tables, `window.__payrollMonth` — everything except any pure formatter still imported elsewhere; check imports first). Delete dead sample constants (`PAYROLL_EMPLOYEES`, `PAYROLL_CONTRACT_CFG`).
3. `api.js`: remove now-dead World A mutation functions (savePayroll, lockPayroll per-employee variants — verify actual names/usages by grep before deleting).
4. `.agents/AGENTS.md`: §2.2 rewritten — the payroll system of record is `payroll_runs`; `payroll_transactions` is immutable history; the disbursement bridge is the only payment writer for payroll.
5. Data: NOTHING deleted. No table drops, no column drops.

## Verification checklist
- [ ] All three tiers green; integration tests assert the 410s.
- [ ] Staging: PayrollSheet history view renders past months; every 'runs' contract computes/pays via the workbench.
- [ ] `git grep -n "calcEmployeeRow" frontend/src` → no matches.
- [ ] Bundle still builds; no console errors on the history view.

## Rollback
`git revert` restores World A routes instantly (they were 410'd, not deleted, in the first commit; physical code deletion may be a follow-up commit once a full pay cycle passes).
