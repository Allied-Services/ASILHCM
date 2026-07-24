# BLOCKED — S0B staging dashboard steps (MD action required)

_Last updated: 2026-07-24_

Automated agent could not create Neon branches or Render services (no `NEON_API_KEY`, no staging `DATABASE_URL` in shell). Code deliverables (`render.yaml`, `docs/STAGING_SETUP.md`) are committed; infrastructure steps require MD.

## MD checklist (see `docs/STAGING_SETUP.md` for full detail)

1. **Neon:** Create branches `staging` and `ci-test` from `production`. Save connection strings privately.
2. **Git:** `git push -u origin staging` (if not already on remote).
3. **Render:** Create `asil-hcm-staging` (web) and `asil-hcm-frontend-staging` (static) per `render.yaml`.
4. **Seed:** `pg_restore` S0A backup into Neon `staging` branch; verify `SELECT COUNT(*) FROM employees` → 682.
5. **OAuth:** Add staging URLs to Google OAuth client authorized origins/redirects.
6. **Verify:** `https://asil-hcm-staging.onrender.com/health` returns OK.

## Impact

S0B code artifacts complete. Sessions S0C+ can proceed locally. Staging E2E verification (S0B checklist items 29–31) blocked until MD completes steps above.

## Recently resolved

**S0A restore-test (step 5)** — completed 2026-07-24. MD created Neon branch `restore-test`; `pg_restore` + employee count **682** (parity with prod). See `audit/groundtruth/facts.md` §7. Delete the `restore-test` branch in Neon console when no longer needed.
