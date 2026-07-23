# S6A — PayrollRun UI: from demo page to full workbench

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. Backend edits: `node --check` + `npm test` + `npm run test:int` (money paths) green before push.
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY. **Frontend decision (locked): NO react-router, NO react-query, NO TypeScript in this phase** — the payroll team must not have the ground shift under them mid-parallel-running. Full frontend restructure is Phase 9.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs.

## Objective
Make `frontend/src/features/payroll/PayrollRun.jsx` (~402 lines) the payroll team's daily screen, replacing what they used PayrollSheet for — but backed by server computation.

## Steps
1. Build out the run view: per-employee row grid (paid days, OT hours by tier, gross, income tax, EOBI/SESSI, PF, claims applied, net pay — read from each row's `computed` JSONB), column totals, and a warnings panel listing the run's `warnings` with the affected employee highlighted.
2. Inline row overrides: editable cells for the override fields the backend supports (`PATCH /api/payroll-runs/:id/rows/:rowId` — check `patchRunRow` in payrollrun/service.js for the accepted fields and mirror exactly); after a patch, trigger recompute-or-refresh per the backend's semantics (verify: does patchRunRow recompute the row, or is a run recompute needed? Follow what the code does).
3. Claims indicator: rows with claims applied show a badge; clicking lists the claims (id, type, source_kind incl. 'wafi', amounts/hours) — data comes from claim linkage on the run (check what the backend exposes; add a small read-only endpoint in the payrollrun module if none exists, following AGENTS.md §3.1 checklist + api.js function).
4. Lifecycle buttons with status-aware enablement: Compute / Recompute (draft), Lock (draft), Invoice (locked), Disburse (locked/invoiced — from S4B), payslip preview per row + Send Payslips (existing endpoints). Role-gate buttons per AGENTS.md §4.4.
5. All API calls through `frontend/src/api.js` named functions — zero raw `fetch()` in the component. Vanilla CSS, dark theme, existing CSS variables.
6. Keep `PayrollSheet.jsx` untouched this session (it still serves the 9 legacy contracts).

## Verification checklist
- [ ] `npm run build` green; eslint: no NEW errors vs `git show HEAD` baseline of the touched files.
- [ ] Staging walkthrough with realistic data: compute → override one row → verify recompute honors it → lock → invoice → disburse — all from this screen (screenshots).
- [ ] Payroll team demo: the MD/payroll lead confirms the grid shows what their Excel shows (columns they need, totals they check). Record requested adjustments in the report; implement trivial ones now, defer structural ones.

## Rollback
`git revert`.
