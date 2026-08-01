# Week 1 — Pilot shadow month status

**Date:** 2026-08-02 (autonomous agent session)  
**Main commit:** `ff34925` — PR #7 merged 2026-08-01 (owner board + execution plan)  
**Pilot contract:** `CTR-1773048704450` — Facility Management, Wafi Energy (38 employees)  
**Plan:** `docs/AUTONOMOUS_EXECUTION_PLAN.md` Week 1

---

## 1. Deploy verification

| Environment | URL | `/health` commit | Expected | Status |
|---|---|---|---|---|
| **Production** | https://asilhcm.onrender.com/health | `32abcad` | `ff34925` or newer | **PENDING** — polled 12× over ~6 min (2026-08-02 00:59–01:05 PKT); Render auto-deploy from `main` not yet visible |
| **Staging** | https://asil-hcm-staging.onrender.com/health | `32abcad` | separate `staging` branch | **BEHIND** — `origin/staging` still at `32abcad`; `origin/main` at `ff34925` |

**Notes:**

- `render.yaml`: prod deploys from **`main`**; staging deploys from **`staging`** branch (not main).
- PR #7 merged to `main` only — staging will not pick up those docs until `staging` is merged from `main` (see `audit/pilot/WEEK2_STATUS.md` §1).
- Re-check prod after Render build completes: `curl.exe -s https://asilhcm.onrender.com/health | jq .commit`

---

## 2. Staging DB readiness (pilot contract)

**Status: NOT QUERIED — `STAGING_DATABASE_URL` unavailable in agent environment.**

| Item | Expected (S0A prod ground truth) | Staging query needed |
|---|---|---|
| Employees on `CTR-1773048704450` | **38** active (`audit/groundtruth/facts.md` §6) | `SELECT COUNT(*) FROM employees WHERE contract_id = 'CTR-1773048704450' AND active = 'Yes';` |
| `contract_policies` row | Present | `SELECT * FROM contract_policies WHERE contract_id = 'CTR-1773048704450';` |
| `payroll_runs` for 2026 | Unknown on staging | `SELECT id, period_month, period_year, status FROM payroll_runs WHERE contract_id = 'CTR-1773048704450' AND period_year = 2026 ORDER BY period_month;` |
| Attendance + claims | Required for compute | `attendance_records` count by month; `employee_claims` with `status = 'focal_approved'` |

Agent did **not** query production for Week 1 counts.

---

## 3. Variance report CLI (S5A / task 1.3)

### Offline fixture test — **PASS**

Run from `C:\temp\BPOFMSystem-variance` (GDrive `backend/node_modules/dotenv` corrupt on `G:\My Drive\...`):

```powershell
cd C:\temp\BPOFMSystem-variance
git pull origin main   # ensure ff34925+
cd backend; npm ci
cd ..
node scripts/variance_report.js --csv audit/pilot/fixtures_s5a_excel_match.csv --hcm-json audit/pilot/fixtures_s5a_hcm.json
```

**Result (2026-08-02):** exit **0**, gate PASS, 3 rows compared, zero variance.

### Live pilot month — **BLOCKED**

Blocked on payroll team Excel CSV export (`BLOCKED.md`). Command when ready:

```powershell
$env:STAGING_DATABASE_URL = "<Neon staging branch URL>"
node scripts/variance_report.js `
  --csv "audit\pilot\wafi_fm_<MONTH>_<YEAR>.csv" `
  --contract CTR-1773048704450 `
  --month <M> --year <Y> `
  --out-dir audit\pilot
```

Prerequisites: computed `payroll_run` on staging; CSV per `scripts/VARIANCE_INPUT_FORMAT.md`.

**Unit tests:** `backend/tests/varianceCompare.test.js` (7 tests).

---

## 4. PR #7 scope (merged)

PR #7 delivered **documentation and agent tooling only** (no application code):

- `OWNER_BOARD.md`, `docs/AUTONOMOUS_EXECUTION_PLAN.md`, `docs/OWNER_VISION_AUDIT.md`
- Cursor skills (`chief`, `morning`, `status`, etc.) and morning-brief automation prompt

Portal payslip bridge and payslip branding remain **not merged** — still open in Week 3 plan.

---

## 5. Blockers (owner / payroll team)

| Blocker | Owner action |
|---|---|
| **S5B variance to zero** | Payroll team exports Excel CSV for pilot month per `VARIANCE_INPUT_FORMAT.md` |
| **Staging row counts** | Provide `STAGING_DATABASE_URL` or run queries in §2 |
| **Prod deploy proof** | Re-poll `/health` until commit starts with `ff34925` |
| **Staging branch merge** | Merge `main` → `staging` when BPO/PSO work allows (document first) |
| **MD sign-off (1.5)** | **Red** — owner phrase required |
| **Week 2 prod pay** | **Red** — `Go red:` for prod compute/disburse |

---

*Next update: after prod deploy shows `ff34925+`, staging merge, or payroll CSV received.*
