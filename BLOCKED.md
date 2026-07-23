# BLOCKED — S0A restore-test (step 5)

**Session:** S0A — Production ground-truth snapshot  
**Step:** 5 — Restore-test backup into scratch Neon branch `restore-test`  
**Date:** 2026-07-24

## What was attempted

1. **`neonctl branches list`** — requires interactive browser OAuth (`oauth2.neon.tech`); no headless credentials available.
2. **`$env:NEON_API_KEY`** — not set in the execution environment.
3. **Neon Management API** — project ID not discoverable from connection string alone; branch create/delete requires API key.

## What succeeded

- Full `pg_dump -Fc` backup: `backups/prod_20260724_041440.dump` (797 MB).
- Dump integrity verified via `pg_restore --list` (1,095 TOC entries, dbname `neondb`).
- Production `SELECT COUNT(*) FROM employees` → **682** (expected post-restore parity target).

## Unblock

Provide **one** of:

1. `NEON_API_KEY` with permission to create/delete branches on the `ep-dry-shadow-ad443mnl` Neon project, **or**
2. MD manually creates branch `restore-test` from main in Neon console and shares its `DATABASE_URL`.

Then run:

```powershell
$env:Path = "C:\Program Files\PostgreSQL\18\bin;" + $env:Path
$env:RESTORE_URL = "<restore-test-branch-database-url>"
pg_restore -d $env:RESTORE_URL --no-owner --no-privileges "backups/prod_20260724_041440.dump"
psql $env:RESTORE_URL -c "SELECT COUNT(*) FROM employees;"
# Delete branch restore-test in Neon console when done
```

## Impact

S0A read-only snapshot and backup script deliverables are complete. Restore-test verification is the only open checklist item before S0A is fully green.
