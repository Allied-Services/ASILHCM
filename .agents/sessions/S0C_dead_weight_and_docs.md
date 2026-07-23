# S0C — Delete dead weight and contradictory docs; establish one architecture doc

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 3. After ANY backend edit: `node --check backend/server.js` and `npm test` (in `backend/`) must pass. Once Phase 2 lands: `npm run test:int` must also pass before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors. Out-of-scope problems go in your report, not in the diff.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Objective
Remove files that are dead code or actively misleading documentation, so no future session (human or AI) is steered wrong by them.

## Steps
1. For each file below, first PROVE it is unreferenced: `git grep -n "<basename-without-extension>"` across the repo must return no imports/requires/script references (matches inside the file itself, in docs, or in `scripts/archive/` don't count). Then `git rm` it:
   - `backend/server.js.bak`
   - `backend/_attendance_routes.js`
   - `backend/attendanceKPI.js`
   - `backend/check_bonus_http.js`
   - `backend/test.js`
   - `backend/cleanup.js`
   - `frontend/src/PayrollIntegration.jsx`
   - `frontend/src/ClientMaster.jsx`
   - `frontend/src/features/attendance/MonthlyReport.jsx` and `TeamSetup.jsx` (8- and 6-line stubs) — also remove whatever imports/renders them (check `App.jsx` and any feature index).
   - The `MockOCR` import line in `frontend/src/App.jsx` (the component is imported but never rendered). Leave `MockOCR.jsx` itself in place if anything else references it; delete it too if nothing does.
   - If any file above IS referenced, do not delete it; record where it's referenced in your report instead.
2. Delete the three contradictory blueprints: `SYSTEM_BLUEPRINT.md`, `SYSTEM_BLUEPRINT_MASTER.md`, `backend/BLUEPRINT.md`. (They claim server.js is 3,800/18,000 lines — it is ~9,263; they list already-fixed vulnerabilities as live-critical; one documents roles that don't exist.)
3. Write `ARCHITECTURE.md` at repo root, 1–2 pages max, containing ONLY verified facts: the two-world payroll split and the consolidation direction (summarize from `.agents/REMEDIATION_PLAN.md`), the canonical-table list (client_invoices not invoices; employee_claims as the claims store; payroll_runs as the target engine; payroll_transactions as legacy+history), deployment topology (Render services incl. staging, Neon branches, env var count pointing to `.env.example` as the authoritative list), and a pointer to REMEDIATION_PLAN.md.
4. Edit `.agents/AGENTS.md`:
   - Replace every instruction to read `SYSTEM_BLUEPRINT.md`/`backend/BLUEPRINT.md` with `ARCHITECTURE.md` + `REMEDIATION_PLAN.md`.
   - In Section 7, delete the anti-pattern row "Create a new top-level route file without discussion … all routes stay in server.js" (contradicted by its own §2.6; new routes go in `backend/src/modules/*`).
   - Add to Section 2: "**No new DDL in server.js — ever.** The inline CREATE TABLE block is frozen as-is (it remains load-bearing until Phase 9). All new DDL goes through `backend/migrations/` (node-pg-migrate)."
   - Add a short section pointing to the remediation program: current phase, session protocol.
5. Also update any other doc that instructs readers to consult the deleted blueprints (`git grep -l "SYSTEM_BLUEPRINT"`).

## Verification checklist
- [ ] `cd backend && npm test` green (147+ tests) and `node --check server.js` clean.
- [ ] `cd frontend && npm run build` succeeds.
- [ ] `git grep -l "SYSTEM_BLUEPRINT"` returns nothing (or only historical changelog mentions inside AGENTS.md §10, which may stay).
- [ ] Deploy `staging` branch; click through: login, Employee Information, Payroll tab, Billing tab — no console errors attributable to the deletions.

## Rollback
`git revert` the commit.
