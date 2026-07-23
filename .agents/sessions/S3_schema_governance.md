# S3 — Single schema source of truth

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. AP confirm routes: edits require `npm run test:int` green before push (S2B gate).
> 3. After ANY backend edit: `node --check backend/server.js` + `npm test`; `npm run test:int` before pushing money-path changes.
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs.

## Background
Three schema definitions coexist: `database/schema.sql` (explicitly "aspirational", describes tables that don't exist — `employee_master`, UUID PKs — and tax slabs that contradict `taxEngine.js`), ~42 inline `CREATE TABLE IF NOT EXISTS` in server.js startup (~8580–8960 — the REAL live tables), and 21 node-pg-migrate files. The inline block is idempotent and load-bearing (migrations FK-reference its tables, ordering via `mountModules.js` bootstrapRestructure) — it is FROZEN, not removed (removal is Phase 9, after server.js decomposition).

## Steps
1. Replace the entire contents of `database/schema.sql` with the prod snapshot `audit/groundtruth/schema_prod.sql` (S0A), topped with:
   ```
   -- GENERATED from production via pg_dump --schema-only. DO NOT HAND-EDIT.
   -- Regenerate after every migration deploy: see scripts/regen_schema.ps1
   -- Generated: <date>
   ```
2. Create `scripts/regen_schema.ps1`: runs the same pg_dump schema-only command against `$env:DATABASE_URL` into `database/schema.sql` (with the header). Document in AGENTS.md that it must be run after each migration reaches prod.
3. Edit `.agents/AGENTS.md` §2.3: replace the old DDL-staging text with: (a) inline server.js DDL block is frozen — nothing added ever; (b) ALL new DDL via `backend/migrations/` (node-pg-migrate), idempotent; (c) regenerate `database/schema.sql` after each migration deploy; (d) `tests-int` bootstraps from schema.sql + migrations, so a stale schema.sql breaks tests — that's intentional.
4. Point the `tests-int/setup.js` bootstrap (S2A) at `database/schema.sql` instead of `audit/groundtruth/schema_prod.sql`, so tests continuously validate that the committed schema is the real one. Keep the S0A file as a frozen historical artifact.

## Verification checklist
- [ ] Reset the Neon `ci-test` branch (or drop/recreate schema), run `npm run test:int` from scratch → green, proving `database/schema.sql` + migrations fully bootstrap a working DB.
- [ ] `git grep -n "employee_master" database/` → no matches.
- [ ] `npm test` green.

## Rollback
`git revert`.
