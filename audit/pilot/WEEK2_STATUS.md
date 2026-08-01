# Week 2 — Pilot pay through new engine (staging dry-run)

**Date:** 2026-08-02  
**Session:** autonomous Week 2 prep (`feat/autonomous-week2-prep`)  
**Pilot contract:** `CTR-1773048704450` (Facility Management, 38 employees)  
**Plan:** `docs/AUTONOMOUS_EXECUTION_PLAN.md` Week 2 · Runbook: `.agents/sessions/S5C_pilot_cutover.md`

---

## 1. Staging branch alignment

| Branch | HEAD | Deploy target |
|---|---|---|
| `origin/main` | `ff34925` (PR #7 merged 2026-08-01) | `asilhcm` + `asil-hcm-frontend` |
| `origin/staging` | `32abcad` (PR #4) | `asil-hcm-staging` + `asil-hcm-frontend-staging` |

**Gap:** staging is **5 commits behind** main (docs/skills from PR #7 only — no payroll code delta between `32abcad` and `ff34925`).

**Before merging `main` → `staging`:**

1. Confirm no active BPO/PSO contract work on `C:\Projects\ASILHCM-Staging` that would conflict (`AUTONOMOUS_EXECUTION_PLAN.md` rule 2).
2. Document merge intent here (date, agent, owner ack if needed).
3. `git checkout staging && git merge main && git push origin staging`
4. Wait for Render staging deploy; verify `/health` commit matches post-merge SHA.

**Do not merge to staging silently** — owner or Chief must acknowledge if BPO track is active.

---

## 2. Staging dry-run lifecycle (compute → lock → invoice → disburse)

Full World B payment path on **Neon staging DB only**. World A prod untouched.

### Preconditions

- [ ] Staging awake (`/health` 200; cold start may take ~45s on free tier)
- [ ] `STAGING_DATABASE_URL` available; pilot contract has policy + rate card + attendance
- [ ] No locked legacy `payroll_transactions` for pilot contract in target month (disbursement Guard B)
- [ ] Role: `payroll_initiator` or `superadmin` for compute/lock; `ap_team`/`finance_manager` for disburse

### Step-by-step (staging UI: Payroll Run tab)

| Step | Action | API / UI | Verify |
|---|---|---|---|
| 1 | Import attendance + approve claims | Attendance module, Wafi staging | Rows exist for pilot month |
| 2 | **Compute** | `POST /api/payroll-runs/compute` or PayrollRun UI | `payroll_runs` row `draft`; `payroll_run_rows` populated |
| 3 | **Variance** (shadow) | `node scripts/variance_report.js --csv ... --contract CTR-1773048704450` | Exit 0 before lock |
| 4 | Row review / patch | PayrollRun UI row overrides | Recompute if patched |
| 5 | **Lock** | `POST /api/payroll-runs/:id/lock` | Status `locked`; `cost_allocations` written |
| 6 | **Invoice** | `POST /api/payroll-runs/:id/invoice` | `client_invoices` row; status `invoiced` |
| 7 | **Disburse** | PayrollRun Disburse modal (S4B) | `payment_batches` + `payment_ledger`; run `paid`; batch id `PB-...` |
| 8 | AP verify | Existing AP screens | Ledger totals match run net pay |

### Rollback (staging)

Before any real bank file: `scripts/rollback_disbursement.sql` for the batch id → run returns to `locked`.

### Test gate (before any PR touching money routes)

```powershell
cd backend
npm test
npm run test:int   # requires TEST_DATABASE_URL with ci-test substring
node --check server.js
```

Integration coverage: `tests-int/disbursement.test.js`, `worldB.engine.test.js`, `worldA.payment.test.js`.

---

## 3. Checklist — when payroll CSV arrives

Owner/payroll team delivers Excel export per `scripts/VARIANCE_INPUT_FORMAT.md`:

- [ ] Save CSV to `audit/pilot/wafi_fm_<MONTH>_<YEAR>.csv`
- [ ] Ensure staging has computed run for same contract/month/year
- [ ] Run variance CLI (staging `DATABASE_URL` or `STAGING_DATABASE_URL`)
- [ ] If deltas: triage per `.agents/sessions/S5B_shadow_month.md` (config → input → engine)
- [ ] Drive to exit 0; attach `variance_summary.md` to `audit/pilot/`
- [ ] **MD sign-off** filed (Red gate) before S5C prod cutover
- [ ] Only then: staging dry-run §2 above, then prod with `Go red:` phrases

---

## 4. Blocked on owner (Red gates — do not proceed while owner asleep)

| Item | Phrase / action needed |
|---|---|
| Production compute for pilot month | `Go red: prod compute CTR-1773048704450` |
| Production lock + disburse + bank file | `Go red: prod disburse` + MD authorizes transmission |
| Prod backup before pay week | `scripts/backup_prod.ps1` with prod `DATABASE_URL` |
| MD sign-off on zero-variance shadow report | Written approval in `audit/pilot/` |
| Merge `main` → `staging` | Confirm BPO/PSO track idle |
| Render secrets (Resend, Jazz, OpenAI, Xero) | `Go red:` + dashboard update |
| Payslip logo (Week 3.4) | Add `frontend/public/asil-logo.png` asset — referenced in `LoginScreen.jsx` but **missing from repo**; TODO only until asset supplied |

---

## 5. Payslip branding (Week 3 early win — skipped)

**No logo asset in repository.** `LoginScreen.jsx` and `DocumentGenerator.jsx` reference `/asil-logo.png` but `frontend/public/` has no PNG logo (only CSV templates and `vite.svg`).

**TODO:** Owner supplies `asil-logo.png` (recommended ≥200px wide); then wire into:

- `backend/src/modules/payrollrun/payslip.js`
- `server.js` World A payslip HTML (`GET /api/payslip/:employeeId/:month/:year`)

No code change this session — avoids broken image URLs in email HTML.

---

## 6. Evidence log

| Check | When | Result |
|---|---|---|
| Offline variance fixtures | 2026-08-02 | PASS exit 0 (`C:\temp\BPOFMSystem-variance`) |
| Prod `/health` | 2026-08-02 01:09 PKT | `32abcad` — deploy pending |
| Staging `/health` | 2026-08-02 01:09 PKT | `32abcad` |
| Staging dry-run lifecycle | — | **Not started** — needs DB URL + branch merge |

---

*Update this file after staging merge, dry-run screenshot, or payroll CSV variance run.*
