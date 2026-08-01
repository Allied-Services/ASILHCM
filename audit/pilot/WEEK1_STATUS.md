# Week 1 — Pilot shadow month status

**Date:** 2026-08-02  
**Branch:** `feat/chief-owner-board-morning` (PR #7)  
**Pilot contract:** `CTR-1773048704450` — Facility Management, Wafi Energy (38 employees)  
**Plan:** `docs/AUTONOMOUS_EXECUTION_PLAN.md` Week 1

---

## 1. Staging deploy health

| Check | Result | Evidence |
|---|---|---|
| Frontend `https://asil-hcm-frontend-staging.onrender.com` | **200 OK** | `curl.exe -sI` → `HTTP/1.1 200 OK`, `Content-Type: text/html`, Render `rndr-id: 8bb0b0ea-97ba-4c71` |
| Backend `https://asil-hcm-staging.onrender.com/health` | **200 OK** | `{"status":"ok","migrations":"ok","commit":"32abcad15a5b9af8cd38157f0f080f0b09aae7b9"}` (cold start ~45s) |

Staging is awake and serving. Frontend last-modified matches same-day deploy.

---

## 2. Pilot contract DB readiness (staging)

**Status: NOT QUERIED — `STAGING_DATABASE_URL` unavailable in agent environment.**

| Item | Expected (S0A prod ground truth) | Staging query needed |
|---|---|---|
| Employees on `CTR-1773048704450` | **38** active (`audit/groundtruth/facts.md` §6) | `SELECT COUNT(*) FROM employees WHERE contract_id = 'CTR-1773048704450' AND active = 'Yes';` |
| `contract_policies` row | Present (`has_policy = t`) | `SELECT * FROM contract_policies WHERE contract_id = 'CTR-1773048704450';` |
| `payroll_runs` for 2026 | Unknown on staging | `SELECT id, period_month, period_year, status FROM payroll_runs WHERE contract_id = 'CTR-1773048704450' AND period_year = 2026 ORDER BY period_month;` |
| Attendance + claims | Required for compute | `attendance_records` count by month; `employee_claims` with `status = 'focal_approved'` |

### What owner/ops must provide

1. Add Neon **staging** branch connection string to `backend/.env.local` as `STAGING_DATABASE_URL` (see `docs/STAGING_SETUP.md` §1a — never commit).
2. Run the four queries above and paste counts into this file (or run `node scripts/variance_report.js` once a run exists).
3. Confirm staging DB was seeded from prod backup (`pg_restore` per STAGING_SETUP §1c) — BPO/PSO work on `C:\Projects\ASILHCM-Staging` is separate; do not mix branches without coordination.

`backend/.env` in this workspace only has production `DATABASE_URL`; agent did **not** query production for Week 1 counts.

---

## 3. Variance report CLI (S5A / task 1.3)

**Blocked on payroll team Excel CSV** (`BLOCKED.md`). CLI reviewed in source; `--help` verified from `usage()` in `scripts/variance_report.js`.

### Help output (from code)

```
Usage: node scripts/variance_report.js --csv <path> --contract <id> --month <m> --year <y>
       node scripts/variance_report.js --csv <path> --hcm-json <path>   (offline / verification)
Options:
  --out-dir <dir>     Output directory (default: cwd)
  --database-url      Override DATABASE_URL
```

### Exact command for payroll team (once CSV is ready)

From repo root, with `STAGING_DATABASE_URL` or staging `DATABASE_URL` set:

```powershell
cd "G:\My Drive\Experiments\BPOFMSystem"
$env:STAGING_DATABASE_URL = "<Neon staging branch URL>"
node scripts/variance_report.js `
  --csv "audit\pilot\wafi_fm_<MONTH>_<YEAR>.csv" `
  --contract CTR-1773048704450 `
  --month <M> `
  --year <Y> `
  --out-dir audit\pilot
```

**Prerequisites before running:**

1. HCM has a **computed** (ideally locked) `payroll_run` for the same contract/month/year (`POST /api/payroll-runs/compute` on staging Payroll Run tab).
2. CSV columns per `scripts/VARIANCE_INPUT_FORMAT.md` (employee_id, paid_days, gross, income_tax, eobi, net_pay, …).
3. Exit code **0** = zero variance; non-zero writes `variance_summary.md` + delta CSV in `--out-dir`.

**Offline verification (no DB):** use fixture pair under `audit/pilot/`:

```powershell
node scripts/variance_report.js --csv audit\pilot\fixtures_s5a_excel_match.csv --hcm-json audit\pilot\fixtures_s5a_hcm.json
```

**Note:** GDrive `backend/node_modules` may corrupt `dotenv` (`ERR_INVALID_PACKAGE_CONFIG`); run from a local clone or `C:\Temp\BPOFMSystem-*` if needed.

**Unit tests:** `backend/tests/varianceCompare.test.js` (7 tests).

---

## 4. Code delivered this session (Week 3 prep)

**Portal payslips from World B** (task 1.4 candidate — implemented surgically):

| File | Change |
|---|---|
| `backend/src/modules/portal/payslipBridge.js` | New: merge World A `payroll_transactions` + World B `payroll_run_rows` summaries; World B wins same period |
| `backend/server.js` | `GET /api/portal/me` uses bridge; `GET /api/payslip/:id/:month/:year` serves World B HTML via `payrollrun/payslip.js` when locked+ run exists |
| `backend/tests/portalPayslipBridge.test.js` | Unit tests for merge + mapping |
| `backend/tests/portalAuth.test.js` | Integration test: portal `/me` returns World B payslip |

Does **not** touch World A AP confirm, BPO/PSO staging, or production disbursement.

---

## 5. Blockers (owner / payroll team)

| Blocker | Owner action |
|---|---|
| **S5B variance to zero** | Payroll team exports Excel CSV for pilot month per `VARIANCE_INPUT_FORMAT.md` |
| **Staging row counts** | Provide `STAGING_DATABASE_URL` or run queries in §2 and update this file |
| **S5B delta triage** | After CSV + compute, fix engine/policy deltas per `.agents/sessions/S5B_shadow_month.md` |
| **MD sign-off (1.5)** | **Red** — owner phrase required |
| **Week 2 prod pay** | **Red** — `Go red:` for prod compute/disburse |

---

## 6. Test evidence

| Check | Result |
|---|---|
| `node --check backend/server.js` | Pass |
| `node -e` smoke test `payslipBridge.js` merge logic | Pass (World B wins same period) |
| `npm test` (GDrive `node_modules`) | Exit 0 but Jest produces no stdout on this path — known GDrive corruption; re-run from local clone before merge |

Files: `backend/tests/portalPayslipBridge.test.js`, `backend/tests/portalAuth.test.js` (World B `/api/portal/me` case).

---

*Next update: after `STAGING_DATABASE_URL` query or payroll CSV received.*
