# S2A — Real-Postgres integration test skeleton

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 3. After ANY backend edit: `node --check backend/server.js` and `npm test` (in `backend/`) must pass. Once Phase 2 lands: `npm run test:int` must also pass before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors. Out-of-scope problems go in your report, not in the diff.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Background
Every existing backend test mocks `pg.Pool` (`backend/tests/setup.js`) — SQL never executes, so column-mismatch bugs like the old Wafi INSERT are invisible by design. This phase adds a second test tier that runs real SQL against a real Postgres: the Neon `ci-test` branch created in S0B. (Chosen over Docker/testcontainers because this is a Windows dev machine without Docker; over pg-mem because pg-mem doesn't faithfully support ON CONFLICT partial indexes and other features this codebase uses.)

## Steps
1. Create `backend/tests-int/` with its own Jest config (`backend/jest.int.config.js`): `testMatch: ['**/tests-int/**/*.test.js']`, `maxWorkers: 1` (suites share one DB), long timeout (60s — Neon cold starts), NO `tests/setup.js` mock.
2. `backend/tests-int/setup.js`:
   - Reads `TEST_DATABASE_URL`. **Refuses to run** (throws with a clear message) unless the connection string contains the substring `ci-test` — this hard-blocks accidentally pointing tests at prod or staging.
   - Global setup: drop+recreate the `public` schema, then apply `audit/groundtruth/schema_prod.sql` (from S0A), then run `npm run migrate` programmatically (node-pg-migrate API) so migration-managed tables are current.
   - Provides `truncateAll()` helper (truncate all tables except `pgmigrations`, RESTART IDENTITY CASCADE) run in `beforeEach` of every suite, plus a shared pool export.
3. `package.json` (backend): `"test:int": "jest -c jest.int.config.js"`. The existing mocked `npm test` is untouched.
4. Smoke test `tests-int/smoke.test.js`: inserts an employee + contract, reads them back, asserts `to_regclass('payroll_runs')` is non-null.
5. Document in `.agents/AGENTS.md` (Section 2): the procedural gate — since there is no CI, **a green local `npm run test:int` is mandatory before pushing anything that touches** `/api/ap/*`, `/api/payroll*`, `payment_*` tables, `payroll_run*` tables, or `employee_claims`. Also document how to set `TEST_DATABASE_URL` (Neon ci-test branch; never committed).

## Verification checklist
- [ ] `npm run test:int` green from a cold Neon branch (paste output).
- [ ] Deliberately set `TEST_DATABASE_URL` to the staging string → the runner refuses with the guard message (paste it).
- [ ] `npm test` (mocked tier) still green.

## Rollback
Delete `tests-int/` + config; no production surface touched.
