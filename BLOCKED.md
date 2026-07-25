# BLOCKED — S5B shadow month (payroll team + MD sign-off)

_Last updated: 2026-07-25_

## Active blocker

**S5B shadow month** requires real month-M payroll data from the payroll team:

1. Import attendance/claims for pilot contract `CTR-1773048704450` (Facility Management, 38 employees)
2. `POST /api/payroll-runs/compute` for month M (do not lock)
3. Payroll team exports Excel CSV per `scripts/VARIANCE_INPUT_FORMAT.md`
4. Run `node scripts/variance_report.js --csv <file> --contract CTR-1773048704450 --month M --year Y`
5. Drive all deltas to zero (config → input → engine fixes per `.agents/sessions/S5B_shadow_month.md`)
6. MD written sign-off filed in `audit/pilot/` before S5C

## Staging environment

| Service | URL | Status |
|---|---|---|
| `asil-hcm-frontend-staging` | https://asil-hcm-frontend-staging.onrender.com | **Live** |
| `asil-hcm-staging` | https://asil-hcm-staging.onrender.com | **Live** (`7827f8d`; S5A pending deploy) |

## Recently resolved

**S5A (2026-07-25)** — variance tool + pilot selection (`CTR-1773048704450`). Commit pending push.

**S4B (2026-07-24)** — disbursement route + PayrollRun UI (`7827f8d`).

**S4A (2026-07-24)** — `disburseRun()` service (`00e1255`).

**Integration tests** — `npm run test:int` **28/28** green (ci-test).

**Git** — `origin/staging` through S4B (`7827f8d`). `main` untouched.
