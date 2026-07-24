# BLOCKED — staging dashboard + integration test DB (MD action required)

_Last updated: 2026-07-24_

## S0B — Staging infrastructure (MD)

Automated agent could not create Neon branches or Render services (no `NEON_API_KEY`, no staging `DATABASE_URL` in shell). Code deliverables (`render.yaml`, `docs/STAGING_SETUP.md`) are committed.

**MD checklist:** see `docs/STAGING_SETUP.md` — Neon `staging` + `ci-test` branches, push `staging` git branch, Render services, OAuth URLs, `pg_restore` seed, `/health` verify.

## S2A — Integration test execution (MD / dev machine)

`npm run test:int` harness is committed but **not executed** in overnight run — `TEST_DATABASE_URL` (Neon `ci-test` branch) not available. Runner refuses URLs without `ci-test` substring.

**Unblock:** Create Neon `ci-test` branch per `docs/STAGING_SETUP.md` §1b; set `$env:TEST_DATABASE_URL` locally; run `cd backend ; npm run test:int`.

## Recently resolved

**S0A restore-test (step 5)** — completed 2026-07-24. MD created Neon branch `restore-test`; `pg_restore` + employee count **682** (parity with prod). See `audit/groundtruth/facts.md` §7. Delete the `restore-test` branch in Neon console when no longer needed.
