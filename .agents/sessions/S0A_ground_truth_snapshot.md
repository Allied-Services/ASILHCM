# S0A — Production ground-truth snapshot (READ-ONLY session)

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 3. After ANY backend edit: `node --check backend/server.js` and `npm test` (in `backend/`) must pass. Once Phase 2 lands: `npm run test:int` must also pass before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors. Out-of-scope problems go in your report, not in the diff.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Objective
Capture what production ACTUALLY is (schema + facts) before anything is changed, and create a repeatable backup script. This session makes **zero changes to the database or application code** — it only reads prod and commits artifacts to the repo.

## Prerequisites
- The production `DATABASE_URL` (Neon) available in the shell environment (ask the MD to provide it; do NOT commit it anywhere).
- `pg_dump` / `psql` installed locally (PostgreSQL client tools for Windows). If missing, install via the PostgreSQL installer or `winget install PostgreSQL.PostgreSQL` and use only the client binaries.

## Steps
1. Create `scripts/backup_prod.ps1`: runs `pg_dump -Fc -d $env:DATABASE_URL -f "backups/prod_$(Get-Date -Format yyyyMMdd_HHmmss).dump"`, creating `backups/` if needed. Add `backups/` to `.gitignore`. This script is re-run before every risky phase and every cutover month.
2. Run it once. Confirm the dump file exists and is > 1 MB.
3. Schema-only snapshot: `pg_dump --schema-only --no-owner --no-privileges -d $env:DATABASE_URL -f audit/groundtruth/schema_prod.sql`. Commit this file.
4. Create `audit/groundtruth/facts.md` answering ALL of the following with the actual query outputs (read-only queries via `psql`):
   - `SELECT name, run_on FROM pgmigrations ORDER BY run_on;` — which of the 21 files in `backend/migrations/` have run on prod? List any missing. **If `20260706120000_payroll_runs` has not run, flag in bold at the top: Phase 4 blocked until migrations are brought current.**
   - `SELECT column_name FROM information_schema.columns WHERE table_name='payroll_transactions' ORDER BY ordinal_position;` — does prod have the legacy `ot`, `opd`, `reimb` columns? (Settles whether the broken Wafi INSERT crashed or silently wrote to dead columns.)
   - `SELECT to_regclass(t) FROM unnest(ARRAY['payroll_runs','payroll_run_rows','contract_policies','employee_claims','monthly_attendance_overrides','cost_allocations','contract_rate_cards','public_holidays']) AS t;` — existence check for every table Phase 2–5 depends on.
   - Full `employee_claims` column list (same information_schema query pattern).
   - Locked-payroll history range: `SELECT MIN(year*100+month), MAX(year*100+month), COUNT(*) FROM payroll_transactions WHERE locked = TRUE;` (if a `locked` column exists; otherwise report that it doesn't and adapt).
   - Pilot-selection data (the S5 pilot decision consumes this):
     ```sql
     SELECT c.id, c.contract_name, cl.name AS client, c.status,
            (SELECT COUNT(*) FROM employees e WHERE (e.contract_id = c.id OR e.contract_name = c.contract_name) AND e.active = 'Yes') AS emp_count,
            (cp.contract_id IS NOT NULL) AS has_policy, cp.ot_allowed, cp.working_days_override,
            (SELECT COUNT(*) FROM monthly_attendance_overrides mao JOIN employees e2 ON e2.id = mao.employee_id
              WHERE e2.contract_id = c.id OR e2.contract_name = c.contract_name) AS attendance_override_rows
     FROM contracts c
     LEFT JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN contract_policies cp ON cp.contract_id = c.id
     WHERE c.status = 'Active'
     ORDER BY emp_count;
     ```
     If any referenced column doesn't exist on prod, adapt the query minimally and note the difference in facts.md.
5. Restore-test the backup into a scratch Neon branch (create branch `restore-test`, `pg_restore` into it, run `SELECT COUNT(*) FROM employees;`, then delete the branch).

## Deletions
None.

## Verification checklist
- [ ] `audit/groundtruth/schema_prod.sql` committed, > 2,000 lines.
- [ ] `audit/groundtruth/facts.md` committed with every bullet answered using real query output.
- [ ] `backups/*.dump` exists locally (NOT committed) and restore-test succeeded (paste the employees count).
- [ ] `git status` shows no application code changed.

## Rollback
None needed — read-only.
